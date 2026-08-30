'use strict';

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

/**
 * Capability Bundle Registry — Stage 3 B1/B2 (single source of truth).
 *
 * A "capability bundle" is a prebuilt archive of heavyweight R/Python packages
 * (e.g. clusterProfiler + org.*.eg.db for enrichment) that a built-in analysis
 * module declares it needs via `plugin.json.requiresBundle`. Module code always
 * ships read-only inside the packaged app; bundles are fetched on demand into a
 * writable user directory by `capability-provisioning.js`.
 *
 * The gap this module closes (AUDIT-LOG §5): `plugin.json` only records a
 * `bundleId` (e.g. "r-enrichment") + `requiresBundleVersion`, but *nowhere*
 * mapped that bundleId to a concrete `{ url, sha256, sizeBytes }` descriptor.
 * This file IS that mapping — the single source of truth for "what is bundle X,
 * where does it live, and how do we verify it".
 *
 * Layering:
 *   - This module is PURE DATA + THIN ORCHESTRATION. It has no `electron`
 *     dependency and can run in core/ (biof3-server, tests) and the main process.
 *   - `capability-provisioning.js` is the generic download/verify/install
 *     engine. This module supplies it descriptors and decides *whether* a
 *     bundle should be fetched.
 *   - `ensureBundlesForPlugin()` is the orchestration layer used by both real
 *     R run paths (registry.js / tools-executor.js).
 *
 * CONVENTION — `sha256 === null` means "unpublished, do not download":
 *   We never fabricate hashes. A descriptor with `sha256 === null` is treated
 *   as `status: 'unpublished'` and provisioning will NOT attempt a download for
 *   it — an unverifiable bundle must never be fetched. Published descriptors
 *   below are backfilled only from `scripts/build-r-bundle.mjs` output after
 *   their OSS objects have been uploaded and checked.
 */

const BUNDLE_HOST = 'https://biof3-uploads.oss-cn-hangzhou.aliyuncs.com';
const DEFAULT_PLATFORM = 'macos-arm64';
const DEFAULT_VERSION = '1.0.0';

function bundleUrl(bundleId, version, platform) {
  return `${BUNDLE_HOST}/bundles/${bundleId}-${version}-${platform}.tar.gz`;
}

/**
 * The registry: bundleId → descriptor.
 *
 * Each descriptor:
 *   - bundleId {string}
 *   - version {string}
 *   - url {string}       download URL (host must be on provisioning allowlist)
 *   - sha256 {string|null}   null ⇒ unpublished (do not download)
 *   - sizeBytes {number|null} null ⇒ unknown (bundle not built yet)
 *   - platforms {string[]}    supported platforms for this descriptor
 *
 * sha256/sizeBytes are immutable build descriptors for the published macOS
 * arm64 archives. New platform/version builds require their own verified
 * descriptors; a requested version with no descriptor remains unpublished.
 */
const BUNDLE_REGISTRY = Object.freeze({
  'r-enrichment': Object.freeze({
    bundleId: 'r-enrichment',
    version: DEFAULT_VERSION,
    url: bundleUrl('r-enrichment', DEFAULT_VERSION, DEFAULT_PLATFORM),
    sha256: 'a857831d0d548cc6f9d856684ccec32c0241af018521c5d0641349ade0be1820',
    sizeBytes: 422094687,
    platforms: Object.freeze([DEFAULT_PLATFORM]),
  }),
  'r-wgcna': Object.freeze({
    bundleId: 'r-wgcna',
    version: DEFAULT_VERSION,
    url: bundleUrl('r-wgcna', DEFAULT_VERSION, DEFAULT_PLATFORM),
    sha256: '439273d8b9cad414d3ed32f14076ac88649ca885e6b5854e0ae91bf5e7980288',
    sizeBytes: 82367498,
    platforms: Object.freeze([DEFAULT_PLATFORM]),
  }),
});

/**
 * Classify a descriptor's publication status.
 *   - 'unknown'     — no such bundleId in the registry
 *   - 'unpublished' — registered but sha256 is null (not built/signed yet)
 *   - 'ready'       — registered and has a sha256 (verifiable, downloadable)
 */
function bundleStatus(descriptor) {
  if (!descriptor) return 'unknown';
  return descriptor.sha256 ? 'ready' : 'unpublished';
}

