// ============================================================
// BLOCK-211 W8 收尾 — PETRI_PACK_DIRS 外部领域包发现契约。
//
// 背景（C-33）：`skills:check` 的 5 红根因是兄弟仓 petri-pack-bio 未检出；
// 代码侧补了 PETRI_PACK_DIRS 让 pack 放在任意位置都能被承认，但一直无机械断言。
// 本测钉住：多目录 path.delimiter 展开、无效目录跳过不抛、与 projectRoot
// 兄弟包/extraDirs 合并去重、以及"承认位置但判据不变"（仍走 validatePackDir 全量校验）。
// ============================================================
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const packRegistry = require('../core/shared-backend/pack-registry.js');

function makeFixturePack(dir, { packId, withPluginsIndex = true } = {}) {
  fs.mkdirSync(path.join(dir, 'plugins'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'pack.json'), JSON.stringify({ packId, name: packId, version: '0.1.0' }));
  if (withPluginsIndex) {
    fs.writeFileSync(path.join(dir, 'plugins', 'installed.json'), '[]');
  }
  return dir;
}

function tempRoot(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function withEnvPackDirs(value, fn) {
  const previous = process.env.PETRI_PACK_DIRS;
  if (value === undefined) delete process.env.PETRI_PACK_DIRS;
  else process.env.PETRI_PACK_DIRS = value;
  try {
    return fn();
  } finally {
    if (previous === undefined) delete process.env.PETRI_PACK_DIRS;
    else process.env.PETRI_PACK_DIRS = previous;
  }
}

test('BLOCK-211 pack dirs: PETRI_PACK_DIRS 多目录（path.delimiter）全部被发现且保序', () => {
  const root = tempRoot('block211-packdirs-a-');
  const first = makeFixturePack(path.join(root, 'first'), { packId: 'p_first' });
  const second = makeFixturePack(path.join(root, 'second'), { packId: 'p_second' });

  const available = withEnvPackDirs([first, second].join(path.delimiter), () =>
    packRegistry.discoverAvailablePacks({}));

  assert.deepEqual(available.map((item) => item.packId), ['p_first', 'p_second']);
  assert.deepEqual(available.map((item) => item.packRoot), [path.resolve(first), path.resolve(second)]);
});

test('BLOCK-211 pack dirs: 不存在/非包目录被跳过，不抛错', () => {
  const root = tempRoot('block211-packdirs-b-');
  const good = makeFixturePack(path.join(root, 'good'), { packId: 'p_good' });
  const notPack = path.join(root, 'plain');
  fs.mkdirSync(notPack, { recursive: true });
  const missing = path.join(root, 'missing');

  const available = withEnvPackDirs([missing, notPack, good].join(path.delimiter), () =>
    packRegistry.discoverAvailablePacks({}));

  assert.deepEqual(available.map((item) => item.packId), ['p_good']);
});

test('BLOCK-211 pack dirs: 非法包（缺 plugins/installed.json）仍被拒——位置可配不等于判据放宽', () => {
  const root = tempRoot('block211-packdirs-c-');
  const invalid = makeFixturePack(path.join(root, 'invalid'), { packId: 'p_invalid', withPluginsIndex: false });

  const available = withEnvPackDirs(invalid, () => packRegistry.discoverAvailablePacks({}));

  assert.deepEqual(available, []);
});

test('BLOCK-211 pack dirs: projectRoot 兄弟包 + env + extraDirs 合并去重', () => {
  const root = tempRoot('block211-packdirs-d-');
  const projectRoot = path.join(root, 'project');
  fs.mkdirSync(projectRoot, { recursive: true });
  const sibling = makeFixturePack(path.join(root, 'petri-pack-bio'), { packId: 'p_sibling' });
  const envPack = makeFixturePack(path.join(root, 'env-pack'), { packId: 'p_env' });
  const extraPack = makeFixturePack(path.join(root, 'extra-pack'), { packId: 'p_extra' });

  const available = withEnvPackDirs([envPack, sibling, envPack].join(path.delimiter), () =>
    packRegistry.discoverAvailablePacks({ projectRoot, extraDirs: [extraPack, sibling] }));

  assert.deepEqual(available.map((item) => item.packId), ['p_sibling', 'p_env', 'p_extra']);
});

test('BLOCK-211 pack dirs: 未设置 env 时行为与旧版一致（只认 projectRoot 兄弟包）', () => {
  const root = tempRoot('block211-packdirs-e-');
  const projectRoot = path.join(root, 'project');
  fs.mkdirSync(projectRoot, { recursive: true });
  makeFixturePack(path.join(root, 'petri-pack-bio'), { packId: 'p_sibling' });
  makeFixturePack(path.join(root, 'unrelated'), { packId: 'p_unrelated' });

  const available = withEnvPackDirs(undefined, () => packRegistry.discoverAvailablePacks({ projectRoot }));

  assert.deepEqual(available.map((item) => item.packId), ['p_sibling']);
});
