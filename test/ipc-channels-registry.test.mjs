/**
 * ipc-channels-registry.test.mjs — BLOCK-92 Wave D2（旧 BLOCK-9.6 IPC 常量集中）
 *
 * 双向守护主进程/preload 通道契约：
 *  1. 注册表值唯一且形状合法；
 *  2. 注册表每个值都能在 src/preload.js 找到（主进程登记而 preload 未包装 = 漂移）；
 *  3. 主进程消费方文件不再持有通道字面量（手写字符串回流 = 漂移）。
 * preload 因 sandbox 不能 require 本地模块而保持字面量（channels.js 头注有记）。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.join(import.meta.dirname, '..');
const CHANNELS = require('../src/ipc/channels.js');

const CONSUMERS = [
  'src/ipc/ai-settings.js',
  'src/ipc/auto-update.js',
  'src/ipc/branch-handlers.js',
  'src/ipc/data-management.js',
  'src/ipc/diagnostic.js',
  'src/ipc/file-dialog.js',
  'src/ipc/harness-capabilities.js',
  'src/ipc/pack.js',
  'src/ipc/plugin.js',
  'src/ipc/runtime-status.js',
  'src/ipc/ssh-host.js',
  'src/ipc/telemetry.js',
  'src/ipc/terminal.js',
  'src/ipc/window-manager.js',
  'src/ipc/workbench-flags.js',
  'src/ipc/working-tree-review.js',
  'src/main.js',
  'src/main/_window-create.js',
  'src/main/_skills-runtime.js',
  'src/main/_window-ipc.js',
];

const CH_RE = /^(?:[a-z][a-z0-9-]*)(?::[a-zA-Z0-9-]+)+$/;

/**
 * 主进程已登记但 preload 刻意不暴露的通道（preload.js L369 注记：「不暴露
 * branch-handlers.js 里的 project/message 通道；d.ts 契约仅含以下 6 个」）。
 * （UI-457：result:* 全域已退役，MAIN_ONLY 相应收缩。）
 */
const MAIN_ONLY = new Set([
  'branch:children',
  'branch:get',
  'branch:project:create',
  'branch:project:get',
  'branch:project:list',
  'branch:project:update',
  'message:append',
  'message:clear',
  'message:count',
  'message:delete',
  'message:get',
  'message:list',
]);

/** 非 IPC 通道的协议类型 tag（canonical=frontend/src/lib/events.ts），reflux 白名单。 */
const PROTOCOL_TAGS = new Set(['gewu:project-open-artifact']);

function flattenRegistry() {
  const flat = [];
  for (const [domain, group] of Object.entries(CHANNELS)) {
    for (const [key, value] of Object.entries(group)) {
      flat.push({ id: `${domain}.${key}`, value });
    }
  }
  return flat;
}

test('registry values are unique and channel-shaped', () => {
  const flat = flattenRegistry();
  assert.ok(flat.length >= 140, `registry unexpectedly small: ${flat.length}`);
  const values = new Set();
  for (const { id, value } of flat) {
    assert.match(value, CH_RE, `${id} value malformed: ${value}`);
    assert.equal(values.has(value), false, `duplicate registry value ${value} at ${id}`);
    values.add(value);
  }
});

test('every registry channel is wrapped in preload or explicitly main-only (main/preload drift guard)', () => {
  const preload = fs.readFileSync(path.join(ROOT, 'src/preload.js'), 'utf8');
  const missing = flattenRegistry()
    .filter(({ value }) => !MAIN_ONLY.has(value))
    .filter(({ value }) => !preload.includes(`'${value}'`) && !preload.includes(`"${value}"`));
  assert.deepEqual(missing, [], 'registry channels missing from preload.js (and not allowlisted MAIN_ONLY)');
});

test('MAIN_ONLY allowlist stays tight (every entry is still registered, none wrapped)', () => {
  const values = new Set(flattenRegistry().map(({ value }) => value));
  const preload = fs.readFileSync(path.join(ROOT, 'src/preload.js'), 'utf8');
  const stale = [...MAIN_ONLY].filter((v) => !values.has(v) || preload.includes(`'${v}'`) || preload.includes(`"${v}"`));
  assert.deepEqual(stale, [], 'MAIN_ONLY entries no longer needed (drop them)');
});

test('consumers hold no hand-written channel literals (literal reflux guard)', () => {
  const offenders = [];
  for (const rel of CONSUMERS) {
    const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    const matches = text.match(/(["'])([a-zA-Z0-9][a-zA-Z0-9:_-]*:[a-zA-Z0-9:_-]+)\1/g) || [];
    for (const raw of matches) {
      const ch = raw.slice(1, -1);
      if (CH_RE.test(ch) && !PROTOCOL_TAGS.has(ch)) offenders.push(`${rel}: ${raw}`);
    }
  }
  assert.deepEqual(offenders, [], 'hand-written channel literals reappeared in consumers');
});

test('every consumer can resolve its channels require (path guard — src/ vs src/main/ 深度差异)', () => {
  const broken = [];
  for (const rel of CONSUMERS) {
    const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    const m = text.match(/const CHANNELS = require\('([^']+)'\)/);
    assert.ok(m, `${rel} 缺少 CHANNELS require`);
    const resolved = path.resolve(path.join(ROOT, path.dirname(rel)), m[1] + '.js');
    if (!fs.existsSync(resolved)) broken.push(`${rel}: require('${m[1]}') -> ${resolved}`);
  }
  assert.deepEqual(broken, [], 'unresolvable channels require');
});
