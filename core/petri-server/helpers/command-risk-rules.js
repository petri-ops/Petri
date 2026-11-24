'use strict';

/**
 * helpers/command-risk-rules.js — 命令/路径风险判定规则单源（BLOCK-180 P2）。
 *
 * 自 agent-tool-policy.js 原样迁入（BLOCK-160 W2 P1 ORC-2 引入）：policy 的
 * 动态防护判定与 helpers/command-risk-spans.js 的 span 分析共用同一份规则，
 * 防止「拦截判据」与「高亮判据」漂移成两个真相。
 */

// 动态审批两维（预裁决缺省，蓝图 §3.4）。
// 命令维度 = 系统级破坏命令首 token（**不含 rm/del 等常规命令**——日常操作不拦，
// 用户需更严由 ORC-1 规则自配；静态黑名单已兜底最坏面）。
const DANGEROUS_FIRST_TOKENS = new Set([
  'format', 'mkfs', 'dd', 'diskpart', 'fsutil', 'cipher',
  'vssadmin', 'bcdedit', 'wipefs', 'shutdown',
]);
// 路径维度 = 敏感系统/凭证目录子串模式（大小写不敏感；刻意排除 /usr/bin、
// Program Files 等高频合法前缀，控制误报面）。
const SENSITIVE_PATH_PATTERNS = [
  '\\windows\\', '/windows/', 'system32', '/etc/', '/boot/', '/proc/',
  '/sys/kernel', '.ssh', '.gnupg', '.aws', '$recycle.bin',
];

function normalizeFirstToken(raw) {
  const token = String(raw || '').trim().toLowerCase();
  // 归一化：剥可执行后缀与派生名（format.com→format / mkfs.ext4→mkfs）
  const base = token.replace(/^(sudo|doas)\s+/i, '').replace(/\.(exe|com|cmd|bat)$/, '');
  return base.includes('.') ? base.split('.')[0] : base;
}

function firstToken(command) {
  return normalizeFirstToken(String(command || '').trim().split(/\s+/)[0]);
}

/**
 * BLOCK-511 S3.3 — 逐命令段取首 token：按换行/; /&&/||/| 分段，剥掉 sudo/doas
 * 与前置环境变量赋值（FOO=1 cmd → cmd）。命中处置不变（调用方决定是否拦截）。
 */
function firstTokens(command) {
  return String(command || '')
    .split(/[\n;]|\|\||&&|\|/)
    .map((segment) => segment.trim().split(/\s+/).filter(Boolean))
    .map((parts) => {
      while (parts.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(parts[0])) parts.shift();
      while (parts.length && /^(sudo|doas)$/i.test(parts[0])) parts.shift();
      return normalizeFirstToken(parts[0]);
    })
    .filter(Boolean);
}

function normalizePathLike(value) {
  return String(value || '').replaceAll('\\', '/').toLowerCase();
}

function matchesSensitivePath(value) {
  const normalized = normalizePathLike(value);
  return SENSITIVE_PATH_PATTERNS.some((pattern) => normalized.includes(pattern));
}

module.exports = {
  DANGEROUS_FIRST_TOKENS,
  SENSITIVE_PATH_PATTERNS,
  firstToken,
  firstTokens,
  normalizePathLike,
  matchesSensitivePath,
};
