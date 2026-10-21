'use strict';

/**
 * BLOCK-234 — installed domain packs' public demo assets.
 *
 * A pack declares `provides.demoAssets = "<relative json path>"`; the file is a
 * plain map `{ "<toolId>": "<jobId>" }`. The map identifies immutable local
 * demo output directories that must survive retention sweeps.
 *
 * Mechanism stays in core; the demo catalog is domain data. Read-only and
 * bounded; paths must stay inside packRoot; bad shapes are ignored per pack;
 * multi-pack overrides are stable by packId and recorded in `warnings`.
 */

const fs = require('fs');
const path = require('path');
const packRegistry = require('../../shared-backend/pack-registry');
const { resolveDataDir } = require('../../shared-backend/data-paths');

const MAX_FILE_BYTES = 64 * 1024;
const MAX_ENTRIES = 200;
const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readBoundedJson(filePath, packRoot, packId, warnings, label) {
  const resolved = path.resolve(filePath);
  const root = path.resolve(packRoot);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    warnings.push({ packId, code: 'path_outside_pack', file: label });
    return null;
  }
  let stat;
  try {
    stat = fs.statSync(resolved);
  } catch {
    return null;
  }
  if (!stat.isFile()) return null;
  if (stat.size > MAX_FILE_BYTES) {
    warnings.push({ packId, code: 'file_too_large', file: label, size: stat.size });
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(resolved, 'utf8'));
  } catch {
    warnings.push({ packId, code: 'invalid_json', file: label });
    return null;
  }
}

/** Read all enabled packs' demo asset maps. Returns `{ assets, warnings }`. */
function loadPublicDemoAssets() {
  let packs = [];
  try {
    packs = packRegistry.readInstalledPacks(resolveDataDir());
  } catch {
    return { assets: {}, warnings: [] };
  }
  const warnings = [];
  const assets = {};
  const ordered = packs
    .filter((pack) => pack && pack.enabled !== false && pack.packRoot)
    .sort((a, b) => String(a.packId).localeCompare(String(b.packId)));
  for (const pack of ordered) {
    const packId = pack.packId;
    const manifest = readBoundedJson(
      path.join(pack.packRoot, 'pack.json'),
      pack.packRoot,
      packId,
      warnings,
      'pack.json',
    );
    const relative = manifest && isPlainObject(manifest.provides)
      ? manifest.provides.demoAssets
      : null;
    if (typeof relative !== 'string' || !relative.trim()) continue;
    const parsed = readBoundedJson(
      path.join(pack.packRoot, relative.trim()),
      pack.packRoot,
      packId,
      warnings,
      relative.trim(),
    );
    if (!isPlainObject(parsed)) {
      if (parsed !== null) warnings.push({ packId, code: 'demo_assets_not_object' });
      continue;
    }
    const entries = Object.entries(parsed).slice(0, MAX_ENTRIES);
    if (Object.keys(parsed).length > MAX_ENTRIES) {
      warnings.push({ packId, code: 'demo_assets_truncated', kept: MAX_ENTRIES });
    }
    for (const [toolId, jobId] of entries) {
      if (!ID_RE.test(toolId) || typeof jobId !== 'string' || !ID_RE.test(jobId)) {
        warnings.push({ packId, code: 'demo_asset_invalid', toolId });
        continue;
      }
      if (assets[toolId]) warnings.push({ packId, code: 'demo_asset_overridden', toolId });
      assets[toolId] = jobId;
    }
  }
  return { assets, warnings };
}

module.exports = { loadPublicDemoAssets };
