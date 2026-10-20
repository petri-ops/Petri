// ============================================================
// BLOCK-216 Q5 — 领域包工作面贡献投影 + 资产路径安全契约。
// 红绿先行：pack 在位 → views/resultSurfaces/uiActions 出现；停用/卸载 → 消失；
// 越界/缺失/重复/非法形状只丢该条并回传 diagnostic；协议与投影共用同一路径判定。
// ============================================================
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const packRegistry = require('../core/shared-backend/pack-registry.js');
const {
  loadPackContributions,
  resolvePackAssetPath,
  mimeForPackAsset,
} = require('../core/petri-server/helpers/pack-contributions.js');
const { installedPackRoot } = require('../src/main/pack-ui/scheme.js');

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'block216-pack-contributions-'));
}

function makePack(root, { packId = 'pack_fixture', provides } = {}) {
  const packRoot = path.join(root, 'pack');
  fs.mkdirSync(path.join(packRoot, 'plugins'), { recursive: true });
  fs.mkdirSync(path.join(packRoot, 'ui'), { recursive: true });
  fs.writeFileSync(path.join(packRoot, 'ui', 'lab.html'), '<!doctype html><title>lab</title>');
  fs.writeFileSync(path.join(packRoot, 'ui', 'result.html'), '<!doctype html><title>result</title>');
  fs.writeFileSync(path.join(packRoot, 'plugins', 'installed.json'), '[]');
  fs.writeFileSync(path.join(packRoot, 'pack.json'), JSON.stringify({
    packId,
    name: 'Fixture Pack',
    version: '0.1.0',
    provides: provides || {
      views: [{ id: 'lab', title: '实验台', entry: 'ui/lab.html', order: 20 }],
      resultSurfaces: [{
        id: 'result',
        title: '结果面',
        entry: 'ui/result.html',
        artifactTypes: ['plot', 'table'],
        priority: 10,
      }],
      uiActions: [{ id: 'focus', label: '聚焦', surfaceId: 'lab' }],
    },
  }));
  return packRoot;
}

function install(dataDir, packRoot, packId = 'pack_fixture', extra = {}) {
  packRegistry.writeInstalledPacks(dataDir, [{
    packId,
    packRoot,
    version: '0.1.0',
    requiresRuntimes: [],
    installedAt: '2026-10-20T00:00:00Z',
    ...extra,
  }]);
}

