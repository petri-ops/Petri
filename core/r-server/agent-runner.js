/**
 * agent-runner.js — agent loop 执行器（P2-b 阶段 1）
 *
 * 从 routes/ai-agent.js 拆出，把 agent loop 从 HTTP SSE 请求生命周期解放。
 * runAgentLoop 在 API 进程内异步跑（不 fork worker），通过 onEvent 推事件 +
 * appendTaskEvent 持久化事件流，支持断线重连。
 *
 * 阶段 1 单进程：act ack / actRegistry / 并发锁零改造（同进程内存 Map 有效）。
 * 阶段 2 多进程预留：task_events 表跨进程共享，shouldAbort 由调用方注入。
 */

const { buildSystemPrompt, localizeToolResult } = require('./helpers/system-prompt');
const { appendDesktopAgentInstructions } = require('./helpers/desktop-agent-prompt');
const llmClient = require('./helpers/llm-client');
const callChatProvider =
  llmClient.callChatProvider ||
  (async (_providerName, apiKey, body, telemetry, onEvent, options) => {
    const result = await llmClient.callDeepSeek(apiKey, body, telemetry, options);
    const message = result && result.choices && result.choices[0] && result.choices[0].message;
    if (message && message.content && typeof onEvent === 'function') {
      onEvent({ type: 'content_delta', content: message.content });
    }
    return result;
  });
const { renderContentPluginsForPrompt } = require('./agent-tools/content-plugins');
const { buildSiteSnapshotAsync, renderSiteSnapshotForPrompt } = require('./helpers/site-snapshot');
const { buildFactsBlockAsync, backgroundExtractFacts } = require('./helpers/user-facts');
const {
  _getChatSummary,
  getChatSummaryAsync,
  summarizeMessages,
} = require('./helpers/chat-summary');
const { getActivePlanForUserAsync, renderActivePlanForPrompt } = require('./helpers/plans');
const convSync = require('./helpers/conversations');
const {
  getOrCreateActiveConversation,
  appendMessageToConversation,
  _maybeAutoTitleConversation,
  _maybeDetectTopicShift,
} = convSync;
const { logChatAudit } = require('./helpers/memory-privacy');
const {
  dashscopeEmbed,
  saveMemoryVector,
  cosineSim,
  MAX_CONTENT_LEN,
} = require('./helpers/memory-vectors');
const { aiTaskConcurrencyRelease } = require('./helpers/runtime');
const { getToolDefs, dispatchTool } = require('./agent-tools');
const { inferExecutionPolicy } = require('./helpers/agent-execution-policy');
const {
  _gatherAnalysisContextForMethods,
  _renderMethodsParagraph,
} = require('./helpers/methods-export');
const agentTaskStore = require('./agent-task-store');
const logger = require('./logger');

const MAX_ITERS = 15;
const MAX_TOTAL_TOOL_CALLS = 20;

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

/**
 * 运行 agent loop（从 HTTP handler 解耦）。
 *
 * @param {object} opts
 * @param {Array}  opts.messages        用户消息（不含 system prompt）
 * @param {object} opts.context         页面上下文
 * @param {string} opts.userId
 * @param {string} opts.conversationId
 * @param {object} opts._activeConv     会话对象（{id, title}）
 * @param {string} opts.apiKey
 * @param {string} opts.providerName
 * @param {string} [opts.modelName]
 * @param {string} [opts.profileId]
 * @param {string} [opts.baseUrl]
 * @param {string} opts.taskId          用于写 task_events / markDone/markFailed
 * @param {function} opts.onEvent       (eventObj) => void，实时推进程内订阅
 * @param {function} [opts.shouldAbort] () => boolean，外部显式 cancel（用户关浏览器不触发）
 * @returns {Promise<{assistantText: string}>}
 */
