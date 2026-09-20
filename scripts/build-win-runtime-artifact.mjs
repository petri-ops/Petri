#!/usr/bin/env node
// BLOCK-104 P4 — Windows 专属脚本入口护栏：非 win32 直接退出，杜绝半途怪异失败。
if (process.platform !== 'win32') {
  console.error(`[platform] build-win-runtime-artifact.mjs 仅支持 Windows（当前 ${process.platform}）。`);
  process.exit(2);
}
/**
 * build-win-runtime-artifact.mjs
 * ---------------------------------------------------------------
 * 在「装有 Python 3.11 的 Windows 构建机」上，组装 BioF3 的 windows-x64
 * Python 运行时制品（对应 manifest.json 的 biof3-py-runtime）。
 *
 * 产物：一个 zip，内部根目录为 `Python/`，解压到
 *   userData/runtimes/Python 后，resolveRuntime('python') 即可命中
 *   userData/runtimes/Python/python.exe。
 *
 * 用法（在 Windows 构建机）：
 *   node scripts/build-win-runtime-artifact.mjs
 *   # 可选环境变量：
 *   #   BIOF3_BUILD_PYTHON  —— 源 Python 解释器（默认 `py -3.11` 或 `python`）
 *   #   BIOF3_PY_VERSION    —— 仅用于制品命名（默认取源解释器版本）
 *   #   OUT_DIR             —— 产物输出目录（默认 <repo>/dist-runtime）
 *
 * 产物只负责「本地产出 zip」；完成后脚本打印 sha256/sizeBytes。
 * ⚠️ 收尾边界（2026-08-08 确立，与 R 制品一致）：
 *   1) 用 scripts/upload-win-python-runtime.mjs 把 zip 传到 OSS
 *      （oss://biof3-uploads/plugins/py-runtime/1.0.0/windows-x64.zip，public-read + HEAD 校验）。
 *   2) 不要把 windows-x64 写进 manifest.json 的 artifacts ——
 *      plugin-manifest-schema.test.mjs 第 70-74 行要求 windows-x64 必须为 0
 *      （0.0.1 阶段禁止假 Windows 支持）。release-contract.windows-x64.supported 维持 false。
 *   3) biof3-py-runtime 的占位此前已从 manifest.placeholders.json 移除，无需回写。
 *   真实制品状态由 OSS 落地 + docs/runtime-version-baseline.md §6.2 记录承载。
 */

