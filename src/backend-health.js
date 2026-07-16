// M1-1 后端就绪感知层
// 聚合 runtime:status + health 探测 + 子进程存活，给渲染进程一个"是否就绪"的统一答案。
//
// 接口：
//   getBackendStatus({ runtimeStatus, procs, probeHealth?, probePy? })
//     → { rRuntime, pyRuntime, rServerUp, pyServerUp, plumberUp, isReady, downReason }
//
// 生产用：probeHealth/probePy 默认走 fetch('http://localhost:PORT/api/health')，1.5s 超时。
// 测试用：注入 probeHealth/probePy mock 函数。
//
// isReady 最低要求 = rServerUp（r-server 是硬底座，py/plumber 按需）。

const R_SERVER_HEALTH = `http://localhost:${process.env.R_SERVER_PORT || 3001}/api/health`;
const PY_SERVER_HEALTH = `http://localhost:${process.env.PY_SERVER_PORT || 3004}/api/health`;
const PLUMBER_HEALTH = `http://localhost:${process.env.PLUMBER_PORT || 8787}/health`;

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

/**
 * 聚合后端状态。
 * @param {object} opts
 * @param {object} opts.runtimeStatus - getRuntimeStatus() 返回的 { r:{installed}, python:{installed} }
 * @param {object} opts.procs - { rServer, pyServer, plumber }，每个为 spawn 返回的 ChildProcess 或 null
 * @param {function?:} opts.probeHealth - 可注入的 r-server health 探测（测试用）
 * @param {function?:} opts.probePy - 可注入的 py-server health 探测（测试用）
 * @param {function?:} opts.probePlumber - 可注入的 plumber 探测（测试用）
 */
async function getBackendStatus({ runtimeStatus, procs, probeHealth, probePy, probePlumber }) {
  const rRuntime = !!runtimeStatus?.r?.installed;
  const pyRuntime = !!runtimeStatus?.python?.installed;

  const rServerAlive = isProcAlive(procs?.rServer);
  const pyServerAlive = isProcAlive(procs?.pyServer);
  const plumberAlive = isProcAlive(procs?.plumber);

  const probeH = probeHealth || (() => probeUrl(R_SERVER_HEALTH));
  const probeP = probePy || (() => probeUrl(PY_SERVER_HEALTH));
  const probePl = probePlumber || (() => probeUrl(PLUMBER_HEALTH));

  // 只在进程存活时才探测（进程已死则直接 false，省一次网络往返）
  const rServerUp = rRuntime && rServerAlive && (await probeH());
  const pyServerUp = pyRuntime && pyServerAlive && (await probeP());
  const plumberUp = plumberAlive && (await probePl());

  // isReady 最低要求 = r-server 就绪
  const isReady = !!rServerUp;

  let downReason = null;
  if (!rRuntime) {
    downReason = 'R 运行时未安装，请从插件商店安装';
  } else if (!rServerAlive) {
    downReason = 'R 后端进程未运行，正在重启…';
  } else if (!rServerUp) {
    downReason = 'R 后端未就绪，点此诊断';
  }

  return { rRuntime, pyRuntime, rServerUp, pyServerUp, plumberUp, isReady, downReason };
}

module.exports = { getBackendStatus, probeUrl };
