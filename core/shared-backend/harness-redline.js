'use strict';

/**
 * EVO-0 — Harness 自进化的不可修改红线守卫（纯函数，fail-closed）。
 * 职责边界：只做「目标路径是否允许被 agent 自写入」的判定，不碰文件 / DB / 权限。
 * 为什么在此层：EVO-2 起 agent 会有受控写入工具（harness_apply_lesson），
 * 任何自写入口必须先过本门——默认拒绝，只有白名单放行，红线表自身 owner:'code' 不可改。
 * 现状对照：user-asset-guard 只管 git 索引，运行时无自修改保护，本模块补这一道。
 */

/** 红线表元数据（agent 不可改）。 */
const EVOLUTION_REDLINE = Object.freeze({
  owner: 'code',
  version: 1,
  policy: 'fail-closed: 仅 allowlist 放行，其余一律拒绝'
});

/**
 * 禁止前缀/片段：命中任一即拒绝（即使同时命中白名单，也以拒绝优先）。
 * 覆盖 harness 源码、工具注册表、approval/执行准入链、built-in skill、凭据路径。
 */
const FORBIDDEN = Object.freeze([
  'core/petri-server/',
  'core/shared-backend/',
  'core/packages/',
  'src/ipc/',
  'src/main',
  'resources/skills/',
  'node_modules/',
  '.git/',
  '.env',
  '.petri-secrets',
  '.netrc',
  'credentials',
  'id_rsa'
].map((s) => Object.freeze(s)));

/** 禁止的精确文件名（出现在任意路径段）。 */
const FORBIDDEN_SEGMENTS = Object.freeze([
  'agent-execution-policy.js',
  'agent-tool-interceptor.js',
  'trust-policy',
  'registry.js',
  'tool-defs',
  'config-schema.js'
].map((s) => Object.freeze(s)));

/**
 * 允许写入面（白名单，前缀精确匹配）。tier 决定 EVO-2 的自动/裁决分级。
 * - auto: 低风险，lesson 注入投影，可自动写
 * - ack: 中风险，策略档位，需改进卡片裁决
 * - draft: 高风险，installed skill，只出草案
 */
const ALLOWLIST = Object.freeze([
  Object.freeze({ prefix: '.petri/LEARNINGS.md', tier: 'auto' }),
  Object.freeze({ prefix: '.petri/MEMORY.md', tier: 'auto' }),
  Object.freeze({ prefix: 'agent-rules.json', tier: 'ack' }),
  Object.freeze({ prefix: 'tool-approval-policy.json', tier: 'ack' }),
  Object.freeze({ prefix: 'memory-policy.json', tier: 'ack' }),
  Object.freeze({ prefix: '.petri/installed-skills/', tier: 'draft' })
]);

/**
 * 路径归一化：去前导 ./ 与 /，统一反斜杠为正斜杠，便于匹配。
 * @param {string} target
 * @returns {string}
 */
function normalizeTarget(target) {
  if (typeof target !== 'string') return '';
  return target.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\//, '');
}

/**
 * 分类一个自写入目标。fail-closed：默认拒绝。
 * @param {string} target - 相对工作区的目标路径
 * @returns {{allowed: boolean, tier: 'forbidden'|'auto'|'ack'|'draft', reason: string}}
 */
function classifyEvolutionTarget(target) {
  const t = normalizeTarget(target);
  if (!t) return Object.freeze({ allowed: false, tier: 'forbidden', reason: 'empty_target' });

  for (const frag of FORBIDDEN) {
    if (t === frag || t.startsWith(frag) || t.includes(`/${frag}`)) {
      return Object.freeze({ allowed: false, tier: 'forbidden', reason: `forbidden_prefix:${frag}` });
    }
  }
  for (const seg of FORBIDDEN_SEGMENTS) {
    if (t.split('/').includes(seg)) {
      return Object.freeze({ allowed: false, tier: 'forbidden', reason: `forbidden_segment:${seg}` });
    }
  }
  for (const entry of ALLOWLIST) {
    if (t === entry.prefix || t.startsWith(entry.prefix)) {
      return Object.freeze({ allowed: true, tier: entry.tier, reason: `allow:${entry.prefix}` });
    }
  }
  return Object.freeze({ allowed: false, tier: 'forbidden', reason: 'not_in_allowlist' });
}

/**
 * 断言目标允许自写入，否则抛错（fail-closed 执行门）。
 * @param {string} target
 * @returns {{allowed: true, tier: string, reason: string}}
 * @throws {Error} 目标不在白名单或命中红线
 */
function assertEvolutionTargetAllowed(target) {
  const r = classifyEvolutionTarget(target);
  if (!r.allowed) throw new Error(`evolution target rejected: ${r.reason} (${target})`);
  return r;
}

module.exports = {
  EVOLUTION_REDLINE,
  FORBIDDEN,
  FORBIDDEN_SEGMENTS,
  ALLOWLIST,
  classifyEvolutionTarget,
  assertEvolutionTargetAllowed,
  normalizeTarget
};
