'use strict';

/**
 * helpers/model3d-assets.js — BLOCK-322 P5-01/P6-02 外部资产入链与资产库。
 *
 * 资产只存一份字节：model3d/assets/<sha256>.<ext>；SceneSpec 只保存工作区相对路径 +
 * sourceSha256 引用。索引/来源留痕是检索元数据，不是第二份资产真相。
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { inspectMeshAsset, inspectCadAsset } = require('./mesh-assets');
const cadExchange = require('./cad-exchange');
const generation = require('./model3d-generation-provider');
const { resolveWorkspaceTarget } = require('../agent-tools/workspace-tools/internals');

const ASSET_ROOT = 'model3d/assets';
const INDEX_SCHEMA = 'model3d-assets/v1';
const MAX_PROVENANCE_CHARS = 4000;

function indexRelativePath() { return `${ASSET_ROOT}/index.json`; }

function readIndex(workspaceRoot) {
  const indexPath = path.join(workspaceRoot, ...ASSET_ROOT.split('/'), 'index.json');
  try {
    const parsed = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    if (parsed && parsed.schema === INDEX_SCHEMA && Array.isArray(parsed.assets)) return parsed;
  } catch { /* missing or corrupt index is an empty library */ }
  return { schema: INDEX_SCHEMA, assets: [] };
}

