'use strict';

/**
 * stream-stall-watchdog.js — BLOCK-338 流式 stall 看门狗（纯函数，零依赖）。
 *
 * 解决的问题：所有提供者只有 http socket idle timeout（deepseek `timeout: 90000`），而
 * socket idle 会被**任意字节**重置——上游持续发 SSE 心跳（`: keep-alive`）或空 chunk 时
 * 永不触发，于是「有连接、无 token」的请求可以无限挂住（实测 150s 零 token 零报错）。
 * 本看门狗按「多久没收到**有效 token**」判死，心跳不续命。
 *
 * 契约：
 *   - 续命集合封闭：只有 content_delta（且内容非空）/ tool_call_delta / thinking_delta 续命；
 *     心跳、空 chunk、ping、其它事件一律不续命。
 *   - 两段计时：首 token（创建起算）→ 首 token 到达后转 idle 计时（每次续命重置）。
 *   - 触发一次即止；stop() 之后不再回调；判死后迟到 delta 不复活。
 *   - 阈值保守（45s / 60s），env 可调但有下限（1s），非法值回落默认——不可关到无穷。
 */

const RENEWAL_EVENT_TYPES = Object.freeze(['content_delta', 'tool_call_delta', 'thinking_delta']);
const DEFAULT_FIRST_TOKEN_MS = 45_000;
const DEFAULT_IDLE_TOKEN_MS = 60_000;
const MIN_THRESHOLD_MS = 1_000;

function readThreshold(raw, fallback) {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < MIN_THRESHOLD_MS) return fallback;
  return Math.floor(value);
}

/** env → { firstTokenMs, idleTokenMs }（非法/过低值回落默认）。 */
function resolveStallThresholds(env = process.env) {
  return {
    firstTokenMs: readThreshold(env && env.PETRI_STREAM_STALL_FIRST_MS, DEFAULT_FIRST_TOKEN_MS),
    idleTokenMs: readThreshold(env && env.PETRI_STREAM_STALL_IDLE_MS, DEFAULT_IDLE_TOKEN_MS),
  };
}

/** 事件是否算「有效 token」——空 content_delta 不算（空 chunk 不得续命）。 */
function isRenewalEvent(event) {
  if (!event || typeof event.type !== 'string') return false;
  if (!RENEWAL_EVENT_TYPES.includes(event.type)) return false;
  if (event.type === 'content_delta') {
    return typeof event.content === 'string' ? event.content.length > 0 : Boolean(event.content);
  }
  return true;
}

/**
 * 创建看门狗。onStall 收到 `{ phase: 'first_token'|'idle', elapsedMs }`。
 * now/setTimer/clearTimer 可注入（测试用可控时钟）。
 */
function createStreamStallWatchdog({
  firstTokenMs,
  idleTokenMs,
  now = Date.now,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  onStall = () => {},
} = {}) {
  const firstLimit = Number.isFinite(firstTokenMs) ? firstTokenMs : DEFAULT_FIRST_TOKEN_MS;
  const idleLimit = Number.isFinite(idleTokenMs) ? idleTokenMs : DEFAULT_IDLE_TOKEN_MS;

  let stopped = false;
  let fired = false;
  let sawFirstToken = false;
  let phase = 'first_token';
  let lastActivityAt = now();
  let timer = null;

  const clearTimerHandle = () => {
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
  };
  const fire = () => {
    if (stopped || fired) return;
    fired = true;
    clearTimerHandle();
    onStall({ phase, elapsedMs: Math.max(0, now() - lastActivityAt) });
  };
  const arm = (ms) => {
    clearTimerHandle();
    timer = setTimer(fire, ms);
  };

  arm(firstLimit);

  return {
    observe(event) {
      if (stopped || fired) return;
      if (!isRenewalEvent(event)) return;
      if (!sawFirstToken) {
        sawFirstToken = true;
        phase = 'idle';
      }
      lastActivityAt = now();
      arm(idleLimit);
    },
    stop() {
      stopped = true;
      clearTimerHandle();
    },
    info() {
      return { stopped, fired, sawFirstToken, phase };
    },
  };
}

module.exports = {
  RENEWAL_EVENT_TYPES,
  DEFAULT_FIRST_TOKEN_MS,
  DEFAULT_IDLE_TOKEN_MS,
  MIN_THRESHOLD_MS,
  isRenewalEvent,
  resolveStallThresholds,
  createStreamStallWatchdog,
};
