/**
 * Harness Capability Provisioning — Stage 3 M1 foundation.
 *
 * A "capability" is a runtime or R/Python package bundle that a built-in
 * analysis module declares it needs (e.g. an `r-enrichment` bundle for
 * GO/KEGG). Module code (`resources/built-in-plugins/<id>/`) always ships
 * read-only inside the packaged app; capabilities are the opposite: they are
 * fetched on demand into a writable user directory and are never bundled
 * into the .app itself.
 *
 * Design constraints (Stage 3 design doc §5, §D2/D5/D7/D8):
 *   - No second download/verify/install system: this module re-implements
 *     the same download + streaming SHA-256 + atomic-move steps already used
 *     by `src/plugin-manager.js`, but stays free of an `electron` dependency
 *     so it can run in `core/` (petri-server, tests) as well as the main process.
 *   - Offline-first: callers should prefer an already-provisioned capability
 *     and only reach the network when the local copy is missing or invalid
 *     (D5). This module doesn't decide *when* to fetch — callers (Harness
 *     readiness gate) do — it only makes fetching idempotent, verifiable and
 *     auditable.
 *   - Transparent, non-blocking (D8): callers get progress callbacks, never
 *     a bare silent multi-hundred-MB download.
 *   - Auditable (D2): every successful provision is recorded in a ledger
 *     file that a read-only settings view can render later.
 *
 * This module intentionally does NOT know about clusterProfiler, KEGG data,
 * or any specific bundle. It is generic infrastructure; GO/KEGG (Stage 3 M2)
 * supplies capability manifests describing what it needs.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const https = require('https');

const LEDGER_FILE_NAME = 'harness-provisioning.json';
const TMP_DIR_NAME = '.tmp';
const CAPABILITIES_DIR_NAME = 'capabilities';

/**
 * Host allowlist for capability downloads (Stage 3 design doc §5.5, §D7;
 * AUDIT-LOG problem D). Provisioning fetches multi-hundred-MB bundles from a
 * URL carried in a capability descriptor; without a host allowlist a
 * malformed/hostile manifest could point the downloader at an arbitrary host
 * (SSRF / exfiltration surface). The current distribution source is the
 * project OSS CDN (see src/macos-oss-updater.js DEFAULT_FEED_URL), so the
 * default allowlist covers Aliyun OSS. Distribution source can move (D4/D7)
 * without touching provisioning logic by overriding the allowlist via
 * `options.allowedHosts` or the PETRI_CAPABILITY_ALLOWED_HOSTS env var.
 *
 * Entries are matched case-insensitively. An entry beginning with '.' is a
 * suffix match (e.g. '.aliyuncs.com' matches 'x.oss-cn-hangzhou.aliyuncs.com');
 * any other entry must match the host exactly.
 */
const DEFAULT_ALLOWED_HOSTS = Object.freeze([
  'petri-uploads.oss-cn-hangzhou.aliyuncs.com',
  '.aliyuncs.com',
]);

function resolveAllowedHosts(options = {}) {
  if (Array.isArray(options.allowedHosts) && options.allowedHosts.length > 0) {
    return options.allowedHosts;
  }
  const fromEnv = process.env.PETRI_CAPABILITY_ALLOWED_HOSTS;
  if (fromEnv && fromEnv.trim()) {
    return fromEnv.split(',').map((h) => h.trim()).filter(Boolean);
  }
  return DEFAULT_ALLOWED_HOSTS;
}

function _hostMatches(host, pattern) {
  const h = String(host || '').toLowerCase();
  const p = String(pattern || '').toLowerCase();
  if (!h || !p) return false;
  if (p.startsWith('.')) return h === p.slice(1) || h.endsWith(p);
  return h === p;
}

/**
 * Validate that a capability download URL is https and its host is on the
 * allowlist. Never throws; returns a structured result so callers surface a
 * clean diagnostic instead of a stack trace.
 *
 * @returns {{ok:true, host:string} | {ok:false, reason:string}}
 */
function checkUrlAllowed(url, options = {}) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: 'invalid_url' };
  }
  if (parsed.protocol !== 'https:') {
    return { ok: false, reason: 'insecure_protocol' };
  }
  const allowed = resolveAllowedHosts(options);
  const host = parsed.hostname;
  if (!allowed.some((pattern) => _hostMatches(host, pattern))) {
    return { ok: false, reason: 'host_not_allowed', host };
  }
  return { ok: true, host };
}

function defaultRuntimesDir() {
  const localDataDir = process.env.PETRI_LOCAL_DATA_DIR || path.join(os.homedir(), 'Documents', 'Petri-Local');
  return path.join(localDataDir, 'runtimes');
}

function resolveRuntimesDir(options = {}) {
  return options.runtimesDir || defaultRuntimesDir();
}

