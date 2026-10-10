#!/usr/bin/env node
/**
 * upload-macos-runtime.mjs
 * ---------------------------------------------------------------
 * 把 macOS arm64 R/Python 运行时制品上传到阿里云 OSS，并校验与
 * resources/built-in-plugins/manifest.json 声明的 macos-arm64
 * sha256/sizeBytes 一致。目标路径与 manifest 同结构：
 *   oss://petri-uploads/plugins/r-runtime/1.0.0/macos-arm64.zip
 *   oss://petri-uploads/plugins/py-runtime/1.0.0/macos-arm64.zip
 *
 * 背景（2026-08-09 🔴）：manifest 已声明真实 sha256/sizeBytes，但 OSS 上
 * macos-arm64.zip 实际 HTTP 404 → macOS 新装用户 installRuntime 下载失败。
 * 本脚本只负责「上传 + 校验」，制品本体与 OSS 凭据需由构建/运维侧提供。
 *
 * 用法（在 macOS 构建机，有 OSS 凭据）：
 *   export OSS_AK=... OSS_SK=...   # 或放到仓库根 .petri-secrets
 *   node scripts/upload-macos-runtime.mjs --runtime r  --zip /path/r-runtime-1.0.0-macos-arm64.zip
 *   node scripts/upload-macos-runtime.mjs --runtime py --zip /path/py-runtime-1.0.0-macos-arm64.zip
 *   # --dry-run 仅预览 + hash 校验，不上传（无需 OSS 凭据）
 *
 * 安全边界：
 *   - 必须先用 --zip 指定本地制品；脚本计算其 sha256/sizeBytes 并比对 manifest
 *     声明的 macos-arm64 值；不一致（且 manifest 非 null）则 fail-closed，
 *     绝不传一个与声明不符的制品（否则 plugin-manager 校验会失败，且构成
 *     silent inconsistency）。
 *   - 上传后用 multipart + public-read ACL + HEAD 校验。
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

function fail(msg) {
  console.error(`[oss-macos-runtime] ERROR: ${msg}`);
  process.exit(1);
}

// 自动加载 .petri-secrets（export KEY="val" 格式），供 OSS_AK/OSS_SK 使用。
// 该文件在 .gitignore 中，不会进仓库。若已手动 export 同名变量则优先保留。
function loadSecretsFile() {
  const p = resolve(REPO_ROOT, '.petri-secrets');
  if (!existsSync(p)) return;
  const content = readFileSync(p, 'utf8');
  const re = /^\s*export\s+([A-Z0-9_]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s#]+))/gm;
  let m;
  while ((m = re.exec(content)) !== null) {
    const key = m[1];
    if (process.env[key] === undefined) {
      process.env[key] = m[2] ?? m[3] ?? m[4] ?? '';
    }
  }
}
loadSecretsFile();

const bucket = process.env.PETRI_OSS_BUCKET || 'petri-uploads';
const endpoint = process.env.OSS_ENDPOINT || 'oss-cn-hangzhou.aliyuncs.com';
const region = process.env.OSS_REGION || 'cn-hangzhou';
const accessKeyId = process.env.OSS_AK || process.env.PETRI_OSS_ACCESS_KEY_ID || process.env.OSS_ACCESS_KEY_ID;
const accessKeySecret = process.env.OSS_SK || process.env.PETRI_OSS_ACCESS_KEY_SECRET || process.env.OSS_ACCESS_KEY_SECRET;

const dryRun = process.argv.includes('--dry-run');
const rtIdx = process.argv.indexOf('--runtime');
const runtime = (rtIdx >= 0 ? process.argv[rtIdx + 1] : 'r').toLowerCase();
const zipIdx = process.argv.indexOf('--zip');
const zipPath = zipIdx >= 0 ? resolve(process.argv[zipIdx + 1]) : null;

// manifest 插件键是 petri-r-runtime / petri-py-runtime；OSS 路径段是 r-runtime / py-runtime
const RUNTIME = {
  r:  { manifestKey: 'petri-r-runtime', ossSegment: 'r-runtime' },
  py: { manifestKey: 'petri-py-runtime', ossSegment: 'py-runtime' },
};
const rt = RUNTIME[runtime];
if (!rt) fail(`--runtime 必须是 r 或 py，收到: ${runtime}`);
const runtimeId = rt.manifestKey;
if (!zipPath || !existsSync(zipPath)) fail(`找不到制品: ${zipPath}（用 --zip 指定 macos-arm64.zip 路径）`);

const objectName = `plugins/${rt.ossSegment}/1.0.0/macos-arm64.zip`;

// 读取 manifest 声明的 macos-arm64 期望 hash/size（作为上传真相源）
const manifestPath = resolve(REPO_ROOT, 'resources/built-in-plugins/manifest.json');
if (!existsSync(manifestPath)) fail(`找不到 manifest: ${manifestPath}`);
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const declared = manifest?.plugins?.[runtimeId]?.artifacts?.['macos-arm64'];
const expectedSha256 = declared?.sha256 ?? null;
const expectedSize = declared?.sizeBytes ?? null;

const stat = statSync(zipPath);
const sha256 = createHash('sha256').update(readFileSync(zipPath)).digest('hex');
const sizeBytes = stat.size;

const publicUrl = `https://${bucket}.${endpoint}/${objectName}`;

// hash 一致性校验（fail-closed，除非 dry-run 仅警告）
const hashMismatch = expectedSha256 && expectedSha256 !== sha256;
const sizeMismatch = expectedSize && expectedSize !== sizeBytes;
if (hashMismatch || sizeMismatch) {
  if (!dryRun) {
    fail(`制品与 manifest 声明不一致：sha256 ${expectedSha256} vs ${sha256}；size ${expectedSize} vs ${sizeBytes}。不要上传与声明不符的制品（若 manifest 值本身有误，先修正 manifest 再传）。`);
  }
  console.warn('[oss-macos-runtime] 警告(dry-run): 制品与 manifest 声明不一致，真实上传会被拒绝。');
}

console.log(`[oss-macos-runtime] runtime  : ${runtimeId}`);
console.log(`[oss-macos-runtime] artifact : ${zipPath}`);
console.log(`[oss-macos-runtime] sizeBytes: ${sizeBytes}`);
console.log(`[oss-macos-runtime] sha256   : ${sha256}`);
console.log(`[oss-macos-runtime] dest     : oss://${bucket}/${objectName}`);
console.log(`[oss-macos-runtime] public   : ${publicUrl}`);
console.log(`[oss-macos-runtime] manifest : sha256=${expectedSha256} size=${expectedSize}`);

if (dryRun) {
  console.log('[oss-macos-runtime] --dry-run: 未上传。');
  process.exit(0);
}

if (!accessKeyId || !accessKeySecret) {
  fail('缺少 OSS 凭据。请设置 OSS_AK / OSS_SK（脚本会自动读取 .petri-secrets）。');
}

const OSS = (await import('ali-oss')).default;
const client = new OSS({
  region,
  endpoint: endpoint.startsWith('http') ? endpoint : `https://${endpoint}`,
  bucket,
  accessKeyId,
  accessKeySecret,
  timeout: Number(process.env.PETRI_OSS_UPLOAD_TIMEOUT_MS || 600000),
});

async function main() {
  try {
    console.log('[oss-macos-runtime] uploading (multipart)...');
    await client.multipartUpload(objectName, zipPath, {
      partSize: Number(process.env.PETRI_OSS_UPLOAD_PART_SIZE || 10 * 1024 * 1024),
      parallel: 3,
      headers: { 'Content-Type': 'application/zip', 'Cache-Control': 'public, immutable, max-age=31536000' },
    });
    await client.putACL(objectName, 'public-read');
    const head = await client.head(objectName);
    if (!head || head.status !== 200) fail('上传后 HEAD 校验未通过');
    console.log(`[oss-macos-runtime] uploaded + public-read OK -> ${publicUrl}`);
    console.log('\n==================== UPLOAD COMPLETE ====================');
    console.log('制品已落地 OSS 且与 manifest 声明 hash 一致。可用下列命令验证 404 已消除：\n');
    console.log(`  curl -sI "${publicUrl}" | head -1`);
    console.log(JSON.stringify({ platform: 'macos-arm64', runtime: runtimeId, url: publicUrl, sha256, sizeBytes }, null, 2));
  } catch (err) {
    fail(`上传失败: ${err.message}`);
  }
}

main();
