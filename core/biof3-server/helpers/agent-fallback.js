'use strict';

/**
 * helpers/agent-fallback.js — BLOCK-56 P1 任务级模型降级启动器。
 *
 * 语义（plan §2.1）：agent 任务因**可降级**模型错误失败 + 用户配置了备用模型
 * → 自动切换备用 profile 续跑原任务（复用 BLOCK-38 resume 链路形态：
 * 原 task 保持 failed 不可变，同会话新建 task，params.resumeOfTaskId 溯源）。
 *
 * 单级不连环（三重闸）：
 *   1. 请求级降级已发生过（loop-orchestrator modelFallbackOccurred）→ 不再任务级
 *   2. 本任务自身已是降级/手动续跑任务（params.fallbackOfTaskId / resumeOfTaskId）→ 不再触发
 *   3. 降级续跑的新任务以 disableProviderFallback 启动（gateway 只试主 profile）
 *
 * 边界：仅 kind='primary' 的任务自动降级（subagent 失败由父 loop 协调，不自动续跑）；
 * 未配置 fallbackEnabled/bindings → 诚实失败（现行为，零回归）。
 */

const agentTaskStore = require('../agent-task-store');
const { buildProgressDigest } = require('../routes/ai-agent/resume');
const {
  classifyDegradableError,
  resolveTaskFallbackProfile,
  buildFallbackResumeMessages,
} = require('./model-fallback-policy');

/** 从 ModelProfile 推导凭据（对齐 resolveChatModelCredential 的 refId 优先级）。 */
function resolveProfileApiKey(profile) {
  try {
    const { getApiKey } = require('./ai-settings');
    const ref = String((profile && profile.credentialRef) || '');
    const refId = ref.includes(':') ? ref.slice(ref.indexOf(':') + 1) : ref;
    if (refId) {
      const secret = getApiKey(refId);
      if (secret) return secret;
    }
    if (profile && profile.provider) return getApiKey(profile.provider) || '';
  } catch {}
  return '';
}

/**
 * 判定并启动任务级降级续跑（同步判定 + 异步拉起 loop）。
 *
 * @param {object} input
 * @param {string} input.taskId 失败的原任务 id
 * @param {string|Error|null} input.error 终态错误（fatalAgentError）
 * @param {boolean} [input.modelFallbackOccurred] 本任务是否已发生过请求级降级
 * @param {string|null} [input.previousProfileId] 原任务主 profile id
 * @param {string} [input.kind] 原任务 kind
 * @param {object|null} [input._activeConv] 原会话对象
 * @param {function} [input.emit] 原任务 _emit（事件落原 task task_events + onEvent）
 * @param {object} [deps] 测试注入：runAgentLoop / gatewayConfig
 * @returns {{launched: boolean, reason: string|null, newTaskId: string|null, category: string|null, toProfileLabel: string|null}}
 */
