/**
 * QODER-L5 P1 — utility-process 插件宿主契约层（2026-11-23）。
 *
 * 只定义 manifest schema + host API 消息白名单，默认拒绝（无声明=不装载、不启动进程）。
 * 不接 Electron、不改 scheme/CSP/sandbox（运行态必碰红线，需用户裁决后才可动）。
 * 零新依赖；本模块产出的是契约判定，不是执行器。
 */
'use strict';

const ALLOWED_HOST_TYPES = new Set(['utility-process']);
const ALLOWED_PERMISSIONS = new Set(['workspace.read', 'workspace.write', 'network.loopback']);
const SAFE_ENTRY_RE = /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/;
const MESSAGE_NAME_RE = /^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/;

/**
 * 评估宿主声明；默认拒绝。返回 {ok, loadable, errors}。
 * @param {{id?:string, host?:object}} manifest
 */
function evaluateHostManifest(manifest = {}) {
  const host = manifest.host;
  if (!host || typeof host !== 'object') {
    return { ok: false, loadable: false, error: 'no_host_declaration', errors: ['no_host_declaration'] };
  }
  const errors = [];
  const type = String(host.type || '');
  if (!ALLOWED_HOST_TYPES.has(type)) errors.push(`unsupported_host_type:${type}`);
  const entry = String(host.entry || '');
  if (!SAFE_ENTRY_RE.test(entry) || entry.includes('..')) errors.push(`unsafe_entry:${entry}`);
  const permissions = Array.isArray(host.permissions) ? host.permissions : [];
  for (const permission of permissions) {
    if (!ALLOWED_PERMISSIONS.has(String(permission))) errors.push(`unknown_permission:${permission}`);
  }
  const messages = host.messages && typeof host.messages === 'object' ? host.messages : {};
  for (const direction of ['inbound', 'outbound']) {
    const names = Array.isArray(messages[direction]) ? messages[direction] : [];
    for (const name of names) {
      if (!MESSAGE_NAME_RE.test(String(name)) || String(name) === '*') errors.push(`invalid_message:${direction}:${name}`);
    }
  }
  return {
    ok: errors.length === 0,
    loadable: errors.length === 0,
    ...(errors.length === 0 ? { manifest: {
      id: String(manifest.id || ''), type, entry, permissions, messages,
    } } : { errors }),
  };
}

module.exports = { ALLOWED_HOST_TYPES, ALLOWED_PERMISSIONS, evaluateHostManifest };
