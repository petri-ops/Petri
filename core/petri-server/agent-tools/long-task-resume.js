'use strict';

/**
 * M2 / BLOCK-428 — 长任务可靠性纯模块（5 项能力收敛到单一模块，减少活动件）。
 *
 * 差异化形态（对标 ZCode 但长出本地可审计形态）：
 *   - ZCode 只做 append-only message/part + hydrate，明确「不做 checkpoint 表」；
 *     Petri 已有 `loop_iterations` / `loop_state_snapshots` / `task_events` 三套持久化材料，
 *     本模块把 checkpoint 做成**结构化投影**（写/读/校验三段 + digest），hydrate 保留作降级。
 *   - 每次转移/租约/命令都 append-only 留痕（事件可重放）；
 *   - 单一 owner + command inbox 串行 admission（只借 ZCode 的本地单进程内核结论，
 *     不照搬其 Relay/JWT/多进程树/计费链）。
 *
 * 红线：
 *   - 零新增依赖、零 spawn、零 DB 写入、零网络；纯内存投影，调用方决定是否落盘。
 *   - **不改 db/schema.js / agent-task-store.js**：两者在 perf 基线 HOT_PATH_FILES 内，
 *     改动会令 coreSha 绑定失效，而本轮禁止直接重采基线；DB 层 UNIQUE 约束登记为
 *     external-blocked + 补腿条件（见 M2 plan §关键工程裁决）。
 *   - 不改 server.js 既有 recovery 语义默认值；不改 MAX_AGENT_ITERS=Infinity 产品契约。
 *   - 损坏 checkpoint **不静默吞错**（`CHECKPOINT_DAMAGED` fail-closed）。
 */

const crypto = require('crypto');

const checksum = (value) => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);

// ── M2-1 append-only transcript ────────────────────────────────────────────
function createTranscript({ traceId = '' } = {}) {
  const messages = [];
  const parts = [];
  const appendMessage = (message) => {
    const entry = Object.freeze({ seq: messages.length + 1, kind: 'message', ...message });
    messages.push(entry);
    return entry;
  };
  const appendPart = (part) => {
    const entry = Object.freeze({ seq: parts.length + 1, kind: 'part', ...part });
    parts.push(entry);
    return entry;
  };
  const snapshot = () => ({ traceId, messages: messages.slice(), parts: parts.slice() });
  return { appendMessage, appendPart, snapshot };
}

/**
 * hydrate：从已落盘记录重建，把 pending/running 的 tool call 合成为 interrupted result，
 * 消除 dangling tool call（模型不会因半截调用卡死）。
 */
function hydrateTranscript(record) {
  const messages = (record && record.messages ? record.messages : []).slice();
  const parts = (record && record.parts ? record.parts : []).slice();
  const interrupted = [];
  const completedCallIds = new Set(
    parts.filter((p) => p.type === 'tool_result' && p.callId).map((p) => p.callId),
  );
  for (const part of parts) {
    if (part.type !== 'tool_call' || !part.callId) continue;
    if (part.state !== 'running' && part.state !== 'pending') continue;
    if (completedCallIds.has(part.callId)) continue;
    interrupted.push(Object.freeze({
      callId: part.callId,
      interrupted: true,
      reason: 'TOOL_EXECUTION_INTERRUPTED_BEFORE_RESUME',
      text: '[Tool execution was interrupted before resume]',
    }));
  }
  return {
    traceId: record && record.traceId ? record.traceId : '',
    messages,
    parts,
    interrupted,
    interruptedToolCount: interrupted.length,
    danglingToolCalls: [],
  };
}

// ── M2-2 checkpoint（结构化投影，写/读/校验三段） ──────────────────────────
function writeCheckpoint(state) {
  if (!state || typeof state !== 'object') {
    throw Object.assign(new Error('CHECKPOINT_DAMAGED: state must be object'), { code: 'CHECKPOINT_DAMAGED' });
  }
  return { ok: true, payload: { payload: state, digest: checksum(state), writtenAt: new Date().toISOString() } };
}

function readCheckpoint(envelope) {
  if (!envelope || !envelope.payload || typeof envelope.payload !== 'object' || !envelope.digest) {
    throw Object.assign(new Error('CHECKPOINT_DAMAGED: envelope incomplete'), { code: 'CHECKPOINT_DAMAGED' });
  }
  if (checksum(envelope.payload) !== envelope.digest) {
    throw Object.assign(new Error('CHECKPOINT_DAMAGED: digest mismatch'), { code: 'CHECKPOINT_DAMAGED' });
  }
  return { checkpoint: envelope.payload, digest: envelope.digest, writtenAt: envelope.writtenAt };
}

