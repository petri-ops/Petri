/**
 * item 83 HK-01：生成产物受控读面 URL 拼装 + 路径 fail-closed。
 * 产物落在 <dataDir>/generated/generate-*，不得通过 ../、绝对路径、盘符、子目录越界。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require_ = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const {
  buildGeneratedArtifactUrl,
  resolveGeneratedArtifactPath,
} = require_(path.join(ROOT, 'core', 'petri-server', 'routes', 'generated-file.js'));

test('HK-01-1：四类产物的 URL 单一真值', () => {
  assert.equal(buildGeneratedArtifactUrl('image', 'a b.png'), '/api/generated/file/image/a%20b.png');
  assert.equal(buildGeneratedArtifactUrl('video', 'v.mp4'), '/api/generated/file/video/v.mp4');
  assert.equal(buildGeneratedArtifactUrl('model3d', 's.glb'), '/api/generated/file/model3d/s.glb');
  assert.equal(buildGeneratedArtifactUrl('html', 'p.html'), '/api/generated/file/html/p.html');
});

test('HK-01-2：合法扁平文件名解析到 generate-* 根下真实文件', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gen-file-'));
  const root = path.join(dataDir, 'generated', 'generate-image');
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, 'a.png'), Buffer.from('png'));
  try {
    const resolved = resolveGeneratedArtifactPath('image', 'a.png', { dataDir });
    assert.equal(resolved, path.join(root, 'a.png'));
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('HK-01-3：越界与未知 kind 一律拒绝（fail-closed）', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gen-file-bound-'));
  try {
    for (const bad of [
      '../secret.png',
      '/etc/passwd',
      'C:\\secret.png',
      'sub/a.png',
      '..',
      '',
    ]) {
      assert.equal(resolveGeneratedArtifactPath('image', bad, { dataDir }), null, `must reject: ${bad}`);
    }
    assert.equal(resolveGeneratedArtifactPath('bogus', 'a.png', { dataDir }), null, 'unknown kind must reject');
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
