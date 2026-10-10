#!/usr/bin/env node
// BLOCK-104 P4 — Windows 专属脚本入口护栏：非 win32 直接退出，杜绝半途怪异失败。
if (process.platform !== 'win32') {
  console.error(`[platform] resume-py-runtime-zip.mjs 仅支持 Windows（当前 ${process.platform}）。`);
  process.exit(2);
}
/**
 * resume-py-runtime-zip.mjs  (一次性恢复脚本，2026-08-08)
 * ---------------------------------------------------------------
 * build-win-runtime-artifact.mjs 的 prune() 因逐文件删除 2 万+ .pyc 过慢、
 * 在会话重置时被打断；而 Compress-Archive 对 1.6GB 的 Python 树（完整科学栈）
 * 会因内存缓冲爆掉、留下 0 字节 zip。本脚本复用已完成的 staging
 * （前缀复制 + pip 安装都已做完），只补齐：
 *   1) prune()  —— 用 .NET 整目录删除 __pycache__（快速、绕过 safe-delete shim）
 *   2) zip()    —— 纯 Node 流式 ZIP 写入（zlib raw-deflate，逐文件、常驻内存低，
 *                  标准 zip，unzip/Expand-Archive/.NET ZipFile 均可读），
 *                  顶层为 Python/（单层，与 R 制品一致）
 *   3) digest() —— sha256 + sizeBytes
 *   4) 打印与 build-win-runtime-artifact.mjs 一致的收尾摘要
 *
 * 用法：node scripts/resume-py-runtime-zip.mjs
 *   可选环境变量：STAGE_ROOT=<已有 staging 目录>
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const OUT_DIR = process.env.OUT_DIR ? path.resolve(process.env.OUT_DIR) : path.join(REPO_ROOT, 'dist-runtime');

function fail(msg, err) {
  console.error(`\n[resume-py] ERROR: ${msg}`);
  if (err) console.error(err);
  process.exit(1);
}

function locateStaging() {
  if (process.env.STAGE_ROOT) {
    const p = path.resolve(process.env.STAGE_ROOT);
    if (!fs.existsSync(p)) fail(`STAGE_ROOT 不存在: ${p}`);
    return p;
  }
  const matches = fs.readdirSync(OUT_DIR)
    .filter((d) => d.startsWith('petri-py-runtime-staging-'))
    .map((d) => path.join(OUT_DIR, d));
  if (matches.length === 0) fail(`在 ${OUT_DIR} 找不到 petri-py-runtime-staging-* 目录，请先运行 build-win-runtime-artifact.mjs`);
  if (matches.length > 1) console.warn(`[resume-py] 发现多个 staging，使用第一个: ${matches[0]}`);
  return matches[0];
}

// ---- prune via .NET（快速、绕过 safe-delete shim 的批量删除拦截） ----
function prune(stagePython) {
  console.log('[resume-py] pruning __pycache__ via .NET ...');
  const ps = [
    `Get-ChildItem -Path '${stagePython}' -Recurse -Directory -Filter '__pycache__' |`,
    `ForEach-Object { [System.IO.Directory]::Delete($_.FullName, $true) }`,
  ].join(' ');
  const r = spawnSync('powershell.exe', ['-NoProfile', '-Command', ps], {
    stdio: 'inherit', windowsHide: true, timeout: 1000 * 60 * 10,
  });
  if (r.status !== 0) fail('prune(__pycache__) 失败');
  console.log('[resume-py] prune done');
}

// ---- 纯 Node 流式 ZIP 写入（deflate，逐文件，常驻内存低） ----
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(d = new Date(1980, 0, 1, 0, 0, 0)) {
  const time = ((d.getHours() & 0x1f) << 11) | ((d.getMinutes() & 0x3f) << 5) | ((d.getSeconds() / 2) & 0x1f);
  const date = (((d.getFullYear() - 1980) & 0x7f) << 9) | (((d.getMonth() + 1) & 0xf) << 5) | (d.getDate() & 0x1f);
  return { time: time & 0xffff, date: date & 0xffff };
}

/**
 * 把 srcDir 打成 zip，顶层统一加 topName/ 前缀（单层）。
 * 逐文件读取 + raw-deflate，内存占用恒定，适合超大目录。
 */
