// ============================================================
// BLOCK-457 P3 — 后端所有权探活与决策（单一所有权的身份判据层）。
//
// 职责：main 实例启动时判断「:3001 上已有的进程是不是我们自己的后端」，
// 决定 attach（复用 BLOCK-100 attach 桩，不 spawn）还是 spawn。
// 判据 = /api/health 的实例身份三字段（instanceId/pid/dataDir，由
// core/petri-server/routes/index.js Health 提供）；dataDir 同源才允许
// attach——跨 dataDir 认领即脑裂（BLOCK-128 家族红线）。
//
// 缺陷史：BLOCK-414（2026-11-11）探到「3001 是自家后端」后只复用端口号、
// 仍 spawn 第二进程 → EADDRINUSE 30s 崩溃循环（2026-11-17 实机 749 boot）。
// 本模块是该意图的最终实现：复用的是**进程**，不是端口号。
// ============================================================

/**
 * 探测 host:port 上的 petri-server 身份。
 * @returns {Promise<null | {petri: boolean, dataDir: string|null, instanceId: string|null, pid: number|null}>}
 *   null = 不可达 / 非 petri（health 形状不符）。
 */
async function probeBackendIdentity(port, timeoutMs = 2500) {
  try {
    const resp = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!resp.ok) return null;
    const body = await resp.json().catch(() => null);
    if (!body || body.status !== 'ok') return null;
    // petri 形状判据：db_ok（BLOCK-414 原判据）或 instanceId（BLOCK-457 新字段）
    // ——两者任一在场即视为 petri-server；纯第三方服务返回的 JSON 不含这些。
    const isPetri = body.db_ok !== undefined || Boolean(body.instanceId);
    if (!isPetri) return null;
    return {
      petri: true,
      dataDir: typeof body.dataDir === 'string' ? body.dataDir : null,
      instanceId: typeof body.instanceId === 'string' ? body.instanceId : null,
      pid: Number.isInteger(body.pid) ? body.pid : null,
    };
  } catch {
    return null;
  }
}

/**
 * 所有权决策表（纯函数，可测）。
 * @returns {'attach' | 'spawn'}
 *   attach：在场者带 dataDir 且与本实例完全同源。
 *   spawn：其余一切（异源 / 旧版缺字段 / ownDataDir 未设 / 不可达）——
 *   宁可 spawn 自己的后端，绝不带着存疑身份认领别人的进程。
 */
function decideBackendOwnership({ identity, ownDataDir }) {
  if (!identity || !identity.petri) return 'spawn';
  if (!ownDataDir) return 'spawn';
  if (identity.dataDir && identity.dataDir === ownDataDir) return 'attach';
  return 'spawn';
}

module.exports = { probeBackendIdentity, decideBackendOwnership };
