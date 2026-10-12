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
const agentRoles = require('./agent-roles');
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
const MAX_GOALS = 5;
const MAX_GOAL_CHARS = 200;
const WAIT_POLL_INTERVAL_MS = 1000;
const WAIT_DEFAULT_TIMEOUT_MS = 300000;
// BLOCK-109 P2 — 单父任务同时活跃子智能体上限（软：超出即软指引，非硬拒）。
// BLOCK-173 CP-8 — 上限用户可配：env PETRI_SPAWN_CONCURRENCY_LIMIT（1-8 钳制，
// 缺省 3=既有保守值）。解析函数化（测试契约直测）；语义仍是软指引非硬拒。
function resolveSpawnConcurrencyLimit() {
  const raw = Number(process.env.PETRI_SPAWN_CONCURRENCY_LIMIT);
  if (!Number.isFinite(raw)) return 3;
  return Math.max(1, Math.min(8, Math.floor(raw)));
}

// BLOCK-173 CP-8 — 派生深度受控放开：env PETRI_SPAWN_MAX_DEPTH（≥1，缺省 1=
// 既有「子不可再生子」零行为变化）。深度=父链上的 spawn 代数；depth=2 时
// 子 agent（作为父）可再派孙代。放开语义：父链校验从「父必须 primary」放宽为
// 「父为 primary 或（子且当前代数 < maxDepth-1）」。
function resolveSpawnMaxDepth() {
  const raw = Number(process.env.PETRI_SPAWN_MAX_DEPTH);
  if (!Number.isFinite(raw) || raw < 1) return 1;
  return Math.min(3, Math.floor(raw));
}
const WAIT_MIN_TIMEOUT_MS = 1000;
const WAIT_MAX_TIMEOUT_MS = 600000;
const SUMMARY_TOKEN_BUDGET = 4000;
const SUMMARY_FILES_LIMIT = 20;
// 终态落库与 assistant 消息落库之间存在毫秒级窗口：done 后短暂重试读摘要文本
const SUMMARY_TEXT_RETRY_MS = 2500;
const SUMMARY_TEXT_RETRY_INTERVAL_MS = 500;
// tasks.status 终态集（markAgentTaskDone 写 status='completed'；retry_pending 非终态）
const TERMINAL_TASK_STATUSES = new Set(['completed', 'failed', 'cancelled']);

// BLOCK-163 W3 P1（ORC-3）— 子 Agent 终态事件总线：wait_agent 事件驱动聚合
//（终态 emit 即醒，替代热 1s 轮询；轮询兜底片保留——事件丢失自愈）。
// 通知点=spawn_agent 派生链 settle 之后（runAgentLoop 的 mark 已在其内部完成）。
const { EventEmitter } = require('events');
const childTerminalBus = new EventEmitter();
childTerminalBus.setMaxListeners(0);
function notifyChildTerminal(agentId) {
  try { childTerminalBus.emit('terminal', String(agentId)); } catch {}
}

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

/** goals 归一校验（fail-closed）：未传=空；数组 1-5 条非空字符串、单条 ≤200 字符。 */
function normalizeGoals(raw) {
  if (raw === undefined || raw === null) return { ok: true, goals: [] };
  if (!Array.isArray(raw)) return { ok: false, fail: fail('invalid_arguments', 'goals 必须是字符串数组（可核对的目标清单）。') };
  const goals = raw.map((g) => String(g || '').trim()).filter(Boolean);
  if (goals.length === 0) return { ok: true, goals: [] };
  if (goals.length > MAX_GOALS) return { ok: false, fail: fail('invalid_arguments', `goals 最多 ${MAX_GOALS} 条（现 ${goals.length}）。`) };
  for (const g of goals) {
    if (g.length > MAX_GOAL_CHARS) return { ok: false, fail: fail('invalid_arguments', `单条目标过长（> ${MAX_GOAL_CHARS} 字符）：${g.slice(0, 30)}…`) };
  }
  return { ok: true, goals };
}