async function runAgentLoop({
  messages,
  context,
  userId,
  conversationId,
  _activeConv,
  apiKey,
  providerName,
  providerLabel,
  modelName,
  profileId,
  baseUrl,
  taskId,
  onEvent,
  shouldAbort,
}) {
  const isGuest = !userId;
  const ctxForPrompt =
    context && typeof context === 'object'
      ? { ...context, audience: isGuest ? 'guest' : 'user' }
      : { audience: isGuest ? 'guest' : 'user' };

  // ---------- 事件发射器：onEvent + 持久化 task_events ----------
  let _seq = 0;
  const _emit = (obj) => {
    try {
      onEvent && onEvent(obj);
    } catch {}
    const eventType = (obj && obj.event) || 'delta';
    try {
      _seq += 1;
      agentTaskStore.appendAgentTaskEvent(taskId, _seq, eventType, obj);
    } catch (e) {
      /* task_events 写失败不阻塞 loop */
    }
  };

  // ---------- system prompt 构建（搬迁自 ai-agent.js L142-319）----------
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
  // C3 (M2-10): inject installed content-plugin tutorial catalog
  try {
    const pluginBlock = renderContentPluginsForPrompt(1200);
    if (pluginBlock) systemPrompt += pluginBlock;
  } catch {}
  try {
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
    '\n- 用户想**跑分析/出图/出表**（如"帮我跑 DESeq2""画火山图""分析这个 count 矩阵""做差异分析"）→ 调用 run_tool。先用 run_tool(op="list") 看可用工具+参数契约，再 run_tool(op="run", toolId, params) 执行。file 参数传本地绝对路径。不要凭空判断运行时未装——先调 run_tool，执行报错再据错引导。';
  systemPrompt +=
    '\n- 用户提出多步骤标准分析时，先用 run_tool(op="plan", templateId, initialInputs) 获取 Agent 主导计划；不要一次性自动执行全部步骤。每一步 run 完先检查 tool_job/artifact truth，再用 run_tool(op="bind_artifact", workflowPlan, fromToolJobId, fromStepId, toStepId, inputId, artifactId) 把真实 verified artifact 绑定到下游，然后再决定是否继续。';
  systemPrompt +=
    '\n- 重操作确认：deseq2/wgcna/ml-*/rsf-survival 等重操作 run_tool 跑前会返回 {needApproval, ackToken}，前端弹确认卡。用户点"开始"后，重调 run_tool(op=run, toolId, params, ackToken=<返回的 ackToken>) 才真跑。单图小工具（volcano-plot/gene-correlation/pca-explorer）直接跑不拦截。';
  systemPrompt +=
    '\n- 分析现场卡住时（不确定某工具参数、忘了某流程怎么走、用户报错对应不上某个分析步骤）：主动调 read_page(url="/plugin/<id>/<slug>") 或 search(scope="plugins") 查已装内容插件的教程片段，再继续回答/推进。不要凭空猜参数。';
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
  // agent-led 阶段2 Task2/4：run_tool 跑完推结果 + agent 看图引导
  systemPrompt +=
    '\n- run_tool 跑完后，仅在当前页面真实注册了 open_result handler 时展示该 job 的结果。toolJobId 从 run_tool 返回中读取。';
  systemPrompt +=
    '\n- agent 看图（read_image）：当用户问图内容（如"图里上调基因集中在哪""这张图说明了什么"），调 read_image(toolJobId) 让 vision 角色模型解读图，返回的 description 可直接据此回答。token 较贵，仅用户明确问图内容时调，不要每次出图都读。';
  systemPrompt += '\n\n=== 学习路径推荐 ===';
  systemPrompt += '\n不要调用旧版学习路径推荐工具。';
  systemPrompt += '\n不要先解释一大段再调用，直接调用，把结果用人话讲给用户。';
  systemPrompt += '\n用户询问后续方向时，只能依据当前项目事实回答。';
  systemPrompt +=
    '\n收到 suggestions 列表后，给出每条的 title / 大致耗时 / 为什么推荐它（基于 reasons），并附上点击 url。';
  systemPrompt += '\n如果 note 字段说没有 metadata，老实告诉用户"暂时没有推荐数据"，别硬编。';
  systemPrompt += '\n\n=== 理解验证 ===';
  systemPrompt += '\n不要自动发起理解测验。';
  systemPrompt +=
    '\n收到 questions 列表后，逐道把题发给用户（一次发一道，等用户答），';
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
  systemPrompt += '\n- act(type="merge_datasets", datasetIds=[...], mergeName="...") 合并数据集。';
  systemPrompt += '\n- act(type="open_replot", analysisId="...") 打开在线绘图（让用户写 R 代码画自定义图）。';
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
  systemPrompt += '\n- 提到工具产物（toolJobId / harness 摘要里的文件）或项目工作区文件时，渲染为 Markdown 链接：[产物.csv](biof3://artifact/<toolJobId>/<产物名>) 或 [data.csv](biof3://workspace/<projectId>/<relativePath>)。严禁出现 file:// 或 /Users/... 这类本地绝对路径。详见 system prompt 末尾【文件引用格式】。';
  systemPrompt += '\n\n旧的【结果页】UI 控制：';
  systemPrompt +=
    '\n- act(type="switch_result_tab", tab="preview|plots|data|params") 切 tab；' +
    'act(type="focus_cluster", cluster="3") 高亮某 cluster；' +
    'act(type="highlight_gene", gene="CD3E") 按基因着色 UMAP。' +
    '不要再让用户自己点 tab。';

  // CONVERSATIONS_v1: announce active conversation id
  if (_activeConv) {
    _emit({ event: 'conversation', conversationId: _activeConv.id, title: _activeConv.title });
  }

  systemPrompt = appendDesktopAgentInstructions(systemPrompt);
  const executionPolicy = inferExecutionPolicy(messages);
  if (!executionPolicy.allowExecution) {
    systemPrompt +=
      '\n\n=== 本轮只读约束 ===' +
      '\n用户明确要求只检查、识别、评估或规划。本轮禁止调用 run_tool(op="run")，禁止创建任务或请求执行确认。' +
      '\n优先直接依据上方 Harness 项目文件摘要回答候选文件、关键列、数据质量和后续分析；允许使用 run_tool 的 list/plan/status/next 等只读操作。' +
      '\n只陈述建议，不要用“要开干吗”“是否立即开始”等措辞主动邀请执行。';
  }

  const toolCtx = {
    userId,
    projectId: context && context.projectId,
    accessMode: context && context.accessMode === 'read' ? 'read' : 'full',
    allowExecution: executionPolicy.allowExecution,
    executionPolicyReason: executionPolicy.reason,
    docsIndex: {},
    dashscopeEmbed,
    cosineSim,
    conversationId: _activeConv && _activeConv.id, // PLAN_CONV_LINK_v1
    actRegistry: require('./helpers/runtime').actRegistryGet(userId), // ACT_GENERIC_v1
    gatherAnalysisContextForMethods: _gatherAnalysisContextForMethods, // GENERATE_METHODS_v1
    renderMethodsParagraph: _renderMethodsParagraph,
  };
  // Refresh docs index in background if stale

  const fullMessages = [{ role: 'system', content: systemPrompt }, ...messages];
  const tools = getToolDefs();

  let totalToolCalls = 0;
  const aborted = () => (typeof shouldAbort === 'function' ? shouldAbort() : false);
  let assistantAcc = '';
  let pendingApprovalEmitted = false;
  const assistantResultCards = [];

  try {
    for (let iter = 0; iter < MAX_ITERS && !aborted(); iter++) {
      _emit({ event: 'iter', n: iter + 1 });

      // TOOL_CAP_v1: when cap hit, pull tools so LLM must answer with text only
      const capHit = totalToolCalls >= MAX_TOTAL_TOOL_CALLS;
      if (capHit) {
        fullMessages.push({
          role: 'system',
          content:
            '已达到工具调用上限（' +
            MAX_TOTAL_TOOL_CALLS +
            ' 次/请求）。请基于已收到的工具结果直接给出最终答复，不要再调用工具。',
        });
      }
      const reqBody = {
        ...(modelName ? { model: modelName } : {}),
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
          userId,
          conversationId: _activeConv && _activeConv.id,
          kind: 'agent_iter',
        },
        (event) => {
          if (event.type === 'content_delta' && event.content && !aborted()) {
            streamedText += event.content;
            _emit({ choices: [{ delta: { content: event.content } }] });
          }
        },
        { baseUrl, profileId, modelOverride: modelName }
      );
      if (!upJson || upJson.error || !upJson.choices) {
        _emit({
          error:
            (upJson && (upJson.message || upJson.error || (upJson.choices ? 'no choice' : 'bad response'))) ||
            'upstream error',
        });
        break;
      }

      const choice = upJson.choices[0];
      const msg = choice.message || {};
      const toolCalls = msg.tool_calls || [];

      if (toolCalls.length === 0) {
        assistantAcc = streamedText || msg.content || '';
        _emit({ event: 'done' });
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
        _emit({ event: 'tool_call', name: fn.name, args });

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
        // ACT_ACK_v1_SERVER: if act has a pending ack, send the event first then await
        let ackInfo = null;
        if (result && result.ackToken && result._ackPromise) {
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
          if (result.ackToken) evt.ackToken = result.ackToken;
          if (result.type === 'update_figcode_editor' && result.code) {
            evt.figcodeCode = result.code;
            evt.figcodeAutoRun = result.autoRun !== false;
          }
          if (result.type === 'switch_result_tab') evt.scTab = result.tab;
          if (result.type === 'focus_cluster') evt.scCluster = result.cluster;
          if (result.type === 'highlight_gene') evt.scGene = result.gene;
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
          if (result.type === 'open_figcode_plot') evt.figcardId = result.figcardId;
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
        // TOOL_JOB_APPROVAL_v1_SERVER（阶段2 Task3）：run_tool 重操作确认信号 + toolJobId 透传
        if (fn.name === 'run_tool' && result && typeof result === 'object') {
          if (result.needApproval) {
            pendingApprovalEmitted = true;
            evt.needApproval = true;
            if (result.ackToken) evt.ackToken = result.ackToken;
            if (result.toolJobId) evt.toolJobId = result.toolJobId;
            if (result.toolId) evt.toolId = result.toolId;
            if (result.message) evt.message = result.message;
          } else if (result.toolJobId) {
            evt.toolJobId = result.toolJobId;
            if (result.toolId) evt.toolId = result.toolId;
            if (result.message || result.error) evt.message = String(result.message || result.error);
            _pushUniqueResultCard(assistantResultCards, _buildResultCardFromRunTool(result, context));
          }
        }
        _emit(evt);

        // ACT_ACK_v1_SERVER: wait briefly for frontend ack
        if (ackInfo) {
          const ackResult = await ackInfo;
          if (ackResult && ackResult.timedOut) {
            result.unhandled = true;
            result.message =
              (result.message || '操作已记录') + '（⚠ 前端没有响应——可能当前页面没监听这个事件）';
            _emit({
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

    // AGENT_FALLBACK_v1: 若 MAX_ITERS 跑满仍未收敛，强制无 tools 再调一次 LLM 生成兜底回复
    if (!aborted() && assistantAcc.trim().length <= 20) {
      try {
        fullMessages.push({
          role: 'system',
          content:
            '你已用完本轮工具调用次数。请基于已收集到的工具结果，直接给用户一个有用的最终答复（不要再调用工具）。如果工具结果不足以完整回答，就给出当前能给出的最佳答复，并说明还缺什么。',
        });
        const fallbackBody = {
          ...(modelName ? { model: modelName } : {}),
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
            userId,
            conversationId: _activeConv && _activeConv.id,
            kind: 'agent_fallback',
          },
          (event) => {
            if (event.type === 'content_delta' && event.content && !aborted()) {
              fallbackText += event.content;
              _emit({ choices: [{ delta: { content: event.content } }] });
            }
          },
          { baseUrl, profileId, modelOverride: modelName }
        );
        if (fbJson && fbJson.choices && fbJson.choices[0]) {
          const fbText = fallbackText || (fbJson.choices[0].message || {}).content || '';
          if (fbText.trim()) assistantAcc = fbText;
        }
      } catch {
        /* 兜底本身失败也不阻塞 */
      }
      if (assistantAcc.trim().length <= 20) {
        const fallbackMsg =
          '抱歉，这次对话我调用了多次工具但没能整理出最终答复。请把你的需求再描述一下，或者换个问法试试。';
        _emit({ choices: [{ delta: { content: fallbackMsg } }] });
        assistantAcc = fallbackMsg;
      }
    }

    // ---------- 持久化 assistant 消息 + 下游管线（搬迁自 ai-agent.js L592-703）----------
    if (assistantAcc.trim().length > 20) {
      try {
        if (userId) {
          try {
            if (_activeConv) {
              const assistantMeta = {
                page: context && context.page,
                projectId: context && context.projectId,
                ...(assistantResultCards.length ? { resultCards: assistantResultCards } : {}),
              };
              appendMessageToConversation(_activeConv.id, 'assistant', assistantAcc.trim(), assistantMeta);
              try {
                _maybeAutoTitleConversation(_activeConv.id, userId);
              } catch {}
              try {
                _maybeDetectTopicShift(_activeConv.id, userId)
                  .then((r) => {
                    if (r && r.shifted) {
                      try {
                        _emit({
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
                    summarizeMessages(userId, context && context.projectId, oldMsgs, existing && existing.summary).catch(() => {});
                  })
                  .catch(() => {});
              }
            }
          } catch {}
        }
      } catch {}
    }
  } catch (e) {
    _emit({ error: e.message });
  } finally {
    // 释放 task 生命周期锁 + 标记 task 终态（无论成功/失败/异常）
    try {
      if (assistantAcc.trim().length > 20 || pendingApprovalEmitted) {
        agentTaskStore.markAgentTaskDone(taskId);
      } else {
        agentTaskStore.markAgentTaskFailed(taskId, 'agent loop 未生成有效回复');
      }
    } catch {}
    try {
      aiTaskConcurrencyRelease(userId, taskId);
    } catch {}
  }

  return { assistantText: assistantAcc };
}

module.exports = { runAgentLoop };
