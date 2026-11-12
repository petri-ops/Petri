'use strict';

/**
 * M1 / BLOCK-427 — 显式 Turn 状态机（对标 ZCode `TurnPhase` 之形，落成本地可审计形态）。
 *
 * 设计红线：
 *   - **不加步数硬上限**。主循环 `loop-orchestrator.js:711` 的 `MAX_AGENT_ITERS = Infinity`
 *     是「goal-terminated, not round-terminated」产品契约，本模块零改动该契约。
 *     本模块提供的是「阶段语义 + 完整资源边界」，不是轮次计数器。
 *   - **fail-closed**：非法转移抛 `INVALID_TURN_TRANSITION`，且不得改动当前态。
 *   - **事件可重放**：每次转移 append-only 写入 `{seq,from,to,at,reason}`，`snapshot()`
 *     直接供 M2 的运行时 checkpoint / hydrate 消费，不另建第二份状态真相。
 *   - **审批可追溯**：`AwaitingPermission` 是显式态，进入/离开都留痕。
 *   - **取消一等结果**：`cancel()` 返回稳定的 `turn_cancelled` 结果类型。
 *
 * 本模块是纯新增、零依赖、零副作用：不 require 主循环、不发 IPC、不写库。
 * 接线到 `loop-orchestrator.js` 属结构性重构，按蓝图归 M6-A（不提前实现）。
 */

const TURN_PHASES = Object.freeze({
  Idle: 'Idle',
  AwaitingModel: 'AwaitingModel',
  Streaming: 'Streaming',
  SchedulingTools: 'SchedulingTools',
  ExecutingTools: 'ExecutingTools',
  Aggregating: 'Aggregating',
  AwaitingPermission: 'AwaitingPermission',
  Completing: 'Completing',
  Error: 'Error',
  Cancelled: 'Cancelled',
});

const TURN_CANCELLED = 'turn_cancelled';

/** 转移表：单点真相。任何未在表内的组合都是非法转移。 */
const TRANSITIONS = Object.freeze({
  [TURN_PHASES.Idle]: Object.freeze([TURN_PHASES.AwaitingModel, TURN_PHASES.Error, TURN_PHASES.Cancelled]),
  [TURN_PHASES.AwaitingModel]: Object.freeze([TURN_PHASES.Streaming, TURN_PHASES.Completing, TURN_PHASES.Error, TURN_PHASES.Cancelled]),
  [TURN_PHASES.Streaming]: Object.freeze([TURN_PHASES.SchedulingTools, TURN_PHASES.Completing, TURN_PHASES.Aggregating, TURN_PHASES.Error, TURN_PHASES.Cancelled]),
  [TURN_PHASES.SchedulingTools]: Object.freeze([TURN_PHASES.ExecutingTools, TURN_PHASES.AwaitingPermission, TURN_PHASES.Aggregating, TURN_PHASES.Completing, TURN_PHASES.Error, TURN_PHASES.Cancelled]),
  [TURN_PHASES.AwaitingPermission]: Object.freeze([TURN_PHASES.ExecutingTools, TURN_PHASES.Aggregating, TURN_PHASES.Completing, TURN_PHASES.Error, TURN_PHASES.Cancelled]),
  [TURN_PHASES.ExecutingTools]: Object.freeze([TURN_PHASES.Aggregating, TURN_PHASES.AwaitingPermission, TURN_PHASES.Error, TURN_PHASES.Cancelled]),
  [TURN_PHASES.Aggregating]: Object.freeze([TURN_PHASES.AwaitingModel, TURN_PHASES.Completing, TURN_PHASES.Error, TURN_PHASES.Cancelled]),
  [TURN_PHASES.Completing]: Object.freeze([TURN_PHASES.Error]),
  [TURN_PHASES.Error]: Object.freeze([]),
  [TURN_PHASES.Cancelled]: Object.freeze([]),
});

const TERMINAL_PHASES = Object.freeze([
  TURN_PHASES.Completing, TURN_PHASES.Error, TURN_PHASES.Cancelled,
]);

function createTurnMachine({ shouldAbort, traceId, onTransition } = {}) {
  let phase = TURN_PHASES.Idle;
  const transitions = [];
  const abort = typeof shouldAbort === 'function' ? shouldAbort : () => false;
  const emit = typeof onTransition === 'function' ? onTransition : null;

  const record = (from, to, reason) => {
    const entry = Object.freeze({
      seq: transitions.length + 1,
      from,
      to,
      at: new Date().toISOString(),
      reason: String(reason || ''),
    });
    transitions.push(entry);
    if (emit) emit(entry);
  };

  const transition = (next, reason = '') => {
    if (!Object.prototype.hasOwnProperty.call(TRANSITIONS, next)) {
      throw Object.assign(new Error(`INVALID_TURN_TRANSITION: unknown phase "${next}"`), { code: 'INVALID_TURN_TRANSITION' });
    }
    // 转移表按「当前态 → 允许的下一态」正查；HK-01 绿轮抓真曾按目标态反查导致 4 项红。
    // 自有属性描述符取值，避免动态下标 warning（同 BLOCK-416 先例）。
    const allowed = Object.getOwnPropertyDescriptor(TRANSITIONS, phase)?.value;
    if (!allowed.includes(next)) {
      throw Object.assign(
        new Error(`INVALID_TURN_TRANSITION: ${phase} -> ${next} not in transition table`),
        { code: 'INVALID_TURN_TRANSITION', from: phase, to: next },
      );
    }
    const from = phase;
    phase = next;
    record(from, next, reason);
    return next;
  };

  const throwIfAborted = (boundary) => {
    if (abort()) {
      throw Object.assign(new Error(`TURN_ABORTED at ${boundary} boundary`), {
        code: 'TURN_ABORTED',
        boundary: String(boundary || ''),
        type: TURN_CANCELLED,
      });
    }
    return false;
  };

  const cancel = ({ reason = 'user_cancelled' } = {}) => {
    if (phase === TURN_PHASES.Cancelled) return { type: TURN_CANCELLED, phase, reason, duplicate: true };
    const from = phase;
    phase = TURN_PHASES.Cancelled;
    record(from, phase, reason);
    return { type: TURN_CANCELLED, phase, reason, duplicate: false };
  };

  const fail = (error) => {
    const from = phase;
    phase = TURN_PHASES.Error;
    record(from, phase, error && error.message ? error.message : String(error || ''));
    return { phase, error };
  };

  const snapshot = () => ({
    traceId: String(traceId || ''),
    phase,
    terminal: TERMINAL_PHASES.includes(phase),
    transitions: transitions.slice(),
  });

  return { get phase() { return phase; }, transition, throwIfAborted, cancel, fail, snapshot };
}

module.exports = {
  TURN_PHASES,
  TURN_CANCELLED,
  TERMINAL_PHASES,
  TRANSITIONS,
  createTurnMachine,
};
