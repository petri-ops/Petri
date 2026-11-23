/**
 * QODER-J6 P1 — 用户自定义 Agent 角色（2026-11-23）。
 *
 * 零新依赖；角色 directive 是 prompt 软约束（agent-roles.js:6-8），不碰 sandbox/执行器/审批。
 * 默认口径：不得覆盖内置角色 key，不得覆盖 baseRole 人设（BLOCK-339 钉死，改动需裁决）。
 * 消费端（spawn-agent-tools.renderRoleDirective）接口不变——本模块只产出合并后的 map。
 */
'use strict';

const RESERVED_KEYS = new Set(['baseRole', 'default', 'system']);
const KEY_RE = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

/** 规范化用户角色定义：非法条目丢弃并诊断，不让一条脏记录整份失败。 */
function normalizeCustomRoles(input = {}) {
  const source = input.roles && typeof input.roles === 'object' && !Array.isArray(input.roles) ? input.roles : {};
  const builtinKeys = new Set(Array.isArray(input.builtinKeys) ? input.builtinKeys : []);
  const roles = [];
  const diagnostics = [];
  for (const [key, value] of Object.entries(source)) {
    if (!KEY_RE.test(key)) { diagnostics.push(`invalid_key:${key}`); continue; }
    if (RESERVED_KEYS.has(key) || builtinKeys.has(key)) { diagnostics.push(`reserved_key:${key}`); continue; }
    if (!value || typeof value !== 'object') { diagnostics.push(`invalid_shape:${key}`); continue; }
    const label = typeof value.label === 'string' ? value.label.trim().slice(0, 80) : '';
    const directive = typeof value.directive === 'string' ? value.directive.trim().slice(0, 800) : '';
    if (!label || !directive) { diagnostics.push(`missing_label_or_directive:${key}`); continue; }
    roles.push({
      key,
      label,
      description: typeof value.description === 'string' ? value.description.trim().slice(0, 200) : '',
      directive,
      version: Number.isFinite(value.version) ? value.version : 1,
    });
  }
  return { ok: true, roles, diagnostics };
}

/** 内置 ∪ 自定义合并：自定义不得覆盖内置（内置优先），返回 map/keys 供消费端零改使用。 */
function mergeAgentRoles(builtin = [], custom = []) {
  const map = new Map();
  for (const role of Array.isArray(builtin) ? builtin : []) {
    if (role && typeof role.key === 'string') map.set(role.key, role);
  }
  for (const role of Array.isArray(custom) ? custom : []) {
    if (role && typeof role.key === 'string' && !map.has(role.key)) map.set(role.key, role);
  }
  return { map, keys: new Set(map.keys()) };
}

module.exports = { RESERVED_KEYS, normalizeCustomRoles, mergeAgentRoles };
