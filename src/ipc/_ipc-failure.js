'use strict';

/**
 * src/ipc/_ipc-failure.js — L2-3（蓝图 L-20）：IPC 失败形状单源。
 *
 * 现状三套形状并存：plugin.js 裸 `[]`/`{}`（无 ok:false 无 code）、_ipc-trust.js
 * `{ok:false,error,reason}`、gen-ui.js `{ok:false,code,message,retryable}`。
 * 新形状统一为 `{ ok:false, code, message, retryable }`；已有消费方按形状容错读取
 * （数组/对象形状的降级默认保留，但附带 failure 字段使失败可见、可断言）。
 */

/**
 * 构造标准 IPC 失败信封。
 * @param {string} code 封闭原因码（reason-code 词表域）
 * @param {string} message 人类可读描述
 * @param {{retryable?: boolean, details?: unknown, degraded?: unknown}} [options]
 *   degraded：形状兼容的降级默认值（如 [] / {plugins:{}}），使旧消费方继续可用、
 *   新消费方可检 failure 与 degraded 区分「真空」与「失败降级」。
 */
function ipcFailure(code, message, options = {}) {
  const envelope = {
    ok: false,
    code,
    message: String(message || code),
    retryable: options.retryable === true,
  };
  if (options.details !== undefined) envelope.details = options.details;
  if (options.degraded !== undefined) envelope.degraded = options.degraded;
  return envelope;
}

module.exports = { ipcFailure };
