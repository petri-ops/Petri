'use strict';

/**
 * agent-runner.js — agent loop 执行器（PHASE 3.1 thin facade）
 *
 * This file is now a thin facade that:
 * 1. Builds system prompt from config
 * 2. Delegates loop body to loop-orchestrator.js
 * 3. Delegates conversation persistence to conversation-adapter.js
 *
 * All loop state machine logic moved to loop-orchestrator.js (~700 lines).
 * All conversation/message logic moved to conversation-adapter.js (~350 lines).
 *
 * runAgentLoop function signature: 100% unchanged from before refactor.
 */

const { estimateRequestTokens } = require('./helpers/token-estimator');
const { getAiSettings } = require('./helpers/ai-settings');
const { buildSystemPrompt, localizeToolResult, loadWorkingTreeRejectEntries } = require('./helpers/system-prompt');
const { appendDesktopAgentInstructions } = require('./helpers/desktop-agent-prompt');
const { renderPluginDemoPathsForPrompt } = require('./helpers/plugin-demo-prompt');
const llmClient = require('./helpers/llm-client');
const agentResilience = require('./helpers/agent-resilience');
const baseCallChatProvider =
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
const { maybeEmitTaskTodo } = require('./agent-tools/todo-tools');
const { buildSiteSnapshotAsync, renderSiteSnapshotForPrompt } = require('./helpers/site-snapshot');
// BLOCK-69 — 知识空间（自动召回注入 + knowledge_search/status 工具数据面）
const knowledgeSpace = require('./helpers/knowledge-space');
const { buildFactsBlockAsync, backgroundExtractFacts } = require('./helpers/user-facts');
const {
  _getChatSummary,
  getChatSummaryAsync,
  summarizeMessages,
} = require('./helpers/chat-summary');
const { getActivePlanForUserAsync, renderActivePlanForPrompt, PLAN_MODE_PROMPT_SECTION } = require('./helpers/plans');
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

// Loop orchestrator (pure state machine)
const { runLoop } = require('./loop-orchestrator');

// A-003: inject projectHarnessWorkflowJob into shared-backend
// This breaks the shared-backend → biof3-server reverse require chain.
const harnessWorkflowState = require('./helpers/harness-workflow-state');
const sharedBackend = require('../shared-backend');
sharedBackend.configure({ projectHarnessWorkflowJob: harnessWorkflowState.projectHarnessWorkflowJob });

// Conversation adapter (message/conversation helpers)
const {
  appendAssistantMessage,
  saveChatTurnToMemory,
  triggerBackgroundFactExtraction,
  triggerChatSummary,
  logAudit,
  announceActiveConversation,
} = require('./conversation-adapter');

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

const { buildIterationCheckpoint } = require('../shared-backend/loop-checkpoint');

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

/**
 * Resolve terminal task status.
 * @param {object} opts
 * @returns {{status: string, error: string|null}}
 */
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
  // BLOCK-49 加映 —— 完成判定放宽为非空即完成：原 >20 字符启发式把短回答
  // 子任务（如纯算式「17 * 23 = 391」14 字符）误判为 failed（实机两轮触发，
  // 破坏 wait_agent/followup 对短任务可靠性）。空字符串仍判 failed（防御
  // 「模型全程无输出」的真失败）。
  if (String(assistantText || '').trim().length > 0 || pendingApproval) {
    return { status: 'completed', error: null };
  }
  return { status: 'failed', error: 'agent loop 未生成有效回复' };
}

/**
 * Resolve failed job replacements from tool jobs array.
 * @param {Array} toolJobs
 * @returns {object}
 */
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

/**
 * Build observed replacement attempt evidence.
 * @param {object} diagnosis
 * @param {object} failedJob
 * @param {object} replacementJob
 * @returns {object|null}
 */
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

/**
 * Build loop observation evidence.
 * @param {object} input
 * @returns {object}
 */
