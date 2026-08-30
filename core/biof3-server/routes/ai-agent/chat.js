'use strict';

/**
 * routes/ai-agent/chat.js — chat 子域（PHASE 2.2b）
 *
 * 下沉的端点（来自 routes/ai-agent.js 第 311-1097 行）：
 *   POST /api/ai/agent — LEGACY SSE 直连端点（786 行 legacy SSE handler）
 *
 * ⚠️  786 行的 legacy SSE handler 整体保留在本文件，不强行拆分（调研报告已识别）。
 *     task 模式路径（第 160-309 行）保留在 routes/ai-agent.js facade 层。
 *
 * 共享 helper 走本文件顶部的 require（与原 routes/ai-agent.js 完全一致）。
 *
 * 行为 100% 兼容：try/catch 顺序、status code、response shape 保持不变。
 */

const express = require('express');
const { buildSystemPrompt, localizeToolResult } = require('../../helpers/system-prompt');
const { appendDesktopAgentInstructions } = require('../../helpers/desktop-agent-prompt');
const { renderPluginDemoPathsForPrompt } = require('../../helpers/plugin-demo-prompt');
const { callChatProvider } = require('../../helpers/llm-client');
const { buildSiteSnapshotAsync, renderSiteSnapshotForPrompt } = require('../../helpers/site-snapshot');
const { buildFactsBlockAsync, backgroundExtractFacts } = require('../../helpers/user-facts');
const {
  _getChatSummary,
  getChatSummaryAsync,
  summarizeMessages,
} = require('../../helpers/chat-summary');
const { getActivePlanForUserAsync, renderActivePlanForPrompt } = require('../../helpers/plans');
const dbMod = require('../../db');
const convSync = require('../../helpers/conversations');
const {
  getOrCreateActiveConversation,
  appendMessageToConversation,
  _maybeAutoTitleConversation,
  _maybeDetectTopicShift,
} = convSync;
const { logChatAudit } = require('../../helpers/memory-privacy');
const {
  dashscopeEmbed,
  saveMemoryVector,
  cosineSim,
  MAX_CONTENT_LEN,
} = require('../../helpers/memory-vectors');
const {
  aiConcurrencyAcquire,
  aiConcurrencyRelease,
} = require('../../helpers/runtime');
const {
  getToolDefs,
  createCallId,
  createTraceId,
  createModelResultState,
  createRejectedToolResult,
  executeToolCall,
  replaceToolResultData,
  serializeToolResultForModel,
  buildToolCallEvent,
  buildToolResultEvent,
  createToolActivityRecorder,
  MAX_AGENT_ITERS,
  MAX_AGENT_TOOL_CALLS,
  MAX_FINALIZATION_ATTEMPTS,
  MAX_CONTINUATION_CHAINS,
  MAX_CONTINUATION_TOKENS,
  shouldFinalizeAgentIteration,
  assessFinalizationResult,
  buildFinalizationRetryRequest,
  buildFinalizationFallbackMessage,
  finalizationFallbackReason,
  createAgentProgressRecorder,
  createContinuationGuard,
  createResultEditCompletionGuard,
  createAgentToolCallController,
  runAgentToolCallBatch,
} = require('../../agent-tools');
const {
  createResultEditProgressRecorder,
  finalizeResultEditProgress,
  projectResultStudioToolContext,
} = require('../../agent-tools/result-context-binding');
const { inferExecutionPolicy } = require('../../helpers/agent-execution-policy');
const {
  _gatherAnalysisContextForMethods,
  _renderMethodsParagraph,
} = require('../../helpers/methods-export');

