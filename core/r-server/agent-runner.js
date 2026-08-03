/**
 * agent-runner.js — agent loop 执行器（P2-b 阶段 1）
 *
 * 从 routes/ai-agent.js 拆出，把 agent loop 从 HTTP SSE 请求生命周期解放。
 * runAgentLoop 在 API 进程内异步跑（不 fork worker），通过 onEvent 推事件 +
 * appendTaskEvent 持久化事件流，支持断线重连。
 *
 * 阶段 1 单进程：act ack / 并发锁零改造（同进程内存 Map 有效）。
 * 阶段 2 多进程预留：task_events 表跨进程共享，shouldAbort 由调用方注入。
 */

const { buildSystemPrompt, localizeToolResult } = require('./helpers/system-prompt');
const { appendDesktopAgentInstructions } = require('./helpers/desktop-agent-prompt');
const { renderPluginDemoPathsForPrompt } = require('./helpers/plugin-demo-prompt');
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

const { v4: uuidv4 } = require('uuid');

// HLE-C1: Loop Controller + Ledger imports
const {
  buildLoopRun,
  buildIteration,
  buildEvidence,
  stableHash,
  REASON_CODES,
  normalizeLoopAutomationMode,
} = require('../shared-backend/loop-contract');
const {
  deriveObservedStateDigest,
  mapDecisionToIterationStatus,
} = require('../shared-backend/loop-controller');

if (
  typeof deriveObservedStateDigest !== 'function' ||
  typeof mapDecisionToIterationStatus !== 'function'
) {
  throw new TypeError('Harness Loop Controller runtime exports are incomplete');
}

const {
  persistLoopRun,
  updateLoopRunStatus,
  getLoopRun,
  listLoopRunsForConversation,
  getActiveLoopRunForConversation,
  persistLoopIteration,
  listLoopIterations,
  persistLoopAction,
  getLoopActionByKey,
  getToolJob,
  persistLoopEvidence,
  saveContextCheckpoint,
} = require('./db');

// HLE-C3R: durable checkpoint builder — persists a compact, redacted snapshot
// per iteration so the conversation summary is not the only copy of loop state.
const { buildIterationCheckpoint } = require('../shared-backend/loop-checkpoint');

// HLE-C2: Validator, Diagnoser, Repair imports
const {
  validateArtifact,
  validateDelivery,
  registerValidator,
  buildResult,
} = require('../shared-backend/loop-validator-registry');

const {
  diagnoseFailure,
} = require('../shared-backend/loop-failure-diagnoser');

const {
  selectRepairStrategy,
} = require('../shared-backend/loop-repair-strategy');
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
  shouldFinalizeAgentIteration,
  assessFinalizationResult,
  buildFinalizationRetryRequest,
  buildFinalizationFallbackMessage,
  finalizationFallbackReason,
  createAgentProgressRecorder,
  createResultEditCompletionGuard,
  createAgentToolCallController,
  runAgentToolCallBatch,
} = require('./agent-tools');
const {
  createResultEditProgressRecorder,
  finalizeResultEditProgress,
  projectResultStudioToolContext,
} = require('./agent-tools/result-context-binding');
const { inferExecutionPolicy } = require('./helpers/agent-execution-policy');
const {
  _gatherAnalysisContextForMethods,
  _renderMethodsParagraph,
} = require('./helpers/methods-export');
const agentTaskStore = require('./agent-task-store');
const logger = require('./logger');

function resolveAgentTaskTerminal({
  cancelled = false,
  fatalError = null,
  assistantText = '',
  pendingApproval = false,
} = {}) {
  if (cancelled) return { status: 'cancelled', error: null };
  if (fatalError) {
    return {
      status: 'failed',
      error: fatalError.message || String(fatalError) || 'agent loop failed',
    };
  }
  if (String(assistantText || '').trim().length > 20 || pendingApproval) {
    return { status: 'completed', error: null };
  }
  return { status: 'failed', error: 'agent loop 未生成有效回复' };
}

function resolveFailedJobReplacements(toolJobs = []) {
  const failedJobs = toolJobs.filter((job) => ['failed', 'blocked'].includes(job.status));
  const replacementByFailureKey = new Map();
  for (const failed of failedJobs) {
    const failedToolId = failed.toolId || failed.jobTruth?.tool_id || null;
    if (!failedToolId) continue;
    const replacement = toolJobs.find((candidate) =>
      candidate.status === 'completed' &&
      candidate.toolJobId &&
      candidate.iteration > failed.iteration &&
      (candidate.toolId || candidate.jobTruth?.tool_id) === failedToolId
    );
    if (replacement) {
      replacementByFailureKey.set(failed.toolJobId || failed.callId, replacement);
    }
  }
  const unresolvedFailedJobs = failedJobs.filter(
    (failed) => !replacementByFailureKey.has(failed.toolJobId || failed.callId)
  );
  const primaryFailed = failedJobs.find((failed) =>
    failed.toolJobId && replacementByFailureKey.has(failed.toolJobId)
  ) || failedJobs.find((failed) => failed.toolJobId) || failedJobs[0] || null;
  return {
    failedJobs,
    unresolvedFailedJobs,
    primaryFailed,
    replacementByFailureKey,
    repairedFailedJobIds: new Set(
      failedJobs
        .filter((failed) => failed.toolJobId && replacementByFailureKey.has(failed.toolJobId))
        .map((failed) => failed.toolJobId)
    ),
  };
}

function buildObservedReplacementAttempt(diagnosis, failedJob, replacementJob) {
  if (!failedJob?.toolJobId || !replacementJob?.toolJobId) return null;
  const toolId =
    replacementJob.toolId ||
    replacementJob.jobTruth?.tool_id ||
    failedJob.toolId ||
    failedJob.jobTruth?.tool_id ||
    null;
  return {
    strategyId: 'observed_same_tool_replacement',
    strategyVersion: '1.0.0',
    newToolId: toolId,
    newInputs: null,
    newParams: null,
    parentLineage: {
      parentJobId: failedJob.toolJobId,
      parentArtifactIds: [],
      parentPlanHash: null,
      repairReason: diagnosis?.faultType || 'unclassified_failure',
    },
    replacementJobId: replacementJob.toolJobId,
    repaired: true,
    invalidatedArtifactIds: [],
    preservedArtifactIds: [],
    isActionable: false,
    requiresUserAuth: false,
    publicMessage: '已验证同一工具的新 Job 成功替换失败 Job，并保留 parent/replacement lineage。',
    costMultiplier: 1,
    safetyLevel: 'safe',
  };
}

