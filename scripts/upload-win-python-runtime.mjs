#!/usr/bin/env node
/**
 * upload-win-python-runtime.mjs
 * ---------------------------------------------------------------
 * 把 build-win-runtime-artifact.mjs 产出的 windows-x64 Python 运行时
 * 制品上传到阿里云 OSS，并打印真实 sha256 / sizeBytes。
 *
 * 产物：dist-runtime/py-runtime-1.0.0-windows-x64.zip
 * 目标：oss://<bucket>/plugins/py-runtime/1.0.0/windows-x64.zip
 *       公共 URL 与 manifest.json 中 macos-arm64 同一目录结构。
 *
 * ⚠️ 收尾边界（2026-08-08 确认，与 R 制品一致）：
 *   - 本脚本只负责「上传 + 打印真实摘要」，让制品真正落地 OSS。
 *   - petri-py-runtime 的占位此前已从 manifest.placeholders.json 移除
 *     （schema 测试要求 runtime 插件不得留在 placeholders，只判 pluginId）。
 *   - windows-x64 现已登记进 manifest.json 的 artifacts（real OSS 制品，已 golden-path
 *     验证，使未签名 Windows dev 构建能从商店安装运行时）；sha256/sizeBytes 暂为 null
 *     （plugin-manager 对 null 跳过校验）。测试护栏已改为「不允许假 Windows 支持」
 *     （无真实描述符的 windows-x64 才算假），不再强制 0 个。release-contract.windows-x64.supported
 *     维持 false，直到 Week 3/4 才翻转。
 *
 * 用法（在 Windows 构建机，无沙箱）：
 *   脚本会自动读取仓库根 .petri-secrets（OSS_AK/OSS_SK）。也可手动 export：
 *   export OSS_AK=... OSS_SK=... && node scripts/upload-win-python-runtime.mjs
 *   # 可选：--dry-run 只预览不上传；--zip <path> 指定 zip 路径。
 */

import OSS from 'ali-oss';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

// 自动加载 .petri-secrets（export KEY="val" 格式），供 OSS_AK/OSS_SK 等变量使用。
// 该文件在 .gitignore 中，不会进仓库。若已手动 export 同名变量则优先保留（不覆盖）。
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
// 项目约定变量名（见 .petri-secrets）：OSS_AK / OSS_SK。PETRI_OSS_ACCESS_KEY_* 为兼容 fallback。
const accessKeyId = process.env.OSS_AK || process.env.PETRI_OSS_ACCESS_KEY_ID || process.env.OSS_ACCESS_KEY_ID;
const accessKeySecret = process.env.OSS_SK || process.env.PETRI_OSS_ACCESS_KEY_SECRET || process.env.OSS_ACCESS_KEY_SECRET;

// 与 build 脚本 / manifest.json macos-arm64 目录结构保持一致
const prefix = (process.env.PETRI_OSS_RUNTIME_PREFIX || 'plugins/py-runtime/1.0.0').replace(/^\/+|\/+$/g, '');
const uploadTimeout = Number(process.env.PETRI_OSS_UPLOAD_TIMEOUT_MS || 600000);
const uploadPartSize = Number(process.env.PETRI_OSS_UPLOAD_PART_SIZE || 10 * 1024 * 1024);
const dryRun = process.argv.includes('--dry-run');
const zipArgIdx = process.argv.indexOf('--zip');
const zipPath = zipArgIdx >= 0 ? resolve(process.argv[zipArgIdx + 1]) : resolve(REPO_ROOT, 'dist-runtime', 'py-runtime-1.0.0-windows-x64.zip');

function fail(msg) {
  console.error(`[oss-py-runtime] ERROR: ${msg}`);
  process.exit(1);
}

if (!accessKeyId || !accessKeySecret) {
  // dry-run 仅预览，不需要凭据；真正上传才校验。
  if (!dryRun) {
    fail('缺少 OSS 凭据。请设置 OSS_AK / OSS_SK（脚本会自动读取 .petri-secrets）。');
  }
  console.warn('[oss-py-runtime] 警告: 未提供 OSS 凭据（--dry-run 模式不需要）。');
}
if (!existsSync(zipPath)) fail(`找不到制品: ${zipPath}（先运行 build-win-runtime-artifact.mjs）`);

const stat = statSync(zipPath);
const sha256 = createHash('sha256').update(readFileSync(zipPath)).digest('hex');
const sizeBytes = stat.size;

const objectName = `${prefix}/windows-x64.zip`;
const publicUrl = `https://${bucket}.${endpoint}/${objectName}`;

console.log(`[oss-py-runtime] artifact : ${zipPath}`);
console.log(`[oss-py-runtime] sizeBytes: ${sizeBytes}`);
console.log(`[oss-py-runtime] sha256   : ${sha256}`);
console.log(`[oss-py-runtime] dest     : oss://${bucket}/${objectName}`);
console.log(`[oss-py-runtime] public   : ${publicUrl}`);

if (dryRun) {
  console.log('[oss-py-runtime] --dry-run: 未上传。');
  process.exit(0);
}

const client = new OSS({
  region: process.env.OSS_REGION || 'cn-hangzhou',
  endpoint: endpoint.startsWith('http') ? endpoint : `https://${endpoint}`,
  bucket,
  accessKeyId,
  accessKeySecret,
  timeout: uploadTimeout,
  // 大 zip（可能 300MB+）用 multipart，分片可控
  ...(uploadPartSize ? {} : {}), // 保留分片参数给 put 时不生效，用 multipartUpload
});

async function main() {
  try {
    console.log('[oss-py-runtime] uploading (multipart)...');
    await client.multipartUpload(objectName, zipPath, {
      partSize: uploadPartSize,
      parallel: 3,
      headers: { 'Content-Type': 'application/zip', 'Cache-Control': 'public, immutable, max-age=31536000' },
    });
    await client.putACL(objectName, 'public-read');
    const head = await client.head(objectName);
    if (!head || head.status !== 200) fail('上传后 HEAD 校验未通过');
    console.log(`[oss-py-runtime] uploaded + public-read OK -> ${publicUrl}`);
    console.log('\n==================== UPLOAD COMPLETE ====================');
    console.log('制品已落地 OSS。petri-py-runtime 占位此前已移除，');
    console.log('下列真实值记录到 docs/runtime-version-baseline.md §6：\n');
    console.log(JSON.stringify({
      platform: 'windows-x64',
      url: publicUrl,
      sha256,
      sizeBytes,
    }, null, 2));
  } catch (err) {
    fail(`上传失败: ${err.message}`);
  }
}

main();
