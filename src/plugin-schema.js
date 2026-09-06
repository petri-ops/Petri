// src/plugin-schema.js — Week 2 per-platform plugin manifest helpers.
// Pure module: no electron / fs / child_process deps. Safe to import from tests.
//
// Schema (Week 2):
//   PlatformId = 'macos-arm64' | 'macos-x64' | 'windows-x64' | 'linux-x64'
//   Artifact = { url: string|null, sha256: string(64 hex)|null, sizeBytes: int|null }
//   PluginEntry = { id, title, version, kind: 'runtime'|'plugin',
//                   artifacts: { [PlatformId]: Artifact }, ... }
//
// Hard constraints:
//   - sha256 / sizeBytes may be null pre-Week-4 (placeholders documented in
//     resources/built-in-plugins/manifest.placeholders.json).
//   - artifact.url host must be in ALLOWED_RUNTIME_HOSTS (or built-in://...).
//   - artifact.url path must reference the platformId key it sits under
//     (e.g. artifacts['macos-arm64'].url must contain 'macos-arm64').
//   - No silent platform fallback. If currentPlatform has no artifact, throw
//     a typed error with code='ARTIFACT_MISSING'.

'use strict';

const PLATFORM_IDS = Object.freeze(['macos-arm64', 'macos-x64', 'windows-x64', 'linux-x64']);

// Real download hosts. built-in://... pseudo URLs are exempt.
// Extend when CI moves Runtime/FigCode zips to a new host (e.g. R2 / OSS release bucket).
// Week 2 seed list per plan: github.com + githubusercontent variants. The Aliyun OSS
// bucket gewu-uploads.oss-cn-hangzhou.aliyuncs.com is the current production host
// for legacy Runtime/FigCode zips and must remain whitelisted until those artifacts
// are re-published under a github.com release URL.
const ALLOWED_RUNTIME_HOSTS = Object.freeze([
  'github.com',
  'objects.githubusercontent.com',
  'githubusercontent.com',
  'gewu-uploads.oss-cn-hangzhou.aliyuncs.com',
  // BLOCK-61 双兼容：OSS bucket 实际名称未改，新旧 host 都放行
  'biof3-uploads.oss-cn-hangzhou.aliyuncs.com',
]);

// Pick the artifact for currentPlatform from a per-platform manifest.
//   - manifest.artifacts must be an object keyed by PlatformId
//   - returns { platformId, artifact } on hit
//   - throws { code: 'ARTIFACT_MISSING', supportedPlatforms, currentPlatform } on miss
//   - does NOT silently fall back to a different platform
function selectArtifact(manifest, currentPlatform) {
  if (!manifest || typeof manifest !== 'object') {
    const e = new Error('manifest is missing or not an object');
    e.code = 'ARTIFACT_MISSING';
    e.supportedPlatforms = [];
    e.currentPlatform = currentPlatform;
    throw e;
  }
  const artifacts = manifest.artifacts || {};
  const supportedPlatforms = Object.keys(artifacts);
  const artifact = artifacts[currentPlatform];
  if (!artifact || typeof artifact !== 'object') {
    const e = new Error(
      `manifest ${manifest.id || '(unknown)'} has no artifact for platform '${currentPlatform}' ` +
        `(supported: ${supportedPlatforms.join(', ') || 'none'})`
    );
    e.code = 'ARTIFACT_MISSING';
    e.supportedPlatforms = supportedPlatforms;
    e.currentPlatform = currentPlatform;
    throw e;
  }
  return { platformId: currentPlatform, artifact };
}

// Verify artifact.url is downloadable from an allowed host.
// built-in://... is allowed (means copy from app bundle, no network).
function assertAllowedUrl(url) {
  if (typeof url !== 'string' || url.length === 0) {
    throw new Error('artifact.url must be a non-empty string');
  }
  if (url.startsWith('built-in://')) return;
  let host;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    throw new Error(`artifact.url is not a valid URL: ${url}`);
  }
  if (!ALLOWED_RUNTIME_HOSTS.includes(host)) {
    throw new Error(
      `artifact.url host '${host}' is not in ALLOWED_RUNTIME_HOSTS=[${ALLOWED_RUNTIME_HOSTS.join(', ')}]`
    );
  }
}

// Convert the pre-Week-2 remote manifest shape
//   { url, checksum, size, platform: ['macos-arm64'] }
// into the per-platform artifact shape used by current clients. The fallback
// entry is the built-in manifest record, so fields added by newer clients are
// retained while an older remote catalog is still being phased out.
function normalizeRemotePluginEntry(id, remoteEntry, fallbackEntry = null) {
  if (!remoteEntry || typeof remoteEntry !== 'object') return fallbackEntry;
  const fallback = fallbackEntry && typeof fallbackEntry === 'object' ? fallbackEntry : {};
  let artifacts = remoteEntry.artifacts;

  if (!artifacts && typeof remoteEntry.url === 'string') {
    const platforms = Array.isArray(remoteEntry.platform) ? remoteEntry.platform : [];
    const platformId = platforms.find((value) => PLATFORM_IDS.includes(value));
    if (platformId) {
      artifacts = {
        [platformId]: {
          url: remoteEntry.url,
          sha256:
            typeof remoteEntry.checksum === 'string'
              ? remoteEntry.checksum.replace(/^sha256:/i, '').trim().toLowerCase()
              : null,
          sizeBytes: Number.isInteger(remoteEntry.size) ? remoteEntry.size : null,
        },
      };
    }
  }

  const kind =
    remoteEntry.kind ||
    fallback.kind ||
    (remoteEntry.type === 'runtime' ? 'runtime' : 'plugin');
  return {
    ...fallback,
    ...remoteEntry,
    id,
    kind,
    artifacts: artifacts || fallback.artifacts || {},
    checksumAlgorithm:
      remoteEntry.checksumAlgorithm || fallback.checksumAlgorithm || 'sha256',
    _builtIn: false,
  };
}