// BLOCK-120 — todoRefs 声明制归属（终态对账 v2）：todo id 与 todo-tools 的
// MAX_ID_LENGTH 同界（≤64 字符）；≤5 条。
const MAX_TODO_REFS = 5;
const MAX_TODO_REF_CHARS = 64;

/** todoRefs 形状归一（fail-closed 同 goals）：未传=空；数组 1-5 条非空字符串、单条 ≤64 字符。 */
function normalizeTodoRefs(raw) {
  if (raw === undefined || raw === null) return { ok: true, refs: [] };
  if (!Array.isArray(raw)) return { ok: false, fail: fail('invalid_arguments', 'todoRefs 必须是字符串数组（任务清单条目 id）。') };
  const refs = raw.map((r) => String(r || '').trim()).filter(Boolean);
  if (refs.length === 0) return { ok: true, refs: [] };
  if (refs.length > MAX_TODO_REFS) return { ok: false, fail: fail('invalid_arguments', `todoRefs 最多 ${MAX_TODO_REFS} 条（现 ${refs.length}）。`) };
  for (const r of refs) {
    if (r.length > MAX_TODO_REF_CHARS) return { ok: false, fail: fail('invalid_arguments', `单条 todoRef 过长（> ${MAX_TODO_REF_CHARS} 字符）：${r.slice(0, 30)}…`) };
  }
  return { ok: true, refs };
}

/**
 * 读当前任务运行最近一次 todo_write 快照的条目 id（对照校验用）。
 * 读法与 agent-runner 终态对账块同源（task_events tool_call(todo_write) 事件重放）。
 * 无清单返回 null（≠空清单：无清单时 refs 无从对照，全部按未登记处置）。
 */
function latestTodoIds(parentTaskId) {
  try {
    const events = agentTaskStore.getAgentTaskEventsSince(parentTaskId, 0, 1000000);
    // 整单幂等替换（todo-tools 契约）：最后一次 todo_write 即最新快照，正向扫到末尾
    let latestItems = null;
    for (const e of events) {
      if (e.eventType === 'tool_call' && e.payload && e.payload.name === 'todo_write'
        && e.payload.args && Array.isArray(e.payload.args.items)) {
        latestItems = e.payload.args.items;
      }
    }
    if (latestItems) {
      return latestItems.map((it) => String((it && it.id) || '')).filter(Boolean);
    }
  } catch { /* 快照读取失败=无从对照，按无清单处置 */ }
  return null;
}

/**
 * todoRefs 对照快照裁决（BLOCK-120 D-2）：有效 refs 保留；未登记 id 丢弃并回传
 * （不整单拒绝——typo 不应阻断派发；无清单时全部按未登记处置）。
 */
function resolveTodoRefs(rawRefs, parentTaskId) {
  const check = normalizeTodoRefs(rawRefs);
  if (!check.ok) return check;
  const knownIds = latestTodoIds(parentTaskId);
  const known = new Set(knownIds || []);
  const refs = check.refs.filter((r) => known.has(r));
  const ignored = check.refs.filter((r) => !known.has(r));
  return { ok: true, refs, ignored, hasSnapshot: knownIds !== null };
}

