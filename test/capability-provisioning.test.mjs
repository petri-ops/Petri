/**
 * test/capability-provisioning.test.mjs
 *
 * Unit tests for core/shared-backend/capability-provisioning.js
 *
 * Stage 3 M1 — all assertions use local temp dirs and injected mock
 * downloaders/hashers; no real network calls, no large file downloads.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const cp = require('../core/shared-backend/capability-provisioning.js');

// ── helpers ─────────────────────────────────────────────────────────────────

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'petri-cap-test-'));
}

function sha256Of(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function makeDownload(content) {
  return async (_url, destPath) => {
    fs.writeFileSync(destPath, content);
  };
}

const CONTENT = 'test-bundle-payload';
const GOOD_SHA = sha256Of(CONTENT);

// Default URL uses the project OSS CDN host so it passes the host allowlist
// gate (see capability-provisioning.js DEFAULT_ALLOWED_HOSTS). Tests that
// exercise the allowlist itself override `url` and/or pass `allowedHosts`.
function baseCap(overrides = {}) {
  return {
    capabilityId: 'r-enrichment',
    version: '1.0.0',
    url: 'https://petri-uploads.oss-cn-hangzhou.aliyuncs.com/bundles/r-enrichment-1.0.0.tar',
    sha256: GOOD_SHA,
    ...overrides,
  };
}

// ── 1. readiness: not provisioned ───────────────────────────────────────────

test('checkCapabilityReady: not_provisioned when ledger is empty', () => {
  const runtimesDir = tmpDir();
  const result = cp.checkCapabilityReady(baseCap(), { runtimesDir });
  assert.equal(result.ready, false);
  assert.equal(result.reason, 'not_provisioned');
});

// ── 2. readiness: invalid descriptor ────────────────────────────────────────

test('checkCapabilityReady: invalid_capability_descriptor for missing id', () => {
  const runtimesDir = tmpDir();
  const result = cp.checkCapabilityReady({ version: '1.0.0' }, { runtimesDir });
  assert.equal(result.ready, false);
  assert.equal(result.reason, 'invalid_capability_descriptor');
});

// ── 3. successful provision ──────────────────────────────────────────────────

test('provisionCapability: provision succeeds with matching SHA', async () => {
  const runtimesDir = tmpDir();
  const cap = baseCap();
  const result = await cp.provisionCapability(cap, {
    runtimesDir,
    download: makeDownload(CONTENT),
  });
  assert.equal(result.ok, true);
  assert.equal(result.alreadyReady, false);
  assert.equal(typeof result.installDir, 'string');
  // ledger should now reflect the entry
  const ledger = cp.readLedger({ runtimesDir });
  const entry = ledger.capabilities['r-enrichment'];
  assert.ok(entry, 'ledger entry must exist');
  assert.equal(entry.version, '1.0.0');
  assert.equal(entry.sha256, GOOD_SHA);
  assert.equal(typeof entry.installedAt, 'number');
});

// ── 4. idempotency ───────────────────────────────────────────────────────────

test('provisionCapability: idempotent — second call returns alreadyReady without downloading', async () => {
  const runtimesDir = tmpDir();
  const cap = baseCap();
  // First provision
  await cp.provisionCapability(cap, { runtimesDir, download: makeDownload(CONTENT) });
  // Second provision — track download calls
  let downloadCalls = 0;
  const countingDownload = async (_url, destPath) => {
    downloadCalls += 1;
    fs.writeFileSync(destPath, CONTENT);
  };
  const result = await cp.provisionCapability(cap, { runtimesDir, download: countingDownload });
  assert.equal(result.ok, true);
  assert.equal(result.alreadyReady, true);
  assert.equal(downloadCalls, 0, 'no re-download on idempotent call');
});

// ── 5. SHA mismatch rejection ────────────────────────────────────────────────

test('provisionCapability: rejects download with wrong SHA and does not write ledger', async () => {
  const runtimesDir = tmpDir();
  const cap = baseCap({ sha256: '0'.repeat(64) }); // correct content, wrong expected hash
  const result = await cp.provisionCapability(cap, {
    runtimesDir,
    download: makeDownload(CONTENT),
    maxAttempts: 1,
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'sha256_mismatch');
  // ledger must not contain the corrupted entry
  const ledger = cp.readLedger({ runtimesDir });
  assert.equal(ledger.capabilities['r-enrichment'], undefined, 'corrupt entry must not be stored');
});

// ── 6. retry exhaustion produces diagnostic ──────────────────────────────────

test('provisionCapability: two retry attempts both fail → error with attempts count', async () => {
  const runtimesDir = tmpDir();
  const cap = baseCap({ sha256: 'badhash' });
  const result = await cp.provisionCapability(cap, {
    runtimesDir,
    download: makeDownload(CONTENT),
    maxAttempts: 2,
  });
  assert.equal(result.ok, false);
  assert.equal(result.attempts, 2);
  assert.ok(result.error, 'must have an error code');
});

// ── 7. install_dir_missing self-heals readiness ───────────────────────────────

test('checkCapabilityReady: install_dir_missing when ledger entry exists but dir deleted', async () => {
  const runtimesDir = tmpDir();
  const cap = baseCap();
  // Provision successfully
  const provResult = await cp.provisionCapability(cap, {
    runtimesDir,
    download: makeDownload(CONTENT),
  });
  assert.equal(provResult.ok, true);
  // Delete the install dir to simulate corruption
  fs.rmSync(provResult.installDir, { recursive: true, force: true });
  // Now readiness check should detect the missing dir
  const readiness = cp.checkCapabilityReady(cap, { runtimesDir });
  assert.equal(readiness.ready, false);
  assert.equal(readiness.reason, 'install_dir_missing');
});

// ── 8. version mismatch ───────────────────────────────────────────────────────

test('checkCapabilityReady: version_mismatch when installed version differs', async () => {
  const runtimesDir = tmpDir();
  const v1 = baseCap({ version: '1.0.0' });
  await cp.provisionCapability(v1, { runtimesDir, download: makeDownload(CONTENT) });
  // Ask for v2 — should be not ready
  const readiness = cp.checkCapabilityReady(baseCap({ version: '2.0.0' }), { runtimesDir });
  assert.equal(readiness.ready, false);
  assert.equal(readiness.reason, 'version_mismatch');
  assert.equal(readiness.installedVersion, '1.0.0');
});

// ── 9. listProvisionedCapabilities ────────────────────────────────────────────

test('listProvisionedCapabilities: returns array of provisioned entries', async () => {
  const runtimesDir = tmpDir();
  // Start empty
  assert.deepEqual(cp.listProvisionedCapabilities({ runtimesDir }), []);
  // Provision one
  await cp.provisionCapability(baseCap({ capabilityId: 'r-enrichment' }), {
    runtimesDir,
    download: makeDownload(CONTENT),
  });
  const list = cp.listProvisionedCapabilities({ runtimesDir });
  assert.equal(list.length, 1);
  assert.equal(list[0].capabilityId, 'r-enrichment');
  // Provision another
  await cp.provisionCapability(baseCap({ capabilityId: 'r-wgcna', sha256: GOOD_SHA }), {
    runtimesDir,
    download: makeDownload(CONTENT),
  });
  assert.equal(cp.listProvisionedCapabilities({ runtimesDir }).length, 2);
});

// ── 10. removeCapability ──────────────────────────────────────────────────────

test('removeCapability: removes ledger entry and install directory', async () => {
  const runtimesDir = tmpDir();
  const cap = baseCap();
  const provResult = await cp.provisionCapability(cap, {
    runtimesDir,
    download: makeDownload(CONTENT),
  });
  assert.equal(provResult.ok, true);
  assert.ok(fs.existsSync(provResult.installDir), 'install dir should exist before removal');

  const removeResult = cp.removeCapability('r-enrichment', { runtimesDir });
  assert.equal(removeResult.ok, true);
  assert.equal(removeResult.removed, true);
  assert.equal(fs.existsSync(provResult.installDir), false, 'install dir must be gone');
  assert.equal(cp.readLedger({ runtimesDir }).capabilities['r-enrichment'], undefined);
  // Removing again is a no-op, not an error
  const removeAgain = cp.removeCapability('r-enrichment', { runtimesDir });
  assert.equal(removeAgain.ok, true);
  assert.equal(removeAgain.removed, false);
});

// ── 11. corrupt ledger reads as empty ────────────────────────────────────────

test('readLedger: corrupt JSON file reads as empty ledger without throwing', () => {
  const runtimesDir = tmpDir();
  fs.mkdirSync(runtimesDir, { recursive: true });
  fs.writeFileSync(path.join(runtimesDir, 'harness-provisioning.json'), '{not valid json}');
  const ledger = cp.readLedger({ runtimesDir });
  assert.deepEqual(ledger.capabilities, {});
  assert.equal(ledger.schemaVersion, 1);
});

// ── 12. custom install function (bundle extraction) ───────────────────────────

test('provisionCapability: supports custom install function (e.g. tar extraction)', async () => {
  const runtimesDir = tmpDir();
  const cap = baseCap();
  let installCalled = false;
  let tmpFileSeen = '';
  let installDirSeen = '';

  const customInstall = async (tmpFile, installDir) => {
    installCalled = true;
    tmpFileSeen = tmpFile;
    installDirSeen = installDir;
    fs.mkdirSync(installDir, { recursive: true });
    fs.writeFileSync(path.join(installDir, 'lib.R'), '# extracted');
  };

  const result = await cp.provisionCapability(cap, {
    runtimesDir,
    download: makeDownload(CONTENT),
    install: customInstall,
  });

  assert.equal(result.ok, true);
  assert.equal(installCalled, true);
  assert.equal(typeof tmpFileSeen, 'string');
  assert.ok(fs.existsSync(path.join(installDirSeen, 'lib.R')));
});

// ── 13. capabilityInstallDir path structure ────────────────────────────────────

test('capabilityInstallDir: path contains capabilityId and version', () => {
  const runtimesDir = tmpDir();
  const dir = cp.capabilityInstallDir('r-enrichment', '1.2.3', { runtimesDir });
  assert.ok(dir.includes('r-enrichment'), 'path must include capabilityId');
  assert.ok(dir.includes('1.2.3'), 'path must include version');
  assert.ok(dir.startsWith(runtimesDir), 'path must be under runtimesDir');
});

// ── 14. host allowlist: rejects off-allowlist host before downloading ─────────

test('provisionCapability: rejects a host not on the allowlist without downloading', async () => {
  const runtimesDir = tmpDir();
  let downloadCalls = 0;
  const countingDownload = async (_url, destPath) => {
    downloadCalls += 1;
    fs.writeFileSync(destPath, CONTENT);
  };
  const cap = baseCap({ url: 'https://evil.example.com/bundle.tar' });
  const result = await cp.provisionCapability(cap, { runtimesDir, download: countingDownload });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'host_not_allowed');
  assert.equal(result.host, 'evil.example.com');
  assert.equal(downloadCalls, 0, 'must not download from a disallowed host');
  // nothing written to ledger
  assert.equal(cp.readLedger({ runtimesDir }).capabilities['r-enrichment'], undefined);
});

// ── 15. host allowlist: rejects non-https URLs ────────────────────────────────

test('provisionCapability: rejects insecure (http) protocol', async () => {
  const runtimesDir = tmpDir();
  const cap = baseCap({ url: 'http://petri-uploads.oss-cn-hangzhou.aliyuncs.com/bundle.tar' });
  const result = await cp.provisionCapability(cap, { runtimesDir, download: makeDownload(CONTENT) });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'insecure_protocol');
});

// ── 16. host allowlist: options.allowedHosts override ─────────────────────────

test('provisionCapability: options.allowedHosts permits a custom host', async () => {
  const runtimesDir = tmpDir();
  const cap = baseCap({ url: 'https://mirror.internal.test/bundle.tar' });
  const result = await cp.provisionCapability(cap, {
    runtimesDir,
    download: makeDownload(CONTENT),
    allowedHosts: ['mirror.internal.test'],
  });
  assert.equal(result.ok, true);
  assert.equal(result.alreadyReady, false);
});

// ── 17. checkUrlAllowed: unit coverage of matching rules ──────────────────────

test('checkUrlAllowed: exact, suffix, protocol and invalid-url rules', () => {
  // default allowlist: exact host
  assert.equal(
    cp.checkUrlAllowed('https://petri-uploads.oss-cn-hangzhou.aliyuncs.com/x.tar').ok,
    true,
  );
  // default allowlist: suffix match on .aliyuncs.com
  assert.equal(cp.checkUrlAllowed('https://other-bucket.aliyuncs.com/x.tar').ok, true);
  // suffix pattern must not match a lookalike host
  assert.equal(cp.checkUrlAllowed('https://aliyuncs.com.evil.net/x.tar').ok, false);
  // off-allowlist
  const off = cp.checkUrlAllowed('https://example.com/x.tar');
  assert.equal(off.ok, false);
  assert.equal(off.reason, 'host_not_allowed');
  // http rejected
  assert.equal(cp.checkUrlAllowed('http://petri-uploads.oss-cn-hangzhou.aliyuncs.com/x.tar').reason, 'insecure_protocol');
  // garbage URL
  assert.equal(cp.checkUrlAllowed('not a url').reason, 'invalid_url');
  // explicit allowedHosts override
  assert.equal(cp.checkUrlAllowed('https://h.test/x', { allowedHosts: ['h.test'] }).ok, true);
});

// ── 18. host allowlist: PETRI_CAPABILITY_ALLOWED_HOSTS env override ────────────

test('checkUrlAllowed: PETRI_CAPABILITY_ALLOWED_HOSTS env var overrides default', () => {
  const prev = process.env.PETRI_CAPABILITY_ALLOWED_HOSTS;
  try {
    process.env.PETRI_CAPABILITY_ALLOWED_HOSTS = 'cdn.example.org, .mirror.test';
    assert.equal(cp.checkUrlAllowed('https://cdn.example.org/x.tar').ok, true);
    assert.equal(cp.checkUrlAllowed('https://a.mirror.test/x.tar').ok, true);
    // default OSS host no longer allowed once env override is set
    assert.equal(
      cp.checkUrlAllowed('https://petri-uploads.oss-cn-hangzhou.aliyuncs.com/x.tar').ok,
      false,
    );
  } finally {
    if (prev === undefined) delete process.env.PETRI_CAPABILITY_ALLOWED_HOSTS;
    else process.env.PETRI_CAPABILITY_ALLOWED_HOSTS = prev;
  }
});
