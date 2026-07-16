/**
 * routes/ai-agent.js — POST /api/ai/agent (multi-turn tool-calling agent)
 *
 * Migrated from server.js. AGENT_TOOLS_v1.
 */

const express = require('express');

// Helpers
const { buildSystemPrompt, localizeToolResult } = require('../helpers/system-prompt');
const { callChatProvider } = require('../helpers/llm-client');
const {
  fetchDocsIndex,
  renderDocsIndexForPrompt,
  getCachedDocsIndex,
} = require('../helpers/docs-index');
const { buildSiteSnapshotAsync, renderSiteSnapshotForPrompt } = require('../helpers/site-snapshot');
const { buildFactsBlockAsync, backgroundExtractFacts } = require('../helpers/user-facts');
const {
  _getChatSummary,
  getChatSummaryAsync,
  summarizeMessages,
} = require('../helpers/chat-summary');
const { getActivePlanForUserAsync, renderActivePlanForPrompt } = require('../helpers/plans');
const dbMod = require('../db');
const convSync = require('../helpers/conversations');
const {
  getOrCreateActiveConversation,
  appendMessageToConversation,
  _maybeAutoTitleConversation,
  _maybeDetectTopicShift,
} = convSync;
const { logChatAudit } = require('../helpers/memory-privacy');
const {
  dashscopeEmbed,
  saveMemoryVector,
  cosineSim,
  MAX_CONTENT_LEN,
} = require('../helpers/memory-vectors');
const {
  aiConcurrencyAcquire,
  aiConcurrencyRelease,
  actRegistryGet,
} = require('../helpers/runtime');

// Agent tools
const { getToolDefs, dispatchTool } = require('../agent-tools');
const { inferExecutionPolicy } = require('../helpers/agent-execution-policy');
// 单细胞异步计算引擎已移除；act 工具的任务提交路径通过 ctx.createTask 判空优雅降级
// （act-tools.js: `if (!ctx.createTask) return { error: 'createTask not wired' }`）。
const createTask = null;
const {
  _gatherAnalysisContextForMethods,
  _renderMethodsParagraph,
} = require('../helpers/methods-export');
const { runAgentLoop } = require('../agent-runner');
const { aiTaskConcurrencyAcquire, aiTaskConcurrencyRelease } = require('../helpers/runtime');
const taskStore = require('../task-store');

// AGENT_TASK_MODE_v1：默认 task 模式（loop 后台跑 + 订阅重连），legacy 回退到直连 SSE
const USE_AGENT_TASK_MODE = (process.env.BIOF3_AGENT_TASK_MODE || 'task') !== 'legacy';

function _buildResultCardFromRunTool(result, context) {
  if (!result || typeof result !== 'object' || !result.toolJobId || result.needApproval) return null;
  const toolId = String(result.toolId || 'analysis');
  const payload = result.result && typeof result.result === 'object' ? result.result : {};
  const artifacts = Array.isArray(payload.artifacts)
    ? payload.artifacts.slice(0, 50).map((item) => {
        if (!item || typeof item !== 'object') return { name: String(item), type: 'file' };
        return {
          id: item.id ? String(item.id) : undefined,
          name: item.name ? String(item.name) : item.filename ? String(item.filename) : undefined,
          filename: item.filename ? String(item.filename) : item.name ? String(item.name) : undefined,
          type: item.type ? String(item.type) : 'file',
          label: item.label ? String(item.label) : item.title ? String(item.title) : undefined,
          title: item.title ? String(item.title) : item.label ? String(item.label) : undefined,
        };
      })
    : [];
  const files = Array.isArray(payload.files)
    ? payload.files.slice(0, 50).map((f) => {
        if (typeof f === 'string') return f;
        if (f && typeof f === 'object') return String(f.name || f.filename || '');
        return String(f);
      }).filter(Boolean)
    : [];
  const outputs = Array.isArray(payload.outputs)
    ? payload.outputs.slice(0, 50).map((item) => {
        if (!item || typeof item !== 'object') return { name: String(item) };
        return {
          id: item.id ? String(item.id) : undefined,
          name: item.name ? String(item.name) : undefined,
          filename: item.filename ? String(item.filename) : undefined,
          type: item.type ? String(item.type) : undefined,
          label: item.label ? String(item.label) : undefined,
        };
      })
    : [];
  return {
    jobId: String(result.toolJobId),
    toolId,
    title: `${toolId} 分析结果`,
    status: result.error || result.ok === false ? 'failed' : 'done',
    projectId: context && context.projectId ? String(context.projectId) : null,
    error: result.error || result.message ? String(result.message || result.error).slice(0, 1200) : undefined,
    artifacts,
    files,
    outputs,
  };
}

function _pushUniqueResultCard(cards, card) {
  if (!card || !card.jobId) return;
  if (cards.some((item) => item.jobId === card.jobId)) return;
  cards.push(card);
}

