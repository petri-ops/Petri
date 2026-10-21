'use strict';

/**
 * BLOCK-235 — installed domain packs' data model extensions.
 *
 * The canonical SDC-0 artifact profiles stay in core. A pack may add *new*
 * artifact profiles (type/field/rule declarations) through
 * `provides.dataModelExtensions = "<relative json path>"`:
 *
 *   { "version": 1, "artifactProfiles": [ <SDC-0 profile definition>, ... ] }
 *
 * Discipline:
 * - only installed and enabled packs; missing/disabled pack → no extensions;
 * - read-only and bounded; paths must stay inside packRoot;
 * - malformed sections are ignored whole per pack with a warning;
 * - duplicate extension ids are stable by packId (later pack wins + warning);
 *   canonical-id conflicts are rejected by the registry, never here.
 */

const fs = require('fs');
const path = require('path');
const packRegistry = require('./pack-registry');
const { resolveDataDir } = require('./data-paths');

const MAX_FILE_BYTES = 256 * 1024;
const MAX_PROFILES = 50;
const MAX_ID_CHARS = 128;

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

/**
 * Read all enabled packs' data model extensions.
 * Returns `{ profiles: [{ packId, definition }], warnings }`.
 */
function loadDataModelExtensions() {
  let packs = [];
  try {
    packs = packRegistry.readInstalledPacks(resolveDataDir());
  } catch {
    return { profiles: [], warnings: [] };
  }
  const warnings = [];
  const byProfileId = new Map();
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
      ? manifest.provides.dataModelExtensions
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
      if (parsed !== null) warnings.push({ packId, code: 'data_model_extensions_not_object' });
      continue;
    }
    if (parsed.version !== undefined && parsed.version !== 1) {
      warnings.push({ packId, code: 'data_model_extensions_version_unsupported', version: parsed.version });
      continue;
    }
    if (!Array.isArray(parsed.artifactProfiles)) {
      warnings.push({ packId, code: 'artifact_profiles_not_array' });
      continue;
    }
    if (parsed.artifactProfiles.length > MAX_PROFILES) {
      warnings.push({ packId, code: 'artifact_profiles_truncated', kept: MAX_PROFILES });
    }
    for (const definition of parsed.artifactProfiles.slice(0, MAX_PROFILES)) {
      if (!isPlainObject(definition)) {
        warnings.push({ packId, code: 'artifact_profile_not_object' });
        continue;
      }
      const profileId = typeof definition.profileId === 'string' ? definition.profileId.trim() : '';
      if (!profileId || profileId.length > MAX_ID_CHARS) {
        warnings.push({ packId, code: 'artifact_profile_id_invalid', profileId });
        continue;
      }
      if (byProfileId.has(profileId)) {
        warnings.push({ packId, code: 'artifact_profile_extension_overridden', profileId });
      }
      byProfileId.set(profileId, { packId, definition });
    }
  }
  return { profiles: [...byProfileId.values()], warnings };
}

module.exports = {
  loadDataModelExtensions,
  MAX_FILE_BYTES,
  MAX_PROFILES,
};