function buildLoopObservationEvidence(input) {
  return buildEvidence({
    ...input,
    kind: 'observation',
  });
}

/**
 * Run agent loop (from HTTP handler decoupled).
 *
 * @param {object} opts
 * @param {Array}  opts.messages        User messages (without system prompt)
 * @param {object} opts.context         Page context
 * @param {string} opts.userId
 * @param {string} opts.conversationId
 * @param {object} opts._activeConv     Conversation object ({id, title})
 * @param {string} opts.apiKey
 * @param {string} opts.providerName
 * @param {string} [opts.modelName]
 * @param {string} [opts.profileId]
 * @param {string} [opts.baseUrl]
 * @param {string} opts.taskId          For task_events persistence
 * @param {function} opts.onEvent       (eventObj) => void
 * @param {function} [opts.shouldAbort] () => boolean
 * @returns {Promise<{assistantText: string}>}
 *
 * PHASE 3.1: Function signature 100% unchanged.
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
  kind = 'primary',
  parentLoopRunId = null,
  // BLOCK-56 P1 — 降级续跑任务置 true：gateway 关闭请求级 fallback（单级不连环）
  disableProviderFallback = false,
  // BLOCK-81 P1 — 思考档位（off/standard/high；未传＝standard＝不发参）
  thinkingLevel = null,
  // BLOCK-93 P1 — 子智能体角色软约束指令片段（spawn 链自注册表渲染；未传＝零注入）
  roleDirective = null,
}) {
  const turnStartedAt = Date.now();
  const isGuest = !userId;
  const ctxForPrompt =
    context && typeof context === 'object'
      ? { ...context, audience: isGuest ? 'guest' : 'user' }
      : { audience: isGuest ? 'guest' : 'user' };

  // BLOCK-16 PHASE 3：把 working-tree-review 拒绝清单注入 ctxForPrompt。
  // system-prompt.js 检测到 workingTreeRejects（已构造好的 entries）就直接渲染；
  // 否则用 workingTreeRejectsUserDataDir 自动从磁盘读。两条入口互斥：
  // ctxForPrompt 优先，磁盘读是兜底。
  if (typeof process !== 'undefined' && process.env && process.env.BIOF3_USER_DATA_DIR) {
    const userDataDir = process.env.BIOF3_USER_DATA_DIR;
    try {
      const entries = loadWorkingTreeRejectEntries(userDataDir, { limit: 10 });
      if (entries.length > 0) {
        ctxForPrompt.workingTreeRejects = entries;
      }
    } catch {
      // 拒绝清单读取失败不阻塞 prompt 构建
    }
  }

  // ---------- Event emitter: onEvent + task_events persistence ----------
  let _seq = 0;
  const _emit = (obj) => {
    try { onEvent && onEvent(obj); } catch {}
    const eventType = (obj && obj.event) || 'delta';
    try {
      _seq += 1;
      agentTaskStore.appendAgentTaskEvent(taskId, _seq, eventType, obj);
    } catch (e) {
      /* task_events write failure does not block loop */
    }
  };

  // ---------- System prompt building (from ai-agent.js L142-319) ----------
  let systemPrompt = buildSystemPrompt(ctxForPrompt, {
    provider: providerName,
    providerLabel,
    model: modelName,
  });

  // BLOCK-93 P1 — 子智能体角色专职约束（注册表指令片段，prompt 级软约束；
  // 紧跟基础 system prompt 之后，后续增量块仍在其后追加）
  if (roleDirective) {
    systemPrompt += '\n\n=== 子智能体角色专职约束 ===\n' + roleDirective;
  }

  // BLOCK-97 P1 — 任务清单使用纪律（todo_write；additive 追加，BLOCK-93 同型。
  // 工具全集对所有 agent 会话常开，故无条件注入；简单问答靠纪律文本自身豁免）
  systemPrompt +=
    '\n\n=== 任务清单使用纪律（todo_write） ===' +
    '\n- 接到多步任务（约 ≥3 步）时，先把工作拆成编号清单并用 todo_write 整单写入，再开始执行；简单问答不要使用清单。' +
    '\n- 开工某条前将其置 in_progress；完成立即置 completed（做完一条勾一条）。' +
    '\n- 计划变化时整单重发（增删改条目），保持清单与实际进度一致。' +
    '\n- 条目用一句话可验证的动词短语，不塞实现细节；清单是给用户看的进度承诺。';

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

  // BLOCK-69 — 知识空间自动召回（D4 轻按需：启用才检索；过阈值才注入，≤3 块；无命中不注入）
  let knowledgeTokens = 0;
  try {
    const latestUserMsg = [...(Array.isArray(messages) ? messages : [])]
      .reverse()
      .find((m) => m && m.role === 'user' && typeof m.content === 'string');
    const cleanQuery = latestUserMsg
      ? latestUserMsg.content.replace(/^\[[^\]]+\]\s*\n?/, '').trim()
      : '';
    if (cleanQuery) {
      const knowledgeTurn = await knowledgeSpace.buildAgentTurnBlock(cleanQuery);
      if (knowledgeTurn.block) {
        systemPrompt += knowledgeTurn.block;
        knowledgeTokens = Math.ceil(knowledgeTurn.usedChars / 4);
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
  systemPrompt +=
    '\n- agent 看图（read_image）：当用户问图内容（如"图里上调基因集中在哪""这张图说明了什么"），调 read_image(toolJobId) 让 vision 角色模型解读图，返回的 description 可直接据此回答。token 较贵，仅用户明确问图内容时调，不要每次出图都读。';
  systemPrompt += '\n\n=== 学习路径推荐 ===';
  systemPrompt += '\n不要调用旧版学习路径推荐工具。';
  systemPrompt += '\n不要先解释一大段再调用，直接调用，把结果用人话讲给用户。';
  systemPrompt += '\n用户询问后续方向时，只能依据当前项目事实回答。';
  systemPrompt +=
    '\n收到 suggestions 列表后，给出每条的 title / 大致耗时 / 为什么推荐它（基于 reasons），并附上点击 url。';
  systemPrompt +=
    '\n如果 note 字段说没有 metadata，老实告诉用户"暂时没有推荐数据"，别硬编。';
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
  systemPrompt +=
    '\n- 提到工具产物（toolJobId / harness 摘要里的文件）或项目工作区文件时，渲染为 Markdown 链接：[产物.csv](biof3://artifact/<toolJobId>/<产物名>) 或 [data.csv](biof3://workspace/<projectId>/<relativePath>)。严禁出现 file:// 或 /Users/... 这类本地绝对路径。详见 system prompt 末尾【文件引用格式】。';
  systemPrompt += '\n- 科学源数据不可变：不得用 workspace_write/workspace_replace/workspace_exec 原地修改已有 CSV/TSV/H5AD/RDS/测序文件来迎合插件。格式或标签修复必须写入 derived/ 或由转换插件生成新 Artifact，保留原文件和输入 hash，再把派生 Artifact 绑定给下游 Job。';
  systemPrompt += '\n\n旧的【结果页】UI 控制：';
  systemPrompt +=
    '\n- act(type="switch_result_tab", tab="preview|plots|data|params") 切 tab；' +
    'act(type="focus_cluster", cluster="3") 高亮某 cluster；' +
    'act(type="highlight_gene", gene="CD3E") 按基因着色 UMAP。' +
    '不要再让用户自己点 tab。';

  // Announce active conversation
  announceActiveConversation(_emit, _activeConv);

  // Append desktop agent instructions
  systemPrompt = appendDesktopAgentInstructions(systemPrompt);

  // Infer execution policy
  // BLOCK-31 P4 fix: 必须传 context —— S-003 设计中 ctx.accessMode 是唯一判定源，
  // 旧调用点漏传导致「完全访问」恒被降级 read、workspace_write 全部被拒。
  const executionPolicy = inferExecutionPolicy(messages, context);
  if (!executionPolicy.allowExecution) {
    systemPrompt +=
      '\n\n=== 本轮只读约束 ===' +
      '\n用户明确要求只检查、识别、评估或规划。本轮禁止调用 run_tool(op="run")，禁止创建任务或请求执行确认。' +
      '\n优先直接依据上方 Harness 项目文件摘要回答候选文件、关键列、数据质量和后续分析；允许使用 run_tool 的 list/plan/status/next 等只读操作。' +
      '\n只陈述建议，不要用"要开干吗""是否立即开始"等措辞主动邀请执行。';
  }

  // UI-303 — Spec 门计划模式注入（与 chat.js 同一共享常量）：accessMode='plan'
  // 档位与显式 planMode 标志等效；agent 循环路径此前不透传 planMode，durable
  // task / 子 agent 在计划档位下缺纪律约束与 policy 拦截，此处补齐对齐。
  const planModeActive = (context && context.planMode === true) || (context && context.accessMode === 'plan');
  if (planModeActive) {
    systemPrompt += PLAN_MODE_PROMPT_SECTION;
  }

  // BLOCK-20: emit token_budget event for ContextBudgetBar (UI-190)
  // 必须在 _emit 已定义后、首次 iteration 前；systemPrompt 已拼完才能算真实 token。
  // BLOCK-51 回归修复：safeCtx 此前声明在 try 块内（const 块级作用域），
  // 而 loopConfig.contextWindow 在块外引用 → "safeCtx is not defined"，
  // 重启后所有 agent_loop 任务启动即崩（fail-closed）。这里在块外先声明。
  let safeCtx = 64000;
  try {
    const { systemPromptTokens, messagesTokens, total } = estimateRequestTokens({
      systemPrompt: systemPrompt || '',
      messages: Array.isArray(messages) ? messages : [],
      maxTokens: 8192,
    });
    const presetCtx = (() => {
      try {
        const settings = getAiSettings();
        const profile = (settings.model_profiles || []).find((p) => p.id === profileId);
        return profile && profile.contextWindow;
      } catch { return undefined; }
    })();
    const { getContextWindow } = require('./helpers/token-estimator');
    const ctxWindow = (await Promise.resolve(getContextWindow(modelName, providerName, baseUrl, null, presetCtx).catch(() => 0))) || 0;
    safeCtx = ctxWindow > 0 ? ctxWindow : 64000;
    const pct = Math.min(100, Math.round((total / safeCtx) * 100));
    _emit({
      event: 'token_budget',
      contextWindow: safeCtx,
      messagesTokensUsed: total,
      systemPromptTokens,
      messagesTokens,
      knowledgeTokens,
      pct,
      trimmed: total > safeCtx,
    });
  } catch (e) {
    console.log('[token-budget-estimation-error]', e && e.message);
  }

  // BLOCK-77 P2 — 驻留任务交接班（双通道 B：agent 会话注入）。
  // 项目存在 running 驻留任务时，把意图卡摘要追加进 system prompt（零轮询依赖——
  // 读取走回访循环同款 Gateway 通道；无卡/读失败 = 零注入，不污染 prompt）。
  try {
    const b77ProjectId = context && context.projectId ? String(context.projectId) : '';
    if (b77ProjectId) {
      const { residentHandoverDigestByProjectId } = require('./helpers/remote-execution/resident-revisit');
      const digest = await residentHandoverDigestByProjectId({ getAsyncDatabase: () => require('./db').getAsyncDatabase() }, b77ProjectId);
      if (digest) {
        systemPrompt += '\n\n=== 驻留任务交接班 ===\n' + digest;
        systemPrompt += '\n请主动向用户简报以上驻留任务的进度与下一步建议（完成/失败已在通知面提示过的不必重复）。';
      }
    }
  } catch (e) {
    console.warn('[agent-runner] resident handover inject failed:', e && e.message);
  }
  const fullMessages = [{ role: 'system', content: systemPrompt }, ...messages];
  const tools = getToolDefs();

  // Build tool context
  const toolCtx = {
    userId,
    // BLOCK-49 — 子 agent 派生工具（spawn/list/wait_agent）的父子关系锚点
    taskId,
    projectId: context && context.projectId,
    ...projectResultStudioToolContext(context),
    // BLOCK-56 P2 + UI-303 — 'workspace-write' 中间档与 'plan' 第四档透传
    // （additive：未知值维持塌缩 full；'plan' 绝不可塌缩 full）
    accessMode: context && (context.accessMode === 'read' || context.accessMode === 'workspace-write' || context.accessMode === 'plan')
      ? context.accessMode
      : 'full',
    // UI-303 — Spec 门计划模式透传（此前 agent 循环路径缺失，见上方 planModeActive 注入）
    planMode: (context && context.planMode === true) || (context && context.accessMode === 'plan'),
    allowExecution: executionPolicy.allowExecution,
    executionPolicyReason: executionPolicy.reason,
    // BLOCK-57 UI-290 — 会话级执行目标（composer 选择器；learning 层校验注册表
    // 后在执行时注入 params，未知目标 fail-closed 回退本机）。agent 循环与
    // chat 内联两条路径都必须透传。
    executionTargetId: context && typeof context.executionTargetId === 'string' && context.executionTargetId.trim()
      ? context.executionTargetId.trim()
      : null,
    docsIndex: {},
    dashscopeEmbed,
    cosineSim,
    conversationId: _activeConv && _activeConv.id,
    gatherAnalysisContextForMethods: _gatherAnalysisContextForMethods,
    renderMethodsParagraph: _renderMethodsParagraph,
    isCancelled: () => (typeof shouldAbort === 'function' ? shouldAbort() : false),
    emitResultEditProgress: (progress) => _emit({
      event: 'result_edit_progress',
      ...progress,
    }),
  };

  // Config for loop orchestrator
  const loopConfig = {
    userId,
    conversationId,
    _activeConv,
    apiKey,
    providerName,
    modelName,
    profileId,
    baseUrl,
    kind,
    parentLoopRunId,
    context,
    executionPolicy,
    tools,
    MAX_AGENT_TOOL_CALLS,
    // BLOCK-51 P2 — 上下文熔断：loop 内每轮请求前的预算检查复用同一 ctxWindow
    contextWindow: safeCtx,
    // BLOCK-56 P1 — 降级续跑任务在 loop 内禁用请求级 fallback
    disableProviderFallback,
    // BLOCK-81 P1 — 思考档位进 loop（网关侧按 profile 能力位门控后映射上游参数）
    thinkingLevel,
  };

  // ---------- Run loop via orchestrator ----------
  // BLOCK-98 M1+M3+M5 — 韧性接线（helpers/agent-resilience.js；开关
  // BIOF3_AGENT_RESILIENCE 默认关）。包裹点在此而非 loop-orchestrator：
  // ①M1 microcompact 请求体投影（副本替换）；②M3 context-exceeded 分类→
  // reactive 原地裁剪重试一次（run 内防呆上限 3 次）；③M5 重试遥测落 ai_usage。
  const resilienceState = agentResilience.createResilienceState();
  const resilientCallChatProvider = async (providerName, apiKey, body, telemetry, onEvent, options) => {
    const callOnce = (reqBody) => baseCallChatProvider(providerName, apiKey, reqBody, telemetry, onEvent, options);
    const projected = agentResilience.maybeMicrocompactBody(body, { contextWindow: safeCtx });
    try {
      return await callOnce(projected);
    } catch (err) {
      const convId = _activeConv && _activeConv.id;
      if (
        agentResilience.isResilienceEnabled(process.env) &&
        agentResilience.reactiveAllowed(resilienceState) &&
        agentResilience.classifyContextExceeded(err)
      ) {
        resilienceState.contextExceededCount += 1;
        agentResilience.recordReactiveUse(resilienceState);
        agentResilience.recordRetryUsage({
          userId, conversationId: convId, modelName, attempt: 1, contextExceeded: true, error: err,
        });
        try { console.log('[block98-reactive] context-exceeded → 原地裁剪重试, run 使用次数=', resilienceState.reactiveUses); } catch {}
        const trimmed = agentResilience.reactiveTrim(Array.isArray(projected.messages) ? projected.messages : [], { contextWindow: safeCtx });
        if (trimmed) {
          return callOnce({ ...projected, messages: trimmed.messages });
        }
      }
      throw err;
    }
  };

  const {
    assistantText,
    // BLOCK-34 P1 — 工具活动快照随消息落库（此前传 null 导致任务完成后
    // 前端 re-conciliation 覆盖内存快照时工具记录消失）。
    assistantToolActivities,
    reasoningByIteration,
    loopRunId,
    loopState,
    cancellationObserved,
    loopAbortedByController,
    providerFailureReason,
    finalizationAttempts,
    fatalAgentError,
    pendingApprovalEmitted,
    modelFallbackOccurred,
  } = await runLoop({
    messages: fullMessages,
    toolCtx,
    shouldAbort,
    emitToolResult: (evt) => {
      _emit(evt);
      // BLOCK-97 P1 — todo_write 成功回执后广播整单快照（task_todo 专用事件，
      // 与 tool_result 同链经 _emit 持久化 task_events；前端摘要卡按此投影）
      maybeEmitTaskTodo(evt, _emit);
    },
    // P3 实机抓真（block97-todo-live 4/9）：loop-orchestrator 的 emitToolResult
    // 参数实为死参——tool_result 等全部事件走 _emit→emitAssistant 通道，
    // 发射判定必须同时挂在本通道才能真正到达事件流。
    emitAssistant: (evt) => {
      _emit(evt);
      maybeEmitTaskTodo(evt, _emit);
    },
    emitDone: () => _emit({ event: 'done' }),
    callChatProvider: resilientCallChatProvider,
    config: loopConfig,
    conversationState: {
      conversationId,
      _activeConv,
    },
  });

  // ---------- Conversation persistence (via conversation-adapter) ----------
  if (assistantText && assistantText.trim().length > 0 && userId && _activeConv) {
    try {
      // Import fresh to get latest reference
      const conversationAdapter = require('./conversation-adapter');

      // Append assistant message to conversation
      conversationAdapter.appendAssistantMessage({
        conversationId: _activeConv.id,
        assistantAcc: assistantText,
        context,
        userId,
        turnStartedAt,
        assistantProgress: null,
        resultEditProgress: null,
        assistantToolActivities: assistantToolActivities || null,
        // UI-272 — 思考段随消息落库（历史会话可回看每轮工具调用前的思考）
        reasoningByIteration: reasoningByIteration && Object.keys(reasoningByIteration).length
          ? reasoningByIteration
          : null,
        assistantResultCards: [],
        loopRunId,
        loopState,
        cancellationObserved,
        finalizationAttempts,
        finalizationFailureReason: null,
        finalizationRouting: null,
        toolCallController: null,
        taskId,
        emitFn: _emit,
      });

      // Log audit
      conversationAdapter.logAudit({ userId, context, messages });

      // Save to memory vector
      if (!cancellationObserved) {
        saveChatTurnToMemory({
          userId,
          conversationId: _activeConv && _activeConv.id,
          assistantAcc: assistantText,
          messages,
          context,
        });
      }

      // Background fact extraction
      triggerBackgroundFactExtraction({
        userId,
        messages,
        assistantAcc: assistantText,
        projectId: context && context.projectId,
      });

      // Chat summary
      triggerChatSummary({
        userId,
        messages,
        assistantAcc: assistantText,
        projectId: context && context.projectId,
      });
    } catch {}
  }

  // ---------- Terminal task resolution ----------
  // BLOCK-31 P1: 终态前回放本 task 的 task_events，聚合权威 filesChanged
  // 清单（workspace_write/replace 成功写入的文件），随终态持久化；
  // 聚合失败不阻塞终态标记（清单缺省为空，前端有兜底）。
  let taskFilesChanged = [];
  try {
    const { collectFilesChangedForTask } = require('./agent-files-changed');
    taskFilesChanged = collectFilesChangedForTask(agentTaskStore, taskId).files;
  } catch {}
  try {
    const terminal = resolveAgentTaskTerminal({
      cancelled: cancellationObserved || (typeof shouldAbort === 'function' ? shouldAbort() : false),
      fatalError: fatalAgentError,
      assistantText,
      pendingApproval: pendingApprovalEmitted,
    });
    if (terminal.status === 'cancelled') {
      agentTaskStore.markAgentTaskCancelled(taskId, taskFilesChanged);
    } else if (terminal.status === 'completed') {
      agentTaskStore.markAgentTaskDone(taskId, taskFilesChanged);
    } else {
      agentTaskStore.markAgentTaskFailed(taskId, terminal.error, taskFilesChanged);
      // BLOCK-56 P1 — 任务级模型降级：可降级错误 + 配置了备用 + 未发生过降级
      // → 切备用 profile 自动续跑一次（单级不连环）。判定不通过时静默返回
      // 现行为（诚实失败），零回归。
      try {
        const { maybeLaunchTaskLevelFallback } = require('./helpers/agent-fallback');
        maybeLaunchTaskLevelFallback({
          taskId,
          error: terminal.error,
          modelFallbackOccurred: modelFallbackOccurred === true,
          previousProfileId: profileId || null,
          kind,
          _activeConv,
          emit: (evt) => _emit(evt),
        });
      } catch {}
    }
    // BLOCK-49 二期 proactive —— 子 agent 终态主动投递到父任务事件流：
    // 用户在父任务 SSE 上无需 wait_agent 即可见（协议面 additive，前端
    // 消费为候选）；父模型上下文不注入（诚实边界）。
    if (kind === 'subagent') {
      try {
        const selfTask = agentTaskStore.getAgentTask(taskId);
        const parentTaskId = selfTask && selfTask.params && selfTask.params.parentTaskId;
        if (parentTaskId) {
          const ownEvents = agentTaskStore.getAgentTaskEventsSince(taskId, 0, 1000000);
          const seq = (ownEvents.length ? ownEvents[ownEvents.length - 1].seq : 0) + 1;
          agentTaskStore.appendAgentTaskEvent(parentTaskId, seq, 'child_finished', {
            // UI-382 — 前端 task 模式拍平 {seq, eventType, payload} 后按 payload.event
            // 分发（copilotClient `_dispatchSseEvent`），payload 必须自带 event 字段，
            // 否则 onChildFinished 永不触发、子智能体聚合条停在「运行中」。
            event: 'child_finished',
            childTaskId: taskId,
            status: terminal.status,
            summaryHead: String(assistantText || terminal.error || '').slice(0, 200),
            at: new Date().toISOString(),
          });
        }
      } catch { /* proactive 投递失败不影响终态落库 */ }
    }
  } catch {}

  try {
    aiTaskConcurrencyRelease(userId, taskId);
  } catch {}

  return { assistantText };
}

module.exports = {
  runAgentLoop,
  resolveAgentTaskTerminal,
  resolveFailedJobReplacements,
  buildObservedReplacementAttempt,
  buildLoopObservationEvidence,
};