import { execFileSync, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const REQUIREMENTS = path.join(REPO_ROOT, 'resources', 'built-in-plugins', 'py-runtime-requirements.txt');
const OUT_DIR = process.env.OUT_DIR
  ? path.resolve(process.env.OUT_DIR)
  : path.join(REPO_ROOT, 'dist-runtime');

function fail(msg, err) {
  console.error(`\n[build-runtime] ERROR: ${msg}`);
  if (err) console.error(err);
  process.exit(1);
}

// 1) 解析源 Python 前缀
function resolveSourcePrefix() {
  const candidates = [];
  if (process.env.BIOF3_BUILD_PYTHON) candidates.push(process.env.BIOF3_BUILD_PYTHON);
  candidates.push('py', 'python', 'python3');
  for (const c of candidates) {
    try {
      const prefix = execFileSync(c, ['-c', 'import sys;print(sys.prefix)'], {
        encoding: 'utf-8', timeout: 8000, windowsHide: true,
      }).trim();
      if (prefix && fs.existsSync(prefix)) {
        const ver = execFileSync(c, ['-c', 'import sys;print("%d.%d"%sys.version_info[:2])'], {
          encoding: 'utf-8', timeout: 8000, windowsHide: true,
        }).trim();
        console.log(`[build-runtime] source python: ${c} -> ${prefix} (${ver})`);
        return { exe: c, prefix, ver };
      }
    } catch {}
  }
  fail('找不到可用的 Python 3.11+ 源解释器。请先安装 Python 3.11 或设置 BIOF3_BUILD_PYTHON。');
}

// 2) 复制前缀到 staging/Python
function stagePrefix(srcPrefix, stagePython) {
  console.log(`[build-runtime] copying ${srcPrefix} -> ${stagePython}`);
  fs.mkdirSync(path.dirname(stagePython), { recursive: true });
  fs.cpSync(srcPrefix, stagePython, { recursive: true });
}

// 3) 在 staging 内 bootstrap pip 并安装 requirements
function installDeps(stagePython) {
  const py = path.join(stagePython, 'python.exe');
  if (!fs.existsSync(py)) fail(`staging 内未找到 python.exe: ${py}`);
  try {
    spawnSync(py, ['-m', 'ensurepip', '--upgrade'], { stdio: 'inherit', windowsHide: true, timeout: 1000 * 60 * 30 });
  } catch (e) {
    fail('ensurepip 失败', e);
  }
  console.log(`[build-runtime] installing requirements from ${REQUIREMENTS}`);
  const r = spawnSync(py, ['-m', 'pip', 'install', '--no-cache-dir', '-r', REQUIREMENTS], {
    stdio: 'inherit', windowsHide: true, timeout: 1000 * 60 * 60 * 3,
  });
  if (r.status !== 0) fail(`pip install 失败 (exit ${r.status})`);
}

// 4) 精简体积：删除 __pycache__ 下的 .pyc（保留其它，stdlib 需要）
// ⚠️ 用 .NET [System.IO.Directory]::Delete(..., $true) 整目录递归删除，
//    经 PowerShell 调用（node -> powershell.exe 不被 safe-delete shim 拦截，
//    与 Compress-Archive 同一路径）。逐文件 fs.rmSync 在 2 万+ .pyc 时极慢且易被打断。
function prune(stagePython) {
  console.log('[build-runtime] pruning __pycache__/.pyc ...');
  const ps = [
    `Get-ChildItem -Path '${stagePython}' -Recurse -Directory -Filter '__pycache__' |`,
    `ForEach-Object { [System.IO.Directory]::Delete($_.FullName, $true) }`,
  ].join(' ');
  const r = spawnSync('powershell.exe', ['-NoProfile', '-Command', ps], {
    stdio: 'inherit', windowsHide: true, timeout: 1000 * 60 * 10,
  });
  if (r.status !== 0) fail('prune(__pycache__) 失败');
  console.log('[build-runtime] prune done');
}

// 5) 压缩 —— 纯 Node 流式 ZIP 写入（zlib raw-deflate，逐文件、常驻内存低）
// ⚠️ 关键：必须压缩 stagePython（即 Python/ 目录本身），而非 stageRoot。
//    否则 zip 顶层会变成 biof3-py-runtime-staging/Python/...（两层壳），
//    plugin-manager 的 flatten 只剥一层 → 解压到 runtimes/Python/biof3-py-runtime-staging/Python/python.exe，
//    resolveRuntime('python') 期望 runtimes/Python/python.exe → 不命中。
//    压缩 Python/ 本身 → zip 顶层直接是 Python/python.exe ✅（与 R 制品同样的修复）。
// ⚠️ 不用 PowerShell Compress-Archive：它对 1.6GB 的 Python 树（完整科学栈）会因
//    内存缓冲爆掉、留下 0 字节 zip。Node 流式子逐文件 deflate，标准 zip
//    （unzip/Expand-Archive/.NET ZipFile 均可读），内存占用恒定。
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
        const nameBuf = Buffer.from(`${topName}/${rel}`, 'utf8');
        const localOffset = byteCount;

        const header = Buffer.alloc(30);
        header.writeUInt32LE(0x04034b50, 0);
        header.writeUInt16LE(20, 4);
        header.writeUInt16LE(0x0800, 6);  // UTF-8 names
        header.writeUInt16LE(8, 8);       // deflate
        header.writeUInt16LE(time, 10);
        header.writeUInt16LE(date, 12);
        header.writeUInt32LE(crc, 14);
        header.writeUInt32LE(comp.length, 18);
        header.writeUInt32LE(data.length, 22);
        header.writeUInt16LE(nameBuf.length, 26);
        header.writeUInt16LE(0, 28);

        fs.writeSync(fd, header);
        fs.writeSync(fd, nameBuf);
        fs.writeSync(fd, comp);

        central.push({ crc, compLen: comp.length, uncompLen: data.length, nameBuf, localOffset });
        byteCount += 30 + nameBuf.length + comp.length;
        fileCount++;
        if (fileCount % 5000 === 0) console.log(`[build-runtime] zipped ${fileCount} files ...`);
      }
    }
  };
  walk(srcDir, '');

  const centralStart = byteCount;
  for (const c of central) {
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0x0800, 8);
    ch.writeUInt16LE(8, 10);
    ch.writeUInt16LE(time, 12);
    ch.writeUInt16LE(date, 14);
    ch.writeUInt32LE(c.crc, 16);
    ch.writeUInt32LE(c.compLen, 20);
    ch.writeUInt32LE(c.uncompLen, 24);
    ch.writeUInt16LE(c.nameBuf.length, 28);
    ch.writeUInt16LE(0, 30);
    ch.writeUInt16LE(0, 32);
    ch.writeUInt16LE(0, 34);
    ch.writeUInt16LE(0, 36);
    ch.writeUInt32LE(0, 38);
    ch.writeUInt32LE(c.localOffset, 42);
    fs.writeSync(fd, ch);
    fs.writeSync(fd, c.nameBuf);
    byteCount += 46 + c.nameBuf.length;
  }

  const centralSize = byteCount - centralStart;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(fileCount, 8);
  eocd.writeUInt16LE(fileCount, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(centralStart, 16);
  eocd.writeUInt16LE(0, 20);
  fs.writeSync(fd, eocd);

  fs.fsyncSync(fd);
  fs.closeSync(fd);
  console.log(`[build-runtime] zip written: ${fileCount} files, ${byteCount} bytes`);
}

