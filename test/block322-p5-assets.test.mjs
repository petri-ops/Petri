import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const assets = require('../core/petri-server/helpers/model3d-assets.js');

function workspace() { return fs.mkdtempSync(path.join(os.tmpdir(), 'assets-')); }

test('BLOCK-322 P5-01 资产入链 — 复制到 sha 路径、provenance、可 add_node 引用', async () => {
  const root = workspace();
  fs.mkdirSync(path.join(root, 'model3d'), { recursive: true });
  const source = path.join(root, 'model3d', 'incoming.glb');
  fs.writeFileSync(source, Buffer.from('glTF-test-payload'));
  const result = await assets.importMeshAsset({
    workspaceRoot: root,
    sourcePath: 'model3d/incoming.glb',
    name: 'robot-arm',
    provenance: { model: 'mock-gen-1', promptHash: 'a'.repeat(64), parameters: { seed: 7 } },
  });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.match(result.asset.sha256, /^[a-f0-9]{64}$/);
  assert.equal(result.asset.path, `model3d/assets/${result.asset.sha256}.glb`);
  assert.equal(fs.existsSync(path.join(root, result.asset.path)), true);
  assert.equal(result.node.type, 'mesh-reference');
  assert.equal(result.node.source.sourceSha256, result.asset.sha256);
  assert.equal(result.provenance.model, 'mock-gen-1');
  const listed = assets.listAssets({ workspaceRoot: root, query: 'robot' });
  assert.equal(listed.ok, true);
  assert.equal(listed.assets.length, 1);
  const got = assets.getAsset({ workspaceRoot: root, assetId: result.asset.id });
  assert.equal(got.asset.sha256, result.asset.sha256);
});

test('BLOCK-322 P6-02 资产库 — 同 sha 去重，不同内容不覆盖；篡改目标字节拒绝', async () => {
  const root = workspace();
  fs.mkdirSync(path.join(root, 'model3d'), { recursive: true });
  fs.writeFileSync(path.join(root, 'model3d', 'a.glb'), Buffer.from('same'));
  const first = await assets.importMeshAsset({ workspaceRoot: root, sourcePath: 'model3d/a.glb' });
  const second = await assets.importMeshAsset({ workspaceRoot: root, sourcePath: 'model3d/a.glb', name: 'renamed' });
  assert.equal(first.asset.sha256, second.asset.sha256);
  assert.equal(assets.listAssets({ workspaceRoot: root }).total, 1);
  // 模拟目标文件被篡改：再导入必须拒绝，不能把错字节登记成同一 sha。
  fs.writeFileSync(path.join(root, first.asset.path), Buffer.from('tampered'));
  const tampered = await assets.importMeshAsset({ workspaceRoot: root, sourcePath: 'model3d/a.glb' });
  assert.equal(tampered.ok, false);
  assert.equal(tampered.error, 'asset_copy_hash_mismatch');
});

test('BLOCK-322 P5-01 — 非法格式/越界/缺失 fail-closed', async () => {
  const root = workspace();
  fs.mkdirSync(path.join(root, 'model3d'), { recursive: true });
  fs.writeFileSync(path.join(root, 'model3d', 'a.txt'), 'x');
  assert.equal((await assets.importMeshAsset({ workspaceRoot: root, sourcePath: 'model3d/a.txt' })).error, 'mesh_format_unsupported');
  assert.equal((await assets.importMeshAsset({ workspaceRoot: root, sourcePath: 'model3d/none.glb' })).error, 'mesh_not_found');
  assert.equal(assets.listAssets({ workspaceRoot: root }).total, 0);
});
