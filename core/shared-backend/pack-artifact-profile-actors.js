'use strict';

/**
 * BLOCK-234 — installed packs' artifact-profile actor lists.
 *
 * The profile schemas (columns, rules, compatibility) stay in core as the
 * generic SDC-0 engine vocabulary. Which concrete tools produce/consume a
 * profile is domain data; a pack declares
 * `provides.artifactProfileActors = "<relative json path>"`:
 *
 *   { "<profileId>": { producers?: [], directProducers?: [], consumers?: [] } }
 *
 * Read-only and bounded; paths must stay inside packRoot; invalid entries are
 * skipped; multi-pack overrides are stable by packId and recorded in warnings.
 */

const fs = require('fs');
const path = require('path');
const packRegistry = require('./pack-registry');
const { resolveDataDir } = require('./data-paths');

const MAX_FILE_BYTES = 64 * 1024;
const MAX_PROFILES = 100;
const MAX_ACTORS = 100;
const ID_RE = /^[A-Za-z0-9_.-]{1,128}$/;

const ACTOR_FIELDS = ['producers', 'directProducers', 'consumers'];

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

function sanitizeActorSet(raw) {
  if (!isPlainObject(raw)) return null;
  const out = {};
  for (const field of ACTOR_FIELDS) {
    if (!Array.isArray(raw[field])) continue;
    const values = raw[field]
      .filter((item) => typeof item === 'string' && ID_RE.test(item.trim()))
      .map((item) => item.trim())
      .slice(0, MAX_ACTORS);
    if (values.length > 0) out[field] = values;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** Read all enabled packs' profile actor maps. Returns `{ actors, warnings }`. */
function loadArtifactProfileActors() {
  let packs = [];
  try {
    packs = packRegistry.readInstalledPacks(resolveDataDir());
  } catch {
    return { actors: {}, warnings: [] };
  }
  const warnings = [];
  const actors = {};
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
      ? manifest.provides.artifactProfileActors
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
      if (parsed !== null) warnings.push({ packId, code: 'profile_actors_not_object' });
      continue;
    }
    const entries = Object.entries(parsed).slice(0, MAX_PROFILES);
    if (Object.keys(parsed).length > MAX_PROFILES) {
      warnings.push({ packId, code: 'profile_actors_truncated', kept: MAX_PROFILES });
    }
    for (const [profileId, rawSet] of entries) {
      if (!ID_RE.test(profileId)) {
        warnings.push({ packId, code: 'profile_actor_id_invalid', profileId });
        continue;
      }
      const set = sanitizeActorSet(rawSet);
      if (!set) {
        warnings.push({ packId, code: 'profile_actor_set_invalid', profileId });
        continue;
      }
      if (actors[profileId]) {
        warnings.push({ packId, code: 'profile_actors_overridden', profileId });
      }
      actors[profileId] = set;
    }
  }
  return { actors, warnings };
}

module.exports = { loadArtifactProfileActors };