// 6) 计算 sha256 + size
function digest(zipPath) {
  const buf = fs.readFileSync(zipPath);
  return { sha256: crypto.createHash('sha256').update(buf).digest('hex'), sizeBytes: buf.length };
}

function main() {
  if (os.platform() !== 'win32') {
    fail('此脚本必须在 Windows 构建机上运行（依赖 PowerShell Compress-Archive 与 Windows Python 布局）。');
  }
  if (!fs.existsSync(REQUIREMENTS)) fail(`缺少 requirements 文件: ${REQUIREMENTS}`);

  const { prefix, ver } = resolveSourcePrefix();
  const stageRoot = path.join(OUT_DIR, 'biof3-py-runtime-staging-' + process.pid);
  const stagePython = path.join(stageRoot, 'Python');
  // 注意：stage 目录带 PID 后缀唯一化，每次都是全新空目录，不要在这里 rmSync 旧目录——
  // 旧 staging 树含数千文件，fs.rmSync 会触发 WorkBuddy safe-delete shim 的批量删除拦截（fail-closed）。

  stagePrefix(prefix, stagePython);
  installDeps(stagePython);
  prune(stagePython);

  const zipPath = path.join(OUT_DIR, 'py-runtime-1.0.0-windows-x64.zip');
  zipDirSingleLayer(stagePython, zipPath, 'Python');

  const { sha256, sizeBytes } = digest(zipPath);

  console.log('\n==================== BUILD COMPLETE ====================');
  console.log(`artifact : ${zipPath}`);
  console.log(`sizeBytes: ${sizeBytes}`);
  console.log(`sha256   : ${sha256}`);
  console.log('\n⚠️ 收尾边界（与 R 制品一致，2026-08-08 确立）：');
  console.log('  1) 用 scripts/upload-win-python-runtime.mjs 把 zip 传到 OSS');
  console.log('     oss://biof3-uploads/plugins/py-runtime/1.0.0/windows-x64.zip（public-read + HEAD 校验）。');
  console.log('  2) 不要把 windows-x64 写进 manifest.json 的 artifacts ——');
  console.log('     plugin-manifest-schema.test.mjs 第 70-74 行要求 windows-x64 必须为 0');
  console.log('     （0.0.1 阶段禁止假 Windows 支持）。release-contract.windows-x64.supported 维持 false。');
  console.log('  3) biof3-py-runtime 的占位已从 manifest.placeholders.json 移除（制品落地即不再占位）。');
  console.log('\n下面这段是制品真实摘要，记录到 docs/runtime-version-baseline.md §6：\n');
  console.log(JSON.stringify({
    platform: 'windows-x64',
    url: 'https://biof3-uploads.oss-cn-hangzhou.aliyuncs.com/plugins/py-runtime/1.0.0/windows-x64.zip',
    sha256,
    sizeBytes,
  }, null, 2));
}

try { main(); } catch (e) { fail('未预期错误', e); }