module.exports = function registerAiAgentRoute(app) {
  app.post('/api/ai/agent', express.json({ limit: '256kb' }), async (req, res) => {
    const { getApiKey, getChatProviderName, getChatModelPreset } = require('../helpers/ai-settings');
    const { messages, context, conversationId: explicitConvId, modelPresetId } = req.body || {};
    const selectedPreset = getChatModelPreset(modelPresetId);
    const providerName = (selectedPreset && selectedPreset.provider) || getChatProviderName();
    const modelName = selectedPreset && selectedPreset.model;
    const baseUrl = selectedPreset && selectedPreset.baseUrl;
    const apiKey = (selectedPreset && selectedPreset.apiKey) || getApiKey(providerName);
    if (!apiKey) return res.status(503).json({ status: 'error', error: 'AI 服务未配置' });

    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ status: 'error', error: '缺少消息' });
    }

    // ===== AGENT_TASK_MODE_v1：task 模式（loop 后台跑 + 订阅重连）=====
    if (USE_AGENT_TASK_MODE && req.query.legacy !== '1') {
      const userId = req.user && req.user.id;
      if (!userId) {
        return res.status(401).json({ status: 'error', error: '未登录' });
      }

      // 创建/复用会话
      let _activeConv = null;
      try {
        const hint = {
          conversationId: explicitConvId,
          page: context && context.page,
          projectId: context && context.projectId,
          titleHint:
            messages[0] && messages[0].content
              ? String(messages[0].content).slice(0, 40)
              : '新对话',
        };
        _activeConv = getOrCreateActiveConversation(userId, hint);
      } catch {}

      // 持久化 user 消息
      try {
        if (_activeConv) {
          const lastUser = [...messages].reverse().find((m) => m.role === 'user');
          if (lastUser) {
            const cleanContent = String(lastUser.content || '').replace(/^\[[^\]]+\]\s*\n?/, '');
            const meta = {
              page: context && context.page,
              projectId: context && context.projectId,
              datasetId: context && context.datasetId,
              analysisId: context && context.analysisId,
            };
            appendMessageToConversation(_activeConv.id, 'user', cleanContent, meta);
          }
        }
      } catch {}

      // 创建 agent task（engine='agent'，提交即 running）
      const { v4: uuidv4 } = require('uuid');
      const taskId = uuidv4();
      const guard = aiTaskConcurrencyAcquire(userId, taskId);
      if (!guard.ok) {
        return res.status(503).json({ error: guard.reason, message: guard.message });
      }
      try {
        taskStore.insertAgentTask({
          taskId,
          userId,
          params: { messages, context, conversationId: _activeConv && _activeConv.id },
        });
      } catch (e) {
        aiTaskConcurrencyRelease(userId, taskId);
        return res.status(500).json({ status: 'error', error: '创建 agent task 失败: ' + e.message });
      }

      // 后台跑 loop（不阻塞 HTTP 响应）。onEvent 推进程内实时订阅（若同进程有订阅端点）。
      // 事件同时写 task_events，订阅端点轮询回放。
      setImmediate(() => {
        runAgentLoop({
          messages,
          context,
          userId,
          conversationId: _activeConv && _activeConv.id,
          _activeConv,
          apiKey,
          providerName,
          modelName,
          baseUrl,
          taskId,
          onEvent: () => {
            /* 实时推进程内订阅（阶段 1 订阅端点轮询 task_events，onEvent 暂留空） */
          },
          shouldAbort: () => false, // 阶段 1：用户关浏览器不 abort，loop 继续跑
        }).catch((e) => {
          try {
            taskStore.markAgentFailed(taskId, e && e.message ? e.message : String(e));
          } catch {}
          try {
            aiTaskConcurrencyRelease(userId, taskId);
          } catch {}
        });
      });

      return res.json({ taskId, status: 'running', conversationId: _activeConv && _activeConv.id });
    }

    // ===== 老路径：直连 SSE（fallback，BIOF3_AGENT_TASK_MODE=legacy 或 ?legacy=1）=====

    // SSE first — browser shows activity; prompt build (docs index) can take seconds
    const _guardUserIdEarly = req.user?.id || req.user?.userId || 'anon';
    const _guardEarly = aiConcurrencyAcquire(_guardUserIdEarly);
    if (!_guardEarly.ok) {
      return res.status(503).json({ error: _guardEarly.reason, message: _guardEarly.message });
    }
    const _guardReleaseEarly = () => aiConcurrencyRelease(_guardUserIdEarly);
    res.on('close', _guardReleaseEarly);
    res.on('finish', _guardReleaseEarly);

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders && res.flushHeaders();
    const sseSend = (obj) => {
      try {
        res.write('data: ' + JSON.stringify(obj) + '\n\n');
      } catch {}
    };
    sseSend({ event: 'iter', n: 0 });

    // CONVERSATIONS_v1: resolve / create active conversation (async PG on ECS platform)
    let _activeConv = null;
    try {
      const _userId = req.user && req.user.id;
      if (_userId) {
        const hint = {
          conversationId: explicitConvId,
          page: context && context.page,
          projectId: context && context.projectId,
          titleHint:
            messages[0] && messages[0].content
              ? String(messages[0].content).slice(0, 40)
              : '新对话',
        };
        _activeConv = useConvAsync
          ? await convAsync.getOrCreateActiveConversation(_userId, hint)
          : getOrCreateActiveConversation(_userId, hint);
      }
    } catch {
      /* fall through, won't persist */
    }
    // CONVERSATIONS_v1: persist the latest user message
    try {
      if (_activeConv) {
        const lastUser = [...messages].reverse().find((m) => m.role === 'user');
        if (lastUser) {
          const cleanContent = String(lastUser.content || '').replace(/^\[[^\]]+\]\s*\n?/, '');
          const meta = {
            page: context && context.page,
            projectId: context && context.projectId,
            datasetId: context && context.datasetId,
            analysisId: context && context.analysisId,
          };
          if (useConvAsync) {
            await convAsync.appendMessageToConversation(_activeConv.id, 'user', cleanContent, meta);
          } else {
            appendMessageToConversation(_activeConv.id, 'user', cleanContent, meta);
          }
        }
      }
    } catch {
      /* ignore */
    }

    const isGuest = !(req.user && req.user.id);
    const ctxForPrompt =
      context && typeof context === 'object'
        ? { ...context, audience: isGuest ? 'guest' : 'user' }
        : { audience: isGuest ? 'guest' : 'user' };

    // Build the same rich system prompt used by /api/ai/chat
    let systemPrompt = buildSystemPrompt(ctxForPrompt);
    if (isGuest) {
      systemPrompt += '\n\n=== 当前用户：未登录访客 ===';
      systemPrompt +=
        '\n- 用户问「我是谁」：你是 BioF3 网站的**访客**（未注册/未登录），我看不到你的账号名或项目列表；不要调用 query(projects/datasets/analyses/facts/memories)。';
      systemPrompt += '\n- 可正常：解答教程、推荐学习路径、read_page/search 查公开文档；简单闲聊。';
      systemPrompt +=
        '\n- 不可代替用户：跑单细胞任务、读写云项目、act 写操作；需要时请引导注册/登录。';
      systemPrompt += '\n- 回答务必有正文，不要只调工具不说话。';
    }
    // Append docs index
    try {
      const idx = await fetchDocsIndex();
      const block = renderDocsIndexForPrompt(idx, 2200);
      if (block) systemPrompt += block;
    } catch {}
    // Append the local user's site snapshot, facts, summary, and active plan.
    try {
      const userId = req.user && req.user.id;
      if (userId) {
        const snap = await buildSiteSnapshotAsync(userId);
        const block = renderSiteSnapshotForPrompt(snap, 3500);
        if (block) systemPrompt += block;
        const factsBlock = await buildFactsBlockAsync(userId, 1200);
        if (factsBlock && factsBlock.trim()) {
          systemPrompt += '\n\n=== 关于该用户的已知事实（请记住并参考） ===' + factsBlock;
        }
        const sumRow = await getChatSummaryAsync(userId);
        if (sumRow && sumRow.summary) {
          systemPrompt += '\n\n=== 与该用户的对话历史摘要（已归档） ===\n' + sumRow.summary;
        }
        const activePlan = await getActivePlanForUserAsync(userId, _activeConv && _activeConv.id);
        if (activePlan) {
          systemPrompt += renderActivePlanForPrompt(activePlan);
        }
      }
    } catch {}

    // Add tool-calling instructions
    systemPrompt += '\n\n=== Tool Calling 指南 ===';
    systemPrompt += '\n你可以调用工具来获取真实数据：query / read_page / search';
    systemPrompt += '\n- 用户问"我有什么..."而 system prompt 已经列出 → 不必再 query，直接答';
    systemPrompt += '\n- 用户问的细节超出 prompt 列表 → 调用 query';
    systemPrompt += '\n- 用户想了解某个教程内容 → 调用 read_page';
    systemPrompt += '\n- 用户问"BioF3 里有没有..."这种探索性问题 → 调用 search';
    systemPrompt +=
      '\n- demo 数据路径（用户说"用 demo 数据"时用这些绝对路径）：'
      + '\n  volcano-plot: /Users/zhangdiandian/Documents/BioF3-Local/plugins/volcano-plot/demo-data/demo_deg.csv'
      + '\n  deseq2: /Users/zhangdiandian/Documents/BioF3-Local/plugins/deseq2/demo-data/demo-counts.csv（counts）+ /Users/zhangdiandian/Documents/BioF3-Local/plugins/deseq2/demo-data/demo-coldata.csv（coldata）'
      + '\n  其他工具的 demo 数据在 /Users/zhangdiandian/Documents/BioF3-Local/plugins/<toolId>/demo-data/ 目录下，先用 run_tool(op=list) 看 toolId，再拼路径。';
    systemPrompt +=
      '\n- 用户想**跑分析/出图/出表**（如"帮我跑 DESeq2""画火山图""分析这个 count 矩阵""做差异分析"）→ 调用 run_tool。先用 run_tool(op="list") 看可用工具+参数契约，再 run_tool(op="run", toolId, params) 执行。file 参数传本地绝对路径。**不要凭空判断运行时未装——先调 run_tool，执行报错再据错引导。**';
    systemPrompt +=
      '\n- 多步骤标准分析先用 run_tool(op="plan", templateId, initialInputs) 生成 Agent 主导计划，禁止一次性偷偷执行全部步骤。每一步完成后先验证 tool_job/artifact truth，再用 run_tool(op="bind_artifact", workflowPlan, fromToolJobId, fromStepId, toStepId, inputId, artifactId) 绑定真实产物并继续。';
    systemPrompt +=
      '\n- run_tool 跑完出图后，立即调用 act_generic(handlerId="open_result", payload={toolJobId}) 把结果展示给用户（主面板自动加载该 job 的图/表）。toolJobId 从 run_tool 的返回里取。不要让用户自己去翻 history。';
    systemPrompt +=
      '\n- agent 看图（read_image）：当用户问图内容（如"图里上调基因集中在哪""这张图说明了什么"），调 read_image(toolJobId) 让多模态模型（qwen-vl-max）解读图，返回的 description 可直接据此回答。token 较贵，仅用户明确问图内容时调，不要每次出图都读。';
    systemPrompt +=
      '\n- 重操作确认：run_tool 跑前判断——若工具属多步骤全流程（如 DESeq2 完整差异分析、WGCNA、ML 建模）或预计耗时较长，先在对话里告诉用户"将运行 X，约 N 秒，开始？"，等用户确认后再 run_tool。单图小工具（画火山图、PCA、热图等秒级完成的）直接跑，不用问。';
    systemPrompt += '\n- 工具调用后再判断下一步：可能继续调用，也可能直接回答用户';
    systemPrompt +=
      '\n- 最终回答里：可执行操作仍用 ```action 块（navigate / start_analysis / external_link 等）';
    systemPrompt += '\n- 控制工具调用次数：通常 0-3 次足够回答';
    systemPrompt +=
      '\n- 当用户的请求是**多步骤任务**时（如"做完整 PBMC 分析"），应当先调用 plan(op="create", title, steps[])，再按步骤推进。每完成一步用 plan(op="update_step") 更新状态。';
    systemPrompt +=
      '\n- 用户说"继续/下一步"且 system prompt 里已有 active plan 时，找到第一个 pending 步骤推进。';
    // ACT_ACK_v1_PROMPT
    systemPrompt += '\n\n=== Act 工具的反馈识别 ===';
    systemPrompt +=
      '\n- 当 act 返回 error="wrong_page" 时：你不在能执行该操作的页面。请先 emit navigate action 跳到 expected[0]，下一轮重新调用此 act。';
    systemPrompt +=
      '\n- 当 act 返回 unhandled=true 时：操作已记录但前端没响应（可能 listener 在别的页面）。这种情况下不要骗用户"已跳转/已切换"——告诉用户具体没生效的原因，让他确认或换个方式。';
    systemPrompt +=
      '\n- 切勿在没有真实工具反馈或工具返回 error/unhandled 时声称"已完成"。如果工具调用失败而你仍想给用户"已跳转"的体验，请显式 emit navigate action card。';
    // VERIFY_STATE_PROMPT_v1
    systemPrompt +=
      '\n- 重要写操作（start_analysis / rename_* / update_analysis_params / switch_result_tab 等）执行后，调用 verify_state(...) 复查实际状态。这是防止 AI 自欺欺人的兜底措施。';
    systemPrompt +=
      '\n  例：act(start_analysis) → 记下返回的 analysisId → verify_state(kind="analysis", id=<analysisId>, expect={status:"running"})';
    systemPrompt +=
      '\n- verify_state 返回 ok=false 时直接告诉用户"操作未生效"并附 mismatches 信息，不要硬声称成功。';
    // PROMPT_PARENT_WAIT_v1
    systemPrompt +=
      '\n- 当 act(start_analysis) 返回 error=parent_not_ready 时，意味着前置分析还在跑。请：1) 跟用户说一声"父分析还在跑"；2) 把当前 plan 步骤状态保持 pending（不要标 failed）；3) 用户稍后说"继续"时再尝试。';
    systemPrompt +=
      '\n- 推进 plan 时不要硬冲多步——一步还没 done 就发下一步会失败。Plan 步骤大多有先后依赖关系。';
    // PLAN_CHAT_LINK_v1
    systemPrompt +=
      '\n- 创建 plan(create) 时，把触发该计划的用户原话（一句话总结即可）作为 chatExcerpt 字段传入，方便用户日后回顾。';
    // PLAN_STEP_LINK_v1_PROMPT
    systemPrompt +=
      '\n- 当 act(start_analysis) 成功后立刻调 plan(update_step, planId, stepN, stepStatus="running", analysisId=<新分析 id>) 把步骤和分析关联。后台任务跑完时步骤会自动同步 done/failed，无需用户提醒。';
    systemPrompt +=
      '\n- 当用户在 FigCode 页面要求修改代码时（例如"换成横向条形图"/"配色改成 Nature 风格"/"加 facet"等），不要让用户自己复制粘贴。直接调用 act(type="update_figcode_editor", code="<完整新代码>", autoRun=true)，前端会自动替换并运行。';
    // ACT_GENERIC_PROMPT_v1 — point AI at the dynamic registry
    systemPrompt += '\n\n=== 通用 act handler 注册表（动态扩展） ===';
    systemPrompt +=
      '\n网站会注册一些自定义的 act handler（如 scroll_to_heading / copy_to_clipboard / toggle_theme 等）。';
    systemPrompt +=
      '\n- 不确定能干什么时，调用 discover_capabilities 看完整列表（带 description / pages / payloadSchema / example）。';
    systemPrompt +=
      '\n- 看到合适的 handlerId 后用 act_generic({handlerId, payload}) 调用，参数照 example 写。';
    systemPrompt += '\n- 优先用通用 handler，比硬塞导航或写一长串解释更好。';
    systemPrompt +=
      '\n- 收到 unknown_handler 错误时不要重试相同 id，先 discover_capabilities 重新看一次。';
    systemPrompt += '\n- 收到 wrong_page 时按 expected 列表先 emit navigate action 跳过去再 act。';

    // SUGGEST_NEXT_STEPS_PROMPT_v1
    systemPrompt += '\n\n=== 学习路径推荐 ===';
    systemPrompt +=
      '\n如果用户首次对话或问"我该从哪开始"/"接下来学什么"/"推荐路径"等，调用 suggest_next_steps。';
    systemPrompt += '\n不要先解释一大段再调用，直接调用，把结果用人话讲给用户。';
    systemPrompt +=
      '\n如果用户已经在学某个领域（如刚读完一篇 single-cell），并问"接下来"，调 suggest_next_steps({topic: "single-cell"})。';
    systemPrompt +=
      '\n收到 suggestions 列表后，给出每条的 title / 大致耗时 / 为什么推荐它（基于 reasons），并附上点击 url。';
    systemPrompt += '\n如果 note 字段说没有 metadata，老实告诉用户"暂时没有推荐数据"，别硬编。';

    // VERIFY_UNDERSTANDING_PROMPT_v1
    systemPrompt += '\n\n=== 理解验证 ===';
    systemPrompt +=
      '\n学习计划走完 / 用户说"学完了"/"考考我"时，调用 verify_understanding 出 1-3 道理解题。';
    systemPrompt += '\n收到 questions 列表后，逐道把题发给用户（一次发一道，等用户答），';
    systemPrompt += '\n用户答完一道你给简短反馈（对/不对 + 一句修正或拓展），再发下一道。';
    systemPrompt += '\n全部答完后做总结：哪些 outcome 看起来稳了，哪条还需补一下。';
    systemPrompt += '\n如果工具返回 doc_not_found，老实告诉用户 url 没找到，别硬出题。';

    // SUGGEST_REVIEW_PROMPT_v1
    systemPrompt += '\n\n=== 主动复习 ===';
    systemPrompt +=
      '\n如果用户之前学过的 doc 已经过去 7 天以上、且当前对话恰好处于"间歇/转场"时机（比如刚打招呼、问"接下来呢"），';
    systemPrompt +=
      '\n你可以调用 suggest_review 看看有没有合适的复习候选。返回 candidates 时，挑 1-2 条用人话说："上次你学了 X，已经过去 N 天了，要不要花几分钟再过一遍？"';
    systemPrompt += '\n用户答 yes 再深入；答 no 不要强推，转 suggest_next_steps 推新内容。';
    systemPrompt += '\n同一会话最多触发 1-2 次复习提示，避免烦人。';

    systemPrompt += '\n\n=== 单细胞 UI 控制工具 ===';
    systemPrompt += '\n在【数据集页】或【结果页】，使用以下 act 直接代替手动操作：';
    systemPrompt +=
      '\n- act(type="filter_table", columnFilters={"列名":"值",...}) 给数据表加列筛选（多列 AND）。';
    systemPrompt +=
      '\n- act(type="select_cells", datasetId="...", columnFilters={...}, subsetName="名字") 直接按 metadata 筛选并创建子集（一步到位，不需要用户再点保存）。注意 datasetId 必填。';
    // FILTER_SYNTAX_v1
    systemPrompt +=
      '\n  - 单个 columnFilter 值的写法：纯字符串子串 / 比较 (">200" / "<5000" / ">=15" / "!=NK") / 区间 ("200-5000") / 单列内 OR ("naive,memory" 或 "naive OR memory") / 单列内 AND (">200 AND <5000")。多列之间是 AND。';
    systemPrompt +=
      '\n- act(type="label_cells", labelKey="cell_type", labelValue="NK cell", columnFilters?={...}) 给选中细胞打标签（弹确认）。';
    systemPrompt +=
      '\n- act(type="merge_datasets", datasetIds=[...], mergeName="...") 合并数据集。';
    systemPrompt +=
      '\n- act(type="open_replot", analysisId="...") 打开在线绘图（让用户写 R 代码画自定义图）。';
    systemPrompt += '\n- act(type="upload_data_hint") 引导用户上传数据。';
    systemPrompt += '\n\n=== 分析工具 (Tools) ===';
    systemPrompt +=
      '\n- act(type="open_tool", toolId="deseq2") 打开 DESeq2 差异分析工具的参数面板，用户可以上传数据开始分析。';
    systemPrompt +=
      '\n- 可用 toolId: deseq2(差异分析), enrichment(GO/KEGG富集), km-survival(KM生存), gsea(GSEA), bindea-immune(免疫浸润), wgcna(WGCNA), lasso-cox(LASSO Cox), seurat-standard(Seurat单细胞), maftools-mutation(突变分析), cellchat(细胞通讯), ml-feature-select(ML特征选择), ml-classifier(ML分类器), rsf-survival(随机生存森林), shap-explain(SHAP可解释性), consensus-cluster(一致性聚类), ml-autoencoder(Autoencoder), ml-scvi-annotate(scVI注释), mo-mofa(MOFA2因子分析), mo-snf(SNF网络融合), mo-multivi(MultiVI多模态), mo-citeseq(CITE-seq WNN)';
    systemPrompt += '\n- 当用户在 /tools 页面想做某种分析时，用 open_tool 帮用户打开对应工具。';
    systemPrompt +=
      '\n- 当用户问"帮我跑差异分析"或"我要做DESeq2"时，调 act(type="open_tool", toolId="deseq2")。';
    systemPrompt += '\n- 当用户问"下一步做什么"且当前有 DESeq2 结果时，推荐 enrichment 或 gsea。';
    systemPrompt += '\n\n=== FigCode 绘图工具 ===';
    systemPrompt +=
      '\n- 用户想绘图（火山图、热图、UMAP、KEGG 气泡图等），并且 FigCode 工具索引里有对应卡片时：直接调 act(type="open_figcode_plot", figcardId="<卡片 id>")，会自动跳转到 FigCode 页 + 打开该卡片的"在线绘图"编辑器。卡片 id 在 docs index 里以 /figcode#xxx 形式给出，xxx 就是 figcardId。';
    // FIGCODE_RULE_STRICT_v1
    systemPrompt +=
      '\n- ⚠️ 不要给 external_link action 写 #/xxx 之类的 URL（那是单细胞内部 hash，不是站内路径）。';
    systemPrompt +=
      '\n- ⚠️ 任何 FigCode 卡片的"打开"操作都必须用 open_figcode_plot，绝对不要用 navigate 或 external_link 让用户去 figcode 主页再点一次。';
    systemPrompt +=
      '\n- 常见 figcardId 示例：volcano（火山图）、heatmap（热图）、correlation-heatmap（相关性热图）、boxplot（箱线图）、ridge-plot（山脊图）等。准确的 id 在站点索引中查。';
    // NO_REDUNDANT_ACTION_v1
    systemPrompt += '\n\n=== Action Card 协议 vs Tool Calling 区分 ===';
    systemPrompt +=
      '\n- ⚠️ 重要：action card（用 ```action JSON```代码块发的）只支持以下 4 种 type: start_analysis / recluster / navigate / external_link。';
    systemPrompt +=
      '\n- 其他所有写操作（update_figcode_editor / switch_result_tab / focus_cluster / highlight_gene / select_cells / filter_table / label_cells / merge_datasets / open_replot / upload_data_hint / open_figcode_plot 等）都通过 act 工具调用，不要再额外发一个 action card。';
    systemPrompt +=
      '\n- 你已经调了 act(...) 工具来执行操作时，绝对不要在最终回答里再写 ```action``` 代码块描述同一个操作。前端会因为不认识 type 而显示"当前页面不支持"错误。';
    // FIGCODE_PARAMS_v1
    systemPrompt +=
      '\n- 当你写 update_figcode_editor 的代码时，**不要**在代码里硬编码 width/height/dpi/base_size 这些参数 —— 用户的右侧面板设置会被前端自动注入到代码顶部。如果用户问"为什么我改 width 不生效"，告诉他们看右侧的尺寸面板。';
    systemPrompt += '\n- 不要再用 navigate 把用户送到 FigCode 主页让他再点 Run 按钮。一步到位。';
    systemPrompt += '\n\n旧的【结果页】UI 控制：';
    systemPrompt += '\n- act(type="switch_result_tab", tab="preview|plots|data|params")';
    +'act(type="switch_result_tab", tab="preview|plots|data|params") 切 tab；' +
      'act(type="focus_cluster", cluster="3") 高亮某 cluster；' +
      'act(type="highlight_gene", gene="CD3E") 按基因着色 UMAP。' +
      '不要再让用户自己点 tab。';

    // CONVERSATIONS_v1: announce active conversation id
    if (_activeConv) {
      sseSend({ event: 'conversation', conversationId: _activeConv.id, title: _activeConv.title });
    }

    const executionPolicy = inferExecutionPolicy(messages);
    if (!executionPolicy.allowExecution) {
      systemPrompt +=
        '\n\n=== 本轮只读约束 ===' +
        '\n用户明确要求只检查、识别、评估或规划。本轮禁止调用 run_tool(op="run")，禁止创建任务或请求执行确认。' +
        '\n优先直接依据上方 Harness 项目文件摘要回答候选文件、关键列、数据质量和后续分析；允许使用 run_tool 的 list/plan/status/next 等只读操作。' +
        '\n只陈述建议，不要用“要开干吗”“是否立即开始”等措辞主动邀请执行。';
    }

    const toolCtx = {
      userId: req.user && req.user.id,
      projectId: context && context.projectId,
      allowExecution: executionPolicy.allowExecution,
      executionPolicyReason: executionPolicy.reason,
      docsIndex: getCachedDocsIndex(),
      dashscopeEmbed,
      cosineSim,
      createTask, // ACT_TOOL_v1: lets act tool submit jobs
      conversationId: _activeConv && _activeConv.id, // PLAN_CONV_LINK_v1
      actRegistry: actRegistryGet(req.user && req.user.id), // ACT_GENERIC_v1
      gatherAnalysisContextForMethods: _gatherAnalysisContextForMethods, // GENERATE_METHODS_v1
      renderMethodsParagraph: _renderMethodsParagraph,
    };
    // Refresh docs index in background if stale
    fetchDocsIndex()
      .then((idx) => {
        if (idx) toolCtx.docsIndex = idx;
      })
      .catch(() => {});

    const fullMessages = [{ role: 'system', content: systemPrompt }, ...messages];

    const tools = getToolDefs();

    // TOOL_CAP_v1
    const MAX_ITERS = 5;
    const MAX_TOTAL_TOOL_CALLS = 12;
    let totalToolCalls = 0;
    let aborted = false;
    req.on('close', () => {
      aborted = true;
    });

    let assistantAcc = '';
    const assistantResultCards = [];

    try {
      for (let iter = 0; iter < MAX_ITERS && !aborted; iter++) {
        sseSend({ event: 'iter', n: iter + 1 });

        // TOOL_CAP_v1: when cap hit, pull tools so LLM must answer with text only
        const capHit = totalToolCalls >= MAX_TOTAL_TOOL_CALLS;
        if (capHit) {
          // Inject a system-style hint about the cap so LLM stops trying to call more
          fullMessages.push({
            role: 'system',
            content:
              '已达到工具调用上限（' +
              MAX_TOTAL_TOOL_CALLS +
              ' 次/请求）。请基于已收到的工具结果直接给出最终答复，不要再调用工具。',
          });
        }
        const reqBody = {
          model: modelName || 'deepseek-chat',
          messages: fullMessages,
          temperature: 0.4,
          max_tokens: 1500,
          tools: capHit ? undefined : tools,
          tool_choice: capHit ? undefined : 'auto',
        };

        let streamedText = '';
        const upJson = await callChatProvider(
          providerName,
          apiKey,
          reqBody,
          {
            userId: req.user && req.user.id,
            conversationId: _activeConv && _activeConv.id,
            kind: 'agent_iter',
          },
          (event) => {
            if (event.type === 'content_delta' && event.content && !aborted) {
              streamedText += event.content;
              sseSend({ choices: [{ delta: { content: event.content } }] });
            }
          },
          { baseUrl }
        );
        if (!upJson || upJson.error || !upJson.choices) {
          sseSend({
            error:
              (upJson && (upJson.message || upJson.error || (upJson.choices ? 'no choice' : 'bad response'))) ||
              'upstream error',
          });
          return res.end();
        }

        const choice = upJson.choices[0];
        const msg = choice.message || {};
        const toolCalls = msg.tool_calls || [];

        if (toolCalls.length === 0) {
          assistantAcc = streamedText || msg.content || '';
          sseSend({ event: 'done' });
          break;
        }

        // Append assistant tool_calls message to history
        fullMessages.push({
          role: 'assistant',
          content: msg.content || '',
          tool_calls: toolCalls,
        });

        // Execute each tool call sequentially
        for (const tc of toolCalls) {
          totalToolCalls++; // TOOL_CAP_v1
          const fn = tc.function || {};
          let args = {};
          try {
            args = JSON.parse(fn.arguments || '{}');
          } catch {}
          sseSend({ event: 'tool_call', name: fn.name, args });

          let result;
          try {
            result = await dispatchTool(fn.name, args, toolCtx);
          } catch (toolErr) {
            result = {
              error: 'tool_failed',
              message: (toolErr && toolErr.message) || String(toolErr),
            };
          }
          result = localizeToolResult(result);
          // ACT_ACK_v1_SERVER: if act has a pending ack, send the SSE event first then await
          let ackInfo = null;
          if (result && result.ackToken && result._ackPromise) {
            // We'll send the SSE below and then await the ack. Stash promise locally.
            ackInfo = result._ackPromise;
            delete result._ackPromise;
          }
          const summary =
            typeof result === 'object' && result
              ? Array.isArray(result)
                ? `返回 ${result.length} 条`
                : result.error
                  ? '错误: ' + result.error
                  : 'ok'
              : String(result);
          // ACT_SSE_v1: enrich act results with undo + message details
          const evt = { event: 'tool_result', name: fn.name, summary };
          if (fn.name === 'act' && result && typeof result === 'object') {
            if (result.undoToken) evt.undoToken = result.undoToken;
            if (result.undoableUntil) evt.undoableUntil = result.undoableUntil;
            if (result.message) evt.message = result.message;
            if (result.error) evt.actError = result.error;
            if (args && args.type) evt.actType = args.type;
            if (result.analysisId) evt.analysisId = result.analysisId;
            if (result.taskId) evt.taskId = result.taskId;
            // ACT_ACK_v1_SERVER: include ackToken so frontend can confirm
            if (result.ackToken) evt.ackToken = result.ackToken;
            // FIGCODE_ACT_v1_SERVER: pass code payload to frontend for direct injection
            if (result.type === 'update_figcode_editor' && result.code) {
              evt.figcodeCode = result.code;
              evt.figcodeAutoRun = result.autoRun !== false;
            }
            // SCRNA_UI_ACT_v1_SERVER: pass UI control payloads
            if (result.type === 'switch_result_tab') evt.scTab = result.tab;
            if (result.type === 'focus_cluster') evt.scCluster = result.cluster;
            if (result.type === 'highlight_gene') evt.scGene = result.gene;
            // SCRNA_DATA_ACT_v1_SERVER
            if (
              result.type === 'select_cells' ||
              result.type === 'filter_table' ||
              result.type === 'label_cells'
            ) {
              if (result.columnFilters) evt.scColumnFilters = result.columnFilters;
            }
            if (result.type === 'select_cells') evt.scSubsetName = result.subsetName || null;
            if (result.type === 'label_cells') {
              evt.scLabelKey = result.labelKey;
              evt.scLabelValue = result.labelValue;
            }
            if (result.type === 'merge_datasets') {
              evt.scDatasetIds = result.datasetIds;
              evt.scMergeName = result.mergeName || null;
            }
            if (result.type === 'open_replot') evt.scOpenReplotForAnalysis = result.analysisId;
            if (result.type === 'upload_data_hint') evt.scUploadHint = true;
            // OPEN_FIGCODE_PLOT_v1_SERVER
            if (result.type === 'open_figcode_plot') evt.figcardId = result.figcardId;
            // OPEN_TOOL_v1_SERVER
            if (result.type === 'open_tool' && result.toolId) evt.toolId = result.toolId;
          }
          // ACT_GENERIC_SSE_v1：act_generic 透传 actType/handlerId/payload 给前端
          // （阶段2 Task2：open_result 等 generic handler 依赖 payload 触发结果面板）
          if (fn.name === 'act_generic' && result && typeof result === 'object') {
            if (result.actType) evt.actType = result.actType;
            if (result.handlerId) evt.handlerId = result.handlerId;
            if (result.payload) evt.payload = result.payload;
            if (result.message) evt.message = result.message;
            if (result.ackToken) evt.ackToken = result.ackToken;
          }
          // TOOL_JOB_APPROVAL_v1_SERVER（阶段2 Task3）：run_tool 重操作确认信号
          // needApproval=true 时前端渲染确认卡，用户 approve 后重调 run_tool(ackToken)
          if (fn.name === 'run_tool' && result && typeof result === 'object') {
            if (result.needApproval) {
              evt.needApproval = true;
              if (result.ackToken) evt.ackToken = result.ackToken;
              if (result.toolJobId) evt.toolJobId = result.toolJobId;
              if (result.toolId) evt.toolId = result.toolId;
              if (result.message) evt.message = result.message;
            } else if (result.toolJobId) {
              // 非重操作成功时也透传 toolJobId（供前端 open_result / plan 联动）
              evt.toolJobId = result.toolJobId;
              if (result.toolId) evt.toolId = result.toolId;
              if (result.message || result.error) evt.message = String(result.message || result.error);
              _pushUniqueResultCard(assistantResultCards, _buildResultCardFromRunTool(result, context));
            }
          }
          sseSend(evt);

          // ACT_ACK_v1_SERVER: wait briefly for frontend ack
          if (ackInfo) {
            const ackResult = await ackInfo;
            if (ackResult && ackResult.timedOut) {
              result.unhandled = true;
              result.message =
                (result.message || '操作已记录') + '（⚠ 前端没有响应——可能当前页面没监听这个事件）';
              sseSend({
                event: 'tool_result',
                name: fn.name,
                summary: 'unhandled',
                actType: args && args.type,
                message: result.message,
              });
            } else if (ackResult && ackResult.info && ackResult.info.error) {
              result.unhandled = true;
              result.message =
                (result.message || '操作已记录') + '（前端报错：' + ackResult.info.error + '）';
            }
          }
          // Truncate result to keep prompt manageable
          let resultStr = JSON.stringify(result);
          if (resultStr.length > 6000) resultStr = resultStr.slice(0, 6000) + '... (truncated)';
          fullMessages.push({
            role: 'tool',
            tool_call_id: tc.id,
            name: fn.name,
            content: resultStr,
          });
        }
      }

      // AGENT_FALLBACK_v1: 若 MAX_ITERS 跑满仍未收敛（5 轮全 tool_calls，没生成文本），
      // 强制无 tools 再调一次 LLM 生成兜底回复，避免用户收到空消息。
      if (!aborted && assistantAcc.trim().length <= 20) {
        try {
          fullMessages.push({
            role: 'system',
            content:
              '你已用完本轮工具调用次数。请基于已收集到的工具结果，直接给用户一个有用的最终答复（不要再调用工具）。如果工具结果不足以完整回答，就给出当前能给出的最佳答复，并说明还缺什么。',
          });
          const fallbackBody = {
            model: modelName || 'deepseek-chat',
            messages: fullMessages,
            temperature: 0.4,
            max_tokens: 1500,
          };
          let fallbackText = '';
          const fbJson = await callChatProvider(
            providerName,
            apiKey,
            fallbackBody,
            {
              userId: req.user && req.user.id,
              conversationId: _activeConv && _activeConv.id,
              kind: 'agent_fallback',
            },
            (event) => {
              if (event.type === 'content_delta' && event.content && !aborted) {
                fallbackText += event.content;
                sseSend({ choices: [{ delta: { content: event.content } }] });
              }
            },
            { baseUrl }
          );
          if (fbJson && fbJson.choices && fbJson.choices[0]) {
            const fbText = fallbackText || (fbJson.choices[0].message || {}).content || '';
            if (fbText.trim()) assistantAcc = fbText;
          }
        } catch {
          // 兜底本身失败也不阻塞，走下面的空回复持久化保护
        }
        // 最终硬兜底：若兜底 LLM 调用也失败/返回空，给用户一条明确提示而非空白
        if (assistantAcc.trim().length <= 20) {
          const fallbackMsg =
            '抱歉，这次对话我调用了多次工具但没能整理出最终答复。请把你的需求再描述一下，或者换个问法试试。';
          sseSend({ choices: [{ delta: { content: fallbackMsg } }] });
          assistantAcc = fallbackMsg;
        }
      }

      if (assistantAcc.trim().length > 20) {
        try {
          const userId = req.user && req.user.id;
          if (userId) {
            // CONVERSATIONS_v1: persist assistant reply
            try {
              if (_activeConv) {
                const assistantMeta = {
                  page: context && context.page,
                  projectId: context && context.projectId,
                  ...(assistantResultCards.length ? { resultCards: assistantResultCards } : {}),
                };
                if (useConvAsync) {
                  await convAsync.appendMessageToConversation(
                    _activeConv.id,
                    'assistant',
                    assistantAcc.trim(),
                    assistantMeta
                  );
                } else {
                  appendMessageToConversation(_activeConv.id, 'assistant', assistantAcc.trim(), assistantMeta);
                }
                // AUTO_TITLE_v1: best-effort async title generation
                try {
                  _maybeAutoTitleConversation(_activeConv.id, userId);
                } catch {}
                // TOPIC_SHIFT_v1: best-effort async topic-shift detection
                try {
                  _maybeDetectTopicShift(_activeConv.id, userId)
                    .then((r) => {
                      if (r && r.shifted) {
                        try {
                          sseSend({
                            event: 'topic_shift',
                            conversationId: _activeConv.id,
                            reason: r.reason,
                          });
                        } catch {}
                      }
                    })
                    .catch(() => {});
                } catch {}
              }
            } catch {}
            // AGENT_EXTRACT_v1: chat audit log (privacy-safe metadata)
            try {
              const _msgCount = Array.isArray(messages) ? messages.length : 0;
              const _page = (context && context.page) || null;
              logChatAudit(userId, _page, _msgCount);
            } catch {}

            // Build the canonical turn pair we'll feed downstream pipelines
            const lastUser = [...messages].reverse().find((m) => m.role === 'user');
            if (lastUser) {
              const cleanUser = String(lastUser.content || '').replace(/^\[[^\]]+\]\s*\n?/, '');
              const turnText = '用户: ' + cleanUser + '\n\nAI: ' + assistantAcc.trim();
              // 1. Vector index (Layer 3b)
              (async () => {
                try {
                  const vecs = await dashscopeEmbed([turnText.slice(0, MAX_CONTENT_LEN)], {
                    userId,
                    conversationId: _activeConv && _activeConv.id,
                    kind: 'embedding',
                  });
                  if (vecs && vecs[0]) {
                    saveMemoryVector({
                      userId,
                      kind: 'chat_turn',
                      refId: null,
                      page: context && context.page,
                      pageTitle: context && context.pageTitle,
                      content: turnText.slice(0, MAX_CONTENT_LEN),
                      vec: vecs[0],
                      conversationId: _activeConv && _activeConv.id,
                    });
                  }
                } catch {}
              })();
            }

            // 2. Layer 3a: fact extraction — fire every 4 user-side turns
            //    (count user messages in this thread)
            try {
              const userMsgCount = Array.isArray(messages)
                ? messages.filter((m) => m.role === 'user').length
                : 0;
              if (userMsgCount >= 2 && userMsgCount % 2 === 0) {
                // Build a synthetic full thread with this turn appended for extraction
                const threadForExtract = messages
                  .slice(-12)
                  .concat([{ role: 'assistant', content: assistantAcc.trim() }]);
                backgroundExtractFacts(userId, threadForExtract).catch(() => {});
              }
            } catch {}

            // 3. Layer 2: summary — when thread grows beyond trigger
            try {
              const SUMMARY_TRIGGER_AT = 22;
              const SUMMARY_KEEP_RECENT = 14;
              if (Array.isArray(messages) && messages.length > SUMMARY_TRIGGER_AT) {
                const oldMsgs = messages.slice(0, messages.length - SUMMARY_KEEP_RECENT);
                if (oldMsgs.length >= 6) {
                  getChatSummaryAsync(userId)
                    .then((existing) => {
                      summarizeMessages(userId, oldMsgs, existing && existing.summary).catch(
                        () => {}
                      );
                    })
                    .catch(() => {});
                }
              }
            } catch {}
          }
        } catch {}
      }
    } catch (e) {
      sseSend({ error: e.message });
    }

    res.end();
  });

  // ===== AGENT_TASK_MODE_v1：SSE 订阅端点（套 tools-metadata.js 模板）=====
  // 前端 POST /api/ai/agent 拿 taskId 后，订阅本端点拿事件流（回放 + 实时）。
  // 支持断线重连：?afterSeq=N 从第 N+1 条开始（前端记 lastSeq，重连时续传）。
  app.get('/api/ai/agent/task/:taskId', async (req, res) => {
    const userId = req.user && req.user.id;
    if (!userId) {
      return res.status(401).json({ status: 'error', error: '未登录' });
    }
    const { taskId } = req.params;
    const afterSeq = Math.max(0, parseInt(req.query.afterSeq, 10) || 0);

    let task;
    try {
      task = taskStore.getTask(taskId);
    } catch (e) {
      return res.status(500).json({ status: 'error', error: '查询 task 失败' });
    }
    if (!task) {
      return res.status(404).json({ status: 'error', error: 'task 不存在' });
    }
    // 越权校验：agent task 有 user_id，必须匹配
    if (task.user_id && task.user_id !== userId) {
      return res.status(403).json({ status: 'error', error: '无权访问该 task' });
    }

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders && res.flushHeaders();

    const sseSend = (obj) => {
      try {
        res.write('data: ' + JSON.stringify(obj) + '\n\n');
      } catch {}
    };

    let lastSeq = afterSeq;
    const isTerminal = (t) => t && (t.agent_status === 'done' || t.agent_status === 'failed');

    // 1. 回放已存事件（afterSeq+1 起）
    try {
      const events = taskStore.getTaskEventsSince(taskId, afterSeq);
      for (const ev of events) {
        sseSend({ seq: ev.seq, eventType: ev.eventType, payload: ev.payload });
        lastSeq = ev.seq;
      }
    } catch {}

    // 2. 若 task 已终态，发 done/error 后结束
    const freshTask = taskStore.getTask(taskId);
    if (isTerminal(freshTask)) {
      if (freshTask.agent_status === 'failed') {
        sseSend({ event: 'error', error: freshTask.error || 'agent task 失败' });
      } else {
        sseSend({ event: 'done' });
      }
      sseSend('[DONE]');
      return res.end();
    }

    // 3. 轮询增量事件到终态（500ms 间隔）
    const poll = setInterval(() => {
      try {
        const events = taskStore.getTaskEventsSince(taskId, lastSeq);
        for (const ev of events) {
          sseSend({ seq: ev.seq, eventType: ev.eventType, payload: ev.payload });
          lastSeq = ev.seq;
        }
        const t = taskStore.getTask(taskId);
        if (isTerminal(t)) {
          clearInterval(poll);
          if (t.agent_status === 'failed') {
            sseSend({ event: 'error', error: t.error || 'agent task 失败' });
          } else {
            sseSend({ event: 'done' });
          }
          sseSend('[DONE]');
          res.end();
        }
      } catch (e) {
        // 轮询出错不终止，下轮继续
      }
    }, 500);

    // 用户关闭订阅：只清 interval，不影响后台 loop（loop 继续跑，事件写 task_events 待重连）
    req.on('close', () => {
      clearInterval(poll);
    });
  });

  /** Call DeepSeek non-streaming and return parsed JSON. */
}; // end registerAiAgentRoute
