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
 * 主进程已登记但 preload 刻意不暴露的通道。
 * （UI-457：result:* 全域已退役；2026-11-05：branch/message 十二通道已随
 * registry 一并退役，按「allowlist stays tight」判据删去 stale 条目。）
 */
const MAIN_ONLY = new Set([
  // BLOCK-264（C-38）— PiP 通道：主进程窗口/截帧面；PiP 页用独立 preload
  // （computer-use-pip-preload.js），主窗 preload 刻意不暴露（渲染侧无消费）
  'computer-use:pip-frame',
  'computer-use:pip-status',
]);

/** 非 IPC 通道的协议类型 tag（canonical=frontend/src/lib/events.ts），reflux 白名单。 */
const PROTOCOL_TAGS = new Set(['petri:project-open-artifact']);

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

// ── BLOCK-360（NSO-W2-2）双向集合相等门（替代 includes 子串单向守护）──────────────────────
// 缺口（评估 F-21）：①注册表→preload 用 includes 子串，通道名只在注释里出现也判绿；
// ②preload→注册表方向缺失，preload 手加未登记通道不红；③CONSUMERS 固定清单，新模块手写
// 字面量不被扫描（本批 glob 首扫即抓到 src/main/desktop-shell.js 两处遗漏，已改 CHANNELS 引用）。

function stripJsComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** preload 真实调用点通道集合（去注释后正则抽取 + 具名 *_CHANNEL 常量）。 */
export function extractPreloadCallSiteChannels(preloadText) {
  const code = stripJsComments(preloadText);
  const out = new Set();
  const callRe = /ipcRenderer\.(?:invoke|send|sendSync|on|once|removeListener|removeAllListeners)\(\s*['"]([^'"]+)['"]/g;
  for (const m of code.matchAll(callRe)) out.add(m[1]);
  const constRe = /const\s+[A-Z_]+_CHANNEL\s*=\s*['"]([^'"]+)['"]/g;
  for (const m of code.matchAll(constRe)) out.add(m[1]);
  return out;
}

function listMainProcessSources() {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) { walk(rel); continue; }
      if (!rel.endsWith('.js')) continue;
      // L2-6：_channel-classification.js 是通道注记 DATA 表（合法引用字面量做键），
      // 非 handler——与 channels.js 同列豁免。
      if (/(^|\/)([a-z-]*preload)\.js$/.test(rel) || rel === 'src/ipc/channels.js' || rel === 'src/ipc/_channel-classification.js') continue;
      out.push(rel);
    }
  };
  walk('src');
  return out.sort();
}

test('W2-2 preload 调用点 ∪ MAIN_ONLY 与注册表集合相等（双向）', () => {
  const preload = fs.readFileSync(path.join(ROOT, 'src/preload.js'), 'utf8');
  const sites = extractPreloadCallSiteChannels(preload);
  const registry = new Set(flattenRegistry().map(({ value }) => value));
  const preloadOnly = [...sites].filter((v) => !registry.has(v)).sort();
  const registryOnly = [...registry].filter((v) => !sites.has(v) && !MAIN_ONLY.has(v)).sort();
  assert.deepEqual(preloadOnly, [], 'preload 存在未登记通道（先在 src/ipc/channels.js 登记）');
  assert.deepEqual(registryOnly, [], '注册表通道在 preload 没有真实调用点（注释里出现不算）');
});

test('W2-2 负测：通道名只出现在注释里不计入调用点（堵 includes 假绿）', () => {
  const text = `// ipcRenderer.invoke('ghost:in-comment')\n/* ipcRenderer.send('ghost:block') */\nconst x = ipcRenderer.invoke('real:call');\n`;
  const sites = extractPreloadCallSiteChannels(text);
  assert.deepEqual([...sites], ['real:call']);
});

test('W2-2 全量 glob：src 下任何主进程模块不得手写已登记通道字面量，也不得手写未登记 IPC 通道', () => {
  const registry = new Set(flattenRegistry().map(({ value }) => value));
  const reflux = [];
  const unregistered = [];
  for (const rel of listMainProcessSources()) {
    const code = stripJsComments(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
    for (const m of code.matchAll(/(["'])([a-zA-Z0-9][a-zA-Z0-9:_-]*:[a-zA-Z0-9:_-]+)\1/g)) {
      if (registry.has(m[2]) && !PROTOCOL_TAGS.has(m[2])) reflux.push(`${rel}: ${m[2]}`);
    }
    for (const m of code.matchAll(/(?:ipcMain\.(?:handle|handleOnce|on|once|removeHandler)|webContents\.send)\(\s*['"]([^'"]+)['"]/g)) {
      if (m[1].includes(':') && !registry.has(m[1])) unregistered.push(`${rel}: ${m[1]}`);
    }
  }
  assert.deepEqual(reflux, [], '主进程模块手写了已登记通道字面量（改用 CHANNELS 引用）');
  assert.deepEqual(unregistered, [], '主进程模块注册了未登记的 IPC 通道（先在 channels.js 登记）');
});

test('L2-6（BLOCK-406）：通道分类注记键 ⊆ 注册表字面量（testOnly/platformScoped 单源一致）', () => {
  const { CHANNEL_CLASSIFICATION } = require('../src/ipc/_channel-classification.js');
  const ids = new Set(flattenRegistry().map((entry) => entry.value));
  for (const id of Object.keys(CHANNEL_CLASSIFICATION)) {
    assert.ok(ids.has(id), `分类注记引用了未登记通道: ${id}`);
  }
  // testOnly 通道必须有 note（销号留痕），platformScoped 必须声明平台域
  for (const [id, cls] of Object.entries(CHANNEL_CLASSIFICATION)) {
    if (cls.testOnly) assert.ok(cls.note, `testOnly 缺销号注记: ${id}`);
    if (cls.platformScoped) assert.ok(typeof cls.platformScoped === 'string' && cls.platformScoped.length > 0, `platformScoped 缺平台域: ${id}`);
  }
});
