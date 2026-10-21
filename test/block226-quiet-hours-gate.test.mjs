/**
 * BLOCK-226 — 主进程通知门的免打扰分支 + 偏好归一。
 * 纯函数，不启 Electron。
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
const { notificationDecision, parseShellPrefs } = require(path.join(ROOT, 'src/main/desktop-shell-model.js'));

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
  now: Date.UTC(2026, 0, 1, 12, 0),
};

test('免打扰窗口内返回 quiet_hours（先于聚焦/去重判定）', () => {
  const nowDate = new Date(2026, 0, 1, 12, 0);
  const result = notificationDecision({ ...base, quietHours: '00:00-23:59', nowDate });
  assert.equal(result.show, false);
  assert.equal(result.reason, 'quiet_hours');
});

test('窗口外正常进入后续门（聚焦抑制）', () => {
  const nowDate = new Date(2026, 0, 1, 12, 0);
  const result = notificationDecision({ ...base, quietHours: '13:00-14:00', nowDate, focused: true });
  assert.equal(result.reason, 'window_focused');
});

test('偏好归一：合法 quietHours 保留，非法值回落空串', () => {
  assert.equal(parseShellPrefs({ quietHours: '22:00-08:00' }).quietHours, '22:00-08:00');
  assert.equal(parseShellPrefs({ quietHours: '25:00-08:00' }).quietHours, '');
  assert.equal(parseShellPrefs({}).quietHours, '');
});
