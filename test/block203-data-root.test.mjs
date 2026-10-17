/**
 * BLOCK-203 W4b P1 — 落点目录单源（`shared-backend/data-paths`）契约测。
 *
 * P0 测绘出四条手写回落链，同一「数据目录」在不同模块里可以是四个不同位置。本片收成两个
 * **有名字的根**（应用数据根 / 用户态根），并把四个模块的拼路径行为统一到它们。
 *
 * 钉五件事：
 *  ① 优先序逐字固定（env 顺序即语义）；② 用户态根与应用数据根**分别**有单一实现；
 *  ③ 四个模块在同一 env 下算出一致的根（不再各写一份链）；
 *  ④ 只设 `PETRI_USER_DATA_DIR` 时，数据面模块也**认它**（历史缺陷：mcp-settings 不认）；
 *  ⑤ 静态门：四个模块不许再自己写 env 优先序（否则"单源"只是口号）。
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataPaths = require(path.join(ROOT, 'core/shared-backend/data-paths.js'));
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('BLOCK-203 W4b P1 — 应用数据根优先序：LOCAL > LOCAL_DATA_DIR > USER_DATA_DIR > ~/Documents', () => {
  const home = '/tmp/fake-home';
  assert.equal(dataPaths.resolveDataDir({ PETRI_LOCAL_DATA_DIR: '/a' }, { homedir: home }), '/a');
  assert.equal(
    dataPaths.resolveDataDir({ PETRI_LOCAL_DATA_DIR: '/a', LOCAL_DATA_DIR: '/b', PETRI_USER_DATA_DIR: '/c' }, { homedir: home }),
    '/a',
    'PETRI_LOCAL_DATA_DIR 永远最优先',
  );
  assert.equal(dataPaths.resolveDataDir({ LOCAL_DATA_DIR: '/b', PETRI_USER_DATA_DIR: '/c' }, { homedir: home }), '/b');
  assert.equal(dataPaths.resolveDataDir({ PETRI_USER_DATA_DIR: '/c' }, { homedir: home }), '/c', '只设 USER_DATA_DIR 时数据面也要认（历史缺陷）');
  assert.equal(dataPaths.resolveDataDir({}, { homedir: home }), path.join(home, 'Documents', 'Petri-Local'));
  // 空串/空白不算设置（env 常被设成空串）
  assert.equal(dataPaths.resolveDataDir({ PETRI_LOCAL_DATA_DIR: '   ' }, { homedir: home }), path.join(home, 'Documents', 'Petri-Local'));
});

test('BLOCK-203 W4b P1 — 用户态根优先序：USER_DATA_DIR > ~/.petri（路径语义与改前一致）', () => {
  const home = '/tmp/fake-home';
  assert.equal(dataPaths.resolveUserStateDir({ PETRI_USER_DATA_DIR: '/u' }, { homedir: home }), '/u');
  assert.equal(dataPaths.resolveUserStateDir({}, { homedir: home }), path.join(home, '.petri'));
  // 应用数据根的 env 不得影响用户态根（两个根各有各的链）
  assert.equal(dataPaths.resolveUserStateDir({ PETRI_LOCAL_DATA_DIR: '/a', LOCAL_DATA_DIR: '/b' }, { homedir: home }), path.join(home, '.petri'));
});

test('BLOCK-203 W4b P1 — 四个落点模块算出的根一致（同一 env 下不再各说各话）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'b203-data-root-'));
  const previous = { ...process.env };
  try {
    process.env.PETRI_LOCAL_DATA_DIR = dir;
    const userPrefs = require(path.join(ROOT, 'core/petri-server/helpers/user-prefs.js'));
    const mcpSettings = require(path.join(ROOT, 'core/petri-server/helpers/mcp-settings.js'));
    const userRules = require(path.join(ROOT, 'core/petri-server/helpers/agent-user-rules.js'));
    const skillPrefs = require(path.join(ROOT, 'core/shared-backend/skill-prefs.js'));

    assert.equal(userPrefs.resolveDataDir(), dir);
    assert.equal(mcpSettings.settingsFile(), path.join(dir, 'mcp-servers.json'));
    assert.equal(userRules.rulesFile(userRules.dataDir()), path.join(dir, 'agent-rules.json'));
    // 技能治理账本住在**用户态根**（声明过的例外，不是漏改）
    assert.equal(skillPrefs.getPrefsFilePath(), path.join(skillPrefs.getUserDataBaseDir(), 'skills-prefs.json'));
    assert.equal(skillPrefs.getUserDataBaseDir(), dataPaths.resolveUserStateDir());
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('BLOCK-203 W4b P1 — 只设 USER_DATA_DIR：数据面模块跟随它（不再回落到 ~/Documents）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'b203-data-user-'));
  const previous = { ...process.env };
  try {
    delete process.env.PETRI_LOCAL_DATA_DIR;
    delete process.env.LOCAL_DATA_DIR;
    process.env.PETRI_USER_DATA_DIR = dir;
    const userPrefs = require(path.join(ROOT, 'core/petri-server/helpers/user-prefs.js'));
    const mcpSettings = require(path.join(ROOT, 'core/petri-server/helpers/mcp-settings.js'));
    assert.equal(userPrefs.resolveDataDir(), dir);
    assert.equal(mcpSettings.settingsFile(), path.join(dir, 'mcp-servers.json'));
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('BLOCK-203 W4b P1 — user-prefs 旧落点只读兼容：cwd/data 的旧文件仍读得到（不迁不删）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'b203-data-legacy-'));
  const previous = { ...process.env };
  try {
    // 只读兼容的判定：显式给出主目录（不存在）+ 旧目录候选（存在）时，必须读到旧文件。
    // 不写任何东西——本测早期版本曾把 writePrefs 打到真实 ~/Documents/Petri-Local，已修。
    delete process.env.PETRI_LOCAL_DATA_DIR;
    delete process.env.LOCAL_DATA_DIR;
    delete process.env.PETRI_USER_DATA_DIR;
    fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'data', 'user-prefs.json'), JSON.stringify({ theme: 'dark' }), 'utf8');

    const userPrefs = require(path.join(ROOT, 'core/petri-server/helpers/user-prefs.js'));
    const primary = path.join(dir, 'fresh'); // 不存在：逼迫走旧目录回落
    assert.deepEqual(userPrefs.readPrefsWithDiagnostics(primary, [path.join(dir, 'data')]).prefs, { theme: 'dark' });
    // 旧目录候选为空数组时不得凭空读别处
    assert.deepEqual(userPrefs.readPrefsWithDiagnostics(primary, []).prefs, {});
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('BLOCK-203 W4b P1 — 静态门：四个落点模块不许再自己写 env 优先序', () => {
  const modules = [
    'core/petri-server/helpers/user-prefs.js',
    'core/petri-server/helpers/mcp-settings.js',
    'core/petri-server/helpers/agent-user-rules.js',
    'core/shared-backend/skill-prefs.js',
  ];
  for (const rel of modules) {
    const src = read(rel);
    assert.ok(src.includes('data-paths'), `${rel} 未接 shared-backend/data-paths（单源没落到这个模块）`);
    assert.equal(
      /process\.env\.PETRI_LOCAL_DATA_DIR\s*\|\|/.test(src),
      false,
      `${rel} 仍在手写 env 优先序（PETRI_LOCAL_DATA_DIR || …）——目录解析只许有一份实现`,
    );
  }
});
