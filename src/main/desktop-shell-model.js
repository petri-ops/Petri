'use strict';

/**
 * desktop-shell-model.js — BLOCK-223 桌面外壳的纯决策层（可单测，不 require electron）。
 *
 * 三块决策：
 *   ① 通知门：偏好 → 支持性 → 窗口聚焦抑制 → 去重（3s）；
 *   ② 活动摘要归一：后端计数 + 主进程终端会话 → 固定形状与 total；
 *   ③ 退出摘要行：只展示非零项，文案与计数一一对应。
 */

const DEFAULT_PREFS = Object.freeze({
  closeToTray: false,
  notifyOnTurnEnd: true,
});

const NOTIFY_DEDUPE_MS = 3000;
const NOTIFY_KINDS = Object.freeze({
  turn_completed: 'Petri · 本轮完成',
  turn_failed: 'Petri · 本轮失败',
  approval_required: 'Petri · 需要你的确认',
});

const COUNT_LABELS = Object.freeze({
  toolJobsRunning: '运行中的工具作业',
  toolJobsPending: '排队中的工具作业',
  approvalsPending: '等待你的审批',
  primaryTasks: '运行中的任务',
  subagentTasks: '运行中的子代理',
  backgroundProcesses: '运行中的后台进程',
  terminalSessions: '打开的终端会话',
});

function stripControlChars(value) {
  let out = '';
  for (const char of String(value == null ? '' : value)) {
    const code = char.codePointAt(0);
    out += code < 32 || code === 127 ? ' ' : char;
  }
  return out;
}

function sanitizeText(value, maxLength) {
  const text = stripControlChars(value)
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return '';
  return text.length > maxLength ? `${text.slice(0, Math.max(1, maxLength - 1))}…` : text;
}

/** 偏好只接受布尔；未知键忽略（渲染进程推送面越权不收）。 */
function parseShellPrefs(input) {
  const out = { ...DEFAULT_PREFS };
  if (input && typeof input === 'object') {
    if (typeof input.closeToTray === 'boolean') out.closeToTray = input.closeToTray;
    if (typeof input.notifyOnTurnEnd === 'boolean') out.notifyOnTurnEnd = input.notifyOnTurnEnd;
  }
  return out;
}

function sanitizeCount(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(Math.floor(n), 1_000_000);
}

/** 后端 counts + 主进程终端数 → 固定形状；total 始终按归一后的值重算。 */
function normalizeActivity(raw) {
  const source = raw && typeof raw === 'object' && raw.counts && typeof raw.counts === 'object'
    ? raw.counts
    : {};
  const counts = {};
  for (const key of Object.keys(COUNT_LABELS)) counts[key] = sanitizeCount(source[key]);
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
  return {
    counts,
    total,
    fetchedAt: typeof raw?.fetchedAt === 'string' ? raw.fetchedAt : null,
    degraded: raw?.degraded === true,
  };
}

function shouldShowQuitSummary(summary) {
  return Boolean(summary) && Number(summary.total) > 0;
}

function quitSummaryRows(counts) {
  const source = counts && typeof counts === 'object' ? counts : {};
  return Object.entries(COUNT_LABELS)
    .map(([key, label]) => ({ key, label, value: sanitizeCount(source[key]) }))
    .filter((row) => row.value > 0);
}

/**
 * 通知门。返回 { show, reason, key }：
 *   pref_off / unsupported_kind / unsupported / window_focused / duplicate / shown
 */
function notificationDecision({
  kind,
  enabled,
  supported,
  focused,
  visible,
  minimized,
  key,
  lastKey,
  lastAt,
  now,
  dedupeMs = NOTIFY_DEDUPE_MS,
} = {}) {
  if (!enabled) return { show: false, reason: 'pref_off', key: null };
  if (!Object.prototype.hasOwnProperty.call(NOTIFY_KINDS, kind)) {
    return { show: false, reason: 'unsupported_kind', key: null };
  }
  if (!supported) return { show: false, reason: 'unsupported', key: null };
  if (focused && visible && !minimized) return { show: false, reason: 'window_focused', key: null };
  const dedupeKey = `${kind}:${sanitizeText(key, 120)}`;
  const at = Number(now) || Date.now();
  if (lastKey && lastKey === dedupeKey && at - Number(lastAt || 0) < dedupeMs) {
    return { show: false, reason: 'duplicate', key: dedupeKey };
  }
  return { show: true, reason: 'shown', key: dedupeKey };
}

/** 通知文案：不含对话正文、工具参数或文件路径。 */
function buildNotificationPayload(input = {}) {
  const title = NOTIFY_KINDS[input.kind];
  if (!title) return null;
  const label = sanitizeText(input.label, 60);
  let body = '';
  if (input.kind === 'approval_required') {
    const toolName = sanitizeText(input.toolName, 40);
    body = toolName ? `工具 ${toolName} 正在等待你的授权` : '有工具调用正在等待你的授权';
  } else if (input.kind === 'turn_failed') {
    body = label ? `「${label}」执行失败，可在应用内查看原因` : '本轮执行失败，可在应用内查看原因';
  } else {
    body = label ? `「${label}」本轮已完成` : '本轮对话已完成';
  }
  return { title, body };
}

module.exports = {
  DEFAULT_PREFS,
  parseShellPrefs,
  normalizeActivity,
  shouldShowQuitSummary,
  quitSummaryRows,
  notificationDecision,
  buildNotificationPayload,
};
