/**
 * external-supervisor-controller.js — BLOCK-520 A-会话级外部监督器直达 L2。
 *
 * 唯一硬门槛=材料 §2：进程身份 + 豁免清单 + fail-safe。只有显式 `prod_user`
 * 且四项全过的实例才进动作候选；owner dev / 9223 / test-user-data / 身份不明
 * 一律豁免（宁可不重启，不可误杀）。
 *
 * 动作层（§4）：L0 观测（C 形态已做）→ L1 告警（只本地可见、不动作）→
 * L2 会话级续跑（复用现成 POST :id/resume；失败回落 DB 既有 recovery_required，
 * 不自造状态）。L3 进程级 kill/restart **永久挂账**，本模块一行都不写。
 * deps 可注入（时钟/resume/告警），测试可控、零新依赖、不碰 owner 实例。
 */

const RESERVED_PORTS = Object.freeze([9222, 9223, 3003]);
const DEV_DATA_MARKERS = Object.freeze(['dev-user-data', 'test-user-data']);
const DEV_PORT_RANGE = Object.freeze({ min: 3000, max: 3999 });

/**
 * §2 豁免判定（任一命中即短路跳过；fail-safe：身份不明保守豁免）。
 * @param {{instanceRole?:string, dataDir?:string, port?:number|string, parentChainVerified?:boolean}} input
 */
function classifyInstance(input = {}) {
  const role = typeof input.instanceRole === 'string' ? input.instanceRole.trim() : '';
  const dataDir = typeof input.dataDir === 'string' ? input.dataDir : '';
  const port = Number(input.port);

  if (!role) {
    return { exempt: true, eligible: false, role, reason: 'identity_unknown' };
  }
  if (role !== 'prod_user') {
    return { exempt: true, eligible: false, role, reason: 'role_not_prod_user' };
  }
  if (DEV_DATA_MARKERS.some((marker) => dataDir.includes(marker))) {
    return { exempt: true, eligible: false, role, reason: dataDir.includes('test-user-data') ? 'test_data_dir' : 'dev_data_dir' };
  }
  if (RESERVED_PORTS.includes(port) || (Number.isFinite(port) && port >= DEV_PORT_RANGE.min && port <= DEV_PORT_RANGE.max)) {
    return { exempt: true, eligible: false, role, reason: 'reserved_port' };
  }
  // 身份不明（无显式 prod_user 标签）—— 上面已挡；此处保留父链未验证的 fail-safe
  if (input.parentChainVerified !== true) {
    return { exempt: true, eligible: false, role, reason: 'identity_unknown' };
  }
  return { exempt: false, eligible: true, role: 'prod_user', reason: 'eligible' };
}

/**
 * §4 动作决策：L0 观测 → L1 告警 → L2 续跑 → L3 人工升级。
 * 重启风暴（窗口内 restart 次数 ≥ threshold）熔断自动重启，转 L3 人工（不动作）。
 * resume 失败回落 DB 既有 recovery_required（可逆，不自造状态、不改 loop 契约）。
 *
 * @param {{instance:object, restartsInWindow?:number, threshold?:number, taskId?:string, reasonCode?:string}} input
 * @param {{resume?:Function, alert?:Function, now?:Function}} deps
 */
async function decideAction(input = {}, deps = {}) {
  const instance = input.instance || {};
  const verdict = instance.eligible === true && instance.exempt !== true
    ? instance
    : classifyInstance(instance);
  const reasonCode = input.reasonCode || 'heartbeat_timeout';
  const base = { reasonCode, role: verdict.role || null, taskId: input.taskId || null };

  if (verdict.exempt || !verdict.eligible) {
    return { ...base, level: 'L0', outcome: 'exempt', reason: verdict.reason || 'not_eligible' };
  }
  const restarts = Number(input.restartsInWindow);
  const threshold = Number(input.threshold);
  if (Number.isFinite(restarts) && Number.isFinite(threshold) && threshold > 0 && restarts >= threshold) {
    if (typeof deps.alert === 'function') {
      try { deps.alert({ ...base, level: 'L3', reason: 'restart_storm', restarts, threshold }); } catch { /* fail-soft：告警失败不阻断主链 */ }
    }
    return { ...base, level: 'L3', outcome: 'escalated_human', reason: 'restart_storm', restarts, threshold };
  }
  // L2：复用现成 resume 端点（deps.resume 注入，生产由调用方绑 POST :id/resume）
  try {
    if (typeof deps.resume !== 'function') {
      return { ...base, level: 'L2', outcome: 'recovery_required', reason: 'resume_unavailable' };
    }
    const result = await deps.resume({ taskId: input.taskId, at: typeof deps.now === 'function' ? deps.now() : null });
    if (!result || result.ok !== true) {
      return { ...base, level: 'L2', outcome: 'recovery_required', reason: 'resume_failed' };
    }
    return { ...base, level: 'L2', outcome: 'resumed', reason: 'ok' };
  } catch (error) {
    return { ...base, level: 'L2', outcome: 'recovery_required', reason: 'resume_failed', detail: error && error.message ? error.message : 'unknown' };
  }
}

module.exports = {
  RESERVED_PORTS,
  DEV_DATA_MARKERS,
  classifyInstance,
  decideAction,
};
