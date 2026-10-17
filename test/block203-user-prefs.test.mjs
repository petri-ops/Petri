/**
 * BLOCK-203 W4a P2 — `user-prefs` 落点收编（runlist W4a 首族）契约测。
 *
 * 钉三件事：
 *  ① **拆前语义逐条冻结**（BLOCK-86 的既有行为，改它就是回归）：枚举域外丢键、
 *     fontScale 越界**钳位**（5 → 1.4）、`fontScale === 1` 不落盘、部分 PUT 合并不清他键、
 *     落点文件仍是 `<dataDir>/user-prefs.json`（位置属 W4b，本片红线不动）。
 *  ② **新增能力只有一条**：未知键 fail-closed（400 + 结构化诊断 + 整批不落盘）。
 *     此前 `sanitize` 静默丢掉未注册键 ⇒ "你写了一个不存在的键"永远不可见。
 *  ③ **域值单源**：注册表 `user-prefs` 族的枚举 == 前端 `themes/accents.ts` 的 AccentId 集合，
 *     且 route/helper 里不再出现第二份集合（历史上"曾漏 blue"就是两份各自维护的后果）。
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const schema = require(path.join(ROOT, 'core/packages/shared-config/config-schema.js'));
const userPrefs = require(path.join(ROOT, 'core/petri-server/helpers/user-prefs.js'));

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const PREFS = (dir) => path.join(dir, 'user-prefs.json');

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

async function startApp(dir) {
  const express = require('express');
  const app = express();
  require(path.join(ROOT, 'core/petri-server/routes/user-prefs.js'))(app, { dataDir: dir });
  const server = await listen(app);
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

function put(base, body) {
  return fetch(`${base}/api/user/prefs`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('BLOCK-203 P2 — 落点路径不变：写出的文件就是 <dataDir>/user-prefs.json', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'petri-b203-prefs-'));
  try {
    const { server, base } = await startApp(dir);
    const response = await put(base, { theme: 'dark' });
    assert.equal(response.status, 200);
    const raw = JSON.parse(fs.readFileSync(PREFS(dir), 'utf8'));
    assert.deepEqual(raw, { theme: 'dark' }, '落点文件形状与位置必须与 BLOCK-86 完全一致');
    await new Promise((resolve) => server.close(resolve));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('BLOCK-203 P2 — 拆前消毒语义冻结：钳位 / 丢非法枚举 / fontScale=1 不落盘 / 部分合并不清他键', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'petri-b203-prefs-'));
  try {
    const { server, base } = await startApp(dir);

    const first = await (await put(base, { theme: 'dark', accent: 'rose' })).json();
    assert.equal(first.ok, true);
    assert.deepEqual({ theme: first.prefs.theme, accent: first.prefs.accent }, { theme: 'dark', accent: 'rose' });

    // 越界 → 钳位（不是拒绝）；部分更新不清他键
    const clamped = await (await put(base, { fontScale: 5, theme: 'light' })).json();
    assert.equal(clamped.ok, true);
    assert.equal(clamped.prefs.fontScale, 1.4, 'fontScale 越界必须钳位到 1.4（BLOCK-86 语义）');
    assert.equal(clamped.prefs.accent, 'rose', '部分 PUT 不得清掉未出现的键');
    assert.ok(
      clamped.diagnostics.some((d) => d.code === 'out-of-range' && d.path === 'fontScale'),
      '钳位必须作为诊断回传（此前是静默改值）',
    );

    // 非法枚举 → 丢键（不写、不清旧值），仍是 200
    const dropped = await (await put(base, { theme: 'hacker', accent: 123 })).json();
    assert.equal(dropped.ok, true);
    assert.equal(dropped.prefs.theme, 'light');
    assert.equal(dropped.prefs.accent, 'rose');
    assert.ok(dropped.diagnostics.some((d) => d.path === 'theme' && d.code === 'not-allowed'));
    assert.ok(dropped.diagnostics.some((d) => d.path === 'accent' && d.code === 'type-mismatch'));

    // fontScale === 1 = "没改过" → 键被移除，而不是存 1
    const back = await (await put(base, { fontScale: 1 })).json();
    assert.equal(back.ok, true);
    assert.equal(back.prefs.fontScale, undefined, 'fontScale=1 不得落盘');
    assert.equal(JSON.parse(fs.readFileSync(PREFS(dir), 'utf8')).fontScale, undefined);

    await new Promise((resolve) => server.close(resolve));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('BLOCK-203 P2 — 未知键 fail-closed：400 + 诊断，且整批不落盘（文件逐字节不变）', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'petri-b203-prefs-'));
  try {
    const { server, base } = await startApp(dir);
    await put(base, { theme: 'dark' });
    const before = fs.readFileSync(PREFS(dir), 'utf8');

    // 一批里同时有合法键与未知键 → 整批拒绝（不做"部分成功"）
    const response = await put(base, { theme: 'light', themeColor: 'rose' });
    assert.equal(response.status, 400, '未知键必须是 400，不得静默丢弃');
    const body = await response.json();
    assert.equal(body.ok, false);
    assert.equal(body.error, 'prefs_value_rejected');
    assert.ok(body.diagnostics.some((d) => d.code === 'unknown-key' && d.path === 'themeColor'));

    assert.equal(fs.readFileSync(PREFS(dir), 'utf8'), before, '拒绝写 = 文件一个字节都不动');
    await new Promise((resolve) => server.close(resolve));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('BLOCK-203 P2 — 读侧仍然宽容：脏文件不抛、非法值丢弃、未知键进诊断（旧文件不迁可读）', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'petri-b203-prefs-'));
  try {
    fs.writeFileSync(PREFS(dir), JSON.stringify({ theme: 'hacker', fontScale: 'x', accent: 'rose', themeName: 'oops' }), 'utf8');
    const { server, base } = await startApp(dir);
    const response = await fetch(`${base}/api/user/prefs`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.prefs, { accent: 'rose' }, '非法键被丢弃，合法键照读');
    assert.ok(body.diagnostics.some((d) => d.path === 'themeName' && d.code === 'unknown-key'));
    await new Promise((resolve) => server.close(resolve));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('BLOCK-203 P2 — resetPrefs 只清覆盖层（回落默认），不删目录也不碰别的文件', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'petri-b203-prefs-'));
  try {
    fs.writeFileSync(path.join(dir, 'other.json'), '{"keep":true}', 'utf8');
    userPrefs.writePrefs(dir, { theme: 'dark', fontScale: 1.2 });
    assert.deepEqual(userPrefs.readPrefs(dir), { theme: 'dark', fontScale: 1.2 });
    userPrefs.resetPrefs(dir);
    assert.deepEqual(userPrefs.readPrefs(dir), {}, '重置 = 覆盖层清空 → 全部回落默认');
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'other.json'), 'utf8')), { keep: true }, '重置不得删别的文件');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('BLOCK-203 P2 — 域值单源：注册表枚举 == 前端 accents.ts 的 AccentId 集合', () => {
  const entry = schema.findKeyEntry('userPrefs.accent');
  assert.deepEqual([...entry.domain.oneOf], ['teal', 'blue', 'violet', 'rose', 'amber']);
  const accentsSrc = read('frontend/src/themes/accents.ts');
  const ids = [...accentsSrc.matchAll(/\{ id: '([a-z]+)', label:/g)].map((m) => m[1]);
  assert.deepEqual(ids, [...entry.domain.oneOf], `accents.ts 与注册表的强调色集合不一致：${ids.join(',')}`);
  const accentType = (accentsSrc.match(/export type AccentId = ([^;]+);/) || [])[1] || '';
  for (const id of ids) assert.ok(accentType.includes(`'${id}'`), `AccentId 联合类型漏了 ${id}`);
});

test('BLOCK-203 P2 — 主题枚举与前端 ThemeProvider 的三值判断一致，且落点模块不再自持集合', () => {
  const entry = schema.findKeyEntry('userPrefs.theme');
  const providerSrc = read('frontend/src/themes/ThemeProvider.tsx');
  for (const value of entry.domain.oneOf) {
    assert.ok(providerSrc.includes(`'${value}'`), `ThemeProvider 里找不到主题值 ${value}`);
  }
  // 第二份集合就是漂移源：落点 helper/route 里只许出现键路径，不许再写死枚举
  const helperSrc = read('core/petri-server/helpers/user-prefs.js');
  const routeSrc = read('core/petri-server/routes/user-prefs.js');
  for (const value of [...entry.domain.oneOf, ...schema.findKeyEntry('userPrefs.accent').domain.oneOf]) {
    assert.ok(!helperSrc.includes(`'${value}'`), `helpers/user-prefs.js 自持了枚举值 ${value}（应只读注册表）`);
    assert.ok(!routeSrc.includes(`'${value}'`), `routes/user-prefs.js 自持了枚举值 ${value}（应只读注册表）`);
  }
});

test('BLOCK-203 P2 — 导入侧比落点更严：越界 fontScale 直接拒绝（不做钳位，保往返幂等）', () => {
  const { validateImport } = require(path.join(ROOT, 'core/petri-server/helpers/config-transfer.js'));
  const envelope = (families) => ({ format: 'petri-config', version: 1, families });

  const ok = validateImport(envelope({ 'user-prefs': { theme: 'dark', fontScale: 1.2, accent: 'rose' } }));
  assert.equal(ok.ok, true, `合法导入应通过：${JSON.stringify(ok.diagnostics)}`);

  const outOfRange = validateImport(envelope({ 'user-prefs': { fontScale: 5 } }));
  assert.equal(outOfRange.ok, false, '导入不得钳位后再落盘');
  assert.ok(outOfRange.diagnostics.some((d) => d.path === 'fontScale' && d.code === 'out-of-range'));

  const unknown = validateImport(envelope({ 'user-prefs': { themeColor: 'rose' } }));
  assert.equal(unknown.ok, false);
  assert.ok(unknown.diagnostics.some((d) => d.code === 'unknown-key' && d.path === 'themeColor'));
});