function getLedgerPath(options = {}) {
  return path.join(resolveRuntimesDir(options), LEDGER_FILE_NAME);
}

function capabilityInstallDir(capabilityId, version, options = {}) {
  return path.join(resolveRuntimesDir(options), CAPABILITIES_DIR_NAME, capabilityId, version);
}

function _ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

/**
 * Read the provisioning ledger. Never throws; a missing/corrupt ledger reads
 * as empty so a fresh install always looks like "nothing provisioned yet"
 * rather than crashing capability checks.
 */
function readLedger(options = {}) {
  const ledgerPath = getLedgerPath(options);
  try {
    const raw = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
    return raw && typeof raw === 'object' && raw.capabilities && typeof raw.capabilities === 'object'
      ? raw
      : { schemaVersion: 1, capabilities: {} };
  } catch {
    return { schemaVersion: 1, capabilities: {} };
  }
}

function writeLedger(ledger, options = {}) {
  const runtimesDir = resolveRuntimesDir(options);
  _ensureDir(runtimesDir);
  const ledgerPath = getLedgerPath(options);
  const payload = { schemaVersion: 1, capabilities: {}, ...ledger };
  fs.writeFileSync(ledgerPath, JSON.stringify(payload, null, 2));
  return payload;
}

/**
 * List provisioned capabilities for a read-only "what has Harness set up"
 * view. Returns an array (not the raw ledger object) so the caller doesn't
 * need to know the on-disk schema.
 */
function listProvisionedCapabilities(options = {}) {
  const ledger = readLedger(options);
  return Object.values(ledger.capabilities || {}).map((entry) => ({ ...entry }));
}

function _sha256Matches(actual, expected) {
  const normalize = (value) => String(value || '').replace(/^sha256:/i, '').trim().toLowerCase();
  return normalize(actual) === normalize(expected);
}

/**
 * Streaming SHA-256 (no full-file buffering), mirroring
 * `src/plugin-manager.js#streamingSha256` so large bundles never load fully
 * into memory just to be verified.
 */
function streamingSha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath, { highWaterMark: 1024 * 1024 });
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

/**
 * Default download implementation: plain https + fs stream, no electron
 * dependency. Tests and Electron-side callers may inject `options.download`
 * to avoid real network calls or to reuse an existing downloader.
 */
function defaultDownload(url, destPath, onProgress) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    const req = https.get(url, { timeout: 30000 }, (res) => {
      if (res.statusCode !== 200) {
        file.close();
        try { fs.unlinkSync(destPath); } catch {}
        reject(new Error(`download failed: HTTP ${res.statusCode}`));
        return;
      }
      const total = parseInt(res.headers['content-length'] || '0', 10);
      let received = 0;
      res.on('data', (chunk) => {
        received += chunk.length;
        if (onProgress && total > 0) onProgress({ received, total, ratio: received / total });
      });
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve(destPath)));
    });
    req.on('error', (error) => {
      file.close();
      try { fs.unlinkSync(destPath); } catch {}
      reject(error);
    });
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('download timed out'));
    });
  });
}

/**
 * Readiness check: is this capability already usable without touching the
 * network? Self-healing — a ledger entry alone is not trusted; the install
 * directory must still exist on disk (mirrors artifact-truth's "don't trust
 * the record, check the file").
 *
 * @param {{capabilityId:string, version:string, sha256?:string}} capability
 */
function checkCapabilityReady(capability, options = {}) {
  if (!capability || !capability.capabilityId || !capability.version) {
    return { ready: false, reason: 'invalid_capability_descriptor' };
  }
  const ledger = readLedger(options);
  const entry = ledger.capabilities[capability.capabilityId];
  const installDir = capabilityInstallDir(capability.capabilityId, capability.version, options);
  if (!entry) return { ready: false, reason: 'not_provisioned', installDir };
  if (entry.version !== capability.version) {
    return { ready: false, reason: 'version_mismatch', installDir, installedVersion: entry.version };
  }
  if (capability.sha256 && entry.sha256 && !_sha256Matches(entry.sha256, capability.sha256)) {
    return { ready: false, reason: 'sha256_mismatch', installDir };
  }
  if (!fs.existsSync(installDir)) {
    return { ready: false, reason: 'install_dir_missing', installDir };
  }
  return { ready: true, installDir, entry };
}

