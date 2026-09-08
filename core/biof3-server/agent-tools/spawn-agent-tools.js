'use strict';

/**
 * BLOCK-49 — 多 Agent 派生工具面（spawn_agent / list_agents / wait_agent）
 *
 * 设计边界：
 * - 进程内直接复用既有 subagent 执行链（agent-task-store + runAgentLoop +
 *   aiTaskConcurrency*），与 routes/ai-agent/chat.js 的 HTTP 派生分支同一套
 *   校验/并发/取消语义，不走 HTTP 自调用。
 * - 权限 fail-closed：spawn_agent 声明为 state-write（R2），在 agent-tool-policy
 *   层即要求 full accessMode（read / workspace-write 一律拒绝）；子 agent 整体
 *   继承父 context（含 accessMode/projectId），不提供任何提权口。
 * - 只有 primary 主 loop 可以派生（子 agent 不允许再生子 agent）；wait_agent
 *   只允许等待当前任务（ctx.taskId）派生的子 agent，且校验 userId。
 * - runAgentLoop / db 懒加载（避免 registry 模块初始化期的 require 环），
 *   与 chat.js 路由内懒加载同一手法。
 * - 终态摘要受 token 预算截断（P2 回传协议），优先返回结构化关键字段。
 */

const agentTaskStore = require('../agent-task-store');
const {
  getAiSettings,
  getChatModelPreset,
  getChatModelCredential,
  getChatProviderName,
} = require('../helpers/ai-settings');
const { aiTaskConcurrencyAcquire, aiTaskConcurrencyRelease } = require('../helpers/runtime');
const { getOrCreateActiveConversation, getAssistantMessageByTaskId } = require('../helpers/conversations');

const MAX_TASK_CHARS = 8000;
const MAX_INSTRUCTIONS_CHARS = 4000;
const WAIT_POLL_INTERVAL_MS = 1000;
const WAIT_DEFAULT_TIMEOUT_MS = 300000;
const WAIT_MIN_TIMEOUT_MS = 1000;
const WAIT_MAX_TIMEOUT_MS = 600000;
const SUMMARY_TOKEN_BUDGET = 4000;
const SUMMARY_FILES_LIMIT = 20;
// 终态落库与 assistant 消息落库之间存在毫秒级窗口：done 后短暂重试读摘要文本
const SUMMARY_TEXT_RETRY_MS = 2500;
const SUMMARY_TEXT_RETRY_INTERVAL_MS = 500;
// tasks.status 终态集（markAgentTaskDone 写 status='completed'；retry_pending 非终态）
const TERMINAL_TASK_STATUSES = new Set(['completed', 'failed', 'cancelled']);

function fail(error, message, extra = {}) {
  return { ok: false, error, message, ...extra };
}

function clampWaitTimeoutMs(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return WAIT_DEFAULT_TIMEOUT_MS;
  return Math.min(WAIT_MAX_TIMEOUT_MS, Math.max(WAIT_MIN_TIMEOUT_MS, Math.round(n)));
}

// 摘要 token 预算：按最坏密度 1 token/char（CJK cl100k 近似上界）折算为字符上限。
// 刻意不对大文本跑 countTokens/tiktoken——单次 60k 字符编码即 ~4s，会阻塞事件循环；
// 字符上限保证摘要 ≤ budgetTokens（英文实际占用远低于上界），父上下文预算依然成立。
function truncateToTokenBudget(text, budgetTokens = SUMMARY_TOKEN_BUDGET) {
  const out = String(text || '');
  const budget = Math.max(1, Number(budgetTokens) || SUMMARY_TOKEN_BUDGET);
  if (!out.trim()) return { text: '', truncated: false };
  if (out.length <= budget) return { text: out, truncated: false };
  return { text: out.slice(0, budget) + '\n…（摘要已按 token 预算截断）', truncated: true };
}

// 显式 model 参数按 preset.model / preset.id 精确解析；解析不到一律 fail-closed，
// 绝不静默回退到其他模型（模型是子 agent 的能力契约，不是可协商项）。
function resolvePresetByModel(modelName) {
  const target = String(modelName || '').trim().toLowerCase();
  if (!target) return null;
  let presets = [];
  try {
    presets = (getAiSettings() && getAiSettings().chat_model_presets) || [];
  } catch {}
  return (
    presets.find((p) => String(p && p.model || '').toLowerCase() === target) ||
    presets.find((p) => String(p && p.id || '').toLowerCase() === target) ||
    null
  );
}

