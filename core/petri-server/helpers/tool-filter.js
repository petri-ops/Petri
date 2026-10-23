'use strict';

/**
 * helpers/tool-filter.js — BLOCK-249（Q4a）子代理工具集过滤（只收紧）。
 *
 * profile 的 `tools.allow` / `tools.deny` 不是权限系统：policy / 审批 / 四档判定照常生效，
 * 这里只是把**下发给模型**的工具名单再收一层。三条性质：
 *  ① deny 优先（同时出现在 allow 与 deny 里 ⇒ 不出现在名单）；
 *  ② allow 只能从"本来可用"的集合里挑（交集），永远不能新增能力；
 *  ③ 未登记的工具名不静默吞——上层把未知名作为诊断回给派发方。
 */

function toolNameOf(def) {
  if (!def || typeof def !== 'object') return '';
  if (def.function && typeof def.function.name === 'string') return def.function.name;
  if (typeof def.name === 'string') return def.name;
  return '';
}

function normalizePolicy(policy) {
  if (!policy || typeof policy !== 'object') return null;
  const toList = (value) => (Array.isArray(value) ? value.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim()) : []);
  const allow = toList(policy.allow);
  const deny = toList(policy.deny);
  if (allow.length === 0 && deny.length === 0) return null;
  return { allow: allow.length > 0 ? allow : null, deny };
}

/** 过滤工具定义；policy 为空 → 原样返回（零行为变化）。 */
function filterToolDefs(defs, policy) {
  const normalized = normalizePolicy(policy);
  if (!normalized) return Array.isArray(defs) ? defs : [];
  const deny = new Set(normalized.deny);
  const allow = normalized.allow ? new Set(normalized.allow) : null;
  return (Array.isArray(defs) ? defs : []).filter((def) => {
    const name = toolNameOf(def);
    if (!name) return false;
    if (deny.has(name)) return false;
    if (allow && !allow.has(name)) return false;
    return true;
  });
}

/** 未知工具名诊断（不拒绝：未知名在名单里就是空操作，但派发方要知道它没生效）。 */
function policyDiagnostics(policy, knownNames) {
  const normalized = normalizePolicy(policy);
  if (!normalized) return [];
  const known = knownNames instanceof Set ? knownNames : new Set(Array.isArray(knownNames) ? knownNames : []);
  const diagnostics = [];
  for (const name of normalized.allow || []) {
    if (!known.has(name)) diagnostics.push({ code: 'unknown_allow_tool', tool: name });
  }
  for (const name of normalized.deny) {
    if (!known.has(name)) diagnostics.push({ code: 'unknown_deny_tool', tool: name });
  }
  return diagnostics;
}

module.exports = {
  toolNameOf,
  normalizePolicy,
  filterToolDefs,
  policyDiagnostics,
};
