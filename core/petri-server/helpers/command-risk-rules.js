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

function firstToken(command) {
  const raw = String(command || '').trim().split(/\s+/)[0]?.toLowerCase() || '';
  // 归一化：剥可执行后缀与派生名（format.com→format / mkfs.ext4→mkfs）
  const base = raw.replace(/\.(exe|com|cmd|bat)$/, '');
  return base.includes('.') ? base.split('.')[0] : base;
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
  normalizePathLike,
  matchesSensitivePath,
};
