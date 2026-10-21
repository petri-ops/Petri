/**
 * BLOCK-234 — Q-DOMAIN P4-C S3a：demo assets 下沉 pack。
 * 钉住 loader 边界与 tools-assets 的静态装配（PUBLIC_DEMO_ASSETS/JOB_IDS）。
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { installDemoPackFixture } from './helpers/demo-pack-fixture.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const fixture = installDemoPackFixture();
after(() => fixture.cleanup());

const { loadPublicDemoAssets } = require(path.join(ROOT, 'core/petri-server/helpers/pack-demo-assets.js'));
const { PUBLIC_DEMO_ASSETS, PUBLIC_DEMO_JOB_IDS } = require(path.join(ROOT, 'core/petri-server/helpers/tools-assets.js'));

const tempDirs = [];
after(() => {
  for (const dir of tempDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});

function makePack(dataDir, packId, assets, extra = {}) {
  const packRoot = path.join(dataDir, packId);
  fs.mkdirSync(packRoot, { recursive: true });
  fs.writeFileSync(path.join(packRoot, 'pack.json'), JSON.stringify({
    packId,
    provides: extra.provides === undefined ? { demoAssets: 'demo-assets.json' } : extra.provides,
  }));
  if (assets !== null) {
    fs.writeFileSync(path.join(packRoot, 'demo-assets.json'), JSON.stringify(assets));
  }
  return { packId, packRoot, enabled: extra.enabled !== false, version: '1.0.0' };
}

function withPacks(packs) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-b234-demo-'));
  tempDirs.push(dataDir);
  fs.mkdirSync(path.join(dataDir, 'packs'), { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'packs', 'installed.json'), JSON.stringify(packs));
  const previous = process.env.PETRI_LOCAL_DATA_DIR;
  process.env.PETRI_LOCAL_DATA_DIR = dataDir;
  return () => {
    if (previous === undefined) delete process.env.PETRI_LOCAL_DATA_DIR;
    else process.env.PETRI_LOCAL_DATA_DIR = previous;
  };
}

test('tools-assets 从夹具 pack 装配 demo 映射与保护集合', () => {
  assert.equal(Object.keys(PUBLIC_DEMO_ASSETS).length, 22);
  assert.ok(Object.isFrozen(PUBLIC_DEMO_ASSETS));
  assert.ok(PUBLIC_DEMO_JOB_IDS.has('job_bdd759f1fd7a46f1'));
  assert.equal(PUBLIC_DEMO_ASSETS['deseq2'], 'job_5c2047cb727e4d42');
});

test('启用包装载、停用包忽略', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-b234-demo-'));
  tempDirs.push(dataDir);
  const enabled = makePack(dataDir, 'a-enabled', { 'tool-a': 'job_a' });
  const disabled = makePack(dataDir, 'b-disabled', { 'tool-b': 'job_b' }, { enabled: false });
  const restore = withPacks([enabled, disabled]);
  try {
    const { assets, warnings } = loadPublicDemoAssets();
    assert.deepEqual(assets, { 'tool-a': 'job_a' });
    assert.deepEqual(warnings, []);
  } finally {
    restore();
  }
});

test('路径逃逸拒绝装载并留 warning', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-b234-demo-'));
  tempDirs.push(dataDir);
  const pack = makePack(dataDir, 'escape', null, { provides: { demoAssets: '../escape.json' } });
  fs.writeFileSync(path.join(dataDir, 'escape.json'), JSON.stringify({ 'tool-x': 'job_x' }));
  const restore = withPacks([pack]);
  try {
    const { assets, warnings } = loadPublicDemoAssets();
    assert.deepEqual(assets, {});
    assert.ok(warnings.some((warning) => warning.code === 'path_outside_pack'), JSON.stringify(warnings));
  } finally {
    restore();
  }
});

test('非法条目跳过；跨包同键后装覆盖并留 warning', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-b234-demo-'));
  tempDirs.push(dataDir);
  const a = makePack(dataDir, 'a-pack', { same: 'job_old', 'bad id': 'job_bad', ok: 'job_ok' });
  const b = makePack(dataDir, 'b-pack', { same: 'job_new' });
  const restore = withPacks([b, a]);
  try {
    const { assets, warnings } = loadPublicDemoAssets();
    assert.equal(assets.same, 'job_new');
    assert.equal(assets.ok, 'job_ok');
    assert.equal(assets['bad id'], undefined);
    assert.ok(warnings.some((warning) => warning.code === 'demo_asset_invalid'));
    assert.ok(warnings.some((warning) => warning.code === 'demo_asset_overridden'));
  } finally {
    restore();
  }
});
