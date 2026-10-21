/**
 * BLOCK-235 — dataModelExtensions bounded loader + additive merge rules.
 * Pins: valid extension, disabled/missing pack, path escape, bad version/shape,
 * multi-pack override, canonical-id rejection, invalid definition rejection.
 */

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { loadDataModelExtensions } = require(path.join(ROOT, 'core/shared-backend/pack-data-model-extensions.js'));
const { applyDataModelExtensions } = require(path.join(ROOT, 'core/shared-backend/artifact-profiles.js'));

const VALID = JSON.parse(fs.readFileSync(path.join(ROOT, 'test/fixtures/data-model-extension.json'), 'utf8'));
const CUSTOM = VALID.artifactProfiles[0];
const tempDirs = [];
after(() => {
  for (const dir of tempDirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});

function makePack(dataDir, packId, content, { enabled = true, relative = 'data-model-extensions.json', provides = true } = {}) {
  const packRoot = path.join(dataDir, packId);
  fs.mkdirSync(packRoot, { recursive: true });
  fs.writeFileSync(path.join(packRoot, 'pack.json'), JSON.stringify({
    packId,
    provides: provides ? { dataModelExtensions: relative } : {},
  }));
  if (content !== null) {
    fs.writeFileSync(path.join(packRoot, 'data-model-extensions.json'), JSON.stringify(content));
  }
  return { packId, packRoot, enabled, version: '1.0.0' };
}

function withPacks(packs) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-b235-load-'));
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

test('loads a valid extension from an enabled pack and ignores a disabled pack', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-b235-load-'));
  tempDirs.push(dataDir);
  const enabled = makePack(dataDir, 'a-enabled', VALID);
  const disabled = makePack(dataDir, 'b-disabled', VALID, { enabled: false });
  const restore = withPacks([enabled, disabled]);
  try {
    const loaded = loadDataModelExtensions();
    assert.equal(loaded.profiles.length, 1);
    assert.equal(loaded.profiles[0].packId, 'a-enabled');
    assert.equal(loaded.profiles[0].definition.profileId, 'petri.custom-table.v1');
    assert.deepEqual(loaded.warnings, []);
  } finally {
    restore();
  }
});

test('path escape, unsupported version and bad shapes are rejected with warnings', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-b235-load-'));
  tempDirs.push(dataDir);
  const escape = makePack(dataDir, 'escape', null, { relative: '../escape.json' });
  fs.writeFileSync(path.join(dataDir, 'escape.json'), JSON.stringify(VALID));
  const version = makePack(dataDir, 'version', { version: 2, artifactProfiles: [CUSTOM] });
  const shape = makePack(dataDir, 'shape', { version: 1, artifactProfiles: {} });
  const missing = makePack(dataDir, 'missing', null, { provides: false });
  const restore = withPacks([escape, version, shape, missing]);
  try {
    const loaded = loadDataModelExtensions();
    assert.deepEqual(loaded.profiles, []);
    assert.ok(loaded.warnings.some((warning) => warning.code === 'path_outside_pack'), JSON.stringify(loaded.warnings));
    assert.ok(loaded.warnings.some((warning) => warning.code === 'data_model_extensions_version_unsupported'));
    assert.ok(loaded.warnings.some((warning) => warning.code === 'artifact_profiles_not_array'));
  } finally {
    restore();
  }
});

test('a later pack wins on a duplicate extension id with a warning', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-b235-load-'));
  tempDirs.push(dataDir);
  const first = makePack(dataDir, 'a-pack', {
    version: 1,
    artifactProfiles: [{ ...CUSTOM, description: 'first definition' }],
  });
  const second = makePack(dataDir, 'b-pack', {
    version: 1,
    artifactProfiles: [{ ...CUSTOM, description: 'second definition' }],
  });
  const restore = withPacks([second, first]);
  try {
    const loaded = loadDataModelExtensions();
    assert.equal(loaded.profiles.length, 1);
    assert.equal(loaded.profiles[0].packId, 'b-pack');
    assert.equal(loaded.profiles[0].definition.description, 'second definition');
    assert.ok(loaded.warnings.some((warning) => warning.code === 'artifact_profile_extension_overridden'));
  } finally {
    restore();
  }
});

test('applyDataModelExtensions rejects canonical overrides and invalid profiles, adds valid ones', () => {
  const profiles = { 'petri.deg.v1': { profileId: 'petri.deg.v1' } };
  const warnings = [];
  const result = applyDataModelExtensions({
    profiles,
    extensions: [
      { packId: 'override', definition: { profileId: 'petri.deg.v1' } },
      { packId: 'invalid', definition: { profileId: 'petri.bad.v2', familyId: 'petri.bad', profileKind: 'data' } },
      { packId: 'missing-id', definition: {} },
      { packId: 'valid', definition: CUSTOM },
    ],
    warnings,
  });
  assert.deepEqual(result.added, ['petri.custom-table.v1']);
  assert.ok(profiles['petri.custom-table.v1']);
  assert.equal(profiles['petri.deg.v1'].profileId, 'petri.deg.v1', 'canonical stub is untouched');
  assert.ok(warnings.some((warning) => warning.code === 'artifact_profile_extension_override_rejected'));
  assert.ok(warnings.some((warning) => warning.code === 'artifact_profile_extension_invalid'));
  assert.ok(warnings.some((warning) => warning.code === 'artifact_profile_extension_id_invalid'));
});
