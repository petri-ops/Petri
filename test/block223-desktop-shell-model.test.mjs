/**
 * BLOCK-223 — 桌面外壳纯决策层 + 控制器（不启 Electron）。
 *
 * 覆盖：偏好默认/校验、通知门（偏好/支持性/聚焦/去重）、通知文案隐私边界、
 * 活动计数归一与求和、退出摘要行、控制器默认状态与无 electron 环境降级。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);
const ROOT = path.resolve(__dirname, '..');

const {
  parseShellPrefs,
  notificationDecision,
  buildNotificationPayload,
  normalizeActivity,
  quitSummaryRows,
  shouldShowQuitSummary,
} = require(path.join(ROOT, 'src/main/desktop-shell-model.js'));
const { createDesktopShell } = require(path.join(ROOT, 'src/main/desktop-shell.js'));

test('偏好默认值：closeToTray=false / notifyOnTurnEnd=true / quietHours 空；布尔校验拒绝字符串', () => {
  assert.deepEqual(parseShellPrefs(undefined), { closeToTray: false, notifyOnTurnEnd: true, quietHours: '' });
  assert.deepEqual(
    parseShellPrefs({ closeToTray: 'yes', notifyOnTurnEnd: 0 }),
    { closeToTray: false, notifyOnTurnEnd: true, quietHours: '' },
    '非布尔不得被真值化',
  );
  assert.deepEqual(
    parseShellPrefs({ closeToTray: true, notifyOnTurnEnd: false, extra: 1 }),
    { closeToTray: true, notifyOnTurnEnd: false, quietHours: '' },
    '未知键忽略',
  );
});

test('通知门：偏好关 > 未知类型 > 不支持 > 聚焦抑制 > 去重', () => {
  const base = {
    kind: 'turn_completed',
    enabled: true,
    supported: true,
    focused: false,
    visible: true,
    minimized: false,
    key: 'conv-1',
    lastKey: null,
    lastAt: 0,
    now: 1_000,
  };
  assert.equal(notificationDecision({ ...base, enabled: false }).reason, 'pref_off');
  assert.equal(notificationDecision({ ...base, kind: 'random' }).reason, 'unsupported_kind');
  assert.equal(notificationDecision({ ...base, supported: false }).reason, 'unsupported');
  assert.equal(notificationDecision({ ...base, focused: true }).reason, 'window_focused');
  assert.equal(
    notificationDecision({ ...base, focused: true, minimized: true }).show,
    true,
    '最小化时即使 isFocused 为真也要通知',
  );
  assert.equal(notificationDecision({ ...base, focused: true, visible: false }).show, true);
  assert.equal(
    notificationDecision({ ...base, lastKey: 'turn_completed:conv-1', lastAt: 0, now: 2_000 }).reason,
    'duplicate',
  );
  assert.equal(
    notificationDecision({ ...base, lastKey: 'turn_completed:conv-1', lastAt: 0, now: 3_500 }).show,
    true,
    '超过 3s 去重窗',
  );
});

test('通知文案：不含正文，标签与工具名按控制字符/长度清洗', () => {
  const completed = buildNotificationPayload({ kind: 'turn_completed', label: '数据\n清洗\u0000 会话' });
  assert.equal(completed.title, 'Petri · 本轮完成');
  assert.equal(completed.body, '「数据 清洗 会话」本轮已完成');
  assert.equal(buildNotificationPayload({ kind: 'turn_completed' }).body, '本轮对话已完成');

  const approval = buildNotificationPayload({ kind: 'approval_required', toolName: 'workspace_exec' });
  assert.equal(approval.body, '工具 workspace_exec 正在等待你的授权');
  assert.equal(buildNotificationPayload({ kind: 'approval_required' }).body, '有工具调用正在等待你的授权');

  const long = 'x'.repeat(100);
  assert.ok(buildNotificationPayload({ kind: 'turn_failed', label: long }).body.length < 100);
  assert.equal(buildNotificationPayload({ kind: 'unknown' }), null);
});

test('活动归一：非法计数归零、total 按归一值重算、terminalSessions 计入', () => {
  const summary = normalizeActivity({
    counts: {
      toolJobsRunning: 2,
      toolJobsPending: -1,
      approvalsPending: '3',
      primaryTasks: 1.9,
      subagentTasks: null,
      backgroundProcesses: 1,
      terminalSessions: 2,
      unknownKey: 99,
    },
    total: 999,
    fetchedAt: '2026-10-21T00:00:00.000Z',
  });
  assert.deepEqual(summary.counts, {
    toolJobsRunning: 2,
    toolJobsPending: 0,
    approvalsPending: 3,
    primaryTasks: 1,
    subagentTasks: 0,
    backgroundProcesses: 1,
    terminalSessions: 2,
  });
  assert.equal(summary.total, 9, '忽略后端 total，按归一后的 counts 求和');
  assert.equal(summary.degraded, false);
  assert.equal(summary.fetchedAt, '2026-10-21T00:00:00.000Z');
  assert.equal(normalizeActivity({ degraded: true }).total, 0);
});

test('退出摘要行：只列非零项，文案与顺序固定', () => {
  const rows = quitSummaryRows({ toolJobsRunning: 1, approvalsPending: 2, terminalSessions: 0 });
  assert.deepEqual(rows, [
    { key: 'toolJobsRunning', label: '运行中的工具作业', value: 1 },
    { key: 'approvalsPending', label: '等待你的审批', value: 2 },
  ]);
  assert.equal(shouldShowQuitSummary({ total: 0 }), false);
  assert.equal(shouldShowQuitSummary({ total: 1 }), true);
});

test('控制器（无 Electron）：默认状态、偏好更新、通知降级、无待决退出', () => {
  const shell = createDesktopShell({
    app: { on() {}, quit() {} },
    getMainWindow: () => null,
    isTestInstance: true,
    getTerminalSessionCount: () => 3,
  });
  assert.deepEqual(shell.getStatus(), {
    ok: true,
    closeToTray: false,
    notifyOnTurnEnd: true,
    trayActive: false,
    notificationsSupported: false,
    testInstance: true,
  });
  const updated = shell.updatePrefs({ closeToTray: true, notifyOnTurnEnd: false });
  assert.equal(updated.ok, true);
  assert.equal(updated.changed, true);
  assert.deepEqual(updated.prefs, { closeToTray: true, notifyOnTurnEnd: false, quietHours: '' });
  assert.equal(shell.notify({ kind: 'turn_completed' }).reason, 'pref_off');
  shell.updatePrefs({ notifyOnTurnEnd: true });
  assert.equal(shell.notify({ kind: 'turn_completed' }).reason, 'unsupported');
  assert.equal(shell.respondQuit('cancel').reason, 'no_pending_quit');
  assert.equal(shell.previewQuitSummary().ok, true);
  shell.dispose();
});
