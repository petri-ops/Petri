'use strict';

/**
 * helpers/model3d-share-package.js — P6-04 本地分享包。
 *
 * 包内容 = SceneSpec + manifest + 已登记产物 + checksums；打包前逐件校验存在性/工作区边界/
 * manifest sha；缺件或哈希不符直接拒绝，不生成「看起来成功」的半包。不做云端上传。
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { ZipArchive } = require('archiver');
const { resolveWorkspaceTarget } = require('../agent-tools/workspace-tools/internals');

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function safeRelative(value) {
  return String(value || '').replace(/\\/g, '/');
}

function safeName(value) {
  const text = String(value || 'model3d-share').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[.-]+/, '').slice(0, 80);
  return text || 'model3d-share';
}

async function resolveFile(workspaceRoot, relativePath) {
  const rel = safeRelative(relativePath);
  if (!rel) return { ok: false, error: 'share_path_required' };
  let target;
  try {
    target = await resolveWorkspaceTarget(workspaceRoot, rel, { createRoot: false });
  } catch (error) {
    return { ok: false, error: error.code || 'path_rejected', message: error.message };
  }
  if (!fs.existsSync(target.target) || !fs.statSync(target.target).isFile()) return { ok: false, error: 'share_file_missing', path: rel };
  return { ok: true, relativePath: target.relativePath, target: target.target, sha256: sha256File(target.target), bytes: fs.statSync(target.target).size };
}

async function createModel3DSharePackage({ workspaceRoot, scenePath, manifestPath, outputs, packageName } = {}) {
  if (!workspaceRoot) return { ok: false, error: 'project_required' };
  if (!scenePath || !manifestPath) return { ok: false, error: 'share_scene_and_manifest_required' };
  const scene = await resolveFile(workspaceRoot, scenePath);
  if (!scene.ok) return scene;
  const manifestFile = await resolveFile(workspaceRoot, manifestPath);
  if (!manifestFile.ok) return manifestFile;
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestFile.target, 'utf8'));
  } catch {
    return { ok: false, error: 'share_manifest_unreadable' };
  }
  const wanted = Array.isArray(outputs) && outputs.length > 0
    ? outputs
    : (Array.isArray(manifest.outputs) ? manifest.outputs : []);
  if (wanted.length === 0) return { ok: false, error: 'share_outputs_required' };
  const files = [];
  const seen = new Set();
  for (const entry of wanted) {
    const relative = safeRelative(entry && entry.path ? entry.path : entry);
    if (seen.has(relative)) continue;
    seen.add(relative);
    const resolved = await resolveFile(workspaceRoot, relative);
    if (!resolved.ok) return resolved;
    const expected = entry && entry.sha256 ? String(entry.sha256) : null;
    if (expected && expected !== resolved.sha256) {
      return { ok: false, error: 'share_output_hash_mismatch', path: relative, expected, actual: resolved.sha256 };
    }
    files.push({ path: resolved.relativePath, sha256: resolved.sha256, bytes: resolved.bytes });
  }
  const bundle = {
    schema: 'model3d-share-bundle/v1',
    generatedAt: new Date().toISOString(),
    scene: { path: scene.relativePath, sha256: scene.sha256, bytes: scene.bytes },
    manifest: { path: manifestFile.relativePath, sha256: manifestFile.sha256, bytes: manifestFile.bytes },
    files,
  };
  const bundleText = `${JSON.stringify(bundle, null, 2)}\n`;
  const bundleSha = crypto.createHash('sha256').update(bundleText).digest('hex');
  const shareDir = path.join(workspaceRoot, 'model3d', 'share');
  fs.mkdirSync(shareDir, { recursive: true });
  const zipName = `${safeName(packageName)}-${bundleSha.slice(0, 12)}.zip`;
  const zipPath = path.join(shareDir, zipName);

  const zip = new ZipArchive({ zlib: { level: 9 } });
  const output = fs.createWriteStream(zipPath);
  const closed = new Promise((resolve, reject) => {
    output.on('close', resolve);
    output.on('error', reject);
    zip.on('error', reject);
  });
  zip.pipe(output);
  zip.append(fs.readFileSync(scene.target), { name: `scene/${path.basename(scene.relativePath)}` });
  zip.append(fs.readFileSync(manifestFile.target), { name: `manifest/${path.basename(manifestFile.relativePath)}` });
  for (const file of files) {
    zip.append(fs.readFileSync(path.join(workspaceRoot, file.path)), { name: `artifacts/${file.path}` });
  }
  zip.append(bundleText, { name: 'checksums.json' });
  await zip.finalize();
  await closed;

  return {
    ok: true,
    schema: bundle.schema,
    bundle,
    bundleSha256: bundleSha,
    zip: {
      path: path.relative(workspaceRoot, zipPath).replace(/\\/g, '/'),
      sha256: sha256File(zipPath),
      bytes: fs.statSync(zipPath).size,
    },
  };
}

module.exports = { createModel3DSharePackage };