module.exports = {
  /**
   * @param {object} app   Express app (or equivalent router)
   * @param {object} deps  外部注入的依赖（来自 facade 层）
   * @param {boolean} deps.USE_AGENT_TASK_MODE  是否启用 task 模式（facade 层注入）
   */
  register(app, deps) {
    const USE_AGENT_TASK_MODE = deps?.USE_AGENT_TASK_MODE ?? true;

    // ===== 老路径：直连 SSE（fallback，BIOF3_AGENT_TASK_MODE=legacy 或 ?legacy=1）=====

    app.post('/api/ai/agent', express.json({ limit: '256kb' }), async (req, res) => {
      const requestStartedAt = Date.now();
      const { messages, context, modelPresetId, modelName: requestedModelName } = req.body || {};
      let explicitConvId = req.body && req.body.conversationId;

      if (!Array.isArray(messages) || messages.length === 0) {
        return res.status(400).json({ status: 'error', error: '缺少消息' });
      }

      // ===== AGENT_TASK_MODE_v1：task 模式（loop 后台跑 + 订阅重连）=====
      if (USE_AGENT_TASK_MODE && req.query.legacy !== '1') {
        const { getChatProviderName, getChatModelPreset, getChatModelCredential } = require('../../helpers/ai-settings');
        const selectedPreset = getChatModelPreset(modelPresetId);
        const providerName = (selectedPreset && selectedPreset.provider) || getChatProviderName();
        const providerLabel = providerName === 'deepseek'
          ? 'DeepSeek'
          : (selectedPreset && selectedPreset.label) || providerName;
        const modelName = typeof requestedModelName === 'string' && requestedModelName.trim()
          ? requestedModelName.trim().slice(0, 200)
          : selectedPreset && selectedPreset.model;
        const baseUrl = selectedPreset && selectedPreset.baseUrl;
        const apiKey = getChatModelCredential(selectedPreset);
        const { runAgentLoop } = require('../../agent-runner');
        const agentTaskStore = require('../../agent-task-store');
        const { aiTaskConcurrencyAcquire, aiTaskConcurrencyRelease } = require('../../helpers/runtime');

        const userId = req.user && req.user.id;
        if (!userId) {
          return res.status(401).json({ status: 'error', error: '未登录' });
        }

        const wantKind = req.body && req.body.kind === 'subagent' ? 'subagent' : 'primary';
        let parentTaskId = null;
        let parentLoopRunId = null;
        if (wantKind === 'subagent') {
          parentTaskId = req.body && req.body.parentTaskId;
          if (!parentTaskId) {
            return res.status(400).json({ status: 'error', error: 'subagent 缺少 parentTaskId' });
          }
          let parentTask = null;
          try { parentTask = agentTaskStore.getAgentTask(parentTaskId); } catch {}
          if (!parentTask) {
            return res.status(404).json({ status: 'error', error: 'parentTask 不存在' });
          }
          if (parentTask.userId && parentTask.userId !== userId) {
            return res.status(403).json({ status: 'error', error: '无权以该 parentTask 派生子 agent' });
          }
          if (parentTask.status !== 'running' || parentTask.agentStatus !== 'running') {
            return res.status(409).json({ status: 'error', error: 'parentTask 已结束，不能再派生子 agent' });
          }
          if ((parentTask.params?.kind || 'primary') !== 'primary') {
            return res.status(409).json({ status: 'error', error: 'parentTask 不是可用的主 agent 会话' });
          }
          const parentLoop = (() => { try { return dbMod.getLoopRunByTaskId(parentTaskId); } catch { return null; } })();
          if (parentLoop && parentLoop.kind !== 'primary') {
            return res.status(409).json({ status: 'error', error: 'parentTask 不是可用的主 agent 会话' });
          }
          if (
            explicitConvId &&
            parentTask.params &&
            parentTask.params.conversationId &&
            parentTask.params.conversationId !== explicitConvId
          ) {
            return res.status(409).json({ status: 'error', error: 'parentTask 与当前会话不一致' });
          }
          parentLoopRunId = parentLoop?.loopRunId || null;
          if (parentTask.params && parentTask.params.conversationId) {
            explicitConvId = parentTask.params.conversationId;
          }
        }

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

        let taskId;
        try {
          // BLOCK-10-audit-closeout: createAgentTask returns the FULL inserted
          // task snapshot (object) — not just the generated UUID. chat.js
          // previously captured this as `taskId`, which then propagated to
          // runAgentLoop + appendAgentTaskEvent as a non-string. SQLite TEXT
          // column silently coerces objects to '[object Object]' via toString,
          // so events were written under the wrong key while getAgentTask(taskId)
          // also missed the row. Fix: pull `.taskId` out before using.
          taskId = agentTaskStore.createAgentTask({
            status: 'running',
            agentStatus: 'running',
            userId,
            params: {
              messages,
              context,
              conversationId: _activeConv && _activeConv.id,
              providerName,
              providerLabel,
              modelName,
              kind: wantKind,
              parentTaskId: parentTaskId || null,
            },
          }).taskId;
        } catch (e) {
          return res.status(500).json({ status: 'error', error: '创建 agent task 失败: ' + e.message });
        }

        const acquired = aiTaskConcurrencyAcquire(userId, taskId);
        if (!acquired) {
          agentTaskStore.markAgentTaskFailed(taskId, '并发限制');
          return res.status(429).json({ status: 'error', error: '并发限制，请稍后再试' });
        }

        setImmediate(() => {
          runAgentLoop({
            messages,
            context,
            userId,
            conversationId: _activeConv && _activeConv.id,
            _activeConv,
            apiKey,
            providerName,
            providerLabel,
            modelName,
            profileId: selectedPreset && selectedPreset.id,
            baseUrl,
            taskId,
            kind: wantKind,
            parentLoopRunId: parentLoopRunId || null,
            onEvent: () => {},
            shouldAbort: () => agentTaskStore.isAgentTaskCancellationRequested(taskId),
          }).catch((e) => {
            try { agentTaskStore.markAgentTaskFailed(taskId, e && e.message ? e.message : String(e)); } catch {}
            try { aiTaskConcurrencyRelease(userId, taskId); } catch {}
          });
        });

        return res.json({
          taskId,
          status: 'running',
          kind: wantKind,
          parentTaskId: parentTaskId || null,
          conversationId: _activeConv && _activeConv.id,
        });
      }

      // ===== 老路径：直连 SSE（fallback）=====

      const { getChatProviderName, getChatModelPreset, getChatModelCredential } = require('../../helpers/ai-settings');
      const selectedPreset = getChatModelPreset(modelPresetId);
      const providerName = (selectedPreset && selectedPreset.provider) || getChatProviderName();
      const providerLabel = providerName === 'deepseek'
        ? 'DeepSeek'
        : (selectedPreset && selectedPreset.label) || providerName;
      const modelName = typeof requestedModelName === 'string' && requestedModelName.trim()
        ? requestedModelName.trim().slice(0, 200)
        : selectedPreset && selectedPreset.model;
      const baseUrl = selectedPreset && selectedPreset.baseUrl;
      const apiKey = getChatModelCredential(selectedPreset);

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

      // Resolve or create the active conversation through the SQLite facade.
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
          _activeConv = getOrCreateActiveConversation(_userId, hint);
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
            appendMessageToConversation(_activeConv.id, 'user', cleanContent, meta);
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
      let systemPrompt = buildSystemPrompt(ctxForPrompt, {
        provider: providerName,
        providerLabel,
        model: modelName,
      });
      if (isGuest) {
        systemPrompt += '\n\n=== 当前用户：未登录访客 ===';
        systemPrompt +=
          '\n- 当前没有可用的本地用户身份或项目范围；不要调用 query(projects/datasets/analyses/facts/memories)。';
        systemPrompt += '\n- 可正常回答一般问题，但不要声称看到了账号、项目或历史分析。';
        systemPrompt +=
          '\n- 不可代替用户运行分析或执行写操作；需要项目能力时说明必须先进入有效的本地项目。';
        systemPrompt += '\n- 回答务必有正文，不要只调工具不说话。';
      }
      // Append docs index
      // Append the local user's site snapshot, facts, summary, and active plan.
      try {
        const userId = req.user && req.user.id;
        if (userId) {
          const projectId = context && context.projectId ? String(context.projectId) : null;
          const snap = await buildSiteSnapshotAsync(userId, { projectId });
          const block = renderSiteSnapshotForPrompt(snap, 3500);
          if (block) systemPrompt += block;
          const factsBlock = await buildFactsBlockAsync(userId, 1200, projectId);
          if (factsBlock && factsBlock.trim()) {
            systemPrompt += '\n\n=== 关于该用户的已知事实（请记住并参考） ===' + factsBlock;
          }
          const sumRow = await getChatSummaryAsync(userId, projectId);
          if (sumRow && sumRow.summary) {
            systemPrompt +=
              '\n\n=== 与该用户的对话历史摘要（已归档） ===\n' +
              sumRow.summary +
              '\n摘要仅用于提取事实，不得继承旧身份、固定推荐结构或已下线功能。';
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
      systemPrompt += renderPluginDemoPathsForPrompt();
      systemPrompt +=
        '\n- 用户想**跑分析/出图/出表**（如"帮我跑 DESeq2""画火山图""分析这个 count 矩阵""做差异分析"）→ 调用 run_tool。先用 run_tool(op="list") 看可用工具+参数契约，再 run_tool(op="run", toolId, params) 执行。file 参数传本地绝对路径。**不要凭空判断运行时未装——先调 run_tool，执行报错再据错引导。**';
      systemPrompt +=
        '\n- 多步骤标准分析先用 run_tool(op="plan", templateId, initialInputs) 生成 Agent 主导计划，禁止一次性偷偷执行全部步骤。每一步完成后先验证 tool_job/artifact truth，再用 run_tool(op="bind_artifact", workflowPlan, fromToolJobId, fromStepId, toStepId, inputId, artifactId) 绑定真实产物并继续。';
      systemPrompt +=
        '\n- run_tool 成功后客户端会自动打开对应结果；不要额外调用页面控制工具。';
      systemPrompt +=
        '\n- agent 看图（read_image）：当用户问图内容（如"图里上调基因集中在哪""这张图说明了什么"），调 read_image(toolJobId) 让 vision 角色模型解读图，返回的 description 可直接据此回答。token 较贵，仅用户明确问图内容时调，不要每次出图都读。';
      systemPrompt +=
        '\n- 自动化边界：完全访问模式下，DESeq2、WGCNA、ML 等项目内可复现分析直接执行，不询问"是否开始"；读取结果并自动诊断、选择安全修复和重试。只有不可逆外部影响、凭据/付费操作或缺少科学判断时才请求用户决定。';
      systemPrompt += '\n- 工具调用后再判断下一步：可能继续调用，也可能直接回答用户';
      systemPrompt +=
        '\n- 最终回答里：页面跳转或外部链接可用 ```action 块（navigate / external_link）';
      systemPrompt += '\n- 控制工具调用次数：通常 0-3 次足够回答';
      systemPrompt +=
        '\n- 当用户的请求是**多步骤任务**时（如"做完整 PBMC 分析"），应当先调用 plan(op="create", title, steps[])，再按步骤推进。每完成一步用 plan(op="update_step") 更新状态。';
      systemPrompt +=
        '\n- 用户说"继续/下一步"且 system prompt 里已有 active plan 时，找到第一个 pending 步骤推进。';
      systemPrompt += '\n\n=== Act 工具的反馈识别 ===';
      systemPrompt +=
        '\n- 当 act 返回 error="wrong_page" 时：你不在能执行该操作的页面。请先 emit navigate action 跳到 expected[0]，下一轮重新调用此 act。';
      systemPrompt +=
        '\n- 当 act 返回 unhandled=true 时：操作已记录但前端没响应（可能 listener 在别的页面）。这种情况下不要骗用户"已跳转/已切换"——告诉用户具体没生效的原因，让他确认或换个方式。';
      systemPrompt +=
        '\n- 切勿在没有真实工具反馈或工具返回 error/unhandled 时声称"已完成"。如果工具调用失败而你仍想给用户"已跳转"的体验，请显式 emit navigate action card。';
      systemPrompt +=
        '\n- 重要写操作（rename_* / update_analysis_params / switch_result_tab 等）执行后，调用 verify_state(...) 复查实际状态。这是防止 AI 自欺欺人的兜底措施。';
      systemPrompt +=
        '\n  例：act(rename_project) → verify_state(kind="project", id=<项目 id>, expect={name:<新名称>})';
      systemPrompt +=
        '\n- verify_state 返回 ok=false 时直接告诉用户"操作未生效"并附 mismatches 信息，不要硬声称成功。';
      systemPrompt +=
        '\n- 推进 plan 时不要硬冲多步——一步还没 done 就发下一步会失败。Plan 步骤大多有先后依赖关系。';
      systemPrompt +=
        '\n- 创建 plan(create) 时，把触发该计划的用户原话（一句话总结即可）作为 chatExcerpt 字段传入，方便用户日后回顾。';
      systemPrompt +=
        '\n- 当用户在 FigCode 页面要求修改代码时（例如"换成横向条形图"/"配色改成 Nature 风格"/"加 facet"等），不要让用户自己复制粘贴。直接调用 act(type="update_figcode_editor", code="<完整新代码>", autoRun=true)，前端会自动替换并运行。';
      systemPrompt += '\n\n=== 学习路径推荐 ===';
      systemPrompt += '\n不要调用旧版学习路径推荐工具。';
      systemPrompt += '\n不要先解释一大段再调用，直接调用，把结果用人话讲给用户。';
      systemPrompt += '\n用户询问后续方向时，只能依据当前项目事实回答。';
      systemPrompt +=
        '\n收到 suggestions 列表后，给出每条的 title / 大致耗时 / 为什么推荐它（基于 reasons），并附上点击 url。';
      systemPrompt += '\n如果 note 字段说没有 metadata，老实告诉用户"暂时没有推荐数据"，别硬编。';
      systemPrompt += '\n\n=== 理解验证 ===';
      systemPrompt += '\n不要自动发起理解测验。';
      systemPrompt += '\n收到 questions 列表后，逐道把题发给用户（一次发一道，等用户答），';
      systemPrompt += '\n用户答完一道你给简短反馈（对/不对 + 一句修正或拓展），再发下一道。';
      systemPrompt += '\n全部答完后做总结：哪些 outcome 看起来稳了，哪条还需补一下。';
      systemPrompt += '\n如果工具返回 doc_not_found，老实告诉用户 url 没找到，别硬出题。';
      systemPrompt += '\n\n=== 主动复习 ===';
      systemPrompt +=
        '\n如果用户之前学过的 doc 已经过去 7 天以上、且当前对话恰好处于"间歇/转场"时机（比如刚打招呼、问"接下来呢"），';
      systemPrompt += '\n不要基于时间间隔主动发起复习。';
      systemPrompt += '\n不要主动发起复习或学习内容推荐。';
      systemPrompt += '\n同一会话最多触发 1-2 次复习提示，避免烦人。';
      systemPrompt += '\n\n=== 单细胞 UI 控制工具 ===';
      systemPrompt += '\n在【数据集页】或【结果页】，使用以下 act 直接代替手动操作：';
      systemPrompt +=
        '\n- act(type="filter_table", columnFilters={"列名":"值",...}) 给数据表加列筛选（多列 AND）。';
      systemPrompt +=
        '\n- act(type="select_cells", datasetId="...", columnFilters={...}, subsetName="名字") 直接按 metadata 筛选并创建子集（一步到位，不需要用户再点保存）。注意 datasetId 必填。';
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
        '\n- 可用 toolId: deseq2(差异分析), enrichment(GO/KEGG富集), km-survival(KM生存), gsea(GSEA), bindea-immune(免疫浸润), wgcna(WGCNA), lasso-cox(LASSO Cox), seurat-standard(Seurat单细胞), maftools-mutation(突变分析), cellchat(细胞通讯), ml-feature-select(ML特征选择), ml-classifier(ML分类器), rsf-survival(随机生存森林), shap-explain(SHAP可解释性), consensus-cluster(一致性聚类), ml-scvi-annotate(scVI注释), mo-mofa(MOFA2因子分析), mo-snf(SNF网络融合)';
      systemPrompt += '\n- 当用户在 /tools 页面想做某种分析时，用 open_tool 帮用户打开对应工具。';
      systemPrompt +=
        '\n- 当用户问"帮我跑差异分析"或"我要做DESeq2"时，调 act(type="open_tool", toolId="deseq2")。';
      systemPrompt += '\n- 不根据某个已完成工具自动指定后续分析。';
      systemPrompt += '\n\n=== FigCode 绘图工具 ===';
      systemPrompt +=
        '\n- 用户想绘图（火山图、热图、UMAP、KEGG 气泡图等），并且 FigCode 工具索引里有对应卡片时：直接调 act(type="open_figcode_plot", figcardId="<卡片 id>")，会自动跳转到 FigCode 页 + 打开该卡片的"在线绘图"编辑器。卡片 id 在 docs index 里以 /figcode#xxx 形式给出，xxx 就是 figcardId。';
      systemPrompt +=
        '\n- ⚠️ 不要给 external_link action 写 #/xxx 之类的 URL（那是单细胞内部 hash，不是站内路径）。';
      systemPrompt +=
        '\n- ⚠️ 任何 FigCode 卡片的"打开"操作都必须用 open_figcode_plot，绝对不要用 navigate 或 external_link 让用户去 figcode 主页再点一次。';
      systemPrompt +=
        '\n- 常见 figcardId 示例：volcano（火山图）、heatmap（热图）、correlation-heatmap（相关性热图）、boxplot（箱线图）、ridge-plot（山脊图）等。准确的 id 在站点索引中查。';
      systemPrompt += '\n\n=== Action Card 协议 vs Tool Calling 区分 ===';
      systemPrompt +=
        '\n- ⚠️ 重要：action card（用 ```action JSON```代码块发的）只支持 navigate / external_link。分析执行必须调用 run_tool。';
      systemPrompt +=
        '\n- 其他所有写操作（update_figcode_editor / switch_result_tab / focus_cluster / highlight_gene / select_cells / filter_table / label_cells / merge_datasets / open_replot / upload_data_hint / open_figcode_plot 等）都通过 act 工具调用，不要再额外发一个 action card。';
      systemPrompt +=
        '\n- 你已经调了 act(...) 工具来执行操作时，绝对不要在最终回答里再写 ```action``` 代码块描述同一个操作。前端会因为不认识 type 而显示"当前页面不支持"错误。';
      systemPrompt +=
        '\n- 当你写 update_figcode_editor 的代码时，**不要**在代码里硬编码 width/height/dpi/base_size 这些参数 —— 用户的右侧面板设置会被前端自动注入到代码顶部。如果用户问"为什么我改 width 不生效"，告诉他们看右侧的尺寸面板。';
      systemPrompt += '\n- 不要再用 navigate 把用户送到 FigCode 主页让他再点 Run 按钮。一步到位。';
      systemPrompt += '\n\n旧的【结果页】UI 控制：';
      systemPrompt += '\n- act(type="switch_result_tab", tab="preview|plots|data|params")';
      systemPrompt += '+act(type="switch_result_tab", tab="preview|plots|data|params") 切 tab；' +
        'act(type="focus_cluster", cluster="3") 高亮某 cluster；' +
        'act(type="highlight_gene", gene="CD3E") 按基因着色 UMAP。' +
        '不要再让用户自己点 tab。';

      // CONVERSATIONS_v1: announce active conversation id
      if (_activeConv) {
        sseSend({ event: 'conversation', conversationId: _activeConv.id, title: _activeConv.title });
      }

      systemPrompt = appendDesktopAgentInstructions(systemPrompt);
      const executionPolicy = inferExecutionPolicy(messages);
      if (!executionPolicy.allowExecution) {
        systemPrompt +=
          '\n\n=== 本轮只读约束 ===' +
          '\n用户明确要求只检查、识别、评估或规划。本轮禁止调用 run_tool(op="run")，禁止创建任务或请求执行确认。' +
          '\n优先直接依据上方 Harness 项目文件摘要回答候选文件、关键列、数据质量和后续分析；允许使用 run_tool 的 list/plan/status/next 等只读操作。' +
          '\n只陈述建议，不要用"要开干吗""是否立即开始"等措辞主动邀请执行。';
      }

      let aborted = false;
      const resultEditProgress = createResultEditProgressRecorder();
      const toolCtx = {
        userId: req.user && req.user.id,
        projectId: context && context.projectId,
        ...projectResultStudioToolContext(context),
        accessMode: context && context.accessMode === 'read' ? 'read' : 'full',
        allowExecution: executionPolicy.allowExecution,
        executionPolicyReason: executionPolicy.reason,
        docsIndex: {},
        dashscopeEmbed,
        cosineSim,
        conversationId: _activeConv && _activeConv.id,
        gatherAnalysisContextForMethods: _gatherAnalysisContextForMethods,
        renderMethodsParagraph: _renderMethodsParagraph,
        isCancelled: () => aborted,
        emitResultEditProgress: (progress) => sseSend({
          event: 'result_edit_progress',
          ...resultEditProgress.record(progress),
        }),
      };

      const fullMessages = [{ role: 'system', content: systemPrompt }, ...messages];
      const tools = getToolDefs();
      const traceId = createTraceId();
      const toolCallController = createAgentToolCallController({ maxToolCalls: MAX_AGENT_TOOL_CALLS });
      const continuationGuard = createContinuationGuard({
        maxChains: MAX_CONTINUATION_CHAINS,
        maxTokens: MAX_CONTINUATION_TOKENS,
      });
      const latestUserMessage = [...messages].reverse().find((message) => message?.role === 'user');
      const resultEditCompletionGuard = createResultEditCompletionGuard({
        expectation: toolCtx.resultStudioCompletionExpectation,
        requestedOutcome: typeof latestUserMessage?.content === 'string' ? latestUserMessage.content : '',
      });
      const modelResultState = createModelResultState({
        projectId: toolCtx.projectId,
        traceId,
      });
      req.on('close', () => { aborted = true; });

      let assistantAcc = '';
      let assistantMessagePersisted = false;
      let providerFailureReason = null;
      const assistantProgress = createAgentProgressRecorder();
      let finalizationAttempts = 0;
      let finalizationFailureReason = null;
      let finalizationRouting = null;
      const assistantResultCards = [];
      const assistantToolActivities = createToolActivityRecorder();

      try {
        for (let iter = 0; iter < MAX_AGENT_ITERS && !aborted; iter++) {
          sseSend({ event: 'iter', n: iter + 1 });

          const finalizing = shouldFinalizeAgentIteration(iter, toolCallController);
          if (finalizing) {
            fullMessages.push({
              role: 'system',
              content: toolCallController.capHit()
                ? '已达到显式配置的工具调用保护上限。请基于已收到的工具结果直接说明停止原因、已完成工作和未执行步骤，不要再调用工具，也不得声称尚未启动的工作正在执行。'
                : '检测到相同工具和参数反复调用，任务可能陷入异常循环。请停止调用工具，直接说明异常、已完成工作和未执行步骤；不得声称尚未启动的工作正在执行。',
            });
          }
          const reqBody = {
            ...(modelName ? { model: modelName } : {}),
            messages: fullMessages,
            temperature: 0.4,
            max_tokens: 16384, // 方案 B：用足够大的值让模型自然停止，而不是物理截断
            tools: finalizing ? undefined : tools,
            tool_choice: finalizing
              ? undefined
              : (resultEditCompletionGuard.requiresToolExecution()
                ? resultEditCompletionGuard.requiredToolChoice()
                : 'auto'),
          };

          let streamedText = '';
          let upJson;
          let attemptBody = reqBody;
          const attemptLimit = finalizing ? MAX_FINALIZATION_ATTEMPTS : 1;
          for (let attempt = 1; attempt <= attemptLimit && !aborted; attempt++) {
            streamedText = '';
            const protocolRecoveryAttempt = finalizing && attempt > 1;
            upJson = await callChatProvider(
              providerName,
              apiKey,
              attemptBody,
              {
                userId: req.user && req.user.id,
                conversationId: _activeConv && _activeConv.id,
                kind: attempt > 1 ? 'agent_finalization_retry' : 'agent_iter',
              },
              protocolRecoveryAttempt ? undefined : (event) => {
                if (event.type === 'content_delta' && event.content && !aborted) {
                  streamedText += event.content;
                  if (!resultEditCompletionGuard.required) {
                    sseSend({ choices: [{ delta: { content: event.content } }] });
                  }
                }
              },
              {
                baseUrl,
                profileId: selectedPreset && selectedPreset.id,
                modelOverride: modelName,
                ...(protocolRecoveryAttempt ? { fallbackWhen: finalizationFallbackReason } : {}),
              }
            );
            if (finalizing && upJson && upJson.modelRouting) finalizationRouting = upJson.modelRouting;
            if (!finalizing) break;
            finalizationAttempts = Math.max(finalizationAttempts, attempt);
            const assessment = assessFinalizationResult(upJson, streamedText);
            finalizationFailureReason = assessment.usable ? null : assessment.reason;
            if (protocolRecoveryAttempt && assessment.usable && assessment.content) {
              sseSend({ choices: [{ delta: { content: assessment.content } }] });
            }
            if (assessment.usable || !assessment.retryable || attempt >= attemptLimit) break;
            sseSend({
              event: 'agent_status',
              phase: 'finalization_retry',
              attempt: attempt + 1,
              maxAttempts: attemptLimit,
              reason: assessment.reason,
              message: '模型未返回可展示的最终说明，正在自动重试整理…',
            });
            attemptBody = buildFinalizationRetryRequest(reqBody);
          }
          if (!finalizing && (!upJson || upJson.error || !upJson.choices)) {
            const assessment = assessFinalizationResult(upJson, streamedText);
            if (assessment.retryable && !aborted) {
              sseSend({
                event: 'agent_status',
                phase: 'provider_retry',
                attempt: 2,
                maxAttempts: 2,
                reason: assessment.reason,
                message: '上游响应暂时异常，正在自动重试当前阶段…',
              });
              streamedText = '';
              upJson = await callChatProvider(
                providerName,
                apiKey,
                reqBody,
                {
                  userId: req.user && req.user.id,
                  conversationId: _activeConv && _activeConv.id,
                  kind: 'agent_iter_retry',
                },
                (event) => {
                  if (event.type === 'content_delta' && event.content && !aborted) {
                    streamedText += event.content;
                    if (!resultEditCompletionGuard.required) {
                      sseSend({ choices: [{ delta: { content: event.content } }] });
                    }
                  }
                },
                { baseUrl, profileId: selectedPreset && selectedPreset.id, modelOverride: modelName }
              );
            }
          }
          if (!upJson || upJson.error || !upJson.choices) {
            if (finalizing && finalizationAttempts > 0) break;
            providerFailureReason = String(
              (upJson && (upJson.message || upJson.error || (upJson.choices ? 'no choice' : 'bad response')))
              || 'upstream error'
            );
            break;
          }

          const choice = upJson.choices[0];
          const msg = choice.message || {};
          const toolCalls = msg.tool_calls || [];

          if (finalizing) {
            const assessment = assessFinalizationResult(upJson, streamedText);
            assistantAcc = assessment.content;
            finalizationFailureReason = assessment.usable ? null : assessment.reason;
            if (assessment.usable) sseSend({ event: 'done' });
            break;
          }

          if (toolCalls.length === 0) {
            let assessment = assessFinalizationResult(upJson, streamedText);
            
            // 方案 B complete：截断自动续写时受 continuationGuard 硬保护。
            // 任务完整性仍由模型自描述（finish_reason）决定；但若同一任务内
            // 连续截断到上限，主动收尾 + 提示用户继续，避免无限续写。
            if (assessment.usable && assessment.truncated && !finalizing) {
              continuationGuard.recordTruncation(reqBody && reqBody.max_tokens);
              if (continuationGuard.capHit()) {
                sseSend({
                  event: 'agent_status',
                  phase: 'continuation_cap_hit',
                  reason: 'continuation_cap',
                  snapshot: continuationGuard.snapshot(),
                  message: '检测到连续多次回答被截断，已自动收尾当前任务。请基于以上内容继续追问，或在模型设置中调整单次输出上限。',
                });
                assistantAcc = assessment.content;
                sseSend({ event: 'done' });
                break;
              }
              fullMessages.push({ role: 'assistant', content: assessment.content });
              fullMessages.push({ role: 'user', content: '继续' });
              sseSend({
                event: 'agent_status',
                phase: 'continuation',
                reason: 'truncated_at_limit',
                message: '检测到回答被截断，正在自动续写…',
              });
              continue;
            }
            if (assessment.usable && !assessment.truncated) continuationGuard.recordStop();
            
            const editCompletion = resultEditCompletionGuard.assessTerminal();
            if (editCompletion.action === 'retry') {
              fullMessages.push({ role: 'assistant', content: assessment.content || msg.content || '' });
              fullMessages.push({ role: 'system', content: editCompletion.prompt });
              sseSend({
                event: 'agent_status',
                phase: 'result_edit_completion_retry',
                attempt: 1,
                maxAttempts: 1,
                reason: editCompletion.reason,
                message: editCompletion.message,
              });
              continue;
            }
            if (editCompletion.action === 'fail') {
              assistantAcc = editCompletion.message;
              sseSend({ choices: [{ delta: { content: assistantAcc } }] });
              sseSend({ event: 'done' });
              break;
            }
            finalizationAttempts = 1;
            finalizationFailureReason = assessment.usable ? null : assessment.reason;
            if (!assessment.usable && assessment.retryable && !aborted) {
              sseSend({
                event: 'agent_status',
                phase: 'finalization_retry',
                attempt: 2,
                maxAttempts: MAX_FINALIZATION_ATTEMPTS,
                reason: assessment.reason,
                message: '模型未返回可展示的最终说明，正在自动重试整理…',
              });
              streamedText = '';
              const retryJson = await callChatProvider(
                providerName,
                apiKey,
                buildFinalizationRetryRequest(reqBody),
                {
                  userId: req.user && req.user.id,
                  conversationId: _activeConv && _activeConv.id,
                  kind: 'agent_finalization_retry',
                },
                undefined,
                {
                  baseUrl,
                  profileId: selectedPreset && selectedPreset.id,
                  modelOverride: modelName,
                  fallbackWhen: finalizationFallbackReason,
                }
              );
              finalizationAttempts = 2;
              if (retryJson && retryJson.modelRouting) finalizationRouting = retryJson.modelRouting;
              assessment = assessFinalizationResult(retryJson, streamedText);
              finalizationFailureReason = assessment.usable ? null : assessment.reason;
              if (assessment.usable && assessment.content) {
                sseSend({ choices: [{ delta: { content: assessment.content } }] });
              }
            }
            assistantAcc = assessment.content;
            if (assessment.usable && resultEditCompletionGuard.required && assessment.content) {
              sseSend({ choices: [{ delta: { content: assessment.content } }] });
            }
            if (assessment.usable) sseSend({ event: 'done' });
            break;
          }

          function _buildResultCardFromRunTool(result, ctx) {
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
              projectId: ctx && ctx.projectId ? String(ctx.projectId) : null,
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

          const progress = assistantProgress.record(streamedText || msg.content, iter + 1);
          if (progress) sseSend({ event: 'agent_progress', ...progress });
          await runAgentToolCallBatch({
            controller: toolCallController,
            toolCalls,
            createCallId,
            shouldAbort: () => aborted,
            onReserved: (accepted) => {
              fullMessages.push({
                role: 'assistant',
                content: msg.content || '',
                tool_calls: accepted,
              });
            },
            execute: async ({ name, args, callId }) => {
              assistantToolActivities.recordCall({ name, args, traceId, callId, iteration: iter + 1 });
              sseSend(buildToolCallEvent({ name, args, traceId, callId, iteration: iter + 1 }));
              let envelope = await executeToolCall(name, args, toolCtx, { traceId, callId });
              let result = localizeToolResult(envelope.data);
              resultEditCompletionGuard.recordToolResult(name, result);
              envelope = replaceToolResultData(envelope, result);
              let ackInfo = null;
              if (result && result.ackToken && result._ackPromise) {
                ackInfo = result._ackPromise;
                delete result._ackPromise;
              }
              if (name === 'run_tool' && result && typeof result === 'object' && result.toolJobId && !result.needApproval) {
                _pushUniqueResultCard(assistantResultCards, _buildResultCardFromRunTool(result, context));
              }
              const toolResultEvent = buildToolResultEvent(envelope, args, { iteration: iter + 1 });
              assistantToolActivities.recordResult(toolResultEvent);
              sseSend(toolResultEvent);
              if (ackInfo) {
                const ackResult = await ackInfo;
                if (ackResult && ackResult.timedOut) {
                  result.unhandled = true;
                  result.message =
                    (result.message || '操作已记录') + '（⚠ 前端没有响应——可能当前页面没监听这个事件）';
                  const ackEvent = buildToolResultEvent(
                    { ...envelope, data: result },
                    args,
                    { iteration: iter + 1 }
                  );
                  ackEvent.summary = 'unhandled';
                  assistantToolActivities.recordResult(ackEvent);
                  sseSend(ackEvent);
                } else if (ackResult && ackResult.info && ackResult.info.error) {
                  result.unhandled = true;
                  result.message =
                    (result.message || '操作已记录') + '（前端报错：' + ackResult.info.error + '）';
                }
              }
              envelope = replaceToolResultData(envelope, result);
              return { envelope, result, args, name, callId };
            },
            reject: async ({ name, args, callId, error, message }) => {
              assistantToolActivities.recordCall({ name, args, traceId, callId, iteration: iter + 1 });
              sseSend(buildToolCallEvent({ name, args, traceId, callId, iteration: iter + 1 }));
              let envelope = createRejectedToolResult(name, error, message, toolCtx, { traceId, callId });
              const result = localizeToolResult(envelope.data);
              envelope = replaceToolResultData(envelope, result);
              const toolResultEvent = buildToolResultEvent(envelope, args, { iteration: iter + 1 });
              assistantToolActivities.recordResult(toolResultEvent);
              sseSend(toolResultEvent);
              return { envelope, result, args, name, callId };
            },
            onResult: ({ outcome }) => {
              fullMessages.push({
                role: 'tool',
                tool_call_id: outcome.callId,
                name: outcome.name,
                content: serializeToolResultForModel(outcome.envelope, undefined, {
                  state: modelResultState,
                }),
              });
            },
          });
        }

        if (providerFailureReason && assistantAcc.trim().length === 0) {
          const final = finalizeResultEditProgress(resultEditProgress, {
            outcome: 'failed', reason: 'agent_run_failed',
          });
          if (final.terminal) sseSend({ event: 'result_edit_progress', ...final.terminal });
          assistantAcc = final.assistantMessage;
          sseSend({ choices: [{ delta: { content: assistantAcc } }] });
          sseSend({ error: providerFailureReason });
        } else if (aborted && resultEditProgress.snapshot().length > 0) {
          const final = finalizeResultEditProgress(resultEditProgress, {
            outcome: 'cancelled', reason: 'user_cancelled',
          });
          if (final.terminal) sseSend({ event: 'result_edit_progress', ...final.terminal });
          assistantAcc = final.assistantMessage;
        }

        if (!providerFailureReason && !aborted && assistantAcc.trim().length === 0) {
          const fallbackMsg = buildFinalizationFallbackMessage({
            attempts: finalizationAttempts,
            reason: finalizationFailureReason,
            anomaly: toolCallController.anomaly,
            lastStageConclusion: assistantProgress.snapshot().slice(-1)[0]?.content,
          });
          sseSend({ choices: [{ delta: { content: fallbackMsg } }] });
          assistantAcc = fallbackMsg;
        }

        if (assistantAcc.trim().length > 0) {
          try {
            const userId = req.user && req.user.id;
            if (userId) {
              try {
                if (_activeConv) {
                  const assistantMeta = {
                    page: context && context.page,
                    projectId: context && context.projectId,
                    processingDurationMs: Math.max(0, Date.now() - requestStartedAt),
                    ...(assistantProgress.snapshot().length
                      ? { progressUpdates: assistantProgress.snapshot() }
                      : {}),
                    ...(resultEditProgress.snapshot().length
                      ? { resultEditProgress: resultEditProgress.snapshot() }
                      : {}),
                    ...(finalizationAttempts ? {
                      finalization: {
                        attempts: finalizationAttempts,
                        recovered: !finalizationFailureReason,
                        ...(finalizationFailureReason ? { failureReason: finalizationFailureReason } : {}),
                        ...(finalizationRouting ? { routing: finalizationRouting } : {}),
                      },
                    } : {}),
                    ...(providerFailureReason || finalizationFailureReason || toolCallController.anomaly ? {
                      incident: {
                        code: providerFailureReason
                          ? 'agent_provider_failed'
                          : toolCallController.anomaly?.code || finalizationFailureReason || 'agent_failure',
                        autoRecoveryAttempts: finalizationAttempts,
                        ...(toolCallController.anomaly?.tool ? { tool: toolCallController.anomaly.tool } : {}),
                      },
                    } : {}),
                    ...(assistantResultCards.length ? { resultCards: assistantResultCards } : {}),
                    ...(assistantToolActivities.snapshot().length
                      ? { toolActivities: assistantToolActivities.snapshot() }
                      : {}),
                  };
                  appendMessageToConversation(_activeConv.id, 'assistant', assistantAcc.trim(), assistantMeta);
                  assistantMessagePersisted = true;
                  try {
                    _maybeAutoTitleConversation(_activeConv.id, userId);
                  } catch {}
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
              try {
                const _msgCount = Array.isArray(messages) ? messages.length : 0;
                const _page = (context && context.page) || null;
                logChatAudit(userId, _page, _msgCount);
              } catch {}

              const lastUser = [...messages].reverse().find((m) => m.role === 'user');
              if (lastUser) {
                const cleanUser = String(lastUser.content || '').replace(/^\[[^\]]+\]\s*\n?/, '');
                const turnText = '用户: ' + cleanUser + '\n\nAI: ' + assistantAcc.trim();
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
                        projectId: context && context.projectId,
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

              try {
                const userMsgCount = Array.isArray(messages)
                  ? messages.filter((m) => m.role === 'user').length
                  : 0;
                if (userMsgCount >= 2 && userMsgCount % 2 === 0) {
                  const threadForExtract = messages
                    .slice(-12)
                    .concat([{ role: 'assistant', content: assistantAcc.trim() }]);
                  backgroundExtractFacts(userId, threadForExtract, context && context.projectId).catch(() => {});
                }
              } catch {}

              try {
                const SUMMARY_TRIGGER_AT = 22;
                const SUMMARY_KEEP_RECENT = 14;
                if (Array.isArray(messages) && messages.length > SUMMARY_TRIGGER_AT) {
                  const oldMsgs = messages.slice(0, messages.length - SUMMARY_KEEP_RECENT);
                  if (oldMsgs.length >= 6) {
                    getChatSummaryAsync(userId, context && context.projectId)
                      .then((existing) => {
                        summarizeMessages(userId, context && context.projectId, oldMsgs, existing && existing.summary).catch(
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
        if (!assistantMessagePersisted && _activeConv && resultEditProgress.snapshot().length > 0) {
          const final = finalizeResultEditProgress(resultEditProgress, {
            outcome: aborted ? 'cancelled' : 'failed',
            reason: aborted ? 'user_cancelled' : 'agent_run_failed',
          });
          if (final.terminal) sseSend({ event: 'result_edit_progress', ...final.terminal });
          const fallback = final.assistantMessage;
          const meta = {
            page: context && context.page,
            projectId: context && context.projectId,
            processingDurationMs: Math.max(0, Date.now() - requestStartedAt),
            resultEditProgress: resultEditProgress.snapshot(),
            incident: { code: aborted ? 'user_cancelled' : 'agent_run_failed', autoRecoveryAttempts: 0 },
          };
          try {
            appendMessageToConversation(_activeConv.id, 'assistant', fallback, meta);
            assistantMessagePersisted = true;
          } catch {}
        }
        sseSend({ error: e.message });
      }

      res.end();
    });
  },
};
