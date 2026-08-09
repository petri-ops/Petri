#!/usr/bin/env node
/**
 * build-macos-runtime.mjs
 * ---------------------------------------------------------------
 * macOS arm64 R/Python 运行时「构建 + 改 manifest hash + 上传 OSS」一体化脚本。
 * 用于修复 🔴 macOS 运行时 OSS 404（路径 B：原始 zip 丢失 → 重新打包 → 用新
 * 真实 hash 覆盖 manifest 声明 → 上传，仍满足 plugin-manager 的 fail-closed 校验）。
 *
 * 消费端契约（src/plugin-manager.js installRuntime）：
 *   - zip 解压到 RUNTIMES_DIR/R（r）或 RUNTIMES_DIR/Python（py）；
 *   - 若解压后顶层是单个目录且无 bin/，会自动展平；
 *   - 顶层统一打 R/ 或 Python/ 前缀，内部含 bin/、lib/、library/ 等；
 *   - r 解压后跑 fix-r-paths.mjs 修 dylib 路径。
 *
 * 用法：
 *   # r：自动探测 R_HOME（本机系统 R）
 *   node scripts/build-macos-runtime.mjs --runtime r
 *   # py：必须指向 Python 3.11 前缀（本机无 3.11，需构建机）
 *   node scripts/build-macos-runtime.mjs --runtime py --source /path/to/python3.11
 *   # 仅预览（不写 manifest、不上传、不产出 zip）：检测 source + 打印计划
 *   node scripts/build-macos-runtime.mjs --runtime r --dry-run
 *   # 产出 zip + 改 manifest，但不上传
 *   node scripts/build-macos-runtime.mjs --runtime r --no-upload
 *   # 扁平打包（顶层直接 bin/lib/…，与已上线的 r 一致，跳过 plugin-manager 展平步骤）
 *   node scripts/build-macos-runtime.mjs --runtime py --source /tmp/py-dist --flat
 *
 * 安全边界：
 *   - 只读源安装树，绝不 prune/删除源；只在 zip 遍历时跳过 __pycache__/*.pyc 等垃圾。
 *   - 上传前先把 manifest 的 macos-arm64 sha256/sizeBytes 改为本次计算的真实值（非 null），
 *     因此 upload-macos-runtime.mjs 的 fail-closed 校验自然通过（声明即真相）。
 *   - multipart + public-read + HEAD 校验，确保下载端拿到 200 + 一致 hash。
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
const MANIFEST_PATH = path.resolve(REPO_ROOT, 'resources/built-in-plugins/manifest.json');

function fail(msg, err) {
  console.error(`\n[build-macos-runtime] ERROR: ${msg}`);
  if (err) console.error(err);
  process.exit(1);
}

// ── 参数解析 ───────────────────────────────────────────────
const runtimeIdx = process.argv.indexOf('--runtime');
const runtime = (runtimeIdx >= 0 ? process.argv[runtimeIdx + 1] : '').toLowerCase();
const sourceIdx = process.argv.indexOf('--source');
const sourceArg = sourceIdx >= 0 ? path.resolve(process.argv[sourceIdx + 1]) : null;
const outIdx = process.argv.indexOf('--out');
const outArg = outIdx >= 0 ? path.resolve(process.argv[outIdx + 1]) : null;
const dryRun = process.argv.includes('--dry-run');
const noManifest = process.argv.includes('--no-manifest');
const noUpload = process.argv.includes('--no-upload');
const flat = process.argv.includes('--flat');

const RT = {
  r:  { manifestKey: 'biof3-r-runtime', topName: 'R', ossSegment: 'r-runtime', lang: 'r' },
  py: { manifestKey: 'biof3-py-runtime', topName: 'Python', ossSegment: 'py-runtime', lang: 'python' },
};
const rt = RT[runtime];
if (!rt) fail('--runtime 必须是 r 或 py');

// ── 凭据加载（复用 upload-macos-runtime 逻辑） ──────────────
function loadSecretsFile() {
  const p = path.resolve(REPO_ROOT, '.biof3-secrets');
  if (!fs.existsSync(p)) return;
  const re = /^\s*export\s+([A-Z0-9_]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s#]+))/gm;
  let m;
  while ((m = re.exec(fs.readFileSync(p, 'utf8'))) !== null) {
    const key = m[1];
    if (process.env[key] === undefined) process.env[key] = m[2] ?? m[3] ?? m[4] ?? '';
  }
}
loadSecretsFile();
const bucket = process.env.BIOF3_OSS_BUCKET || 'biof3-uploads';
const endpoint = process.env.OSS_ENDPOINT || 'oss-cn-hangzhou.aliyuncs.com';
const region = process.env.OSS_REGION || 'cn-hangzhou';

// ── 解析源安装树 ───────────────────────────────────────────
function detectRHome() {
  if (sourceArg) return sourceArg;
  try {
    const out = spawnSync('R', ['RHOME'], { encoding: 'utf-8', timeout: 10000 });
    if (out.status === 0 && out.stdout.trim()) return out.stdout.trim();
  } catch {}
  // 常见 macOS 路径兜底
  for (const p of ['/usr/local/lib/R', '/Library/Frameworks/R.framework/Resources', '/opt/homebrew/lib/R']) {
    if (fs.existsSync(path.join(p, 'bin', 'Rscript'))) return p;
  }
  return null;
}
function detectPyHome() {
  if (sourceArg) return sourceArg;
  return null; // py 必须显式给 source
}
function resolveSource() {
  if (rt.lang === 'r') {
    const home = detectRHome();
    if (!home || !fs.existsSync(path.join(home, 'bin', 'Rscript'))) fail('找不到 R 安装（用 --source 指定 R_HOME，需含 bin/Rscript）');
    return home;
  }
  const home = detectPyHome();
  if (!home || !fs.existsSync(path.join(home, 'bin', 'python3'))) fail('py 必须 --source 指向 Python 3.11 前缀（需含 bin/python3）');
  return home;
}

// ── 版本校验 ───────────────────────────────────────────────
function checkVersion(source) {
  if (rt.lang === 'r') {
    try {
      const out = spawnSync(path.join(source, 'bin', 'Rscript'), ['-e', 'cat(as.character(getRversion()))'], { encoding: 'utf-8', timeout: 15000 });
      const v = out.stdout.trim();
      console.log(`[build-macos-runtime] R 版本: ${v}`);
      if (!/^4\.[4-9]/.test(v)) console.warn('  ⚠️ 建议 R >= 4.4（manifest 声明 >=4.4.0）');
    } catch (e) { console.warn('  ⚠️ 无法读取 R 版本:', e.message); }
  } else {
    try {
      const out = spawnSync(path.join(source, 'bin', 'python3'), ['--version'], { encoding: 'utf-8', timeout: 15000 });
      const m = (out.stdout + out.stderr).match(/Python (\d+\.\d+\.\d+)/);
      const v = m ? m[1] : '?';
      console.log(`[build-macos-runtime] Python 版本: ${v}`);
      if (!/^3\.11\./.test(v)) console.warn('  ⚠️ 运行时 builtAgainst=3.11，当前不是 3.11，可能导致下游工具不兼容');
    } catch (e) { console.warn('  ⚠️ 无法读取 Python 版本:', e.message); }
  }
}

// ── 流式 ZIP（单层顶层目录，deflate，逐文件常驻内存低） ────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c >>> 0; }
  return t;
})();
function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function dosDateTime(d = new Date(1980, 0, 1, 0, 0, 0)) {
  const time = ((d.getHours() & 0x1f) << 11) | ((d.getMinutes() & 0x3f) << 5) | ((d.getSeconds() / 2) & 0x1f);
  const date = (((d.getFullYear() - 1980) & 0x7f) << 9) | (((d.getMonth() + 1) & 0xf) << 5) | (d.getDate() & 0x1f);
  return { time: time & 0xffff, date: date & 0xffff };
}
// 跳过的垃圾：Python 缓存、macOS 元数据、版本控制
const SKIP_DIRS = new Set(['__pycache__', '.git', '.svn', 'node_modules']);
const SKIP_FILE_RE = /\.pyc$|\.DS_Store$|~$|\.swp$/;

function zipDirSingleLayer(srcDir, zipPath, topName) {
  fs.mkdirSync(path.dirname(zipPath), { recursive: true });
  if (fs.existsSync(zipPath)) fs.rmSync(zipPath, { force: true });
  const fd = fs.openSync(zipPath, 'w');
  const central = [];
  const { time, date } = dosDateTime();
  let fileCount = 0, byteCount = 0;

  const walk = (dir, relPrefix) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      if (SKIP_DIRS.has(e.name)) continue;
      if (SKIP_FILE_RE.test(e.name)) continue;
      const abs = path.join(dir, e.name);
      const rel = relPrefix ? `${relPrefix}/${e.name}` : e.name;
      if (e.isDirectory()) { walk(abs, rel); }
      else if (e.isSymbolicLink()) {
        // 符号链接：stored（不压缩），数据为链接目标；用 lstat 真实 mode（含 S_IFLNK）写
        // external attributes，并把 central 的 version-made-by 设为 Unix(788)，让系统 unzip
        // 还原为软链（如 pyenv 的 bin/python3 -> python3.11）。
        const target = fs.readlinkSync(abs);
        const data = Buffer.from(target, 'utf8');
        const crc = crc32(data);
        const st = fs.lstatSync(abs);
        const name = topName ? `${topName}/${rel}` : rel;
        const nameBuf = Buffer.from(name, 'utf8');
        const localOffset = byteCount;
        const header = Buffer.alloc(30);
        header.writeUInt32LE(0x04034b50, 0);
        header.writeUInt16LE(20, 4);
        header.writeUInt16LE(0x0800, 6);
        header.writeUInt16LE(0, 8); // stored
        header.writeUInt16LE(time, 10);
        header.writeUInt16LE(date, 12);
        header.writeUInt32LE(crc, 14);
        header.writeUInt32LE(data.length, 18);
        header.writeUInt32LE(data.length, 22);
        header.writeUInt16LE(nameBuf.length, 26);
        header.writeUInt16LE(0, 28);
        fs.writeSync(fd, header); fs.writeSync(fd, nameBuf); fs.writeSync(fd, data);
        central.push({ crc, compLen: data.length, uncompLen: data.length, nameBuf, localOffset, externalAttrs: ((st.mode & 0xffff) << 16) >>> 0 });
        byteCount += 30 + nameBuf.length + data.length;
        fileCount++;
        if (fileCount % 20000 === 0) console.log(`[build-macos-runtime] zipped ${fileCount} files ...`);
      }
      else if (e.isFile()) {
        const data = fs.readFileSync(abs);
        const comp = zlib.deflateRawSync(data, { level: 6 });
        const crc = crc32(data);
        const st = fs.lstatSync(abs);
        const name = topName ? `${topName}/${rel}` : rel;
        const nameBuf = Buffer.from(name, 'utf8');
        const localOffset = byteCount;
        const header = Buffer.alloc(30);
        header.writeUInt32LE(0x04034b50, 0);
        header.writeUInt16LE(20, 4);
        header.writeUInt16LE(0x0800, 6);
        header.writeUInt16LE(8, 8);
        header.writeUInt16LE(time, 10);
        header.writeUInt16LE(date, 12);
        header.writeUInt32LE(crc, 14);
        header.writeUInt32LE(comp.length, 18);
        header.writeUInt32LE(data.length, 22);
        header.writeUInt16LE(nameBuf.length, 26);
        header.writeUInt16LE(0, 28);
        fs.writeSync(fd, header); fs.writeSync(fd, nameBuf); fs.writeSync(fd, comp);
        // external attributes 用 lstat 真实 mode（含类型+权限位），保留 exec 位（如 python3.11=0755）
        central.push({ crc, compLen: comp.length, uncompLen: data.length, nameBuf, localOffset, externalAttrs: ((st.mode & 0xffff) << 16) >>> 0 });
        byteCount += 30 + nameBuf.length + comp.length;
        fileCount++;
        if (fileCount % 20000 === 0) console.log(`[build-macos-runtime] zipped ${fileCount} files ...`);
      }
    }
  };
  walk(srcDir, '');
  const centralStart = byteCount;
  for (const c of central) {
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(788, 4); ch.writeUInt16LE(20, 6); // 788 = Unix version-made-by
    ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(8, 10);
    ch.writeUInt16LE(time, 12); ch.writeUInt16LE(date, 14);
    ch.writeUInt32LE(c.crc, 16); ch.writeUInt32LE(c.compLen, 20); ch.writeUInt32LE(c.uncompLen, 24);
    ch.writeUInt16LE(c.nameBuf.length, 28); ch.writeUInt16LE(0, 30); ch.writeUInt16LE(0, 32);
    ch.writeUInt16LE(0, 34); ch.writeUInt16LE(0, 36); ch.writeUInt32LE(c.externalAttrs || 0, 38); ch.writeUInt32LE(c.localOffset, 42);
    fs.writeSync(fd, ch); fs.writeSync(fd, c.nameBuf);
    byteCount += 46 + c.nameBuf.length;
  }
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(0, 4); eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(fileCount, 8); eocd.writeUInt16LE(fileCount, 10);
  eocd.writeUInt32LE(byteCount - centralStart, 12); eocd.writeUInt32LE(centralStart, 16); eocd.writeUInt16LE(0, 20);
  fs.writeSync(fd, eocd); fs.fsyncSync(fd); fs.closeSync(fd);
  console.log(`[build-macos-runtime] zip written: ${fileCount} files, ${(byteCount / 1024 / 1024).toFixed(1)} MB`);
}

// ── manifest 改值 ──────────────────────────────────────────
function updateManifest(sha256, sizeBytes) {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const art = manifest?.plugins?.[rt.manifestKey]?.artifacts?.['macos-arm64'];
  if (!art) fail(`manifest 缺少 ${rt.manifestKey}.artifacts.macos-arm64`);
  const prev = { sha256: art.sha256, sizeBytes: art.sizeBytes };
  art.sha256 = sha256;
  art.sizeBytes = sizeBytes;
  manifest.updated = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`[build-macos-runtime] manifest updated: ${rt.manifestKey}.macos-arm64 sha256/sizeBytes -> 新值`);
  console.log(`  旧: sha256=${prev.sha256} size=${prev.sizeBytes}`);
  console.log(`  新: sha256=${sha256} size=${sizeBytes}`);
}

// ── 上传 ───────────────────────────────────────────────────
async function upload(objectName, zipPath) {
  const OSS = (await import('ali-oss')).default;
  const accessKeyId = process.env.OSS_AK || process.env.BIOF3_OSS_ACCESS_KEY_ID || process.env.OSS_ACCESS_KEY_ID;
  const accessKeySecret = process.env.OSS_SK || process.env.BIOF3_OSS_ACCESS_KEY_SECRET || process.env.OSS_ACCESS_KEY_SECRET;
  if (!accessKeyId || !accessKeySecret) fail('缺少 OSS 凭据（.biof3-secrets 或 OSS_AK/OSS_SK）');
  const client = new OSS({
    region, endpoint: endpoint.startsWith('http') ? endpoint : `https://${endpoint}`, bucket, accessKeyId, accessKeySecret,
    timeout: Number(process.env.BIOF3_OSS_UPLOAD_TIMEOUT_MS || 1800000),
  });
  console.log('[build-macos-runtime] uploading (multipart)...');
  await client.multipartUpload(objectName, zipPath, {
    partSize: Number(process.env.BIOF3_OSS_UPLOAD_PART_SIZE || 10 * 1024 * 1024),
    parallel: 4,
    headers: { 'Content-Type': 'application/zip', 'Cache-Control': 'public, immutable, max-age=31536000' },
  });
  await client.putACL(objectName, 'public-read');
  const head = await client.head(objectName);
  if (!head || head.status !== 200) fail('上传后 HEAD 校验未通过');
  return `https://${bucket}.${endpoint}/${objectName}`;
}

// ── main ───────────────────────────────────────────────────
function main() {
  const source = resolveSource();
  console.log(`[build-macos-runtime] runtime : ${rt.manifestKey} (${rt.lang})`);
  console.log(`[build-macos-runtime] source  : ${source}`);
  checkVersion(source);
  const objectName = `plugins/${rt.ossSegment}/1.0.0/macos-arm64.zip`;
  const zipPath = outArg || path.join(OUT_DIR, `${rt.ossSegment}-1.0.0-macos-arm64.zip`);
  const publicUrl = `https://${bucket}.${endpoint}/${objectName}`;

  if (dryRun) {
    console.log(`[build-macos-runtime] --dry-run: 计划`);
    console.log(`  zip    -> ${zipPath}`);
    console.log(`  dest   -> oss://${bucket}/${objectName}`);
    console.log(`  url    -> ${publicUrl}`);
    console.log(`  action -> 改 manifest ${rt.manifestKey}.macos-arm64 为新 hash + 上传 + HEAD 200`);
    console.log('[build-macos-runtime] 未构建、未改 manifest、未上传。');
    process.exit(0);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log(`[build-macos-runtime] streaming-zip -> ${zipPath}${flat ? ' (flat)' : ''}`);
  zipDirSingleLayer(source, zipPath, flat ? '' : rt.topName);

  const buf = fs.readFileSync(zipPath);
  const sha256 = crypto.createHash('sha256').update(buf).digest('hex');
  const sizeBytes = buf.length;
  console.log(`[build-macos-runtime] sha256   : ${sha256}`);
  console.log(`[build-macos-runtime] sizeBytes: ${sizeBytes}`);

  if (!noManifest) updateManifest(sha256, sizeBytes);

  if (!noUpload) {
    upload(objectName, zipPath).then((url) => {
      console.log(`\n==================== BUILD + UPLOAD COMPLETE ====================`);
      console.log(`artifact : ${zipPath}`);
      console.log(`url      : ${url}`);
      console.log(`sha256   : ${sha256}`);
      console.log(`sizeBytes: ${sizeBytes}`);
      console.log(`\n验证 404 已消除：`);
      console.log(`  curl -sI "${url}" | head -1`);
    }).catch((e) => fail('上传失败', e));
  } else {
    console.log(`\n[build-macos-runtime] --no-upload：zip 已产出 + manifest 已改（如需上传去掉 --no-upload）。`);
  }
}

try { main(); } catch (e) { fail('未预期错误', e); }
