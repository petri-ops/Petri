import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createModel3DSharePackage } = require('../core/petri-server/helpers/model3d-share-package.js');

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'share-'));
  fs.mkdirSync(path.join(root, 'model3d', 'runs'), { recursive: true });
  const scene = path.join(root, 'model3d', 'scene.scene3d.json');
  const output = path.join(root, 'model3d', 'runs', 'scene.glb');
  fs.writeFileSync(scene, '{"version":"scene3d/v1"}');
  fs.writeFileSync(output, 'glb-bytes');
  const crypto = require('node:crypto');
  const sha = crypto.createHash('sha256').update('glb-bytes').digest('hex');
  const manifest = path.join(root, 'model3d', 'runs', 'manifest.json');
  fs.writeFileSync(manifest, JSON.stringify({ sceneHash: 'a'.repeat(64), outputs: [{ path: 'model3d/runs/scene.glb', sha256: sha }] }));
  return { root, scene: 'model3d/scene.scene3d.json', manifest: 'model3d/runs/manifest.json' };
}

test('BLOCK-322 P6-04 分享包 — scene+manifest+产物+checksums，zip 可复算', async () => {
  const ctx = setup();
  const first = await createModel3DSharePackage({ workspaceRoot: ctx.root, scenePath: ctx.scene, manifestPath: ctx.manifest, packageName: 'box' });
  assert.equal(first.ok, true, JSON.stringify(first));
  const zipPath = path.join(ctx.root, first.zip.path);
  assert.equal(fs.existsSync(zipPath), true);
  assert.equal(fs.readFileSync(zipPath).subarray(0, 2).toString(), 'PK');
  assert.equal(first.bundle.files.length, 1);
  assert.match(first.zip.sha256, /^[a-f0-9]{64}$/);
  assert.match(first.bundleSha256, /^[a-f0-9]{64}$/);
});

test('BLOCK-322 P6-04 分享包 — 缺件与 manifest sha 不符拒绝', async () => {
  const missing = setup();
  fs.rmSync(path.join(missing.root, 'model3d/runs/scene.glb'));
  const missingResult = await createModel3DSharePackage({ workspaceRoot: missing.root, scenePath: missing.scene, manifestPath: missing.manifest });
  assert.equal(missingResult.error, 'share_file_missing');
  const mismatch = setup();
  const manifest = JSON.parse(fs.readFileSync(path.join(mismatch.root, mismatch.manifest), 'utf8'));
  manifest.outputs[0].sha256 = 'b'.repeat(64);
  fs.writeFileSync(path.join(mismatch.root, mismatch.manifest), JSON.stringify(manifest));
  const mismatchResult = await createModel3DSharePackage({ workspaceRoot: mismatch.root, scenePath: mismatch.scene, manifestPath: mismatch.manifest });
  assert.equal(mismatchResult.error, 'share_output_hash_mismatch');
});