// 与 chat.js subagent 分支同一模型解析链：显式 model → 继承父 model preset →
// 父任务参数精确合成（BLOCK-49 起 chat.js 落库 profileId/baseUrl）→ active preset
function resolveSpawnModelSettings({ explicitModel, parentParams }) {
  if (explicitModel) {
    const preset = resolvePresetByModel(explicitModel);
    if (!preset) return { error: `未找到模型「${explicitModel}」对应的已配置模型 preset，拒绝派生（fail-closed）` };
    return { preset };
  }
  const parentPreset = resolvePresetByModel(parentParams && parentParams.modelName);
  if (parentPreset) return { preset: parentPreset };
  if (parentParams && parentParams.providerName) {
    return {
      preset: {
        id: parentParams.profileId || parentParams.providerName,
        provider: parentParams.providerName,
        label: parentParams.providerLabel,
        model: parentParams.modelName,
        baseUrl: parentParams.baseUrl,
      },
    };
  }
  return { preset: getChatModelPreset() };
}

/**
 * spawn_agent — 派生子 agent（异步启动，立即返回 agentId）。
 * @param {{task: string, model?: string, instructions?: string}} args
 * @param {{userId: string, taskId: string, context?: object}} ctx 父 loop 的 toolCtx
 */
async function spawn_agent(args, ctx) {
  const taskText = String((args && args.task) || '').trim();
  if (!taskText) return fail('invalid_arguments', 'task 不能为空：请给出清晰具体的子任务描述。');
  if (taskText.length > MAX_TASK_CHARS) {
    return fail('invalid_arguments', `task 过长（${taskText.length} > ${MAX_TASK_CHARS} 字符），请拆分子任务。`);
  }
  const instructions = String((args && args.instructions) || '').trim();
  if (instructions.length > MAX_INSTRUCTIONS_CHARS) {
    return fail('invalid_arguments', `instructions 过长（> ${MAX_INSTRUCTIONS_CHARS} 字符）。`);
  }

  const parentTaskId = ctx && ctx.taskId;
  const userId = ctx && ctx.userId;
  if (!parentTaskId || !userId) {
    return fail('no_parent', 'spawn_agent 只能在主 agent 会话循环内调用。');
  }

  // 父任务校验（与 chat.js subagent 分支同一语义；loop 内调用时父任务必然 running，
  // 但仍然完整复核，不信任调用时机）
  const parentTask = agentTaskStore.getAgentTask(parentTaskId);
  if (!parentTask) return fail('parent_not_found', '父任务不存在。');
  if (parentTask.userId && parentTask.userId !== userId) {
    return fail('permission_denied', '无权以该任务派生子 agent。');
  }
  if ((parentTask.params && parentTask.params.kind || 'primary') !== 'primary') {
    return fail('parent_not_primary', '只有主 agent 会话可以派生子 agent（子 agent 不允许再生子 agent）。');
  }
  if (parentTask.status !== 'running' || parentTask.agentStatus !== 'running') {
    return fail('parent_not_running', '父任务已结束，不能再派生子 agent。');
  }

  const parentParams = parentTask.params || {};
  const parentContext = parentParams.context || {};
  // 权限继承：子 agent 整体继承父 context（accessMode/projectId 等）。
  // spawn 本身已被 policy 限制为 full accessMode，因此继承结果是确定的。
  const context = { ...parentContext };
  if (ctx.accessMode && !context.accessMode) context.accessMode = ctx.accessMode;

  const model = resolveSpawnModelSettings({ explicitModel: args && args.model, parentParams });
  if (model.error) return fail('invalid_arguments', model.error);

  const userContent = instructions ? `${taskText}\n\n${instructions}` : taskText;

  return launchSubAgent({
    parentTaskId,
    userId,
    parentParams,
    parentContext,
    userContent,
    model,
    spawnSource: 'tool:spawn_agent',
  });
}