/**
 * spawn_agent — 派生子 agent（异步启动，立即返回 agentId）。
 * @param {{task: string, model?: string, instructions?: string, goals?: string[]}} args
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
  // BLOCK-173 CP-8 — 深度受控放开：maxDepth=1（缺省）维持「父必须 primary」；
  // maxDepth≥2 时允许运行中的子 agent 作为父再派下一代（深度=父链 spawn 代数），
  // 仍然 fail-closed 校验父链（非 primary 父必须是 subagent 且未超深度）。
  const maxDepth = resolveSpawnMaxDepth();
  const parentKind = (parentTask.params && parentTask.params.kind) || 'primary';
  if (parentKind !== 'primary') {
    if (maxDepth < 2) {
      return fail('parent_not_primary', '只有主 agent 会话可以派生子 agent（子 agent 不允许再生子 agent）。');
    }
    // 深度上限校验：沿 parentTaskId 上溯统计代数（有界防环）。
    let ancestryDepth = 1;
    let cursor = parentTask;
    while (cursor && cursor.params && cursor.params.parentTaskId && ancestryDepth < maxDepth + 2) {
      const ancestor = agentTaskStore.getAgentTask(cursor.params.parentTaskId);
      if (!ancestor) break;
      ancestryDepth += 1;
      cursor = ancestor;
    }
    if (ancestryDepth >= maxDepth) {
      return fail('spawn_depth_exceeded', `已达派生深度上限（${maxDepth}）：当前允许的最大 spawn 代数为 ${maxDepth}。`);
    }
  }
  if (parentTask.status !== 'running' || parentTask.agentStatus !== 'running') {
    return fail('parent_not_running', '父任务已结束，不能再派生子 agent。');
  }

  // BLOCK-109 P2 — 派发并行度软上限：活跃子任务 ≥ 上限时软指引而非硬拒。
  // 并发子 agent 过多 = 并发模型连接过多 = 上游瞬断（ECONNRESET）概率上升
  // （2026-09-21 用户实测 4 并行派发后主/子双双 ECONNRESET）；同时保持模型
  // 控制权——wait_agent 腾位后可再派。
  const runningChildren = agentTaskStore.getRunningChildAgentTasks(parentTaskId) || [];
  const spawnConcurrencyLimit = resolveSpawnConcurrencyLimit();
  if (runningChildren.length >= spawnConcurrencyLimit) {
    const activeList = runningChildren
      .map((t) => String(t.taskId || '').slice(0, 8))
      .join(', ');
    return fail(
      'concurrency_limit',
      `活跃子智能体已达并行上限（${runningChildren.length}/${spawnConcurrencyLimit}：${activeList}）。`
        + '请先调用 wait_agent 等待其中一个完成以腾出位置，或先执行不依赖新子智能体的其他工作。'
    );
  }

  const parentParams = parentTask.params || {};
  const parentContext = parentParams.context || {};
  // 权限继承：子 agent 整体继承父 context（accessMode/projectId 等）。
  // spawn 本身已被 policy 限制为 full accessMode，因此继承结果是确定的。
  const context = { ...parentContext };
  if (ctx.accessMode && !context.accessMode) context.accessMode = ctx.accessMode;

  const model = resolveSpawnModelSettings({ explicitModel: args && args.model, parentParams });
  if (model.error) return fail('invalid_arguments', model.error);

  // BLOCK-93 P1 — 角色专职化：role 可选参数（注册表校验，未知 fail-closed；
  // 未传＝通用缺省，零行为变化）。
  const roleCheck = agentRoles.resolveRoleOrError(args && args.role);
  if (!roleCheck.ok) return roleCheck.fail;

  // 加映 3 — goals 可选声明：落 params（汇报门逐目标核对）+ 子任务书判据段
  const goalCheck = normalizeGoals(args && args.goals);
  if (!goalCheck.ok) return goalCheck.fail;

  // BLOCK-120 — todoRefs 可选声明：对照最近清单快照，未登记 id 丢弃+回传（D-2）
  const refsCheck = resolveTodoRefs(args && args.todoRefs, parentTaskId);
  if (!refsCheck.ok) return refsCheck.fail;

  const userContent = instructions ? `${taskText}\n\n${instructions}` : taskText;

  const launched = launchSubAgent({
    parentTaskId,
    userId,
    parentParams,
    parentContext,
    userContent,
    model,
    role: roleCheck.role,
    goals: goalCheck.goals,
    todoRefs: refsCheck.refs,
    spawnSource: 'tool:spawn_agent',
  });
  if (launched.ok === false) return launched;
  return {
    ...launched,
    ...(refsCheck.refs.length ? { todoRefs: refsCheck.refs } : {}),
    ...(refsCheck.ignored.length ? {
      todoRefsIgnored: refsCheck.ignored,
      note: refsCheck.hasSnapshot
        ? `todoRefs 中未在当前任务清单登记的 id 已忽略：${refsCheck.ignored.join(', ')}`
        : '当前任务尚无任务清单，todoRefs 已忽略（先用 todo_write 建清单再派发即可归属）。',
    } : {}),
  };
}

/**
 * launchSubAgent — 创建子 agent 任务 + 并发槽 + 异步启动 loop。
 * BLOCK-49 二期：从 spawn_agent 抽取核心，spawn_agent / followup_task 共用。
 * BLOCK-93 P1：role（可选角色 key）随 params 落库 + 注册表指令片段注入 system prompt。
 * 加映 3：goals 落 params（汇报门逐目标核对）+ 任务书尾部「完成判据」段。
 * @returns {{ok:true, agentId:string, model?:string, role?:string} | {ok:false, error, message, ...}}
 */