async function _provisionOnce(capability, options) {
  const runtimesDir = resolveRuntimesDir(options);
  const tmpDir = path.join(runtimesDir, TMP_DIR_NAME);
  _ensureDir(tmpDir);
  const installDir = capabilityInstallDir(capability.capabilityId, capability.version, options);
  const tmpFile = path.join(tmpDir, `${capability.capabilityId}-${capability.version}-${process.pid}.download`);

  const download = options.download || defaultDownload;
  await download(capability.url, tmpFile, options.onProgress);

  if (capability.sha256) {
    const actual = await (options.hash || streamingSha256)(tmpFile);
    if (!_sha256Matches(actual, capability.sha256)) {
      try { fs.unlinkSync(tmpFile); } catch {}
      const error = new Error('sha256_mismatch');
      error.code = 'sha256_mismatch';
      throw error;
    }
  }

  // Materialize into place. Bundles that need extraction (e.g. tar.gz) pass
  // an `install` function; the default treats the download as the payload
  // itself and atomically renames it into the install directory.
  _ensureDir(path.dirname(installDir));
  try { fs.rmSync(installDir, { recursive: true, force: true }); } catch {}
  if (typeof options.install === 'function') {
    await options.install(tmpFile, installDir);
  } else {
    _ensureDir(installDir);
    fs.renameSync(tmpFile, path.join(installDir, path.basename(tmpFile)));
  }
  try { fs.unlinkSync(tmpFile); } catch {}

  return installDir;
}

/**
 * Fetch, verify and materialize a capability if it isn't already ready.
 * Idempotent: repeated calls when already provisioned are a no-op disk
 * check, not a re-download. Retries a corrupted/interrupted attempt once
 * before surfacing a diagnostic — callers should not retry silently forever.
 *
 * @param {{capabilityId:string, version:string, url:string, sha256?:string, kind?:string}} capability
 * @param {object} [options]
 * @param {string} [options.runtimesDir] - override for tests/isolation.
 * @param {function} [options.download] - injectable downloader (url, destPath, onProgress) => Promise<void>.
 * @param {function} [options.hash] - injectable hasher (filePath) => Promise<string>.
 * @param {function} [options.install] - injectable installer (tmpFile, installDir) => Promise<void>, for bundles needing extraction.
 * @param {function} [options.onProgress] - progress callback for D8 transparency.
 * @param {number} [options.maxAttempts] - default 2.
 */
async function provisionCapability(capability, options = {}) {
  if (!capability || !capability.capabilityId || !capability.version || !capability.url) {
    return { ok: false, error: 'invalid_capability_descriptor' };
  }

  const already = checkCapabilityReady(capability, options);
  if (already.ready) {
    return { ok: true, alreadyReady: true, installDir: already.installDir };
  }

  // Host allowlist gate — only reached when a real network fetch is about to
  // happen (an already-provisioned capability short-circuits above and is
  // never re-validated, so tightening the allowlist can't strand installed
  // bundles). A caller-injected `options.download` (tests) still passes
  // through this gate so the allowlist is exercised uniformly; injected
  // downloaders simply must use an allowed URL.
  const urlCheck = checkUrlAllowed(capability.url, options);
  if (!urlCheck.ok) {
    return { ok: false, error: urlCheck.reason, url: capability.url, host: urlCheck.host };
  }

  const maxAttempts = Number.isInteger(options.maxAttempts) ? options.maxAttempts : 2;
  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const installDir = await _provisionOnce(capability, options);
      const ledger = readLedger(options);
      ledger.capabilities[capability.capabilityId] = {
        capabilityId: capability.capabilityId,
        kind: capability.kind || 'bundle',
        version: capability.version,
        sha256: capability.sha256 || null,
        url: capability.url,
        size: capability.size || null,
        installDir,
        installedAt: (options.now || Date.now)(),
        attempts: attempt,
      };
      writeLedger(ledger, options);
      return { ok: true, alreadyReady: false, installDir, attempts: attempt };
    } catch (error) {
      lastError = error;
    }
  }

  return {
    ok: false,
    error: (lastError && lastError.code) || 'provisioning_failed',
    message: lastError && lastError.message,
    attempts: maxAttempts,
  };
}

/**
 * Remove a provisioned capability (ledger entry + install dir). Local-disk
 * only; never touches user analysis data or project artifacts. Callers at
 * the UI layer should treat this as a confirm-first action (C-03).
 */
function removeCapability(capabilityId, options = {}) {
  const ledger = readLedger(options);
  const entry = ledger.capabilities[capabilityId];
  if (!entry) return { ok: true, removed: false };
  try {
    if (entry.installDir) fs.rmSync(entry.installDir, { recursive: true, force: true });
  } catch (error) {
    return { ok: false, error: error.message };
  }
  delete ledger.capabilities[capabilityId];
  writeLedger(ledger, options);
  return { ok: true, removed: true };
}

module.exports = {
  defaultRuntimesDir,
  resolveRuntimesDir,
  getLedgerPath,
  capabilityInstallDir,
  readLedger,
  writeLedger,
  listProvisionedCapabilities,
  checkCapabilityReady,
  provisionCapability,
  removeCapability,
  streamingSha256,
  defaultDownload,
  checkUrlAllowed,
  resolveAllowedHosts,
  DEFAULT_ALLOWED_HOSTS,
};