/**
 * launchSubAgent — 创建子 agent 任务 + 并发槽 + 异步启动 loop。
 * BLOCK-49 二期：从 spawn_agent 抽取核心，spawn_agent / followup_task 共用。
 * @returns {{ok:true, agentId:string, model?:string} | {ok:false, error, message, ...}}
 */
function launchSubAgent({ parentTaskId, userId, parentParams, parentContext, userContent, model, spawnSource }) {
  const context = { ...(parentContext || {}) };
  if (model.accessModeHint && !context.accessMode) context.accessMode = model.accessModeHint;
  const preset = model.preset;
  const providerName = (preset && preset.provider) || parentParams.providerName || getChatProviderName();
  const providerLabel = parentParams.providerLabel || providerName;
  const modelName = (preset && preset.model) || parentParams.modelName;

  // 会话复用：与 chat.js subagent 分支一致，子 agent 挂在父会话下
  let _activeConv = null;
  try {
    _activeConv = getOrCreateActiveConversation(userId, {
      conversationId: parentParams.conversationId,
      page: parentContext.page,
      projectId: parentContext.projectId,
    });
  } catch {}

  let taskId;
  try {
    taskId = agentTaskStore.createAgentTask({
      status: 'running',
      agentStatus: 'running',
      userId,
      params: {
        messages: [{ role: 'user', content: userContent }],
        context,
        conversationId: _activeConv && _activeConv.id,
        providerName,
        providerLabel,
        modelName,
        kind: 'subagent',
        parentTaskId,
        spawnSource,
      },
    }).taskId;
  } catch (e) {
    return { ok: false, error: 'spawn_failed', message: '创建子 agent 任务失败: ' + (e && e.message ? e.message : String(e)) };
  }

  // 并发槽（与 chat.js 同序：先建任务再 acquire；失败即标 failed 并如实回传）
  const acquired = aiTaskConcurrencyAcquire(userId, taskId, { isPrimary: false });
  if (!acquired || acquired.ok === false) {
    try { agentTaskStore.markAgentTaskFailed(taskId, '并发限制'); } catch {}
    return fail(
      'subagent_concurrency_limit',
      '子 agent 并发槽已满，请等待现有子 agent 完成后再派生（可用 list_agents 查看在跑子 agent）。',
      // 任务行已建（failed 终态），回传 agentId 供追溯
      { agentId: taskId, reason: acquired && acquired.reason }
    );
  }

  // 懒加载打断 require 环（agent-runner → agent-tools → registry → 本模块）
  const { runAgentLoop } = require('../agent-runner');
  const dbMod = require('../db');
  let parentLoopRunId = null;
  try {
    const parentLoop = dbMod.getLoopRunByTaskId(parentTaskId);
    parentLoopRunId = (parentLoop && parentLoop.loopRunId) || null;
  } catch {}

  setImmediate(() => {
    runAgentLoop({
      messages: [{ role: 'user', content: userContent }],
      context,
      userId,
      conversationId: _activeConv && _activeConv.id,
      _activeConv,
      apiKey: getChatModelCredential(preset),
      providerName,
      providerLabel,
      modelName,
      profileId: preset && preset.id,
      baseUrl: preset && preset.baseUrl,
      taskId,
      kind: 'subagent',
      parentLoopRunId,
      onEvent: () => {},
      shouldAbort: () => agentTaskStore.isAgentTaskCancellationRequested(taskId),
      // BLOCK-56 P1 单级不连环：子 agent 内禁用请求级 fallback
      disableProviderFallback: true,
    }).catch((e) => {
      try { agentTaskStore.markAgentTaskFailed(taskId, e && e.message ? e.message : String(e)); } catch {}
      try { aiTaskConcurrencyRelease(userId, taskId); } catch {}
    });
  });

  return { ok: true, agentId: taskId, status: 'running', kind: 'subagent', model: modelName || undefined };
}

// ── BLOCK-49 二期：运行中协作三件套 ──────────────────────────

/** 事件流末尾 seq（appendAgentTaskEvent 需要显式 seq）。 */
function nextEventSeq(taskId) {
  const events = agentTaskStore.getAgentTaskEventsSince(taskId, 0, 1000000);
  return (events.length ? events[events.length - 1].seq : 0) + 1;
}