function writeIndex(workspaceRoot, index) {
  const dir = path.join(workspaceRoot, ...ASSET_ROOT.split('/'));
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'index.json');
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(index, null, 2)}\n`);
  fs.renameSync(temp, file);
}

function cleanProvenance(input) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const clean = {};
  for (const key of [
    'model', 'promptHash', 'parameters', 'source', 'generator', 'license',
    'sourceSha256', 'sourceFormat', 'derivedFormat', 'derivedSha256',
    'kernel', 'kernelVersion', 'faceted', 'notes',
  ]) {
    if (source[key] === undefined) continue;
    const text = typeof source[key] === 'string' ? source[key] : JSON.stringify(source[key]);
    clean[key] = text.slice(0, MAX_PROVENANCE_CHARS);
  }
  return clean;
}

function assetId(sha) { return `asset-${String(sha).slice(0, 16)}`; }

async function importMeshAsset({ workspaceRoot, sourcePath, name, provenance, originalSource } = {}) {
  if (!workspaceRoot) return { ok: false, error: 'project_required' };
  const inspected = await inspectMeshAsset({ workspaceRoot, relativePath: sourcePath });
  if (!inspected.ok) return inspected;
  const extension = path.extname(inspected.path).toLowerCase();
  const destinationRel = `${ASSET_ROOT}/${inspected.sourceSha256}${extension}`;
  let sourceTarget;
  let destinationTarget;
  try {
    sourceTarget = await resolveWorkspaceTarget(workspaceRoot, inspected.path, { createRoot: false });
    destinationTarget = await resolveWorkspaceTarget(workspaceRoot, destinationRel, { createRoot: true });
  } catch (error) {
    return { ok: false, error: error.code || 'path_rejected', message: error.message };
  }
  fs.mkdirSync(path.dirname(destinationTarget.target), { recursive: true });
  if (!fs.existsSync(destinationTarget.target)) {
    fs.copyFileSync(sourceTarget.target, destinationTarget.target);
  }
  const copiedSha = crypto.createHash('sha256').update(fs.readFileSync(destinationTarget.target)).digest('hex');
  if (copiedSha !== inspected.sourceSha256) {
    return { ok: false, error: 'asset_copy_hash_mismatch', expected: inspected.sourceSha256, actual: copiedSha };
  }
  const clean = cleanProvenance(provenance);
  const provenanceRel = `${ASSET_ROOT}/${inspected.sourceSha256}.provenance.json`;
  const provenanceRecord = {
    schema: 'model3d-asset-provenance/v1',
    sha256: inspected.sourceSha256,
    bytes: inspected.bytes,
    format: inspected.format,
    name: String(name || path.basename(originalSource || inspected.path)).slice(0, 200),
    sourcePath: originalSource || inspected.path,
    importedAt: new Date().toISOString(),
    ...clean,
  };
  const provenancePath = path.join(workspaceRoot, ...provenanceRel.split('/'));
  fs.writeFileSync(provenancePath, `${JSON.stringify(provenanceRecord, null, 2)}\n`);
  const index = readIndex(workspaceRoot);
  const id = assetId(inspected.sourceSha256);
  const entry = {
    id,
    name: provenanceRecord.name,
    path: destinationRel,
    sha256: inspected.sourceSha256,
    bytes: inspected.bytes,
    format: inspected.format,
    sourcePath: provenanceRecord.sourcePath,
    provenancePath: provenanceRel,
    importedAt: provenanceRecord.importedAt,
    model: clean.model || null,
  };
  const existing = index.assets.findIndex((asset) => asset.sha256 === inspected.sourceSha256);
  if (existing >= 0) index.assets[existing] = entry;
  else index.assets.push(entry);
  writeIndex(workspaceRoot, index);
  return {
    ok: true,
    asset: entry,
    node: {
      id,
      type: 'mesh-reference',
      source: { path: destinationRel, sourceSha256: inspected.sourceSha256 },
      label: entry.name,
    },
    provenance: provenanceRecord,
  };
}

function sha256Buffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/**
 * STEP/IGES 源文件 → 派生网格资产（GLB/STL）→ 现有资产索引。
 * 原始 CAD 文件留在工作区，provenance 记录 sourcePath/sourceSha256；资产只存派生网格。
 */
async function importCadAsset({ workspaceRoot, sourcePath, name, provenance } = {}) {
  if (!workspaceRoot) return { ok: false, error: 'project_required' };
  const inspected = await inspectCadAsset({ workspaceRoot, relativePath: sourcePath });
  if (!inspected.ok) return inspected;
  const format = cadExchange.cadFormatForPath(inspected.path);
  if (!format) return { ok: false, error: 'cad_format_unsupported' };
  let sourceTarget;
  try {
    sourceTarget = await resolveWorkspaceTarget(workspaceRoot, inspected.path, { createRoot: false });
  } catch (error) {
    return { ok: false, error: error.code || 'path_rejected', message: error.message };
  }
  const sourceBytes = fs.readFileSync(sourceTarget.target);
  const converted = format === 'step'
    ? await cadExchange.stepToGlb({ bytes: sourceBytes })
    : await cadExchange.igesToStl({ bytes: sourceBytes });
  if (!converted.ok) return converted;
  const derivedBytes = converted.glb || converted.stl;
  if (!derivedBytes || derivedBytes.length === 0) return { ok: false, error: 'cad_conversion_empty' };
  const derivedFormat = converted.glb ? 'glb' : 'stl';
  const derivedSha = sha256Buffer(derivedBytes);
  const tempRel = `${ASSET_ROOT}/.cad-${derivedSha}.${derivedFormat}`;
  let tempTarget;
  try {
    tempTarget = await resolveWorkspaceTarget(workspaceRoot, tempRel, { createRoot: true });
  } catch (error) {
    return { ok: false, error: error.code || 'path_rejected', message: error.message };
  }
  fs.mkdirSync(path.dirname(tempTarget.target), { recursive: true });
  fs.writeFileSync(tempTarget.target, derivedBytes);
  try {
    const imported = await importMeshAsset({
      workspaceRoot,
      sourcePath: tempRel,
      name: String(name || path.basename(inspected.path)).slice(0, 200),
      originalSource: inspected.path,
      provenance: {
        ...(provenance && typeof provenance === 'object' ? provenance : {}),
        source: inspected.path,
        sourceSha256: inspected.sourceSha256,
        sourceFormat: format,
        derivedFormat,
        derivedSha256: derivedSha,
        kernel: converted.summary?.kernel,
        kernelVersion: converted.summary?.kernelVersion,
        notes: format === 'iges'
          ? 'IGES import is mesh-based; assembly hierarchy/colors are not guaranteed.'
          : 'STEP imported through occt-wasm XCAF; derived GLB preserves names/colors where present.',
      },
    });
    if (!imported.ok) return imported;
    return {
      ...imported,
      cad: {
        sourceFormat: format,
        derivedFormat,
        sourceSha256: inspected.sourceSha256,
        derivedSha256: derivedSha,
        sourcePath: inspected.path,
        kernel: converted.summary?.kernel || null,
        kernelVersion: converted.summary?.kernelVersion || null,
        ...(converted.summary || {}),
      },
    };
  } finally {
    try { fs.rmSync(tempTarget.target, { force: true }); } catch { /* temp already gone */ }
  }
}

async function importGeneratedAsset({ workspaceRoot, glb, name, provenance } = {}) {
  if (!workspaceRoot) return { ok: false, error: 'project_required' };
  const buffer = Buffer.isBuffer(glb) ? glb : Buffer.from(glb || []);
  if (buffer.length === 0) return { ok: false, error: 'generation_empty_glb' };
  if (buffer.subarray(0, 4).toString('ascii') !== 'glTF') return { ok: false, error: 'generation_invalid_glb' };
  const sha = sha256Buffer(buffer);
  const tempRel = `${ASSET_ROOT}/.generated-${sha}.glb`;
  let tempTarget;
  try {
    tempTarget = await resolveWorkspaceTarget(workspaceRoot, tempRel, { createRoot: true });
  } catch (error) {
    return { ok: false, error: error.code || 'path_rejected', message: error.message };
  }
  fs.mkdirSync(path.dirname(tempTarget.target), { recursive: true });
  fs.writeFileSync(tempTarget.target, buffer);
  try {
    const imported = await importMeshAsset({
      workspaceRoot,
      sourcePath: tempRel,
      name: String(name || 'generated-model').slice(0, 200),
      originalSource: 'generated',
      provenance: {
        ...(provenance && typeof provenance === 'object' ? provenance : {}),
        source: 'generated',
        derivedFormat: 'glb',
        derivedSha256: sha,
      },
    });
    if (!imported.ok) return imported;
    return { ...imported, generation: { ...(provenance || {}), glbSha256: sha, bytes: buffer.length } };
  } finally {
    try { fs.rmSync(tempTarget.target, { force: true }); } catch { /* temp already gone */ }
  }
}

async function generateAndImport({ workspaceRoot, prompt, name } = {}) {
  if (!workspaceRoot) return { ok: false, error: 'project_required' };
  const generated = await generation.generateModel({ prompt });
  if (!generated.ok) return generated;
  const promptHash = generated.promptHash || generation.promptHash(prompt);
  const imported = await importGeneratedAsset({
    workspaceRoot,
    glb: generated.glb,
    name: name || 'generated-model',
    provenance: {
      model: `${generated.provider}:${generated.model}`,
      promptHash,
      parameters: {
        provider: generated.provider,
        model: generated.model,
        taskId: generated.taskId,
        usage: generated.usage,
      },
      generator: generated.provider,
      license: 'provider terms; generated asset provenance recorded locally',
    },
  });
  if (!imported.ok) return imported;
  return {
    ...imported,
    generation: {
      provider: generated.provider,
      model: generated.model,
      taskId: generated.taskId,
      usage: generated.usage,
      promptHash,
    },
  };
}

function listAssets({ workspaceRoot, query = '', limit = 20 } = {}) {
  if (!workspaceRoot) return { ok: false, error: 'project_required' };
  const text = String(query || '').trim().toLowerCase();
  const max = Math.min(50, Math.max(1, Number(limit) || 20));
  const index = readIndex(workspaceRoot);
  const matches = index.assets
    .filter((asset) => !text || `${asset.name} ${asset.path} ${asset.sha256} ${asset.model || ''}`.toLowerCase().includes(text))
    .sort((a, b) => String(b.importedAt).localeCompare(String(a.importedAt)))
    .slice(0, max);
  return { ok: true, count: matches.length, total: index.assets.length, assets: matches, indexPath: indexRelativePath() };
}

function getAsset({ workspaceRoot, assetId: requestedId } = {}) {
  if (!workspaceRoot) return { ok: false, error: 'project_required' };
  const index = readIndex(workspaceRoot);
  const asset = index.assets.find((entry) => entry.id === requestedId || entry.sha256 === requestedId);
  if (!asset) return { ok: false, error: 'asset_not_found' };
  return { ok: true, asset, node: { id: asset.id, type: 'mesh-reference', source: { path: asset.path, sourceSha256: asset.sha256 }, label: asset.name } };
}

module.exports = { ASSET_ROOT, INDEX_SCHEMA, importMeshAsset, importCadAsset, importGeneratedAsset, generateAndImport, listAssets, getAsset, indexRelativePath };
