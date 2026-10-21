/**
 * BLOCK-234 — Q-DOMAIN P4-C S3b：artifact profile actors 下沉 pack。
 * 钉住 loader 边界，以及 profile registry 在冻结前合并 pack actor 映射。
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import './helpers/artifact-actors-fixture-auto.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const { loadArtifactProfileActors } = require(path.join(ROOT, 'core/shared-backend/pack-artifact-profile-actors.js'));
const profileRegistry = require(path.join(ROOT, 'core/shared-backend/artifact-profiles.js'));

const tempDirs = [];
after(() => {
  for (const dir of tempDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});

function makePack(dataDir, packId, actors, extra = {}) {
  const packRoot = path.join(dataDir, packId);
  fs.mkdirSync(packRoot, { recursive: true });
  fs.writeFileSync(path.join(packRoot, 'pack.json'), JSON.stringify({
    packId,
    provides: extra.provides === undefined ? { artifactProfileActors: 'artifact-profile-actors.json' } : extra.provides,
  }));
  if (actors !== null) {
    fs.writeFileSync(path.join(packRoot, 'artifact-profile-actors.json'), JSON.stringify(actors));
  }
  return { packId, packRoot, enabled: extra.enabled !== false, version: '1.0.0' };
}

function withPacks(packs) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-b234-actors-'));
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

test('profile registry 冻结前合并 pack actors（deg 的生产者/消费者）', () => {
  const profile = profileRegistry.getProfile('petri.deg.v1');
  assert.ok(profile.producers.includes('deg-standardizer'));
  assert.ok(profile.directProducers.includes('deseq2'));
  assert.ok(profile.consumers.includes('volcano-plot'));
  assert.equal(profileRegistry.isProducer('petri.deg.v1', 'deseq2'), true);
  assert.equal(profileRegistry.isConsumer('petri.deg.v1', 'volcano-plot'), true);
  assert.equal(profileRegistry.isConsumer('petri.deg.v1', 'not-a-tool'), false);
});

test('启用包装载、停用包忽略', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-b234-actors-'));
  tempDirs.push(dataDir);
  const enabled = makePack(dataDir, 'a-enabled', { 'petri.x.v1': { consumers: ['tool-a'] } });
  const disabled = makePack(dataDir, 'b-disabled', { 'petri.y.v1': { consumers: ['tool-b'] } }, { enabled: false });
  const restore = withPacks([enabled, disabled]);
  try {
    const { actors, warnings } = loadArtifactProfileActors();
    assert.deepEqual(actors, { 'petri.x.v1': { consumers: ['tool-a'] } });
    assert.deepEqual(warnings, []);
  } finally {
    restore();
  }
});

test('路径逃逸拒绝装载并留 warning', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-b234-actors-'));
  tempDirs.push(dataDir);
  const pack = makePack(dataDir, 'escape', null, { provides: { artifactProfileActors: '../escape.json' } });
  fs.writeFileSync(path.join(dataDir, 'escape.json'), JSON.stringify({ 'petri.x.v1': { consumers: ['tool-x'] } }));
  const restore = withPacks([pack]);
  try {
    const { actors, warnings } = loadArtifactProfileActors();
    assert.deepEqual(actors, {});
    assert.ok(warnings.some((warning) => warning.code === 'path_outside_pack'), JSON.stringify(warnings));
  } finally {
    restore();
  }
});

test('非法 actor 跳过；跨包同键后装覆盖并留 warning', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-b234-actors-'));
  tempDirs.push(dataDir);
  const a = makePack(dataDir, 'a-pack', {
    'petri.same.v1': { producers: ['tool-old'] },
    'petri.bad.v1': { consumers: ['bad id', 42] },
  });
  const b = makePack(dataDir, 'b-pack', { 'petri.same.v1': { producers: ['tool-new'] } });
  const restore = withPacks([b, a]);
  try {
    const { actors, warnings } = loadArtifactProfileActors();
    assert.deepEqual(actors['petri.same.v1'], { producers: ['tool-new'] });
    assert.equal(actors['petri.bad.v1'], undefined);
    assert.ok(warnings.some((warning) => warning.code === 'profile_actor_set_invalid'));
    assert.ok(warnings.some((warning) => warning.code === 'profile_actors_overridden'));
  } finally {
    restore();
  }
});