/** 校验 agentId 属于当前任务的子 agent，返回子任务行或 fail 响应。 */
function findOwnChildOrFail(parentTaskId, agentId) {
  if (!agentId) {
    return { error: fail('invalid_arguments', '缺少 agentId。') };
  }
  const child = agentTaskStore.listChildAgentTasks(parentTaskId).find((t) => t.taskId === agentId);
  if (!child) {
    return { error: fail('not_your_agent', '该 agentId 不属于当前任务派生的子 agent（或不存在）。') };
  }
  return { child };
}

/**
 * interrupt_agent — 中断运行中的子 agent（cancel_requested，子 loop 在下一
 * 检查点让出；级联覆盖其派生链）。已终态时幂等返回。
 */
async function interrupt_agent(args, ctx) {
  const parentTaskId = ctx && ctx.taskId;
  const userId = ctx && ctx.userId;
  if (!parentTaskId || !userId) return fail('no_parent', 'interrupt_agent 只能在 agent 会话循环内调用。');
  const { child, error } = findOwnChildOrFail(parentTaskId, String((args && args.agentId) || '').trim());
  if (error) return error;

  if (TERMINAL_TASK_STATUSES.has(child.status)) {
    return { ok: true, agentId: child.taskId, alreadyTerminal: true, status: child.status };
  }
  const dbMod = require('../db');
  const { cancelledTaskIds } = agentTaskStore.cancelAgentTaskCascade(child.taskId, { dbMod });
  try {
    agentTaskStore.appendAgentTaskEvent(
      child.taskId, nextEventSeq(child.taskId), 'interrupt_requested',
      { by: 'parent', parentTaskId, at: new Date().toISOString() },
    );
  } catch {}
  return {
    ok: true,
    agentId: child.taskId,
    agentStatus: 'cancel_requested',
    cancelledTaskIds,
    message: '中断请求已发出；子 agent 将在下一个取消检查点让出，wait_agent 会返回其终态摘要。',
  };
}

/**
 * send_message — 向子 agent 投递父消息（持久化到其事件流，followup_task
 * 续派时作为上下文注入）。运行中即时注入 loop 需改 agent-runner 核心，
 * 二期 v1 为持久化队列语义（诚实登记）。
 */
async function send_message(args, ctx) {
  const parentTaskId = ctx && ctx.taskId;
  const userId = ctx && ctx.userId;
  if (!parentTaskId || !userId) return fail('no_parent', 'send_message 只能在 agent 会话循环内调用。');
  const message = String((args && args.message) || '').trim();
  if (!message) return fail('invalid_arguments', 'message 不能为空。');
  if (message.length > MAX_TASK_CHARS) return fail('invalid_arguments', `message 过长（> ${MAX_TASK_CHARS} 字符）。`);
  const { child, error } = findOwnChildOrFail(parentTaskId, String((args && args.agentId) || '').trim());
  if (error) return error;

  if (TERMINAL_TASK_STATUSES.has(child.status)) {
    return fail('agent_terminal', '子 agent 已结束；请用 followup_task 追加任务（消息将随续派注入）。', { agentId: child.taskId, status: child.status });
  }
  try {
    agentTaskStore.appendAgentTaskEvent(
      child.taskId, nextEventSeq(child.taskId), 'parent_message',
      { message, from: 'parent', at: new Date().toISOString() },
    );
  } catch (e) {
    return fail('queue_failed', '消息入队失败: ' + (e && e.message ? e.message : String(e)));
  }
  return {
    ok: true,
    agentId: child.taskId,
    queued: true,
    note: '消息已入队（子 agent 事件流可见）。运行中即时注入需 loop 核心支持（登记候选）；'
      + '当前该消息将在 followup_task 续派该子 agent 时作为上下文注入。',
  };
}

/**
 * followup_task — 对已终态子 agent 追加任务：以前次摘要 + 队列消息为上下文
 * 续派新子 agent（复用 spawn 启动核心，模型/权限继承链一致）。
 */