test('BLOCK-216 contributions: installed pack projects views/result surfaces/actions', () => {
  const root = tempRoot();
  try {
    const packRoot = makePack(root);
    const loaded = loadPackContributions({ dataDir: root });
    // installed.json 尚未写入 → 无包
    assert.deepEqual(loaded.packs, []);
    install(root, packRoot);
    const result = loadPackContributions({ dataDir: root });
    assert.equal(result.packs.length, 1);
    assert.equal(result.packs[0].packId, 'pack_fixture');
    assert.deepEqual(result.packs[0].views.map((view) => view.id), ['lab']);
    assert.equal(result.packs[0].views[0].publicId, 'pack:pack_fixture:lab');
    assert.deepEqual(result.packs[0].resultSurfaces.map((surface) => surface.id), ['result']);
    assert.equal(result.packs[0].resultSurfaces[0].publicId, 'pack:pack_fixture:result:result');
    assert.deepEqual(result.packs[0].uiActions.map((action) => action.id), ['focus']);
    assert.equal(result.packs[0].uiActions[0].publicId, 'pack:pack_fixture:action:focus');
    assert.equal(result.packs[0].uiActions[0].surfaceId, 'pack:pack_fixture:lab');
    assert.equal(result.packs[0].packRoot, undefined, 'packRoot must never leak to the renderer');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('BLOCK-216 contributions: disabled pack disappears', () => {
  const root = tempRoot();
  try {
    const packRoot = makePack(root);
    install(root, packRoot, 'pack_fixture', { enabled: false });
    assert.deepEqual(loadPackContributions({ dataDir: root }).packs, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('BLOCK-216 contributions: unsafe, missing, duplicate entries are dropped with diagnostics', () => {
  const root = tempRoot();
  try {
    const packRoot = makePack(root, {
      provides: {
        views: [
          { id: 'escape', title: '逃逸', entry: '../outside.html' },
          { id: 'absolute', title: '绝对', entry: '/etc/passwd' },
          { id: 'missing', title: '缺失', entry: 'ui/nope.html' },
          { id: 'ok', title: '正常', entry: 'ui/lab.html' },
          { id: 'ok', title: '重复', entry: 'ui/lab.html' },
        ],
        resultSurfaces: [
          { id: 'bad-types', artifactTypes: [] },
          { id: 'ok-result', artifactTypes: ['plot'], entry: 'ui/result.html' },
        ],
        uiActions: [{ id: 'no-label' }, { id: 'ok-action', label: '动作' }],
      },
    });
    install(root, packRoot);
    const result = loadPackContributions({ dataDir: root });
    assert.deepEqual(result.packs[0].views.map((view) => view.id), ['ok']);
    assert.deepEqual(result.packs[0].resultSurfaces.map((surface) => surface.id), ['ok-result']);
    assert.deepEqual(result.packs[0].uiActions.map((action) => action.id), ['ok-action']);
    const codes = result.diagnostics.map((item) => item.code);
    assert.ok(codes.includes('entry_missing_or_unsafe'));
    assert.ok(codes.includes('duplicate_id'));
    assert.ok(codes.includes('missing_id_or_artifact_types'));
    assert.ok(codes.includes('missing_id_or_label'));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('BLOCK-216 contributions: malformed provides arrays are diagnosed, not thrown', () => {
  const root = tempRoot();
  try {
    const packRoot = makePack(root, {
      provides: { views: 'nope', resultSurfaces: {}, uiActions: 42 },
    });
    install(root, packRoot);
    const result = loadPackContributions({ dataDir: root });
    assert.deepEqual(result.packs, []);
    assert.equal(result.diagnostics.filter((item) => item.code === 'invalid_shape').length, 3);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('BLOCK-216 pack protocol: only installed + enabled packs resolve to a root', () => {
  const root = tempRoot();
  const prev = process.env.PETRI_LOCAL_DATA_DIR;
  try {
    const packRoot = makePack(root);
    process.env.PETRI_LOCAL_DATA_DIR = root;
    assert.equal(installedPackRoot('pack_fixture'), null);
    install(root, packRoot);
    assert.equal(installedPackRoot('pack_fixture'), packRoot);
    install(root, packRoot, 'pack_fixture', { enabled: false });
    assert.equal(installedPackRoot('pack_fixture'), null);
    assert.equal(installedPackRoot('missing'), null);
  } finally {
    if (prev === undefined) delete process.env.PETRI_LOCAL_DATA_DIR;
    else process.env.PETRI_LOCAL_DATA_DIR = prev;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('BLOCK-216 asset path: traversal, absolute and missing files are rejected', () => {
  const root = tempRoot();
  try {
    const packRoot = makePack(root);
    assert.equal(resolvePackAssetPath(packRoot, 'ui/lab.html')?.filePath, fs.realpathSync(path.join(packRoot, 'ui', 'lab.html')));
    assert.equal(resolvePackAssetPath(packRoot, '../outside.html'), null);
    assert.equal(resolvePackAssetPath(packRoot, '/etc/passwd'), null);
    assert.equal(resolvePackAssetPath(packRoot, 'C:/Windows/win.ini'), null);
    assert.equal(resolvePackAssetPath(packRoot, 'https://evil.example/x.html'), null);
    assert.equal(resolvePackAssetPath(packRoot, 'ui'), null, 'directories are not assets');
    assert.equal(resolvePackAssetPath(packRoot, 'ui/nope.html'), null);
    assert.equal(mimeForPackAsset('ui/lab.html'), 'text/html; charset=utf-8');
    assert.equal(mimeForPackAsset('ui/lab.wasm'), 'application/octet-stream');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('BLOCK-216 asset path: symlink escape is rejected when the platform allows symlinks', () => {
  const root = tempRoot();
  try {
    const packRoot = makePack(root);
    const outside = path.join(root, 'outside.txt');
    fs.writeFileSync(outside, 'secret');
    const link = path.join(packRoot, 'ui', 'link.txt');
    try {
      fs.symlinkSync(outside, link);
    } catch (error) {
      if (error.code === 'EPERM' || error.code === 'EACCES' || error.code === 'UNKNOWN') return;
      throw error;
    }
    assert.equal(resolvePackAssetPath(packRoot, 'ui/link.txt'), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