function launchSubAgent({ parentTaskId, userId, parentParams, parentContext, userContent, model, role, goals = [], todoRefs = [], spawnSource }) {
  const context = { ...(parentContext || {}) };
  if (model.accessModeHint && !context.accessMode) context.accessMode = model.accessModeHint;
  const preset = model.preset;
  const providerName = (preset && preset.provider) || parentParams.providerName || getChatProviderName();
  const providerLabel = parentParams.providerLabel || providerName;
  const modelName = (preset && preset.model) || parentParams.modelName;
  const goalList = Array.isArray(goals) ? goals.filter(Boolean) : [];
  const refList = Array.isArray(todoRefs) ? todoRefs.filter(Boolean) : [];
  const userContentFinal = goalList.length
    ? `${userContent}\n\n【完成判据（终态汇报将逐条核对完备性，未达成会被点名）】\n${goalList.map((g, i) => `${i + 1}. ${g}`).join('\n')}`
    : userContent;
  // BLOCK-93 P1 — prompt 软约束：注册表指令片段（未知 key 时 renderRoleDirective
  // 返回 null＝零注入；上游已做 fail-closed 校验，此处是纵深）
  const roleDirective = role ? agentRoles.renderRoleDirective(role) : null;

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
        messages: [{ role: 'user', content: userContentFinal }],
        context,
        conversationId: _activeConv && _activeConv.id,
        providerName,
        providerLabel,
        modelName,
        kind: 'subagent',
        parentTaskId,
        spawnSource,
        ...(role ? { role } : {}),
        ...(goalList.length ? { goals: goalList } : {}),
        // BLOCK-120 — todoRefs 落 params：终态对账按此把失败/取消子任务归属到清单条目
        //（D-3：子任务书不注入 refs——归因是父侧观测面，子侧上下文保持精简）
        ...(refList.length ? { todoRefs: refList } : {}),
        // BLOCK-88 P2（D3）— 联邦委托派生的 subagent 继承访客归属
        //（俯瞰面板 federatedFrom 角标数据源；宿主本地派生恒 undefined）。
        ...(parentParams && parentParams.federated ? { federated: parentParams.federated } : {}),
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
      messages: [{ role: 'user', content: userContentFinal }],
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
      // BLOCK-93 P1 — 角色软约束注入（未传＝null＝零变化）
      roleDirective: roleDirective || null,
      onEvent: () => {},
      shouldAbort: () => agentTaskStore.isAgentTaskCancellationRequested(taskId),
      // BLOCK-56 P1 单级不连环：子 agent 内禁用请求级 fallback
      disableProviderFallback: true,
    }).catch((e) => {
      try { agentTaskStore.markAgentTaskFailed(taskId, e && e.message ? e.message : String(e)); } catch {}
      try { aiTaskConcurrencyRelease(userId, taskId); } catch {}
    }).then(() => {
      // ORC-3 — 派生链 settle 后广播终态（wait_agent 订阅即醒；幂等安全）
      notifyChildTerminal(taskId);
    });
  });

  return { ok: true, agentId: taskId, status: 'running', kind: 'subagent', model: modelName || undefined, ...(role ? { role } : {}) };
}