/**
 * Look up a bundle descriptor by id. Returns null for an unknown bundle or when
 * the descriptor does not support the requested platform.
 *
 * @param {string} bundleId
 * @param {{platform?: string, version?: string}} [opts]
 * @returns {object|null} a shallow copy of the descriptor, or null
 */
function getBundleDescriptor(bundleId, opts = {}) {
  if (!bundleId || typeof bundleId !== 'string') return null;
  const base = BUNDLE_REGISTRY[bundleId];
  if (!base) return null;

  const platform = opts.platform || DEFAULT_PLATFORM;
  if (Array.isArray(base.platforms) && !base.platforms.includes(platform)) {
    return null;
  }

  // A requested version different from the registered one is not an error here
  // (the caller may want the descriptor to compare); we surface the registered
  // descriptor and let the readiness/provisioning layer enforce version match.
  const version = opts.version || base.version;
  const platformMismatchSafe = { ...base, platforms: [...base.platforms] };
  if (version !== base.version) {
    // Re-derive the URL for the requested version so callers building a
    // per-version fetch get a consistent URL; sha256 stays null (we only have a
    // verified hash for the registered/built version).
    return {
      ...platformMismatchSafe,
      version,
      url: bundleUrl(bundleId, version, platform),
      sha256: base.version === version ? base.sha256 : null,
      sizeBytes: base.version === version ? base.sizeBytes : null,
    };
  }
  return platformMismatchSafe;
}

function normalizeRequiredBundles(pluginCfg) {
  if (!pluginCfg || !pluginCfg.requiresBundle) return [];
  const raw = Array.isArray(pluginCfg.requiresBundle)
    ? pluginCfg.requiresBundle
    : [pluginCfg.requiresBundle];
  return raw.filter((b) => typeof b === 'string' && b.length > 0);
}

/**
 * Extract a verified .tar.gz bundle into the library directory mounted by
 * R_LIBS_USER. The archive is trusted only after capability-provisioning has
 * matched its SHA-256 against the descriptor committed in this registry.
 *
 * A bundle-manifest.json marker is mandatory so a wrong-but-valid archive
 * cannot be recorded as a ready R library.
 */
function installTarGzBundle(archivePath, installDir, expected = {}) {
  fs.mkdirSync(installDir, { recursive: true });
  return new Promise((resolve, reject) => {
    const rejectAndClean = (failure) => {
      try { fs.rmSync(installDir, { recursive: true, force: true }); } catch {}
      reject(failure);
    };
    execFile(
      'tar',
      ['-xzf', archivePath, '-C', installDir],
      { timeout: 300000, maxBuffer: 1024 * 1024 },
      (error, _stdout, stderr) => {
        if (error) {
          const failure = new Error(
            `bundle_extract_failed: ${String(stderr || error.message).trim()}`
          );
          failure.code = 'bundle_extract_failed';
          rejectAndClean(failure);
          return;
        }
        const marker = path.join(installDir, 'bundle-manifest.json');
        if (!fs.existsSync(marker)) {
          const failure = new Error('bundle_manifest_missing');
          failure.code = 'bundle_manifest_missing';
          rejectAndClean(failure);
          return;
        }
        let manifest;
        try {
          manifest = JSON.parse(fs.readFileSync(marker, 'utf8'));
        } catch {
          const failure = new Error('bundle_manifest_invalid');
          failure.code = 'bundle_manifest_invalid';
          rejectAndClean(failure);
          return;
        }
        if (
          (expected.bundleId && manifest.bundleId !== expected.bundleId) ||
          (expected.version && manifest.bundleVersion !== expected.version)
        ) {
          const failure = new Error('bundle_manifest_mismatch');
          failure.code = 'bundle_manifest_mismatch';
          rejectAndClean(failure);
          return;
        }
        resolve(installDir);
      }
    );
  });
}

/**
 * Resolve the bundle descriptors a plugin requires, each annotated with a
 * `status` for a future wiring layer to make decisions on.
 *
 * @param {{requiresBundle?: string|string[], requiresBundleVersion?: string}} pluginCfg
 * @param {{platform?: string}} [opts]
 * @returns {Array<{bundleId:string, status:'ready'|'unpublished'|'unknown', descriptor:object|null}>}
 */
