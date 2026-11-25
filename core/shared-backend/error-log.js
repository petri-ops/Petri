/**
 * Petri shared backend — Error Log
 *
 * Append-only JSONL error log shared by all backend roles. Replaces the
 * previous petri-server/helpers/error-log.js. No external dependencies.
 *
 * BLOCK-520 P0（OB-004/007）：
 *  - 写盘失败不再静默吞（getLastWriteError 可查 + stderr 留痕）
 *  - dedupe：同源同消息在窗口内只落一条，抑制数可查
 *  - installConsoleErrorBridge：console.error 全量桥接落盘，保留原 stderr 行为
 *  - installProcessErrorHandlers：unhandledRejection/uncaughtException 必触 error-log（E-019）
 */

const fsPromises = require('fs').promises;
const path = require('path');

// BLOCK-102 P1 — the /var/log default is unwritable on Windows/macOS desktop
// (and the append failure was itself swallowed), so the dedicated error
// surface was silently dead. Default to the data root instead.
const errorLogFile = process.env.PETRI_ERROR_LOG_FILE
  || path.join(process.env.PETRI_LOCAL_DATA_DIR || process.cwd(), 'petri-errors.log');

const DEDUPE_MS = Number.isFinite(Number(process.env.PETRI_ERROR_DEDUPE_MS))
  ? Number(process.env.PETRI_ERROR_DEDUPE_MS)
  : 5000;

// 加载期捕获原始 console.error：logError 自身回声走它，永远不会被后续安装的
// console.error 桥接二次记账（避免一次错误写两条/递归）。
const rawConsoleError = console.error.bind(console);

const recent = new Map(); // key(source|message) -> { at, count }
const stats = { entries: 0, suppressed: 0 };
let lastWriteError = null;
let consoleBridgeDispose = null;
let processHandlersDispose = null;

function normalizeError(err) {
  if (err && typeof err === 'object') {
    return {
      message: err.message || String(err),
      stack: err.stack,
    };
  }
  return {
    message: String(err),
    stack: undefined,
  };
}

function stringifyArg(arg) {
  if (arg instanceof Error) return arg.message;
  if (typeof arg === 'string') return arg;
  if (arg && typeof arg === 'object') {
    try {
      return JSON.stringify(arg);
    } catch (e) {
      return String(arg) + ' (unserializable: ' + e.message + ')';
    }
  }
  return String(arg);
}

function keepEntry(key, now) {
  const prev = recent.get(key);
  if (prev && now - prev.at < DEDUPE_MS) {
    prev.count += 1;
    stats.suppressed += 1;
    return false;
  }
  recent.set(key, { at: now, count: 1 });
  stats.entries += 1;
  // 有界清理：过期键随手剪除，避免长跑进程 Map 无界增长。
  if (recent.size > 500) {
    for (const [k, v] of recent) {
      if (now - v.at >= DEDUPE_MS) recent.delete(k);
    }
  }
  return true;
}

function reportWriteFailure(writeErr, entry) {
  lastWriteError = {
    file: errorLogFile,
    error: writeErr && writeErr.message ? writeErr.message : String(writeErr),
    entry,
  };
  rawConsoleError('[error-log] write failed for ' + errorLogFile + ': ' + lastWriteError.error);
}

function logError(source, err, meta = {}) {
  const normalized = normalizeError(err);
  // dedupe 身份不含 stack：同一错误在不同调用点的 stack 差异不应绕过收敛。
  const key = source + '|' + normalized.message;
  if (!keepEntry(key, Date.now())) return { deduped: true };

  const entry = {
    time: new Date().toISOString(),
    source,
    message: normalized.message,
    stack: normalized.stack,
    ...meta,
  };

  fsPromises.appendFile(errorLogFile, JSON.stringify(entry) + '\n')
    .catch((writeErr) => reportWriteFailure(writeErr, entry));

  // 自身回声：console.error 来源由桥接器负责原样输出，此处不重复打印。
  if (source !== 'console.error') rawConsoleError('[' + source + ']', entry.message);
  return { deduped: false, entry };
}

async function readRecentErrors(limit = 200) {
  const content = await fsPromises.readFile(errorLogFile, 'utf-8').catch(() => '');
  return content
    .split('\n')
    .filter((line) => line.trim())
    .slice(-limit)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

/**
 * OB-004：把 console.error 全量桥接到 error-log，同时保留原 stderr 行为。
 * 幂等；返回 restore 函数（便于测试与将来热卸载）。
 * 注意：server.js 端口守卫路径不得安装（需保持 dataDir 零文件副作用契约）。
 */
function installConsoleErrorBridge() {
  if (consoleBridgeDispose) return consoleBridgeDispose;
  const original = console.error;
  const bridge = function bridgedConsoleError(...args) {
    logError('console.error', args.map(stringifyArg).join(' '));
    return original.apply(this, args);
  };
  // 标记桥接函数本体，restore 时只摘自己，不误伤后来其它宿主的包装。
  Object.defineProperty(bridge, '__petriBridge', { value: true });
  console.error = bridge;
  consoleBridgeDispose = function restoreConsoleError() {
    if (console.error === bridge) console.error = original;
    consoleBridgeDispose = null;
  };
  return consoleBridgeDispose;
}

/**
 * OB-007：统一注册进程级错误处理器，必触 error-log（E-019）。
 * uncaughtException 默认记录后 exit(1)（L3-5 受控重启语义）；测试可传
 * exitOnFatal:false 避免退出。返回 dispose 摘除监听器。
 */
function installProcessErrorHandlers({ exitOnFatal = true } = {}) {
  if (processHandlersDispose) return processHandlersDispose;
  const onRejection = (reason) => logError('unhandledRejection', reason);
  const onException = (err) => {
    logError('uncaughtException', err);
    if (exitOnFatal) {
      process.exit(1);
    }
  };
  process.on('unhandledRejection', onRejection);
  process.on('uncaughtException', onException);
  processHandlersDispose = function disposeProcessHandlers() {
    process.off('unhandledRejection', onRejection);
    process.off('uncaughtException', onException);
    processHandlersDispose = null;
  };
  return processHandlersDispose;
}

// 测试/诊断钩子：无需重启进程即可观察与归零 dedupe/写盘状态。
function getDedupeStats() {
  return { ...stats, windowMs: DEDUPE_MS };
}
function getLastWriteError() {
  return lastWriteError;
}
function resetErrorLogState() {
  recent.clear();
  stats.entries = 0;
  stats.suppressed = 0;
  lastWriteError = null;
}

module.exports = {
  errorLogFile,
  logError,
  readRecentErrors,
  installConsoleErrorBridge,
  installProcessErrorHandlers,
  getDedupeStats,
  getLastWriteError,
  resetErrorLogState,
};
