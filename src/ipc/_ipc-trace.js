'use strict';

/**
 * BLOCK-520 P1（OB-002）全局 IPC trace 包装。
 *
 * 在 main.js 最早处（信任门之后、任何 ipcMain.handle 注册之前）装一次补丁：此后
 * 每条 IPC 都自动按 rid 记录时间轴（invoke→handler→完成）。rid 为可选参数——
 * preload 侧在 payload 末尾附 `__petriRid`，旧调用方不传也不影响 handler 语义
 * （包装器只摘走 rid 字段，不改变其余参数形状与顺序）。
 *
 * 与 _ipc-trust.js 同范式：Symbol 标记幂等，避免叠加两次包装。
 */

const TRACE_MARK = Symbol.for('petri.ipcTrace');

function installGlobalIpcTrace(ipcMain, { trace, metrics } = {}) {
  if (!ipcMain || ipcMain[TRACE_MARK]) return ipcMain;
  // 走 core-utils resolveCore（dev/resourcesPath 双态），不用静态相对 core require
  // —— block353 打包契约：主图禁静态 core 相对路径（C-48 根因类）。
  const { resolveCore } = require('../main/core-utils');
  const {
    newRid,
    traceIpc,
  } = trace || require(resolveCore('shared-backend', 'ipc-trace.js'));
  const { recordIpc } = metrics || require(resolveCore('shared-backend', 'metrics.js'));

  const originalHandle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = function tracedHandle(channel, handler) {
    return originalHandle(channel, async (event, ...args) => {
      const last = args[args.length - 1];
      const hasRid = last && typeof last === 'object' && typeof last.__petriRid === 'string';
      const rid = hasRid ? last.__petriRid : newRid();
      const callArgs = hasRid ? args.slice(0, -1) : args;
      traceIpc({ rid, channel: String(channel), phase: 'handler', at: event && event.senderId ? `sender:${event.senderId}` : undefined });
      const started = process.hrtime.bigint();
      let ok = true;
      try {
        const result = await handler(event, ...callArgs);
        traceIpc({ rid, channel: String(channel), phase: 'done', ok: true });
        return result;
      } catch (error) {
        ok = false;
        traceIpc({ rid, channel: String(channel), phase: 'done', ok: false, message: error && error.message });
        throw error;
      } finally {
        recordIpc({ channel: String(channel), durationMs: Number(process.hrtime.bigint() - started) / 1e6, ok });
      }
    });
  };
  Object.defineProperty(ipcMain, TRACE_MARK, { value: true, enumerable: false });
  return ipcMain;
}

module.exports = { installGlobalIpcTrace };