async function followup_task(args, ctx) {
  const parentTaskId = ctx && ctx.taskId;
  const userId = ctx && ctx.userId;
  if (!parentTaskId || !userId) return fail('no_parent', 'followup_task 只能在 agent 会话循环内调用。');
  const taskText = String((args && args.task) || '').trim();
  if (!taskText) return fail('invalid_arguments', 'task 不能为空：请给出追加的子任务描述。');
  if (taskText.length > MAX_TASK_CHARS) return fail('invalid_arguments', `task 过长（${taskText.length} > ${MAX_TASK_CHARS} 字符）。`);
  const { child, error } = findOwnChildOrFail(parentTaskId, String((args && args.agentId) || '').trim());
  if (error) return error;
  if (!TERMINAL_TASK_STATUSES.has(child.status)) {
    return fail('agent_running', '子 agent 仍在运行；先 wait_agent 等终态，或用 interrupt_agent 中断后续派。', { agentId: child.taskId, status: child.status });
  }

  const childFull = agentTaskStore.getAgentTask(child.taskId);
  const parentTask = agentTaskStore.getAgentTask(parentTaskId);
  const parentParams = parentTask.params || {};
  const summary = await buildTerminalSummary(childFull);

  // 队列消息取出（消费即清：事件流保留审计，续派提示只带未消费语义）
  const queued = agentTaskStore.getAgentTaskEventsSince(child.taskId, 0, 1000000)
    .filter((e) => e.eventType === 'parent_message')
    .map((e) => {
      // payload 形状双兼容：store 读取已解析为对象；字符串形状防御性保留
      try {
        const raw = typeof e.payload === 'string' ? JSON.parse(e.payload || '{}') : (e.payload || {});
        return String(raw.message || '').slice(0, 500);
      } catch { return ''; }
    })
    .filter(Boolean);

  const parts = [
    `【续派任务】你此前完成了以下任务，现在基于前情继续：`,
    `原任务：${summary.task}`,
  ];
  if (summary.assistantText) parts.push('前次产出摘要：\n' + summary.assistantText);
  if (queued.length) {
    parts.push('期间收到父消息：\n' + queued.map((m) => '- ' + m).join('\n'));
  }
  parts.push(`请在此基础上继续新任务：${taskText}`);
  const userContent = parts.join('\n\n').slice(0, MAX_TASK_CHARS * 2);

  const model = resolveSpawnModelSettings({ explicitModel: args && args.model, parentParams });
  if (model.error) return fail('invalid_arguments', model.error);

  const launched = launchSubAgent({
    parentTaskId,
    userId,
    parentParams,
    parentContext: parentParams.context || {},
    userContent,
    model,
    spawnSource: 'tool:followup_task',
  });
  if (launched.ok === false) return launched;
  return {
    ok: true,
    agentId: launched.agentId,
    followupOf: child.taskId,
    status: 'running',
    queuedMessagesInjected: queued.length,
    model: launched.model || undefined,
  };
}

/**
 * queueUserMessage — 用户侧留言等价（BLOCK-65 P1-a）：agent 专属窗（用户操作）
 * 对运行中子 agent 留言。语义与 send_message 工具单源（持久化 parent_message
 * 事件 + 队列语义：followup_task 续派时注入）；差异仅在归属校验——工具版要求
 * 调用方是父 loop ctx，本函数面向 HTTP 用户态（子任务真实存在即可）。
 */
function queueUserMessage({ childTaskId, message }) {
  const text = String(message || '').trim();
  if (!text) return { ok: false, error: 'invalid_arguments', message: 'message 不能为空。' };
  if (text.length > MAX_TASK_CHARS) return { ok: false, error: 'invalid_arguments', message: `message 过长（> ${MAX_TASK_CHARS} 字符）。` };
  const child = agentTaskStore.getAgentTask(childTaskId);
  if (!child) return { ok: false, error: 'not_found', message: '子 agent 不存在。' };
  if (TERMINAL_TASK_STATUSES.has(child.status)) {
    return { ok: false, error: 'agent_terminal', message: '子 agent 已结束；请改用「继续派」追加任务（留言将随续派注入）。', status: child.status };
  }
  try {
    agentTaskStore.appendAgentTaskEvent(
      childTaskId, nextEventSeq(childTaskId), 'parent_message',
      { message: text, from: 'user_window', at: new Date().toISOString() },
    );
  } catch (e) {
    return { ok: false, error: 'queue_failed', message: '留言入队失败: ' + (e && e.message ? e.message : String(e)) };
  }
  return {
    ok: true,
    queued: true,
    note: '留言已入队（子 agent 事件流可见）。运行中即时注入需 loop 核心支持（登记候选）；'
      + '当前该留言将在「继续派」续派该子 agent 时作为上下文注入。',
  };
}

