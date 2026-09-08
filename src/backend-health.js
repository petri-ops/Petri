// M1-1 后端就绪感知层
// 聚合 runtime:status + health 探测 + 子进程存活，给渲染进程一个"是否就绪"的统一答案。
//
// 接口：
//   getBackendStatus({ runtimeStatus, procs, probeHealth? })
//     → { rRuntime, pyRuntime, rServerUp, isReady, downReason }
//
// 生产用：probeHealth 默认走 fetch('http://localhost:PORT/api/health')，1.5s 超时。
// 测试用：注入 probeHealth mock 函数。
//
// isReady 最低要求 = rServerUp（biof3-server 是硬底座）。
// BLOCK-30 P1: pyServerUp 随 py-server HTTP 服务摘除；pyRuntime 保留
// （Python 工具仍由 biof3-server 经内嵌 Python 运行时执行）。
// BLOCK-51 P3: plumberUp 随 plumber 空壳摘除（replot.R 从未存在，
// plumber 进程从未启动，恒为 false 的死指标）。
// BLOCK-66 P1: isReady 与 R 运行时解绑 —— biof3-server 纯 Node 无 R 依赖，
// R 缺失照常启动（isReady 只表达「后端进程可用」）；rRuntime/pyRuntime
// 独立表达运行时就绪度，R 缺失的诚实失败在 tools-executor runtime preflight。

// A-009: pull every backend port from env-coordinator instead of each
// file duplicating the per-port fallback literal here. The Electron
// main process sets R_SERVER_PORT
// before this module is required, so the helper defaults
// are only hit in the standalone fallback path.
const { getBackendPort } = require('./main/env-coordinator');

const R_SERVER_HEALTH = `http://localhost:${getBackendPort('r')}/api/health`;

/**
 * 探测一个 URL 是否可达且返回 2xx。1.5s 超时，失败返回 false（不抛）。
 */
async function probeUrl(url, timeoutMs = 1500) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    return r.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

/**
 * 判断子进程是否存活。proc 可能为 null（未 spawn）或 { killed: bool }。
 */
function isProcAlive(proc) {
  return !!proc && !proc.killed;
}

function mergeRuntimeStatusWithConfiguredHomes(runtimeStatus, env = process.env) {
  const merged = {
    ...(runtimeStatus || {}),
    r: { ...(runtimeStatus?.r || {}) },
    python: { ...(runtimeStatus?.python || {}) },
  };
  // In development, main.js may resolve a valid system runtime even though it
  // is not present in the plugin installation ledger. The configured runtime
  // home is authoritative for availability and must not be collapsed into
  // "not installed" merely because the child server stopped.
  if (env.BIOF3_R_HOME) merged.r.installed = true;
  if (env.BIOF3_PY_HOME) merged.python.installed = true;
  return merged;
}

/**
 * 聚合后端状态。
 * @param {object} opts
 * @param {object} opts.runtimeStatus - getRuntimeStatus() 返回的 { r:{installed}, python:{installed} }
 * @param {object} opts.procs - { rServer }，spawn 返回的 ChildProcess 或 null
 * @param {function?:} opts.probeHealth - 可注入的 biof3-server health 探测（测试用）
 */
async function getBackendStatus({ runtimeStatus, procs, probeHealth }) {
  const rRuntime = !!runtimeStatus?.r?.installed;
  const pyRuntime = !!runtimeStatus?.python?.installed;

  const serverAlive = isProcAlive(procs?.rServer);

  const probeH = probeHealth || (() => probeUrl(R_SERVER_HEALTH));

  // 只在进程存活时才探测（进程已死则直接 false，省一次网络往返）
  const serverUp = serverAlive && (await probeH());

  // BLOCK-66 P1 — 语义拆分：isReady 表达「后端进程可用」（biof3-server 是唯一
  // 业务后端，纯 Node 不依赖 R），与 R 运行时安装状态解绑。R 缺失时应用全功能
  // 可用（R 类插件执行时由 tools-executor runtime preflight 诚实失败 + 指引），
  // 运行时就绪度由 rRuntime/pyRuntime 字段独立表达（additive，不删任何字段）。
  // rServerUp 为历史名，语义 = biof3-server up（与 serverUp 同值），保留兼容。
  const rServerUp = serverUp;
  const isReady = !!serverUp;

  let downReason = null;
  if (!serverAlive) {
    downReason = '本地分析服务未运行，正在重启…';
  } else if (!serverUp) {
    downReason = '本地分析服务未就绪，点此诊断';
  }

  return { rRuntime, pyRuntime, rServerUp, serverUp, isReady, downReason };
}

module.exports = { getBackendStatus, mergeRuntimeStatusWithConfiguredHomes, probeUrl };