function maybeLaunchTaskLevelFallback(input, deps = {}) {
  const outcome = { launched: false, reason: null, newTaskId: null, category: null, toProfileLabel: null };
  const {
    taskId,
    error,
    modelFallbackOccurred = false,
    previousProfileId = null,
    kind = 'primary',
    _activeConv = null,
    emit = () => {},
  } = input || {};

  // 闸 0：仅主任务自动降级
  if (kind !== 'primary') { outcome.reason = 'not_primary'; return outcome; }
  // 闸 1：本任务已发生过请求级降级 → 单级不连环
  if (modelFallbackOccurred) { outcome.reason = 'fallback_already_used'; return outcome; }

  // 闸 2：本任务自身已是降级/手动续跑任务 → 不连环
  let task = null;
  try { task = agentTaskStore.getAgentTask(taskId); } catch {}
  const params = (task && task.params && typeof task.params === 'object') ? task.params : {};
  if (params.fallbackOfTaskId || params.resumeOfTaskId) { outcome.reason = 'already_resumed'; return outcome; }

  // 分类：不可降级错误走既有失败链（零回归）
  const classified = classifyDegradableError(error);
  if (!classified.degradable) { outcome.reason = 'not_degradable'; return outcome; }

  // 配置：未启用/无有效备用 → 诚实失败（现行为）
  let profile = null;
  try {
    const { modelGateway } = require('./llm-client');
    const config = typeof deps.gatewayConfig === 'function' ? deps.gatewayConfig() : (deps.gatewayConfig || modelGateway.getConfig());
    profile = resolveTaskFallbackProfile(config, previousProfileId, 'agent');
  } catch {}
  if (!profile) { outcome.reason = 'no_fallback_profile'; return outcome; }

  const originalMessages = Array.isArray(params.messages) ? params.messages : [];
  if (originalMessages.length === 0) { outcome.reason = 'no_original_messages'; return outcome; }

  // 执行进度摘要（task_events）→ 合成恢复指令（与 BLOCK-38 resume 同构）
  let digest = '';
  try { digest = buildProgressDigest(agentTaskStore.getAgentTaskEventsSince(taskId, 0, 1000000)); } catch {}
  const toProfileLabel = String(profile.label || profile.model || profile.provider || '备用模型');
  const reasonText = String(error && error.message ? error.message : error || '').slice(0, 200);
  const resumeMessages = buildFallbackResumeMessages(originalMessages, digest, { reason: reasonText, label: toProfileLabel });

  let newTaskId;
  try {
    newTaskId = agentTaskStore.createAgentTask({
      status: 'running',
      agentStatus: 'running',
      userId: task.user_id || params.userId,
      params: {
        messages: resumeMessages,
        context: params.context && typeof params.context === 'object' ? params.context : {},
        conversationId: params.conversationId || null,
        providerName: profile.provider,
        providerLabel: toProfileLabel,
        modelName: profile.model,
        kind: 'primary',
        parentTaskId: null,
        resumeOfTaskId: taskId,
        fallbackOfTaskId: taskId,
        fallbackFromProfileId: previousProfileId || null,
        fallbackReason: reasonText,
      },
    }).taskId;
  } catch (e) {
    outcome.reason = 'create_task_failed: ' + (e && e.message);
    return outcome;
  }
  outcome.newTaskId = newTaskId;
  outcome.category = classified.category;
  outcome.toProfileLabel = toProfileLabel;

  // 溯源事件落原 task（seq 由 agent-runner _emit 维护；事件同时进 task_events 与 onEvent）
  try {
    emit({
      event: 'model_fallback',
      scope: 'task_level',
      fromProfileId: previousProfileId || null,
      toProfileId: profile.id,
      toProfileLabel,
      reason: reasonText || null,
      category: classified.category,
      newTaskId,
      message: `模型调用失败，已自动降级到备用模型「${toProfileLabel}」继续执行原任务`,
    });
    emit({
      event: 'agent_status',
      phase: 'model_fallback_resumed',
      newTaskId,
      message: `已降级到「${toProfileLabel}」继续执行`,
    });
  } catch {}

  // 并发槽 + loop 拉起（对齐 resume.js：primary 槽语义）
  const { aiTaskConcurrencyAcquire, aiTaskConcurrencyRelease } = require('./runtime');
  const acquired = aiTaskConcurrencyAcquire(task.user_id || params.userId, newTaskId, { isPrimary: true });
  if (!acquired || acquired.ok === false) {
    try { agentTaskStore.markAgentTaskFailed(newTaskId, '降级续跑因并发限制未能启动'); } catch {}
    try {
      emit({ event: 'agent_status', phase: 'model_fallback_failed', message: '备用模型续跑因并发限制未能启动，请手动重试' });
    } catch {}
    outcome.launched = false;
    outcome.reason = 'concurrency_limit';
    return outcome;
  }

  let activeConv = _activeConv || null;
  try {
    if (!activeConv && params.conversationId) {
      const convSync = require('./conversations');
      activeConv = convSync.getOrCreateActiveConversation(task.user_id || params.userId, {
        conversationId: params.conversationId,
        page: params.context && params.context.page,
        projectId: params.context && params.context.projectId,
        titleHint: '降级续跑任务',
      });
    }
  } catch {}

  const runAgentLoop = typeof deps.runAgentLoop === 'function' ? deps.runAgentLoop : require('../agent-runner').runAgentLoop;
  setImmediate(() => {
    runAgentLoop({
      messages: resumeMessages,
      context: params.context && typeof params.context === 'object' ? params.context : {},
      userId: task.user_id || params.userId,
      conversationId: (activeConv && activeConv.id) || params.conversationId || null,
      _activeConv: activeConv,
      apiKey: resolveProfileApiKey(profile),
      providerName: profile.provider,
      providerLabel: toProfileLabel,
      modelName: profile.model,
      profileId: profile.id,
      baseUrl: profile.baseUrl,
      taskId: newTaskId,
      kind: 'primary',
      parentLoopRunId: null,
      // 闸 3：降级续跑任务关闭请求级 fallback（gateway 只试主 profile）
      disableProviderFallback: true,
      onEvent: () => {},
      shouldAbort: () => agentTaskStore.isAgentTaskCancellationRequested(newTaskId),
    }).catch((e) => {
      try { agentTaskStore.markAgentTaskFailed(newTaskId, e && e.message ? e.message : String(e)); } catch {}
      try { aiTaskConcurrencyRelease(task.user_id || params.userId, newTaskId); } catch {}
    });
  });

  outcome.launched = true;
  return outcome;
}

module.exports = { maybeLaunchTaskLevelFallback, resolveProfileApiKey };