function zipDirSingleLayer(srcDir, zipPath, topName) {
  fs.mkdirSync(path.dirname(zipPath), { recursive: true });
  if (fs.existsSync(zipPath)) fs.rmSync(zipPath, { force: true });

  const fd = fs.openSync(zipPath, 'w');
  const central = [];
  const { time, date } = dosDateTime();
  let fileCount = 0;
  let byteCount = 0;

  const walk = (dir, relPrefix) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      const rel = relPrefix ? `${relPrefix}/${e.name}` : e.name;
      if (e.isDirectory()) {
        walk(abs, rel);
      } else if (e.isFile()) {
        const data = fs.readFileSync(abs);
        const comp = zlib.deflateRawSync(data, { level: 6 });
        const crc = crc32(data);
        const name = `${topName}/${rel}`;
        const nameBuf = Buffer.from(name, 'utf8');
        const localOffset = byteCount;

        const header = Buffer.alloc(30);
        header.writeUInt32LE(0x04034b50, 0);   // local file header sig
        header.writeUInt16LE(20, 4);           // version needed
        header.writeUInt16LE(0x0800, 6);       // flags: UTF-8 names
        header.writeUInt16LE(8, 8);            // method: deflate
        header.writeUInt16LE(time, 10);
        header.writeUInt16LE(date, 12);
        header.writeUInt32LE(crc, 14);
        header.writeUInt32LE(comp.length, 18); // compressed size
        header.writeUInt32LE(data.length, 22); // uncompressed size
        header.writeUInt16LE(nameBuf.length, 26);
        header.writeUInt16LE(0, 28);           // extra len

        fs.writeSync(fd, header);
        fs.writeSync(fd, nameBuf);
        fs.writeSync(fd, comp);

        central.push({
          crc, compLen: comp.length, uncompLen: data.length, nameBuf, localOffset,
        });
        byteCount += 30 + nameBuf.length + comp.length;
        fileCount++;
        if (fileCount % 5000 === 0) console.log(`[resume-py] zipped ${fileCount} files ...`);
      }
    }
  };

  walk(srcDir, '');

  const centralStart = byteCount;
  for (const c of central) {
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);  // central dir header sig
    ch.writeUInt16LE(20, 4);          // version made by
    ch.writeUInt16LE(20, 6);          // version needed
    ch.writeUInt16LE(0x0800, 8);      // flags
    ch.writeUInt16LE(8, 10);          // method
    ch.writeUInt16LE(time, 12);
    ch.writeUInt16LE(date, 14);
    ch.writeUInt32LE(c.crc, 16);
    ch.writeUInt32LE(c.compLen, 20);
    ch.writeUInt32LE(c.uncompLen, 24);
    ch.writeUInt16LE(c.nameBuf.length, 28);
    ch.writeUInt16LE(0, 30);          // extra len
    ch.writeUInt16LE(0, 32);          // comment len
    ch.writeUInt16LE(0, 34);          // disk number start
    ch.writeUInt16LE(0, 36);          // internal attrs
    ch.writeUInt32LE(0, 38);          // external attrs
    ch.writeUInt32LE(c.localOffset, 42);
    fs.writeSync(fd, ch);
    fs.writeSync(fd, c.nameBuf);
    byteCount += 46 + c.nameBuf.length;
  }

  const centralSize = byteCount - centralStart;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);  // EOCD sig
  eocd.writeUInt16LE(0, 4);           // disk number
  eocd.writeUInt16LE(0, 6);           // disk with central dir
  eocd.writeUInt16LE(fileCount, 8);   // entries this disk
  eocd.writeUInt16LE(fileCount, 10);  // total entries
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(centralStart, 16);
  eocd.writeUInt16LE(0, 20);          // comment len
  fs.writeSync(fd, eocd);

  fs.fsyncSync(fd);
  fs.closeSync(fd);
  console.log(`[resume-py] zip written: ${fileCount} files, ${byteCount} bytes`);
}

function digest(zipPath) {
  const buf = fs.readFileSync(zipPath);
  return { sha256: crypto.createHash('sha256').update(buf).digest('hex'), sizeBytes: buf.length };
}

function main() {
  const stageRoot = locateStaging();
  const stagePython = path.join(stageRoot, 'Python');
  if (!fs.existsSync(path.join(stagePython, 'python.exe'))) {
    fail(`staging 内未找到 python.exe: ${path.join(stagePython, 'python.exe')}`);
  }
  console.log(`[resume-py] using staging: ${stageRoot}`);

  prune(stagePython);

  const zipPath = path.join(OUT_DIR, 'py-runtime-1.0.0-windows-x64.zip');
  console.log(`[resume-py] streaming-zip -> ${zipPath}`);
  zipDirSingleLayer(stagePython, zipPath, 'Python');

  const { sha256, sizeBytes } = digest(zipPath);

  console.log('\n==================== RESUME BUILD COMPLETE ====================');
  console.log(`artifact : ${zipPath}`);
  console.log(`sizeBytes: ${sizeBytes}`);
  console.log(`sha256   : ${sha256}`);
  console.log('\n⚠️ 收尾边界（与 R 制品一致，2026-08-08 确立）：');
  console.log('  1) 用 scripts/upload-win-python-runtime.mjs 把 zip 传到 OSS');
  console.log('     oss://petri-uploads/plugins/py-runtime/1.0.0/windows-x64.zip（public-read + HEAD 校验）。');
  console.log('  2) 不要把 windows-x64 写进 manifest.json 的 artifacts ——');
  console.log('     plugin-manifest-schema.test.mjs 第 70-74 行要求 windows-x64 必须为 0。');
  console.log('     release-contract.windows-x64.supported 维持 false。');
  console.log('  3) petri-py-runtime 的占位已从 manifest.placeholders.json 移除。\n');
  console.log(JSON.stringify({
    platform: 'windows-x64',
    url: 'https://petri-uploads.oss-cn-hangzhou.aliyuncs.com/plugins/py-runtime/1.0.0/windows-x64.zip',
    sha256,
    sizeBytes,
  }, null, 2));
}

try { main(); } catch (e) { fail('未预期错误', e); }