function buildLoopObservationEvidence(input) {
  return buildEvidence({
    ...input,
    kind: 'observation',
  });
}

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
  const turnStartedAt = Date.now();
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
  systemPrompt += renderPluginDemoPathsForPrompt();
  systemPrompt +=
    '\n- 用户想**跑分析/出图/出表**（如"帮我跑 DESeq2""画火山图""分析这个 count 矩阵""做差异分析"）→ 调用 run_tool。先用 run_tool(op="list") 看可用工具+参数契约，再 run_tool(op="run", toolId, params) 执行。file 参数传本地绝对路径。不要凭空判断运行时未装——先调 run_tool，执行报错再据错引导。';
  systemPrompt +=
    '\n- 用户提出多步骤标准分析时，先用 run_tool(op="plan", templateId, initialInputs) 获取 Agent 主导计划；不要一次性自动执行全部步骤。每一步 run 完先检查 tool_job/artifact truth，再用 run_tool(op="bind_artifact", workflowPlan, fromToolJobId, fromStepId, toStepId, inputId, artifactId) 把真实 verified artifact 绑定到下游，然后再决定是否继续。';
  systemPrompt +=
    '\n- 自动化边界：完全访问模式下，deseq2/wgcna 等项目内可复现分析直接执行；读取结果并在不改变科学问题的前提下自动诊断、修参和重试，不要请求用户点击开始。只有不可逆外部影响、凭据/付费操作或缺少科学判断时才请求用户决定。';
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
  // run_tool 成功事件由客户端确定性打开结果；模型只在用户明确要求时解读图片。
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
  systemPrompt += '\n- 科学源数据不可变：不得用 workspace_write/workspace_replace/workspace_exec 原地修改已有 CSV/TSV/H5AD/RDS/测序文件来迎合插件。格式或标签修复必须写入 derived/ 或由转换插件生成新 Artifact，保留原文件和输入 hash，再把派生 Artifact 绑定给下游 Job。';
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

  // HLE-C1: Loop state — created lazily on first real execution turn (task_execute detection)
  // Ordinary Q&A and context_assist do NOT create a LoopRun.
  let loopState = null;
  let loopRunId = null;
  let loopSequence = 0;
  let loopIterations = [];       // persisted iterations for this run
  let loopActiveJobs = [];       // in-flight tool_job_ids observed this turn
  let loopFirstIterationDone = false;
  let loopAbortedByController = false;
  let loopPublicConclusion = null;
  // HLE-C2: accumulated validator results for this run (used in pre-turn decision)
  let loopValidatorResults = [];
  // HLE-C2: toolJobId → artifact data from result_json (used for validation + false-success check)
  const loopArtifactCache = {};

  // HLE-C2: Extract artifact filenames from result_json (mirrors harness.js logic)
  function _extractArtifactFiles(parsed) {
    if (!parsed || typeof parsed !== 'object') return [];
    const out = new Set();
    const INTERNAL_FILES = new Set([
      '.tool_manifest.json', '.params.json', '.log', '.lock',
      '__MACOSX', '.DS_Store', 'Thumbs.db',
    ]);
    const sources = [parsed.artifacts, parsed.outputs, parsed.files];
    for (const list of sources) {
      if (!Array.isArray(list)) continue;
      for (const item of list) {
        if (!item) continue;
        const name = typeof item === 'string' ? item : item.name || item.filename;
        if (!name) continue;
        const base = typeof name === 'string' ? require('path').basename(name) : String(name);
        if (base && !INTERNAL_FILES.has(base)) out.add(base);
      }
    }
    return Array.from(out);
  }

  function _loopInit(projectId, conversationId) {
    // idempotent: only create once per turn closure
    if (loopRunId) return;
    const pid = String(projectId || '');
    const cid = String(conversationId || '');
    const executionIntent = executionPolicy.allowExecution ? 'task_execute' : 'task_draft';
    const automationMode = normalizeLoopAutomationMode(
      context && context.automationMode,
      toolCtx.accessMode === 'full' ? 'trusted' : 'guided',
    );

    // HLE-C3R: durable resume. A multi-turn task must reuse ONE LoopRun rather
    // than mint a new run every turn. Look up the latest non-terminal run for
    // this (project, conversation, automationMode) and resume it. Terminal runs
    // (incl. failed(recovery_required) set by a server restart) are excluded by
    // getActiveLoopRunForConversation, so recovery is surfaced via the recovery
    // API instead of being silently resumed here.
    let resumed = null;
    try {
      resumed = getActiveLoopRunForConversation(pid, cid);
    } catch { resumed = null; }

    if (resumed && resumed.loopRunId) {
      loopRunId = resumed.loopRunId;
      loopState = resumed.loopStatus === 'planned' ? 'running' : resumed.loopStatus;
      // Rebuild the in-memory iteration chain (ASC) so sequence + parent hash
      // continue from durable truth, not from an empty per-turn array.
      try {
        const prior = listLoopIterations(loopRunId, { limit: 500 }) || [];
        loopIterations = prior.slice().sort((a, b) => (a.sequence || 0) - (b.sequence || 0));
        loopSequence = loopIterations.reduce((m, it) => Math.max(m, it.sequence || 0), 0);
      } catch {
        loopIterations = [];
        loopSequence = 0;
      }
      // A resumed 'planned' run advances to 'running' on first execution turn.
      if (resumed.loopStatus === 'planned' && executionPolicy.allowExecution) {
        try {
          updateLoopRunStatus(loopRunId, {
            loopStatus: 'running',
            hash: resumed.hash,
            json: JSON.stringify(resumed.record || {}),
            updatedAt: new Date().toISOString(),
          });
        } catch {}
      }
      _emit({
        event: 'loop_phase',
        phase: 'resumed',
        loopRunId,
        automationMode: resumed.automationMode || automationMode,
        executionIntent: resumed.executionIntent || executionIntent,
        resumedFromSequence: loopSequence,
      });
      return;
    }

    const taskSpecHash = stableHash({
      projectId: pid,
      conversationId: cid,
      executionIntent,
    });
    const run = buildLoopRun({
      projectId: pid,
      conversationId: cid,
      taskSpecRef: taskSpecHash,
      automationMode,
      executionIntent,
      loopStatus: 'running',
      metadata: { taskSpecHash },
    });
    loopRunId = run.loopRunId;
    loopState = 'running';
    persistLoopRun(run);
    _emit({
      event: 'loop_phase',
      phase: 'started',
      loopRunId,
      automationMode,
      executionIntent,
    });
  }

  function _loopEmitIterationEvent(iteration, decision, actionKey) {
    _emit({
      event: 'loop_iteration',
      loopRunId,
      iterationId: iteration.iterationId,
      sequence: iteration.sequence,
      decision: iteration.decision,
      decisionReasonCode: iteration.decisionReasonCode,
      publicConclusion: iteration.publicConclusion,
      status: iteration.status,
      proposedActionKey: actionKey || null,
      actionKeyHash: actionKey ? stableHash(actionKey) : null,
    });
  }

  function _loopPersistPhase(nextStatus, publicConclusion) {
    if (!loopRunId || !nextStatus || nextStatus === 'running') return;
    try {
      const current = getLoopRun(loopRunId);
      if (!current || current.loopStatus === nextStatus) return;
      updateLoopRunStatus(loopRunId, {
        loopStatus: nextStatus,
        hash: current.hash,
        json: JSON.stringify({
          ...(current.record || {}),
          loopStatus: nextStatus,
          publicConclusion: publicConclusion || null,
          completedAt: ['completed', 'failed', 'cancelled'].includes(nextStatus)
            ? new Date().toISOString()
            : null,
        }),
        updatedAt: new Date().toISOString(),
      });
      _emit({
        event: 'loop_phase',
        phase: nextStatus,
        loopRunId,
        publicConclusion: publicConclusion || undefined,
        automationMode: current.automationMode,
        executionIntent: current.executionIntent,
      });
    } catch (error) {
      console.warn('[harness-loop] failed to persist phase:', error && error.message);
    }
  }

  // HLE-C3R: persist a durable context checkpoint for each iteration so the
  // chat summary is NOT the only copy of loop state. ContextEnvelope rebuild
  // (model switch / app restart) reads these checkpoints. Best-effort: a
  // checkpoint failure must never break the turn.
  function _loopSaveCheckpoint(iteration, projectId, conversationId, extra = {}) {
    if (!loopRunId || !iteration || !iteration.iterationId) return;
    try {
      const cp = buildIterationCheckpoint({
        loopRunId,
        loopRunHash: iteration.hash,
        sequence: iteration.sequence,
        observedStateDigest: iteration.observedStateDigest || iteration.hash,
        goalGapIds: iteration.goalGapIds || [],
        decision: iteration.decision,
        decisionReasonCode: iteration.decisionReasonCode,
        publicConclusion: iteration.publicConclusion,
        status: iteration.status,
        proposedActionHash: extra.proposedActionHash || null,
        validatorResults: extra.validatorResults || [],
        repairAttempt: extra.repairAttempt || null,
        toolJobId: extra.toolJobId || null,
        artifactIds: extra.artifactIds || [],
        costSnapshot: extra.costSnapshot || null,
      });
      saveContextCheckpoint({
        ...cp,
        projectId: String(projectId || ''),
        conversationId: String(conversationId || ''),
        sourceDigest: cp.observedStateDigest || cp.checkpointId,
      });
    } catch { /* best-effort: never break the turn on checkpoint failure */ }
  }

  function _loopPersistProgressIteration(providerIteration) {
    if (!loopRunId) return;
    const batch = assistantToolActivities
      .snapshot()
      .filter((activity) => activity.iteration === providerIteration);
    if (batch.length === 0) return;

    const runToolJobs = batch
      .filter((activity) => activity.name === 'run_tool' && activity.callId)
      .map((activity) => {
        const event = toolResultEventsByCallId[activity.callId];
        const resultData = event?.toolResult?.data || {};
        // Public ToolResult payloads are deliberately bounded. Large plugin
        // results become data.preview, while the stable execution identity is
        // promoted to the event envelope. Always read the promoted field first
        // so Loop persistence never loses run_tool -> tool_job lineage.
        const toolJobId = event?.toolJobId || resultData.toolJobId || null;
        let job = null;
        if (toolJobId) {
          try { job = getToolJob(toolJobId) || null; } catch {}
        }
        const resultFailed = resultData.ok === false || Boolean(resultData.error);
        return {
          id: toolJobId || activity.callId,
          toolJobId,
          toolId: job?.tool_id || resultData.toolId || null,
          status: job?.status || (
            resultFailed
              ? 'failed'
              : activity.status === 'success'
              ? 'completed'
              : activity.status === 'awaiting_confirmation'
                ? 'pending'
                : 'failed'
          ),
          error: job?.error || resultData.error || resultData.message || null,
          requiresUserInput: [
            'missing_required_file_inputs',
            'scientific_task_not_confirmed',
            'scientific_task_params_changed',
            'scientific_task_tool_changed',
          ].includes(resultData.error),
          finished_at: job?.completed_at || null,
        };
      });
    const failedCount = runToolJobs.filter((job) => ['failed', 'blocked'].includes(job.status)).length;
    const pendingCount = runToolJobs.filter((job) => ['pending', 'queued', 'running'].includes(job.status)).length;
    const completedTools = [...new Set(runToolJobs
      .filter((job) => job.status === 'completed')
      .map((job) => job.toolId)
      .filter(Boolean))];
    const latestProgress = assistantProgress
      .snapshot()
      .filter((progress) => progress.iteration === providerIteration)
      .slice(-1)[0]?.content;

    let decision = 'continue';
    let reasonCode = REASON_CODES.TOOL_SUCCEEDED;
    let publicConclusion = latestProgress || `本阶段已完成 ${batch.length} 项操作，继续推进。`;
    if (failedCount > 0) {
      const requiresUserInput = runToolJobs.some((job) => job.requiresUserInput);
      decision = requiresUserInput ? 'wait' : 'retry';
      reasonCode = requiresUserInput
        ? REASON_CODES.SCIENTIFIC_DESIGN_MISSING
        : REASON_CODES.TRANSIENT_RUNTIME_RETRY;
      publicConclusion = requiresUserInput
        ? '执行前置条件不完整，未创建非法 Job；需要补齐关键输入或科学确认。'
        : `本阶段有 ${failedCount} 个工具任务未成功，已保留 Job 证据并进入自动诊断。`;
    } else if (pendingCount > 0) {
      decision = 'wait';
      publicConclusion = `本阶段有 ${pendingCount} 个工具任务仍在执行或等待，继续监控。`;
    } else if (completedTools.length > 0) {
      publicConclusion = `${completedTools.join('、')} 已生成真实 Job/Artifact，继续验证下游目标。`;
    }

    loopSequence += 1;
    const parentHash = loopIterations.length > 0
      ? loopIterations[loopIterations.length - 1].hash
      : null;
    const iteration = buildIteration({
      loopRunId,
      sequence: loopSequence,
      observedStateDigest: deriveObservedStateDigest({
        toolJobs: runToolJobs,
        conversationSummary: publicConclusion,
        dagProgress: { providerIteration, persistedIterations: loopIterations.length },
      }),
      goalGapIds: [],
      proposedAction: null,
      decision,
      decisionReasonCode: reasonCode,
      publicConclusion,
      status: mapDecisionToIterationStatus(decision),
      parentIterationHash: parentHash,
      createdAt: new Date().toISOString(),
    }, {
      validatorResults: [],
      repairAttempt: null,
      costSnapshot: null,
    });
    persistLoopIteration(iteration);
    loopIterations.push(iteration);
    loopFirstIterationDone = true;
    _loopSaveCheckpoint(iteration, toolCtx.projectId, toolCtx.conversationId, {
      toolJobId: runToolJobs.slice(-1)[0]?.toolJobId || null,
    });
    _loopEmitIterationEvent(iteration, decision, null);
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

  const aborted = () => (typeof shouldAbort === 'function' ? shouldAbort() : false);
  const resultEditProgress = createResultEditProgressRecorder();
  const toolCtx = {
    userId,
    projectId: context && context.projectId,
    ...projectResultStudioToolContext(context),
    accessMode: context && context.accessMode === 'read' ? 'read' : 'full',
    allowExecution: executionPolicy.allowExecution,
    executionPolicyReason: executionPolicy.reason,
    docsIndex: {},
    dashscopeEmbed,
    cosineSim,
    conversationId: _activeConv && _activeConv.id, // PLAN_CONV_LINK_v1
    gatherAnalysisContextForMethods: _gatherAnalysisContextForMethods, // GENERATE_METHODS_v1
    renderMethodsParagraph: _renderMethodsParagraph,
    isCancelled: aborted,
    emitResultEditProgress: (progress) => _emit({
      event: 'result_edit_progress',
      ...resultEditProgress.record(progress),
    }),
  };
  // Refresh docs index in background if stale

  const fullMessages = [{ role: 'system', content: systemPrompt }, ...messages];
  const tools = getToolDefs();

  const traceId = createTraceId();
  const toolCallController = createAgentToolCallController({ maxToolCalls: MAX_AGENT_TOOL_CALLS });
  const latestUserMessage = [...messages].reverse().find((message) => message?.role === 'user');
  const resultEditCompletionGuard = createResultEditCompletionGuard({
    expectation: toolCtx.resultStudioCompletionExpectation,
    requestedOutcome: typeof latestUserMessage?.content === 'string' ? latestUserMessage.content : '',
  });
  const modelResultState = createModelResultState({
    projectId: toolCtx.projectId,
    traceId,
  });
  let assistantAcc = '';
  let assistantMessagePersisted = false;
  let providerFailureReason = null;
  const assistantProgress = createAgentProgressRecorder();
  let finalizationAttempts = 0;
  let finalizationFailureReason = null;
  let finalizationRouting = null;
  let pendingApprovalEmitted = false;
  let cancellationObserved = false;
  let modelFinalized = false;
  let fatalAgentError = null;
  const assistantResultCards = [];
  const assistantToolActivities = createToolActivityRecorder();
  // HLE-C1: map callId → envelope for Loop post-turn iteration reading
  const toolResultEventsByCallId = {};

  try {
    for (let iter = 0; iter < MAX_AGENT_ITERS && !aborted(); iter++) {
      _emit({ event: 'iter', n: iter + 1 });

      // HLE-C1: Pre-turn Loop Controller decision.
      // Block/abort before calling the model if the loop is already resolved.
      if (loopRunId && loopState && loopState !== 'running') {
        _emit({
          event: 'loop_phase',
          phase: loopState,
          loopRunId,
          publicConclusion: loopPublicConclusion,
          reason: 'controller_aborted',
        });
        loopAbortedByController = true;
        cancellationObserved = true;
        assistantAcc = loopPublicConclusion || '任务已被 Loop Controller 终止。已完成工作已保留。';
        break;
      }

      // Normal scientific work has no iteration boundary. Only an anomaly (or
      // an explicitly injected finite test cap) forces a tool-free explanation.
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
        max_tokens: 1500,
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
      for (let attempt = 1; attempt <= attemptLimit && !aborted(); attempt++) {
        streamedText = '';
        const protocolRecoveryAttempt = finalizing && attempt > 1;
        upJson = await callChatProvider(
          providerName,
          apiKey,
          attemptBody,
          {
            userId,
            conversationId: _activeConv && _activeConv.id,
            kind: attempt > 1 ? 'agent_finalization_retry' : 'agent_iter',
          },
          protocolRecoveryAttempt ? undefined : (event) => {
            if (event.type === 'content_delta' && event.content && !aborted()) {
              streamedText += event.content;
              if (!resultEditCompletionGuard.required) {
                _emit({ choices: [{ delta: { content: event.content } }] });
              }
            }
          },
          {
            baseUrl,
            profileId,
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
          _emit({ choices: [{ delta: { content: assessment.content } }] });
        }
        if (assessment.usable || !assessment.retryable || attempt >= attemptLimit) break;
        _emit({
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
        const maxProviderAttempts = 3;
        for (let attempt = 2; attempt <= maxProviderAttempts
          && assessment.retryable && !aborted(); attempt += 1) {
          _emit({
            event: 'agent_status',
            phase: 'provider_retry',
            attempt,
            maxAttempts: maxProviderAttempts,
            reason: assessment.reason,
            message: '上游响应暂时异常，正在自动重试当前阶段…',
          });
          streamedText = '';
          upJson = await callChatProvider(
            providerName,
            apiKey,
            reqBody,
            {
              userId,
              conversationId: _activeConv && _activeConv.id,
              kind: 'agent_iter_retry',
            },
            (event) => {
              if (event.type === 'content_delta' && event.content && !aborted()) {
                streamedText += event.content;
                if (!resultEditCompletionGuard.required) {
                  _emit({ choices: [{ delta: { content: event.content } }] });
                }
              }
            },
            { baseUrl, profileId, modelOverride: modelName }
          );
          if (upJson && !upJson.error && upJson.choices) break;
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
        modelFinalized = assessment.usable;
        break;
      }

      if (toolCalls.length === 0) {
        let assessment = assessFinalizationResult(upJson, streamedText);
        const editCompletion = resultEditCompletionGuard.assessTerminal();
        if (editCompletion.action === 'retry') {
          fullMessages.push({ role: 'assistant', content: assessment.content || msg.content || '' });
          fullMessages.push({ role: 'system', content: editCompletion.prompt });
          _emit({
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
          _emit({ choices: [{ delta: { content: assistantAcc } }] });
          _emit({ event: 'done' });
          modelFinalized = true;
          break;
        }
        finalizationAttempts = 1;
        finalizationFailureReason = assessment.usable ? null : assessment.reason;
        if (!assessment.usable && assessment.retryable && !aborted()) {
          _emit({
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
              userId,
              conversationId: _activeConv && _activeConv.id,
              kind: 'agent_finalization_retry',
            },
            undefined,
            {
              baseUrl,
              profileId,
              modelOverride: modelName,
              fallbackWhen: finalizationFallbackReason,
            }
          );
          finalizationAttempts = 2;
          if (retryJson && retryJson.modelRouting) finalizationRouting = retryJson.modelRouting;
          assessment = assessFinalizationResult(retryJson, streamedText);
          finalizationFailureReason = assessment.usable ? null : assessment.reason;
          if (assessment.usable && assessment.content) {
            _emit({ choices: [{ delta: { content: assessment.content } }] });
          }
        }
        assistantAcc = assessment.content;
        if (assessment.usable && resultEditCompletionGuard.required && assessment.content) {
          _emit({ choices: [{ delta: { content: assessment.content } }] });
        }
        modelFinalized = assessment.usable;
        break;
      }
      const progress = assistantProgress.record(streamedText || msg.content, iter + 1);
      if (progress) _emit({ event: 'agent_progress', ...progress });
      await runAgentToolCallBatch({
        controller: toolCallController,
        toolCalls,
        createCallId,
        shouldAbort: aborted,
        onReserved: (accepted) => {
          // Keep Provider history protocol-valid: only reserved calls enter the
          // assistant message, and every reserved call receives one tool result.
          fullMessages.push({
            role: 'assistant',
            content: msg.content || '',
            tool_calls: accepted,
          });
        },
        execute: async ({ name, args, callId }) => {
          if (name === 'run_tool' && executionPolicy.allowExecution) {
            _loopInit(toolCtx.projectId, toolCtx.conversationId);
          }
          assistantToolActivities.recordCall({ name, args, traceId, callId, iteration: iter + 1 });
          _emit(buildToolCallEvent({ name, args, traceId, callId, iteration: iter + 1 }));
          let envelope = await executeToolCall(name, args, toolCtx, { traceId, callId });
          let result = localizeToolResult(envelope.data);
          resultEditCompletionGuard.recordToolResult(name, result);
          envelope = replaceToolResultData(envelope, result);

          // ACT_ACK_v1_SERVER: send the event first, then wait for the frontend ack.
          let ackInfo = null;
          if (result && result.ackToken && result._ackPromise) {
            ackInfo = result._ackPromise;
            delete result._ackPromise;
          }
          if (name === 'run_tool' && result && typeof result === 'object') {
            if (result.needApproval) pendingApprovalEmitted = true;
            if (result.toolJobId && !result.needApproval) {
              _pushUniqueResultCard(assistantResultCards, _buildResultCardFromRunTool(result, context));
            }
          }
          const toolResultEvent = buildToolResultEvent(envelope, args, { iteration: iter + 1 });
          assistantToolActivities.recordResult(toolResultEvent);
          _emit(toolResultEvent);
          // HLE-C1: track by callId for Loop post-turn state reading
          if (callId) toolResultEventsByCallId[callId] = toolResultEvent;

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
              _emit(ackEvent);
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
          if (name === 'run_tool' && executionPolicy.allowExecution) {
            _loopInit(toolCtx.projectId, toolCtx.conversationId);
          }
          assistantToolActivities.recordCall({ name, args, traceId, callId, iteration: iter + 1 });
          _emit(buildToolCallEvent({ name, args, traceId, callId, iteration: iter + 1 }));
          let envelope = createRejectedToolResult(name, error, message, toolCtx, { traceId, callId });
          const result = localizeToolResult(envelope.data);
          envelope = replaceToolResultData(envelope, result);
          const toolResultEvent = buildToolResultEvent(envelope, args, { iteration: iter + 1 });
          assistantToolActivities.recordResult(toolResultEvent);
          _emit(toolResultEvent);
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
      _loopPersistProgressIteration(iter + 1);
    }

    cancellationObserved = aborted();

    // HLE-C1: Persist Loop iteration after each agent turn.
    // HLE-C2: Augments with real job truth, Validator, Diagnoser, Repair.
    if (loopRunId) {
      // Gather observed state from this turn's tool results
      const activities = assistantToolActivities.snapshot();
      const toolJobs = activities
        .filter((a) => a.name === 'run_tool' && a.callId)
        .map((a) => {
          // HLE-C2: Read real job truth from DB (authoritative source)
          const evt = toolResultEventsByCallId && toolResultEventsByCallId[a.callId];
          const resultData = evt && evt.toolResult && evt.toolResult.data
            ? evt.toolResult.data
            : {};
          const toolJobId = evt?.toolJobId || resultData.toolJobId || null;
          let jobTruth = null;
          if (toolJobId) {
            try {
              jobTruth = getToolJob(toolJobId) || null;
              if (jobTruth) {
                // Cache artifact data from result_json for validator use
                const parsed = jobTruth.result_json ? JSON.parse(jobTruth.result_json) : null;
                loopArtifactCache[toolJobId] = {
                  toolJobId,
                  job: jobTruth,
                  result_json: parsed,
                  files: _extractArtifactFiles(parsed),
                };
              }
            } catch {}
          }
          const resultFailed = resultData.ok === false || Boolean(resultData.error);
          const status = jobTruth
            ? jobTruth.status
            : resultFailed
              ? 'failed'
              : (evt && evt.toolResult && evt.toolResult.status)
                ? evt.toolResult.status
                : (a.status === 'error' ? 'failed' : a.status === 'success' ? 'completed' : 'unknown');
          return {
            toolJobId: toolJobId || null,
            toolId: jobTruth?.tool_id || resultData.toolId || evt?.toolId || null,
            callId: a.callId,
            name: a.name,
            status,
            iteration: a.iteration,
            jobTruth,
            error: jobTruth?.error || resultData.error || resultData.message || null,
            reasonCode: resultData.reasonCode || resultData.reason_code || null,
            requiresUserInput: [
              'missing_required_file_inputs',
              'scientific_task_not_confirmed',
              'scientific_task_params_changed',
              'scientific_task_tool_changed',
            ].includes(resultData.error),
          };
        });

      // HLE-C2: Run Validator Registry on completed job artifacts
      const validatorResults = [];
      for (const job of toolJobs) {
        if (!job.toolJobId || !loopArtifactCache[job.toolJobId]) continue;
        const cache = loopArtifactCache[job.toolJobId];
        if (!cache.result_json) continue;
        const sources = [
          ...(cache.result_json.artifacts || []),
          ...(cache.result_json.outputs || []),
          ...(cache.result_json.files || []),
        ];
        for (const item of sources) {
          if (!item || typeof item !== 'object') continue;
          const artifact = {
            kind: item.type || item.kind || cache.result_json.toolId || 'unknown',
            type: item.type || item.kind || 'unknown',
            name: item.name || item.filename || 'unknown',
            url: item.url || null,
            metadata: item,
          };
          try {
            const vr = validateArtifact(artifact, {
              toolJobId: job.toolJobId,
              projectId: toolCtx.projectId,
              userId,
            });
            if (vr.overallStatus !== 'unavailable' || (vr.findings && vr.findings.length > 0)) {
              validatorResults.push({ ...vr, toolJobId: job.toolJobId, artifactName: artifact.name });
            }
          } catch {}
        }
        if (validatorResults.length > 0) {
          const lastVr = validatorResults[validatorResults.length - 1];
          try {
            const evidence = buildLoopObservationEvidence({
              loopRunId,
              iterationId: null,
              ref: `tool_job:${job.toolJobId}/${lastVr.overallStatus}`,
              summaryDigest: stableHash(lastVr),
              parentEvidenceHash: null,
            });
            evidence.toolJobId = job.toolJobId;
            evidence.validatorResults = lastVr;
            try { persistLoopEvidence(evidence); } catch {}
          } catch {}
        }
      }

      // HLE-C2: Diagnose failed jobs and propose repair
      let repairAttempt = null;
      let diagnosis = null;
      const {
        failedJobs,
        unresolvedFailedJobs,
        primaryFailed,
        replacementByFailureKey,
        repairedFailedJobIds,
      } = resolveFailedJobReplacements(toolJobs);
      if (failedJobs.length > 0) {
        try {
          diagnosis = diagnoseFailure(
            {
              ...(primaryFailed.jobTruth || {}),
              tool_id: primaryFailed.jobTruth ? primaryFailed.jobTruth.tool_id : null,
              error: primaryFailed.jobTruth ? primaryFailed.jobTruth.error : primaryFailed.error,
              reason_code: primaryFailed.reasonCode,
              status: primaryFailed.jobTruth ? primaryFailed.jobTruth.status : primaryFailed.status,
            },
            {
              toolId: primaryFailed.jobTruth ? primaryFailed.jobTruth.tool_id : null,
              artifactValidationResults: validatorResults.filter((vr) => vr.toolJobId === primaryFailed.toolJobId),
            }
          );
        } catch (e) {
          diagnosis = {
            faultType: 'unknown_failure',
            defaultBehavior: 'require_user',
            strategies: ['ask_user_design'],
            message: `诊断失败: ${e.message}`,
            confidence: 0.1,
          };
        }
        if (diagnosis) {
          try {
            const repairCtx = {
              parentJobId: primaryFailed.toolJobId,
              originalToolId: primaryFailed.jobTruth ? primaryFailed.jobTruth.tool_id : null,
              originalParams: primaryFailed.jobTruth && primaryFailed.jobTruth.params_json
                ? JSON.parse(primaryFailed.jobTruth.params_json)
                : null,
              originalInputs: null,
              parentArtifactIds: [],
              dag: null,
              fallbackProvider: null,
            };
            repairAttempt = selectRepairStrategy(diagnosis, repairCtx);
            const replacement = replacementByFailureKey.get(
              primaryFailed.toolJobId || primaryFailed.callId
            );
            if (!repairAttempt && replacement) {
              repairAttempt = buildObservedReplacementAttempt(
                diagnosis,
                primaryFailed,
                replacement,
              );
            }
            if (repairAttempt && replacement) {
              repairAttempt = {
                ...repairAttempt,
                replacementJobId: replacement.toolJobId,
                repaired: true,
              };
            }
            if (repairAttempt && (repairAttempt.isActionable || repairAttempt.repaired)) {
              try {
                const repairEvidence = buildLoopObservationEvidence({
                  loopRunId,
                  iterationId: null,
                  ref: `repair:${primaryFailed.toolJobId}/${repairAttempt.strategyId}`,
                  summaryDigest: stableHash({ strategyId: repairAttempt.strategyId, faultType: diagnosis.faultType }),
                  parentEvidenceHash: null,
                });
                repairEvidence.repairStrategy = repairAttempt;
                repairEvidence.diagnosis = diagnosis;
                repairEvidence.toolJobId = primaryFailed.toolJobId;
                persistLoopEvidence(repairEvidence);
              } catch {}
            }
          } catch {}
        }
      }

      // Derive state digest
      const stateDigest = deriveObservedStateDigest({
        toolJobs: toolJobs.map((job) => ({
          id: job.toolJobId || job.callId,
          status: job.status,
          error: job.jobTruth && job.jobTruth.error,
          finished_at: job.jobTruth && job.jobTruth.completed_at,
        })),
        conversationSummary: assistantProgress.snapshot().slice(-1)[0]?.content || '',
        dagProgress: {
          persistedIterations: loopIterations.length,
          toolActivities: activities.length,
        },
      });

      const activeJobs = toolJobs.filter((j) => j.status === 'running' || j.status === 'pending');
      const effectiveValidatorResults = validatorResults.filter((result) =>
        !result.toolJobId || !repairedFailedJobIds.has(result.toolJobId)
      );
      const hasBlocked = effectiveValidatorResults.some((vr) => vr.overallStatus === 'blocked');
      const hasFailedValidation = effectiveValidatorResults.some((vr) => vr.overallStatus === 'failed');

      // HLE-C2: Check for false-success — failed job with files BUT artifact truth is NOT valid.
      // A failed job may produce partial files; those files cannot be used as valid upstream artifacts.
      // HLE-C5R: Check artifactTruth.status explicitly, not just file existence.
      const falseSuccessJobs = [];
      for (const failed of unresolvedFailedJobs) {
        if (!failed.toolJobId || !loopArtifactCache[failed.toolJobId]) continue;
        const cache = loopArtifactCache[failed.toolJobId];
        if (!cache.files || cache.files.length === 0) continue;
        // artifactTruth must be checked — partial/degraded/blocked files do NOT make a failed job valid
        const truth = cache.result_json?.artifactTruth;
        if (!truth || truth.status !== 'valid') {
          falseSuccessJobs.push(failed.toolJobId);
        }
      }

      if (cancellationObserved || loopAbortedByController) {
        loopSequence += 1;
        const parentHash = loopIterations.length > 0
          ? loopIterations[loopIterations.length - 1].hash
          : null;
        const iteration = buildIteration({
          loopRunId,
          sequence: loopSequence,
          observedStateDigest: stateDigest,
          goalGapIds: [],
          proposedAction: null,
          decision: 'cancel',
          decisionReasonCode: REASON_CODES.TRANSIENT_RUNTIME_RETRY,
          publicConclusion: cancellationObserved
            ? '用户取消。已完成的阶段已保留。'
            : 'Loop Controller 已终止任务。',
          status: 'skipped',
          parentIterationHash: parentHash,
          createdAt: new Date().toISOString(),
        }, {
          validatorResults: validatorResults.slice(),
          repairAttempt: null,
          costSnapshot: null,
        });
        try { persistLoopIteration(iteration); loopIterations.push(iteration); } catch {}
        _loopSaveCheckpoint(iteration, toolCtx.projectId, toolCtx.conversationId, {
          validatorResults: validatorResults.slice(),
        });
        loopState = 'cancelled';
        loopPublicConclusion = iteration.publicConclusion;
        _loopEmitIterationEvent(iteration, 'cancel', null);
        _loopPersistPhase('cancelled', iteration.publicConclusion);
      } else {
        let decision = 'continue';
        let decisionReasonCode = REASON_CODES.TOOL_SUCCEEDED;
        let publicConclusion = null;
        const requiresUserDecision = unresolvedFailedJobs.some((job) => job.requiresUserInput) ||
          (
            unresolvedFailedJobs.length > 0 &&
            (
              diagnosis?.defaultBehavior === 'require_user' ||
              repairAttempt?.requiresUserAuth === true
            )
          );

        if (falseSuccessJobs.length > 0) {
          decision = 'block';
          decisionReasonCode = REASON_CODES.ARTIFACT_VALIDATION_FAILED;
          publicConclusion = `检测到假成功：任务失败但产生了文件（${falseSuccessJobs.length} 个）。已验证结果不完整，禁止宣称完成。`;
        } else if (hasBlocked) {
          decision = 'block';
          decisionReasonCode = REASON_CODES.ARTIFACT_VALIDATION_FAILED;
          publicConclusion = `验证失败（blocked）：${validatorResults.filter((vr) => vr.overallStatus === 'blocked').length} 个产物未通过验证，任务无法继续。`;
        } else if (hasFailedValidation) {
          decision = 'block';
          decisionReasonCode = REASON_CODES.ARTIFACT_VALIDATION_FAILED;
          publicConclusion = `验证失败（failed）：${validatorResults.filter((vr) => vr.overallStatus === 'failed').length} 个产物验证未通过。`;
        } else if (requiresUserDecision) {
          decision = 'wait';
          decisionReasonCode = REASON_CODES.SCIENTIFIC_DESIGN_MISSING;
          publicConclusion = '关键输入或科学设计尚未确认；系统未创建非法 Job，等待补齐必要信息。';
          loopActiveJobs = [];
        } else if (unresolvedFailedJobs.length > 0) {
          decision = 'retry';
          decisionReasonCode = REASON_CODES.TRANSIENT_RUNTIME_RETRY;
          publicConclusion = diagnosis && diagnosis.message
            ? `故障分类：${diagnosis.faultType}。${diagnosis.message}`
            : `工具执行失败（${unresolvedFailedJobs.length} 个）。Loop Controller 将在下一轮决策中处理。`;
          loopActiveJobs = toolJobs;
        } else if (activeJobs.length > 0) {
          decision = 'continue';
          decisionReasonCode = REASON_CODES.TOOL_SUCCEEDED;
          publicConclusion = `工具执行中（${activeJobs.length} 个运行中）。继续监控。`;
          loopActiveJobs = activeJobs;
        } else if (modelFinalized || activities.length === 0) {
          decision = 'complete';
          decisionReasonCode = REASON_CODES.GOAL_ACHIEVED;
          publicConclusion = modelFinalized
            ? '已根据真实工具与产物状态完成本轮交付。'
            : '本轮无工具调用，已整理最终答复。';
          loopActiveJobs = [];
        } else {
          loopActiveJobs = toolJobs;
        }

        loopValidatorResults = loopValidatorResults.concat(validatorResults);

        loopSequence += 1;
        const parentHash = loopIterations.length > 0
          ? loopIterations[loopIterations.length - 1].hash
          : null;

        const iteration = buildIteration({
          loopRunId,
          sequence: loopSequence,
          observedStateDigest: stateDigest,
          goalGapIds: [],
          proposedAction: null,
          decision,
          decisionReasonCode,
          publicConclusion,
          status: mapDecisionToIterationStatus(decision),
          parentIterationHash: parentHash,
          createdAt: new Date().toISOString(),
        }, {
          validatorResults: validatorResults.slice(),
          repairAttempt,
          costSnapshot: null,
        });

        try { persistLoopIteration(iteration); loopIterations.push(iteration); } catch {}
        _loopSaveCheckpoint(iteration, toolCtx.projectId, toolCtx.conversationId, {
          validatorResults: validatorResults.slice(),
          repairAttempt,
        });
        _loopEmitIterationEvent(iteration, decision, null);
        if (decision === 'complete') {
          loopState = 'completed';
          loopPublicConclusion = iteration.publicConclusion;
          _loopPersistPhase('completed', iteration.publicConclusion);
        } else if (decision === 'block') {
          loopState = 'blocked';
          loopPublicConclusion = iteration.publicConclusion;
          _loopPersistPhase('blocked', iteration.publicConclusion);
        } else if (decision === 'wait') {
          loopState = 'waiting_for_user';
          loopPublicConclusion = iteration.publicConclusion;
          _loopPersistPhase('waiting_for_user', iteration.publicConclusion);
        }
      }
    }

    if (!cancellationObserved && !loopAbortedByController && modelFinalized) {
      _emit({ event: 'done' });
    }

    if (providerFailureReason) {
      fatalAgentError = new Error(providerFailureReason);
      const final = finalizeResultEditProgress(resultEditProgress, {
        outcome: 'failed', reason: 'agent_run_failed',
      });
      if (final.terminal) _emit({ event: 'result_edit_progress', ...final.terminal });
      assistantAcc = final.assistantMessage;
      _emit({ choices: [{ delta: { content: assistantAcc } }] });
      _emit({ error: providerFailureReason });
    } else if (cancellationObserved || loopAbortedByController) {
      const final = finalizeResultEditProgress(resultEditProgress, {
        outcome: 'cancelled', reason: 'user_cancelled',
      });
      if (final.terminal) _emit({ event: 'result_edit_progress', ...final.terminal });
      assistantAcc = final.assistantMessage;
      _emit({ event: 'agent_cancelled', reason: 'user_cancelled' });
    } else if (assistantAcc.trim().length === 0) {
      const fallbackMsg = buildFinalizationFallbackMessage({
        attempts: finalizationAttempts,
        reason: finalizationFailureReason,
        anomaly: toolCallController.anomaly,
        lastStageConclusion: assistantProgress.snapshot().slice(-1)[0]?.content,
      });
      _emit({ choices: [{ delta: { content: fallbackMsg } }] });
      assistantAcc = fallbackMsg;
    }

    // ---------- 持久化 assistant 消息 + 下游管线（搬迁自 ai-agent.js L592-703）----------
    if (assistantAcc.trim().length > 0) {
      try {
        if (userId) {
          try {
            if (_activeConv) {
              const assistantMeta = {
                page: context && context.page,
                projectId: context && context.projectId,
                processingDurationMs: Math.max(0, Date.now() - turnStartedAt),
                ...(cancellationObserved ? {
                  interruption: {
                    reason: 'user_cancelled',
                    preservedProgressCount: assistantProgress.snapshot().length,
                    preservedToolActivityCount: assistantToolActivities.snapshot().length,
                  },
                } : {}),
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
                ...(loopRunId ? {
                  loopRef: {
                    loopRunId,
                    phase: loopState || 'running',
                  },
                } : {}),
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
    fatalAgentError = e;
    cancellationObserved = cancellationObserved || aborted();
    if (!assistantMessagePersisted && _activeConv && resultEditProgress.snapshot().length > 0) {
      const final = finalizeResultEditProgress(resultEditProgress, {
        outcome: cancellationObserved ? 'cancelled' : 'failed',
        reason: cancellationObserved ? 'user_cancelled' : 'agent_run_failed',
      });
      if (final.terminal) _emit({ event: 'result_edit_progress', ...final.terminal });
      assistantAcc = final.assistantMessage;
      try {
        appendMessageToConversation(_activeConv.id, 'assistant', assistantAcc, {
          page: context && context.page,
          projectId: context && context.projectId,
          processingDurationMs: Math.max(0, Date.now() - turnStartedAt),
          resultEditProgress: resultEditProgress.snapshot(),
          incident: { code: cancellationObserved ? 'user_cancelled' : 'agent_run_failed', autoRecoveryAttempts: 0 },
        });
        assistantMessagePersisted = true;
      } catch {}
    }
    _emit({ error: e.message });
    if (loopRunId && !cancellationObserved) {
      _loopPersistPhase('failed', 'Harness Loop 收口失败，执行记录与已有产物已保留。');
    }
  } finally {
    // 释放 task 生命周期锁 + 标记 task 终态（无论成功/失败/异常）
    try {
      cancellationObserved = cancellationObserved || aborted();
      const terminal = resolveAgentTaskTerminal({
        cancelled: cancellationObserved,
        fatalError: fatalAgentError,
        assistantText: assistantAcc,
        pendingApproval: pendingApprovalEmitted,
      });
      if (terminal.status === 'cancelled') {
        agentTaskStore.markAgentTaskCancelled(taskId);
      } else if (terminal.status === 'completed') {
        agentTaskStore.markAgentTaskDone(taskId);
      } else {
        agentTaskStore.markAgentTaskFailed(taskId, terminal.error);
      }
    } catch {}
    try {
      aiTaskConcurrencyRelease(userId, taskId);
    } catch {}
  }

  return { assistantText: assistantAcc };
}

module.exports = {
  runAgentLoop,
  resolveAgentTaskTerminal,
  resolveFailedJobReplacements,
  buildObservedReplacementAttempt,
  buildLoopObservationEvidence,
};