// Validate a parsed manifest against the per-platform schema.
// Returns { valid: boolean, issues: string[] }.
// Hand-rolled (no ajv in dependencies — see package.json).
function validateManifest(parsed) {
  const issues = [];
  if (!parsed || typeof parsed !== 'object') {
    return { valid: false, issues: ['manifest root must be an object'] };
  }
  if (typeof parsed.version !== 'string') {
    issues.push('manifest.version must be a string');
  }
  if (!parsed.plugins || typeof parsed.plugins !== 'object') {
    return { valid: false, issues: ['manifest.plugins must be an object', ...issues] };
  }
  const platformIdRe = /^(macos-arm64|macos-x64|windows-x64|linux-x64)$/;
  const sha256Re = /^[a-f0-9]{64}$/;

  for (const [id, plug] of Object.entries(parsed.plugins)) {
    const where = `plugins.${id}`;
    if (!plug || typeof plug !== 'object') {
      issues.push(`${where} must be an object`);
      continue;
    }
    if (plug.id !== id) {
      issues.push(`${where}.id ('${plug.id}') must equal map key ('${id}')`);
    }
    if (typeof plug.title !== 'string' || plug.title.length === 0) {
      issues.push(`${where}.title must be a non-empty string`);
    }
    if (typeof plug.version !== 'string' || !/^[0-9]+\.[0-9]+\.[0-9]+/.test(plug.version)) {
      issues.push(`${where}.version ('${plug.version}') must be a semver-like string`);
    }
    if (plug.kind !== 'runtime' && plug.kind !== 'plugin') {
      issues.push(`${where}.kind must be 'runtime' or 'plugin' (got '${plug.kind}')`);
    }
    if (plug.checksumAlgorithm && plug.checksumAlgorithm !== 'sha256') {
      issues.push(`${where}.checksumAlgorithm must be 'sha256' (Week 2 only supports sha256)`);
    }
    if (!plug.artifacts || typeof plug.artifacts !== 'object') {
      issues.push(`${where}.artifacts must be an object keyed by PlatformId`);
      continue;
    }
    const platformKeys = Object.keys(plug.artifacts);
    if (platformKeys.length === 0) {
      issues.push(`${where}.artifacts must declare at least one platform`);
    }
    for (const pk of platformKeys) {
      if (!platformIdRe.test(pk)) {
        issues.push(`${where}.artifacts.${pk}: invalid PlatformId`);
      }
      const a = plug.artifacts[pk];
      if (!a || typeof a !== 'object') {
        issues.push(`${where}.artifacts.${pk} must be an object`);
        continue;
      }
      if (a.url !== null && typeof a.url !== 'string') {
        issues.push(`${where}.artifacts.${pk}.url must be a string or null`);
      } else if (typeof a.url === 'string') {
        if (!a.url.startsWith('built-in://')) {
          try {
            const host = new URL(a.url).hostname.toLowerCase();
            if (!ALLOWED_RUNTIME_HOSTS.includes(host)) {
              issues.push(`${where}.artifacts.${pk}.url host '${host}' not in ALLOWED_RUNTIME_HOSTS`);
            }
          } catch {
            issues.push(`${where}.artifacts.${pk}.url is not a valid URL`);
          }
          // url path must reference the platformId it sits under
          if (!a.url.toLowerCase().includes(pk)) {
            issues.push(`${where}.artifacts.${pk}.url must reference platformId in path (got '${a.url}')`);
          }
        }
      }
      if (a.sha256 !== null && !sha256Re.test(String(a.sha256))) {
        issues.push(`${where}.artifacts.${pk}.sha256 must be 64 lowercase hex or null`);
      }
      if (a.sha256 !== null && a.sizeBytes === null) {
        // sha256 populated but sizeBytes missing — pair them
        issues.push(`${where}.artifacts.${pk}.sizeBytes must be set when sha256 is set`);
      }
      if (a.sizeBytes !== null && (!Number.isInteger(a.sizeBytes) || a.sizeBytes < 0)) {
        issues.push(`${where}.artifacts.${pk}.sizeBytes must be a non-negative integer or null`);
      }
    }
    if (plug.kind === 'runtime') {
      if (!['r', 'python'].includes(plug.language)) {
        issues.push(`${where}.language must be 'r' or 'python' when kind='runtime'`);
      }
    }
  }
  return { valid: issues.length === 0, issues };
}

module.exports = {
  PLATFORM_IDS,
  ALLOWED_RUNTIME_HOSTS,
  normalizeRemotePluginEntry,
  selectArtifact,
  assertAllowedUrl,
  validateManifest,
};
