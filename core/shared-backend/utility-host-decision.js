/**
 * L5 utility-process host 决策层（2026-11-23，用户裁决放行运行态）。
 *
 * 安全边界：默认不装载；仅已安装且启用包 + 白名单入口可 fork；argv 固定、不传 MessagePort；
 * 不碰现有 pack iframe sandbox/CSP；审计不泄漏 packRoot 真值/凭据。
 * 纯函数决策层；IPC 装配层（channels/preload/main）消费本模块结果。
 * 零新依赖。
 */
'use strict';

const SAFE_ENTRY_RE = /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/;
const ALLOWED_PERMISSIONS = new Set(['workspace.read', 'workspace.write', 'network.loopback']);
const STATES = new Set(['stopped', 'starting', 'running', 'stopping']);
const TRANSITIONS = {
  stopped: { start: 'starting' },
  starting: { spawned: 'running', exit: 'stopped', stop: 'stopping' },
  running: { stop: 'stopping', exit: 'stopped' },
  stopping: { exit: 'stopped' },
};

/** fork 准入：默认拒绝。返回 {allowed, argv, messagePort:false, ...} 或 {allowed:false, error}。 */
function evaluateForkAdmission(input = {}) {
  const pack = input.pack;
  if (!pack || typeof pack !== 'object' || pack.enabled === false || !pack.packRoot) {
    return { allowed: false, error: 'pack_not_enabled' };
  }
  const host = input.manifest && input.manifest.host;
  if (!host || typeof host !== 'object' || String(host.type || '') !== 'utility-process') {
    return { allowed: false, error: 'no_host_declaration' };
  }
  const entry = String(host.entry || '');
  if (!SAFE_ENTRY_RE.test(entry) || entry.includes('..') || /^[a-z]+:\/\//i.test(entry)) {
    return { allowed: false, error: 'unsafe_entry' };
  }
  const permissions = Array.isArray(host.permissions) ? host.permissions : [];
  for (const permission of permissions) {
    if (!ALLOWED_PERMISSIONS.has(String(permission))) return { allowed: false, error: 'unknown_permission' };
  }
  const messages = host.messages && typeof host.messages === 'object' ? host.messages : {};
  for (const direction of ['inbound', 'outbound']) {
    const names = Array.isArray(messages[direction]) ? messages[direction] : [];
    if (names.some((name) => !/^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/.test(String(name)))) {
      return { allowed: false, error: 'invalid_message_whitelist' };
    }
  }
  return {
    allowed: true,
    argv: [entry], // 固定 argv：无 shell、无远程 URL、无额外参数注入
    messagePort: false, // 不传 MessagePort（新机制保守起步）
    packId: typeof input.manifest.id === 'string' ? input.manifest.id.slice(0, 120) : null,
    entry,
  };
}

/** 生命周期状态机：非法跃迁返回 error，不改状态。 */
function reduceHostState(current = { status: 'stopped' }, event) {
  const status = STATES.has(current.status) ? current.status : 'stopped';
  const next = (TRANSITIONS[status] || {})[String(event || '')];
  if (!next) return { ...current, error: 'invalid_transition' };
  return { ...current, status: next, error: null };
}

/** 审计行：只记 packId/action/entry/status，不记 packRoot 真值/凭据/token。 */
function auditHostEvent(event = {}) {
  const clean = {
    at: String(event.at || '').slice(0, 40),
    packId: typeof event.packId === 'string' ? event.packId.slice(0, 120) : null,
    action: String(event.action || '').slice(0, 40),
    entry: typeof event.entry === 'string' ? event.entry.slice(0, 200) : null,
    status: typeof event.status === 'string' ? event.status.slice(0, 40) : null,
  };
  return JSON.stringify(clean);
}

module.exports = { evaluateForkAdmission, reduceHostState, auditHostEvent, STATES };