// ── BLOCK-49 二期：运行中协作三件套 ──────────────────────────

/** 事件流末尾 seq（appendAgentTaskEvent 需要显式 seq）。 */
function nextEventSeq(taskId) {
  const events = agentTaskStore.getAgentTaskEventsSince(taskId, 0, 5000) // BLOCK-102 P4 cap;
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
 * send_message — 向子 agent 投递父消息。双通道（2026-09-23 实时化）：
 * ①运行中 → 复用 BLOCK-98 M4 输入插队队列，子 agent 下一个模型请求边界即看到
 *   （前缀「父智能体消息」）；送达回执 parent_message_delivered 落事件流。
 * ②终态前未被消费 → followup_task 续派时作为上下文注入（原队列语义兜底）。
 * parent_message 事件恒落事件流作审计与续派兜底，两通道经 refs 去重不重复。
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
  const seq = nextEventSeq(child.taskId);
  try {
    agentTaskStore.appendAgentTaskEvent(
      child.taskId, seq, 'parent_message',
      { message, from: 'parent', at: new Date().toISOString() },
    );
  } catch (e) {
    return fail('queue_failed', '消息入队失败: ' + (e && e.message ? e.message : String(e)));
  }
  // 实时 steering：入队失败不阻塞（事件流已在，退化为 followup 注入语义）
  const steered = enqueueSteeringForChild(child.taskId, message, seq, '【父智能体消息】');
  return {
    ok: true,
    agentId: child.taskId,
    queued: true,
    ...(steered ? { deliveredVia: 'steering' } : {}),
    note: steered
      ? '消息已实时送达：子 agent 将在下一个模型请求边界看到（前缀「父智能体消息」）；若其终态前未消费，仍随 followup_task 续派注入。'
      : '消息已入队（子 agent 事件流可见）；将在 followup_task 续派该子 agent 时作为上下文注入。',
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

  // 队列消息取出（实时已送达的经 delivered refs 剔除；事件流保留审计）
  const queued = collectUndeliveredParentMessages(child.taskId);

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

  // BLOCK-93 P1 — 续派角色继承：显式 args.role 覆盖 > 原子 agent 角色 > 通用缺省
  const roleCheck = agentRoles.resolveRoleOrError(
    (args && args.role) || (childFull.params && childFull.params.role) || ''
  );
  if (!roleCheck.ok) return roleCheck.fail;

  // 加映 3 — 续派 goals：显式 args.goals > 继承原子 agent goals
  let goals = [];
  if (args && args.goals !== undefined) {
    const gc = normalizeGoals(args.goals);
    if (!gc.ok) return gc.fail;
    goals = gc.goals;
  } else if (Array.isArray(childFull.params && childFull.params.goals)) {
    goals = childFull.params.goals.slice(0, MAX_GOALS);
  }

  // BLOCK-120 — 续派 todoRefs：显式 args.todoRefs > 继承原子 agent todoRefs（D-5）
  let todoRefs = [];
  let refsIgnored = [];
  let refsNote = null;
  if (args && args.todoRefs !== undefined) {
    const rc = resolveTodoRefs(args.todoRefs, parentTaskId);
    if (!rc.ok) return rc.fail;
    todoRefs = rc.refs;
    refsIgnored = rc.ignored;
    if (rc.ignored.length) {
      refsNote = rc.hasSnapshot
        ? `todoRefs 中未在当前任务清单登记的 id 已忽略：${rc.ignored.join(', ')}`
        : '当前任务尚无任务清单，todoRefs 已忽略。';
    }
  } else if (Array.isArray(childFull.params && childFull.params.todoRefs)) {
    todoRefs = childFull.params.todoRefs.slice(0, MAX_TODO_REFS);
  }

  const launched = launchSubAgent({
    parentTaskId,
    userId,
    parentParams,
    parentContext: parentParams.context || {},
    userContent,
    model,
    role: roleCheck.role,
    goals,
    todoRefs,
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
    ...(roleCheck.role ? { role: roleCheck.role } : {}),
    ...(todoRefs.length ? { todoRefs } : {}),
    ...(refsIgnored.length ? { todoRefsIgnored: refsIgnored, note: refsNote } : {}),
  };
}

/**
 * collectUndeliveredParentMessages — 收集未被实时 steering 送达的父消息/留言
 * （followup 续派注入用）。parent_message 事件中剔除 parent_message_delivered
 * 回执 refs 已引用的条目：运行中已实时看到的消息续派时不再重复注入。
 */
function collectUndeliveredParentMessages(taskId) {
  const events = agentTaskStore.getAgentTaskEventsSince(taskId, 0, 1000000);
  const delivered = new Set();
  for (const e of events) {
    if (e.eventType !== 'parent_message_delivered') continue;
    const refs = e.payload && Array.isArray(e.payload.refs) ? e.payload.refs : [];
    for (const r of refs) delivered.add(Number(r));
  }
  return events
    .filter((e) => e.eventType === 'parent_message' && !delivered.has(Number(e.seq)))
    .map((e) => {
      // payload 形状双兼容：store 读取已解析为对象；字符串形状防御性保留
      try {
        const raw = typeof e.payload === 'string' ? JSON.parse(e.payload || '{}') : (e.payload || {});
        return String(raw.message || '').slice(0, 500);
      } catch { return ''; }
    })
    .filter(Boolean);
}

/**
 * enqueueSteeringForChild — 把父消息/用户留言推入运行中子 agent 的 M4 插队
 * 队列（实时送达：下一个模型请求边界注入）。best-effort：失败由调用方退化为
 * followup 注入语义，不阻塞消息落事件流。
 * @returns {boolean} 是否成功入队（=实时通道生效）
 */
function enqueueSteeringForChild(childTaskId, text, parentMessageSeq, prefix) {
  try {
    const agentResilience = require('../helpers/agent-resilience');
    const enq = agentResilience.enqueueUserInput(
      childTaskId,
      `${prefix}${text}`,
      { preformatted: true, parentMessageSeq },
    );
    return Boolean(enq && enq.ok);
  } catch {
    return false;
  }
}

/**
 * queueUserMessage — 用户侧留言等价（BLOCK-65 P1-a）：agent 专属窗（用户操作）
 * 对运行中子 agent 留言。语义与 send_message 工具单源（持久化 parent_message
 * 事件 + 实时 steering 双通道，delivered refs 去重）；差异仅在归属校验——
 * 工具版要求调用方是父 loop ctx，本函数面向 HTTP 用户态（子任务真实存在即可）。
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
  const seq = nextEventSeq(childTaskId);
  try {
    agentTaskStore.appendAgentTaskEvent(
      childTaskId, seq, 'parent_message',
      { message: text, from: 'user_window', at: new Date().toISOString() },
    );
  } catch (e) {
    return { ok: false, error: 'queue_failed', message: '留言入队失败: ' + (e && e.message ? e.message : String(e)) };
  }
  const steered = enqueueSteeringForChild(childTaskId, text, seq, '【用户留言】');
  return {
    ok: true,
    queued: true,
    ...(steered ? { deliveredVia: 'steering' } : {}),
    note: steered
      ? '留言已实时送达：子 agent 将在下一个模型请求边界看到（前缀「用户留言」）；若其终态前未消费，仍随「继续派」续派注入。'
      : '留言已入队（子 agent 事件流可见）；将在「继续派」续派该子 agent 时作为上下文注入。',
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

  const queued = collectUndeliveredParentMessages(child.taskId);

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

  // BLOCK-93 P1 — 用户侧续派同样继承原子 agent 角色（无显式覆盖入参）
  const roleCheck = agentRoles.resolveRoleOrError((child.params && child.params.role) || '');
  if (!roleCheck.ok) return { ok: false, error: 'invalid_arguments', message: roleCheck.fail.message };

  // 加映 3 — 用户侧续派同样继承原子 agent goals
  const goals = Array.isArray(child.params && child.params.goals)
    ? child.params.goals.slice(0, MAX_GOALS)
    : [];

  const launched = launchSubAgent({
    parentTaskId,
    userId,
    parentParams,
    parentContext: parentParams.context || {},
    userContent,
    model,
    role: roleCheck.role,
    goals,
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
    ...(roleCheck.role ? { role: roleCheck.role } : {}),
  };
}

/**
 * list_agents — 列出当前任务派生的全部子 agent（含终态）。
 */
async function list_agents(args, ctx) {
  const parentTaskId = ctx && ctx.taskId;
  if (!parentTaskId) return fail('no_parent', 'list_agents 只能在 agent 会话循环内调用。');
  const children = agentTaskStore.listChildAgentTasks(parentTaskId);
  // BLOCK-163 W3 P2（ORC-4）— 编排查询门面恢复投影（additive；既有字段零变化）
  const { summarizeChildAgents } = require('../../shared-backend/orchestration-query');
  const recovery = summarizeChildAgents(children);
  return {
    ok: true,
    recovery,
    agents: children.map((t) => ({
      agentId: t.taskId,
      status: t.status,
      agentStatus: t.agentStatus,
      task: String(t.params && t.params.messages && t.params.messages[0] && t.params.messages[0].content || '').slice(0, 120),
      // BLOCK-93 P1 — 角色透出（未指定角色的历史任务不带此字段）
      ...(t.params && t.params.role ? { role: t.params.role } : {}),
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
    // 父 loop 被取消时立即让出，不空等；BLOCK-171 CP-1 — tool-call 级
    // 精确取消（tool-cancel 路由经注册表 abort signal）同效。
    if ((typeof ctx.isCancelled === 'function' && ctx.isCancelled())
      || (ctx.toolCancelSignal && ctx.toolCancelSignal.aborted)) {
      return { ok: false, error: 'cancelled', agentId, status: task.status, message: '父任务已请求取消。' };
    }
    // ORC-3 — 事件驱动等待：终态 emit 即醒；WAIT_POLL_INTERVAL_MS 片为兜底
    // 轮询（事件丢失/外部终态自愈）。先订阅后睡眠，无竞窗。
    const remaining = timeoutMs - (Date.now() - startedAt);
    await new Promise((resolve) => {
      const slice = Math.min(Math.max(WAIT_POLL_INTERVAL_MS, 2000), Math.max(remaining, 1));
      const timer = setTimeout(() => {
        childTerminalBus.off('terminal', onTerminal);
        resolve(false);
      }, slice);
      const onTerminal = (id) => {
        if (String(id) !== agentId) return;
        clearTimeout(timer);
        childTerminalBus.off('terminal', onTerminal);
        resolve(true);
      };
      childTerminalBus.on('terminal', onTerminal);
    });
  }
}

async function buildTerminalSummary(task) {
  const base = {
    task: String(task.params && task.params.messages && task.params.messages[0] && task.params.messages[0].content || '').slice(0, 120),
    // BLOCK-93 P1 — 角色随摘要回父（父上下文可感知子 agent 专职面）
    ...(task.params && task.params.role ? { role: task.params.role } : {}),
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
  // BLOCK-173 CP-8 — 配置解析器导出（契约测试直测；非工具面）
  resolveSpawnConcurrencyLimit,
  resolveSpawnMaxDepth,
  spawn_agent,
  interrupt_agent,
  send_message,
  followup_task,
  list_agents,
  wait_agent,
  childTerminalBus,
  notifyChildTerminal,
  // BLOCK-65 P1-a：用户侧（HTTP）等价——agent 专属窗留言/续派，语义与工具版单源
  queueUserMessage,
  launchUserFollowup,
  // 测试钩子（不进入 registry）
  __test: {
    clampWaitTimeoutMs,
    truncateToTokenBudget,
    resolvePresetByModel,
    collectUndeliveredParentMessages,
    enqueueSteeringForChild,
    normalizeGoals,
    normalizeTodoRefs,
    latestTodoIds,
    resolveTodoRefs,
  },
};