/**
 * launchUserFollowup — 用户侧续派等价（BLOCK-65 P1-a）：agent 专属窗在子
 * agent 终态后触发。任务组装语义与 followup_task 工具单源（前次摘要 + 队列
 * 留言 + 新任务）；父链取原任务 params.parentTaskId（模型/权限继承链一致）。
 */
async function launchUserFollowup({ childTaskId, userId, task }) {
  const taskText = String(task || '').trim();
  if (!taskText) return { ok: false, error: 'invalid_arguments', message: 'task 不能为空：请给出追加的子任务描述。' };
  if (taskText.length > MAX_TASK_CHARS) return { ok: false, error: 'invalid_arguments', message: `task 过长（${taskText.length} > ${MAX_TASK_CHARS} 字符）。` };
  const child = agentTaskStore.getAgentTask(childTaskId);
  if (!child) return { ok: false, error: 'not_found', message: '子 agent 不存在。' };
  const parentTaskId = child.params && child.params.parentTaskId;
  if (!parentTaskId) return { ok: false, error: 'no_parent', message: '该任务没有父派生链，无法续派。' };
  if (!TERMINAL_TASK_STATUSES.has(child.status)) {
    return { ok: false, error: 'agent_running', message: '子 agent 仍在运行；请先中断再续派。', status: child.status };
  }
  const parentTask = agentTaskStore.getAgentTask(parentTaskId);
  if (!parentTask) return { ok: false, error: 'parent_gone', message: '父任务已不存在，无法延续派生链。' };
  const parentParams = parentTask.params || {};
  const summary = await buildTerminalSummary(child);

  const queued = agentTaskStore.getAgentTaskEventsSince(child.taskId, 0, 1000000)
    .filter((e) => e.eventType === 'parent_message')
    .map((e) => {
      try {
        const raw = typeof e.payload === 'string' ? JSON.parse(e.payload || '{}') : (e.payload || {});
        return String(raw.message || '').slice(0, 500);
      } catch { return ''; }
    })
    .filter(Boolean);

  const parts = [
    `【续派任务】你此前完成了以下任务，现在基于前情继续：`,
    `原任务：${summary.task}`,
  ];
  if (summary.assistantText) parts.push('前次产出摘要：\n' + summary.assistantText);
  if (queued.length) {
    parts.push('期间收到消息：\n' + queued.map((m) => '- ' + m).join('\n'));
  }
  parts.push(`请在此基础上继续新任务：${taskText}`);
  const userContent = parts.join('\n\n').slice(0, MAX_TASK_CHARS * 2);

  const model = resolveSpawnModelSettings({ explicitModel: undefined, parentParams });
  if (model.error) return { ok: false, error: 'invalid_arguments', message: model.error };

  const launched = launchSubAgent({
    parentTaskId,
    userId,
    parentParams,
    parentContext: parentParams.context || {},
    userContent,
    model,
    spawnSource: 'user:followup',
  });
  if (launched.ok === false) return launched;
  return {
    ok: true,
    agentId: launched.agentId,
    followupOf: child.taskId,
    status: 'running',
    queuedMessagesInjected: queued.length,
    model: launched.model || undefined,
  };
}

/**
 * list_agents — 列出当前任务派生的全部子 agent（含终态）。
 */
async function list_agents(args, ctx) {
  const parentTaskId = ctx && ctx.taskId;
  if (!parentTaskId) return fail('no_parent', 'list_agents 只能在 agent 会话循环内调用。');
  const children = agentTaskStore.listChildAgentTasks(parentTaskId);
  return {
    ok: true,
    agents: children.map((t) => ({
      agentId: t.taskId,
      status: t.status,
      agentStatus: t.agentStatus,
      task: String(t.params && t.params.messages && t.params.messages[0] && t.params.messages[0].content || '').slice(0, 120),
      createdAt: t.createdAt,
      finishedAt: t.finishedAt || undefined,
      error: t.error || undefined,
    })),
  };
}