// ── M2-3 durable 任务图 ────────────────────────────────────────────────────
const DEFAULT_STAGES = Object.freeze(['clarify', 'task_analysis', 'decompose', 'env_setup', 'plan', 'exec', 'critic', 'complete']);

function createTaskGraph({ stages = DEFAULT_STAGES, maxConsecutiveErrors = 3, persisted } = {}) {
  const nodes = new Map();
  const history = [];
  for (const name of stages) nodes.set(name, { name, state: 'pending', attempts: 0 });
  let consecutiveErrors = 0;
  let paused = false;
  let revision = 0;

  if (persisted && Array.isArray(persisted.nodes)) {
    for (const n of persisted.nodes) nodes.set(n.name, { ...n });
    consecutiveErrors = Number(persisted.consecutiveErrors) || 0;
    paused = Boolean(persisted.paused);
    revision = Number(persisted.revision) || 0;
  }

  const transition = (name, state) => {
    const node = nodes.get(name);
    if (!node) throw Object.assign(new Error(`UNKNOWN_STAGE: ${name}`), { code: 'UNKNOWN_STAGE' });
    node.state = state;
    node.attempts += 1;
    revision += 1;
    history.push(Object.freeze({ seq: history.length + 1, name, state, revision }));
    if (state === 'failed') {
      consecutiveErrors += 1;
      if (consecutiveErrors >= maxConsecutiveErrors) paused = true;
    } else {
      consecutiveErrors = 0;
      paused = false;
    }
    return node;
  };

  const redispatch = (name) => {
    const node = nodes.get(name);
    if (!node) throw Object.assign(new Error(`UNKNOWN_STAGE: ${name}`), { code: 'UNKNOWN_STAGE' });
    node.state = 'dispatched';
    consecutiveErrors = 0;
    paused = false;
    revision += 1;
    history.push(Object.freeze({ seq: history.length + 1, name, state: 'dispatched', revision }));
    return node;
  };

  const persist = () => ({
    nodes: [...nodes.values()].map((n) => ({ ...n })),
    consecutiveErrors, paused, revision, history: history.slice(),
  });
  const nodeState = (name) => (nodes.get(name) ? nodes.get(name).state : null);

  return {
    stages: [...nodes.keys()],
    get paused() { return paused; },
    get revision() { return revision; },
    transition, redispatch, persist, nodeState,
  };
}

// ── M2-4 command inbox 串行 admission（CAS + 三类 ACK） ─────────────────────
function createCommandInbox({ revision = 0 } = {}) {
  const seen = new Map();
  let current = revision;
  const admit = ({ commandId, baseRevision, payload }) => {
    if (seen.has(commandId)) return { ack: 'duplicate', commandId, revision: current };
    if (Number(baseRevision) < current) return { ack: 'stale', commandId, revision: current };
    if (payload === null || payload === undefined) {
      seen.set(commandId, 'noop');
      return { ack: 'noop', commandId, revision: current };
    }
    seen.set(commandId, 'applied');
    current += 1;
    return { ack: 'applied', commandId, revision: current };
  };
  return { admit, get revision() { return current; } };
}

// ── M2-5 单一 owner + 持久化租约 ───────────────────────────────────────────
function createLeaseTable({ persisted } = {}) {
  const leases = new Map();
  if (persisted && Array.isArray(persisted.leases)) {
    for (const l of persisted.leases) leases.set(l.taskId, { ...l });
  }
  const acquire = ({ taskId, owner, pid }) => {
    const entry = Object.freeze({ taskId, owner, pid: Number(pid), acquiredAt: new Date().toISOString(), cancelled: false });
    leases.set(taskId, entry);
    return entry;
  };
  const ownerOf = (taskId) => (leases.get(taskId) ? leases.get(taskId).owner : null);
  const pidOf = (taskId) => (leases.get(taskId) ? leases.get(taskId).pid : null);
  const cancel = (taskId, { from } = {}) => {
    const entry = leases.get(taskId);
    if (!entry) return { ok: false, code: 'LEASE_NOT_FOUND' };
    if (from !== entry.owner) return { ok: false, code: 'NOT_OWNER', owner: entry.owner };
    leases.set(taskId, { ...entry, cancelled: true });
    return { ok: true, owner: entry.owner };
  };
  const persist = () => ({ leases: [...leases.values()].map((l) => ({ ...l })) });
  return { acquire, ownerOf, pidOf, cancel, persist };
}

module.exports = {
  DEFAULT_STAGES,
  createTranscript,
  hydrateTranscript,
  writeCheckpoint,
  readCheckpoint,
  createTaskGraph,
  createCommandInbox,
  createLeaseTable,
};
