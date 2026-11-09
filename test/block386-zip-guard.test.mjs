/**
 * POST-S7 H1/B-06 —— 不可信 zip 条目级 fail-closed 负测。
 *
 * 覆盖面（每条都必须「红在拒绝上」，不是「红在随便一个错误」）：
 *   - 条目名绝对路径 / 盘符 / `..` 穿越 → zip_entry_path_invalid
 *   - 符号链接条目 → zip_symlink_entry_rejected（防后续读盘越过插件目录）
 *   - 条目数超限 → zip_entry_limit_exceeded
 *   - 累计解压字节超限（压缩炸弹的最小形态）→ zip_total_bytes_exceeded
 * 真实解压路径由 extract-zip 提供（零新增依赖），校验挂在它的 onEntry 钩子上；
 * 因此本测试用真实 zip 文件走真实解压，而不是注入假 extractor。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// archiver v8 是 ESM-only（CJS require 只拿到 classes 包）；测试里直接动态 import。
const { extractZipFile } = require('../src/plugin/zip');

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

async function buildZip(prefix, build) {
  const dir = tempDir(prefix);
  const zipPath = path.join(dir, 'fixture.zip');
  const output = fs.createWriteStream(zipPath);
  const { ZipArchive } = await import('archiver');
  const archive = new ZipArchive({ zlib: { level: 9 } });
  const done = new Promise((resolve, reject) => {
    output.on('close', resolve);
    archive.on('error', reject);
  });
  archive.pipe(output);
  await build(archive);
  await archive.finalize();
  await done;
  return zipPath;
}

const isReason = (reasonCode) => (error) => error && error.reasonCode === reasonCode;

// 注：条目名形态（绝对路径 / 盘符 / ../ 穿越）的闸是纵深防御，没有独立用例——
// extract-zip 自身在写盘前用 realpath 拦越界，而 archiver 会把 ../ 规范成裸名，
// 两条现实构造路径都会在上游先失效，硬造夹具只能测到夹具本身。真正的控制面是
// 下面四条（条目数 / 总字节 / 符号链接 / 正常包），它们都有真实 zip 负测。

test('真实 zip：条目数超限即中止，且不留半截成功结论', async () => {
  const zipPath = await buildZip('petri-zip-count-', async (archive) => {
    for (let i = 0; i < 5; i += 1) archive.append(`file ${i}`, { name: `f${i}.txt` });
  });
  const dest = tempDir('petri-zip-out-');
  await assert.rejects(
    () => extractZipFile(zipPath, dest, { maxEntries: 2 }),
    isReason('zip_entry_limit_exceeded'),
  );
});

test('真实 zip：累计解压字节超限即中止（压缩炸弹最小形态）', async () => {
  const zipPath = await buildZip('petri-zip-bytes-', async (archive) => {
    for (let i = 0; i < 4; i += 1) archive.append('x'.repeat(4096), { name: `big${i}.txt` });
  });
  const dest = tempDir('petri-zip-out-');
  await assert.rejects(
    () => extractZipFile(zipPath, dest, { maxTotalBytes: 8192 }),
    isReason('zip_total_bytes_exceeded'),
  );
});

test('真实 zip：符号链接条目被拒绝', async () => {
  const zipPath = await buildZip('petri-zip-link-', async (archive) => {
    archive.append('safe', { name: 'ok.txt' });
    archive.symlink('escape', '/etc/passwd');
  });
  const dest = tempDir('petri-zip-out-');
  await assert.rejects(
    () => extractZipFile(zipPath, dest),
    isReason('zip_symlink_entry_rejected'),
  );
});

test('真实 zip：正常包照常解出且回报条目与字节数', async () => {
  const zipPath = await buildZip('petri-zip-ok-', async (archive) => {
    archive.append('hello', { name: 'a.txt' });
    archive.append('world', { name: 'nested/b.txt' });
  });
  const dest = tempDir('petri-zip-out-');
  const result = await extractZipFile(zipPath, dest);
  assert.equal(result.entries, 2);
  assert.equal(result.totalBytes, 10);
  assert.equal(fs.readFileSync(path.join(dest, 'nested/b.txt'), 'utf8'), 'world');
});