/**
 * wait_agent — 阻塞等待指定子 agent 终态，返回 token 预算内摘要。
 * 只允许等待当前任务派生的子 agent（parentTaskId + userId 双重校验）。
 * @param {{agentId: string, timeout?: number}} args
 */
async function wait_agent(args, ctx) {
  const parentTaskId = ctx && ctx.taskId;
  const userId = ctx && ctx.userId;
  if (!parentTaskId || !userId) return fail('no_parent', 'wait_agent 只能在 agent 会话循环内调用。');
  const agentId = String((args && args.agentId) || '').trim();
  if (!agentId) return fail('invalid_arguments', '缺少 agentId。');

  const first = agentTaskStore.getAgentTask(agentId);
  if (!first) return fail('agent_not_found', '子 agent 不存在。');
  if (first.userId && first.userId !== userId) return fail('permission_denied', '无权等待该子 agent。');
  if (!first.params || first.params.parentTaskId !== parentTaskId) {
    return fail('agent_not_child', '只能等待当前会话派生的子 agent。');
  }

  const timeoutMs = clampWaitTimeoutMs(args && args.timeout);
  const startedAt = Date.now();
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  for (;;) {
    const task = agentTaskStore.getAgentTask(agentId);
    if (!task) return fail('agent_not_found', '子 agent 不存在。');
    if (TERMINAL_TASK_STATUSES.has(task.status)) {
      const summary = await buildTerminalSummary(task);
      return {
        ok: true,
        agentId,
        status: task.status,
        agentStatus: task.agentStatus,
        summary,
      };
    }
    if (Date.now() - startedAt >= timeoutMs) {
      return {
        ok: false,
        error: 'wait_timeout',
        agentId,
        status: task.status,
        message: '等待超时，子 agent 仍在运行；可稍后再次调用 wait_agent，或用 list_agents 查看状态。',
      };
    }
    // 父 loop 被取消时立即让出，不空等
    if (typeof ctx.isCancelled === 'function' && ctx.isCancelled()) {
      return { ok: false, error: 'cancelled', agentId, status: task.status, message: '父任务已请求取消。' };
    }
    await sleep(WAIT_POLL_INTERVAL_MS);
  }
}

async function buildTerminalSummary(task) {
  const base = {
    task: String(task.params && task.params.messages && task.params.messages[0] && task.params.messages[0].content || '').slice(0, 120),
    error: task.error || undefined,
    filesChanged: Array.isArray(task.filesChanged) ? task.filesChanged.slice(0, SUMMARY_FILES_LIMIT) : [],
    filesChangedTruncated: Array.isArray(task.filesChanged) && task.filesChanged.length > SUMMARY_FILES_LIMIT,
  };
  if (task.status !== 'completed') return { ...base, assistantText: '', truncated: false };

  // done → assistant 消息落库存在毫秒级窗口，短暂重试；仍取不到则降级为无正文摘要
  let assistantMessage = getAssistantMessageByTaskId(task.taskId);
  const deadline = Date.now() + SUMMARY_TEXT_RETRY_MS;
  while (!assistantMessage && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, SUMMARY_TEXT_RETRY_INTERVAL_MS));
    assistantMessage = getAssistantMessageByTaskId(task.taskId);
  }
  const { text, truncated } = truncateToTokenBudget(assistantMessage && assistantMessage.content);
  return { ...base, assistantText: text, truncated };
}

module.exports = {
  spawn_agent,
  interrupt_agent,
  send_message,
  followup_task,
  list_agents,
  wait_agent,
  // BLOCK-65 P1-a：用户侧（HTTP）等价——agent 专属窗留言/续派，语义与工具版单源
  queueUserMessage,
  launchUserFollowup,
  // 测试钩子（不进入 registry）
  __test: { clampWaitTimeoutMs, truncateToTokenBudget, resolvePresetByModel },
};