function resolveBundlesForPlugin(pluginCfg, opts = {}) {
  const bundleIds = normalizeRequiredBundles(pluginCfg);
  const version = (pluginCfg && pluginCfg.requiresBundleVersion) || undefined;
  // Call through module.exports so a test (or a future override layer) can swap
  // getBundleDescriptor and have resolve/ensure honor it.
  const lookup = module.exports.getBundleDescriptor;
  return bundleIds.map((bundleId) => {
    const descriptor = lookup(bundleId, { platform: opts.platform, version });
    return { bundleId, status: bundleStatus(descriptor), descriptor };
  });
}

/**
 * Orchestration layer: ensure every bundle a plugin requires is provisioned.
 *
 * For each required bundle:
 *   - unknown bundle           → { ok:false, status:'unknown' }        (no fetch)
 *   - unpublished (sha256=null)→ { ok:false, status:'unpublished' }    (no fetch)
 *   - already provisioned      → { ok:true,  status:'ready', alreadyReady:true }
 *   - ready + not installed    → provisionCapability(...) result
 *
 * Never throws; returns a structured aggregate. `options` are forwarded to
 * `provisionCapability` (download/hash/install/runtimesDir/onProgress can be
 * injected, e.g. by tests or the future wiring layer).
 *
 * @param {{requiresBundle?: string|string[], requiresBundleVersion?: string}} pluginCfg
 * @param {object} [options] forwarded to provisionCapability + { platform }
 * @returns {Promise<{ok:boolean, results:Array<object>}>}
 */
async function ensureBundlesForPlugin(pluginCfg, options = {}) {
  const resolved = resolveBundlesForPlugin(pluginCfg, { platform: options.platform });
  if (resolved.length === 0) {
    return { ok: true, results: [] };
  }

  let cp = null;
  try {
    cp = require('./capability-provisioning');
  } catch (e) {
    return {
      ok: false,
      results: resolved.map((r) => ({
        bundleId: r.bundleId,
        ok: false,
        status: 'provisioning_unavailable',
        message: e.message,
      })),
    };
  }

  const results = [];
  for (const { bundleId, status, descriptor } of resolved) {
    if (status === 'unknown') {
      results.push({ bundleId, ok: false, status: 'unknown' });
      continue;
    }
    if (status === 'unpublished') {
      // sha256 is null — unverifiable, must not download.
      results.push({ bundleId, ok: false, status: 'unpublished' });
      continue;
    }

    // status === 'ready': check readiness first, then provision if needed.
    const capability = {
      capabilityId: descriptor.bundleId,
      version: descriptor.version,
      url: descriptor.url,
      sha256: descriptor.sha256,
      size: descriptor.sizeBytes || undefined,
      kind: 'bundle',
    };

    let ready = { ready: false };
    try {
      ready = cp.checkCapabilityReady(capability, options);
    } catch (e) {
      results.push({ bundleId, ok: false, status: 'readiness_check_failed', message: e.message });
      continue;
    }
    if (ready.ready) {
      results.push({ bundleId, ok: true, status: 'ready', alreadyReady: true, installDir: ready.installDir });
      continue;
    }

    const provisionOptions = { ...options };
    if (
      typeof provisionOptions.install !== 'function' &&
      /\.tar\.gz(?:$|[?#])/i.test(descriptor.url)
    ) {
      provisionOptions.install = (archivePath, installDir) =>
        installTarGzBundle(archivePath, installDir, {
          bundleId: descriptor.bundleId,
          version: descriptor.version,
        });
    }
    const prov = await cp.provisionCapability(capability, provisionOptions);
    results.push({
      bundleId,
      ok: !!prov.ok,
      status: prov.ok ? 'ready' : 'provision_failed',
      alreadyReady: !!prov.alreadyReady,
      installDir: prov.installDir,
      error: prov.error,
      message: prov.message,
    });
  }

  return { ok: results.every((r) => r.ok), results };
}

module.exports = {
  BUNDLE_REGISTRY,
  getBundleDescriptor,
  resolveBundlesForPlugin,
  ensureBundlesForPlugin,
  bundleStatus,
  installTarGzBundle,
};
