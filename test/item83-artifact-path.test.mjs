/**
 * item83 返工 HK-01：产物落盘路径强一致 / HTML utf-8 / 四类产物受控读面。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require_ = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

{
  const Database = require_(path.join(ROOT, 'core', 'petri-server', 'node_modules', 'better-sqlite3'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'item83-path-db-'));
  const boot = new Database(path.join(dir, 'petri.db'));
  const migrations = path.join(ROOT, 'src', 'migrations');
  for (const f of fs.readdirSync(migrations).filter((f) => f.endsWith('.sql')).sort()) {
    boot.exec(fs.readFileSync(path.join(migrations, f), 'utf8'));
  }
  boot.close();
  process.env.PETRI_DB_PATH = path.join(dir, 'petri.db');
  process.on('exit', () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} });
}

const { verifyGeneratedDescriptor } = require_(path.join(ROOT, 'core', 'petri-server', 'agent-tools', 'generate-tools.js'));

test('HK-01 描述符 url ↔ 实际文件路径强一致，默认路径一律红', () => {
  const outDir = '/data/generated/generate-image';
  const good = {
    path: path.join(outDir, 'a.png'),
    url: '/api/generated/file/image/a.png',
  };
  assert.doesNotThrow(() => verifyGeneratedDescriptor(good, outDir, 'image'));
  assert.throws(
    () => verifyGeneratedDescriptor({ ...good, path: '/cwd/create-output/a.png' }, outDir, 'image'),
    /generated_path_out_of_controlled_dir/,
  );
  assert.throws(
    () => verifyGeneratedDescriptor({ ...good, url: '/api/generated/file/video/a.png' }, outDir, 'image'),
    /generated_descriptor_url_mismatch/,
  );
});

test('HK-01 generate.html 落 generated/generate-html 且 UTF-8 回读一致', async () => {
  const { createGenerateHandler } = require_(path.join(ROOT, 'core', 'petri-server', 'agent-tools', 'generate-tools.js'));
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'item83-html-'));
  const content = '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>海浪拍打礁石</title></head><body>像素风插画</body></html>';
  try {
    const handler = createGenerateHandler('generate.html', { dataDir });
    const descriptor = await handler({ content, filename: 'wave.html' });
    assert.equal(descriptor.mime, 'text/html');
    assert.ok(descriptor.path.startsWith(path.join(dataDir, 'generated', 'generate-html')));
    assert.equal(descriptor.url, '/api/generated/file/html/wave.html');
    assert.equal(fs.readFileSync(descriptor.path, 'utf8'), content);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('HK-01 HTML 读面声明 charset=utf-8', () => {
  const route = read('core/petri-server/routes/generated-file.js');
  assert.match(route, /charset=utf-8/);
  const files = read('core/petri-server/routes/files.js');
  assert.match(files, /charset=utf-8/);
});
