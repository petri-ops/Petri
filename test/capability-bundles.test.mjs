/**
 * test/capability-bundles.test.mjs
 *
 * Unit tests for core/shared-backend/capability-bundles.js
 *
 * Stage 3 B1/B2 — pure local, zero network. Provisioning is exercised through
 * injected mock download/hash + a temp runtimesDir. Mock descriptors isolate
 * provisioning behavior from the immutable production archive hashes.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const bundles = require('../core/shared-backend/capability-bundles.js');

// ── helpers ─────────────────────────────────────────────────────────────────

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'biof3-bundles-test-'));
}

function sha256Of(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

const CONTENT = 'test-bundle-payload';
const GOOD_SHA = sha256Of(CONTENT);

function makeDownload(content, counter) {
  return async (_url, destPath) => {
    if (counter) counter.calls += 1;
    fs.writeFileSync(destPath, content);
  };
}

async function makeMockInstall(tmpFile, installDir) {
  fs.mkdirSync(installDir, { recursive: true });
  fs.copyFileSync(tmpFile, path.join(installDir, 'mock-package'));
}

// ── 1. registry entries exist ─────────────────────────────────────────────────

test('BUNDLE_REGISTRY contains the two real bundle entries', () => {
  const expected = {
    'r-enrichment': {
      sha256: 'a857831d0d548cc6f9d856684ccec32c0241af018521c5d0641349ade0be1820',
      sizeBytes: 422094687,
    },
    'r-wgcna': {
      sha256: '439273d8b9cad414d3ed32f14076ac88649ca885e6b5854e0ae91bf5e7980288',
      sizeBytes: 82367498,
    },
  };
  assert.ok(bundles.BUNDLE_REGISTRY['r-enrichment'], 'r-enrichment must be registered');
  assert.ok(bundles.BUNDLE_REGISTRY['r-wgcna'], 'r-wgcna must be registered');
  for (const id of ['r-enrichment', 'r-wgcna']) {
    const d = bundles.BUNDLE_REGISTRY[id];
    assert.equal(d.bundleId, id);
    assert.equal(d.version, '1.0.0');
    assert.equal(d.sha256, expected[id].sha256);
    assert.equal(d.sizeBytes, expected[id].sizeBytes);
    assert.ok(d.url.startsWith('https://biof3-uploads.oss-cn-hangzhou.aliyuncs.com/bundles/'));
    assert.ok(d.url.includes(id) && d.url.includes('1.0.0') && d.url.includes('macos-arm64'));
    assert.deepEqual(d.platforms, ['macos-arm64']);
  }
});

// ── 2. getBundleDescriptor: hit / unknown ─────────────────────────────────────

test('getBundleDescriptor: returns descriptor for a known bundle', () => {
  const d = bundles.getBundleDescriptor('r-enrichment');
  assert.ok(d);
  assert.equal(d.bundleId, 'r-enrichment');
  assert.equal(d.sha256, 'a857831d0d548cc6f9d856684ccec32c0241af018521c5d0641349ade0be1820');
});

test('getBundleDescriptor: returns null for an unknown bundle', () => {
  assert.equal(bundles.getBundleDescriptor('r-nonexistent'), null);
  assert.equal(bundles.getBundleDescriptor(''), null);
  assert.equal(bundles.getBundleDescriptor(undefined), null);
});

test('getBundleDescriptor: returns null for an unsupported platform', () => {
  assert.equal(bundles.getBundleDescriptor('r-enrichment', { platform: 'windows-x64' }), null);
});

// ── 3. resolveBundlesForPlugin variants ───────────────────────────────────────

test('resolveBundlesForPlugin: single published bundle → one ready entry', () => {
  const out = bundles.resolveBundlesForPlugin({ requiresBundle: 'r-enrichment', requiresBundleVersion: '1.0.0' });
  assert.equal(out.length, 1);
  assert.equal(out[0].bundleId, 'r-enrichment');
  assert.equal(out[0].status, 'ready');
  assert.ok(out[0].descriptor);
});

test('resolveBundlesForPlugin: multiple bundles (array)', () => {
  const out = bundles.resolveBundlesForPlugin({ requiresBundle: ['r-enrichment', 'r-wgcna'] });
  assert.equal(out.length, 2);
  assert.deepEqual(out.map((r) => r.bundleId).sort(), ['r-enrichment', 'r-wgcna']);
  assert.ok(out.every((r) => r.status === 'ready'));
});

test('resolveBundlesForPlugin: unknown bundle → status unknown, descriptor null', () => {
  const out = bundles.resolveBundlesForPlugin({ requiresBundle: 'r-nope' });
  assert.equal(out.length, 1);
  assert.equal(out[0].status, 'unknown');
  assert.equal(out[0].descriptor, null);
});

test('resolveBundlesForPlugin: no requiresBundle → empty array', () => {
  assert.deepEqual(bundles.resolveBundlesForPlugin({}), []);
  assert.deepEqual(bundles.resolveBundlesForPlugin(null), []);
  assert.deepEqual(bundles.resolveBundlesForPlugin({ requiresBundle: '' }), []);
});

// ── 4. ensureBundlesForPlugin: unpublished → no download ──────────────────────

test('ensureBundlesForPlugin: unpublished bundle does NOT download and returns status unpublished', async () => {
  const runtimesDir = tmpDir();
  const counter = { calls: 0 };
  const result = await bundles.ensureBundlesForPlugin(
    // No verified descriptor exists for this requested version.
    { requiresBundle: 'r-enrichment', requiresBundleVersion: '9.9.9' },
    { runtimesDir, download: makeDownload(CONTENT, counter) },
  );
  assert.equal(result.ok, false);
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].bundleId, 'r-enrichment');
  assert.equal(result.results[0].ok, false);
  assert.equal(result.results[0].status, 'unpublished');
  assert.equal(counter.calls, 0, 'must not download an unpublished bundle');
});

// ── 5. ensureBundlesForPlugin: no requiresBundle → ok, empty ──────────────────

test('ensureBundlesForPlugin: no requiresBundle → ok with empty results', async () => {
  const result = await bundles.ensureBundlesForPlugin({}, {});
  assert.equal(result.ok, true);
  assert.deepEqual(result.results, []);
});

// ── 6. ensureBundlesForPlugin: unknown bundle → no download, status unknown ───

test('ensureBundlesForPlugin: unknown bundle does not download', async () => {
  const runtimesDir = tmpDir();
  const counter = { calls: 0 };
  const result = await bundles.ensureBundlesForPlugin(
    { requiresBundle: 'r-nope' },
    { runtimesDir, download: makeDownload(CONTENT, counter) },
  );
  assert.equal(result.ok, false);
  assert.equal(result.results[0].status, 'unknown');
  assert.equal(counter.calls, 0);
});

// ── 7. ensureBundlesForPlugin: ready descriptor → downloads + installs ────────
//
// We monkeypatch getBundleDescriptor to return a published (sha256-bearing)
// descriptor pointing at an allowlisted host, so the provisioning "ready" path
// executes end-to-end against a temp runtimesDir with an injected download.

test('ensureBundlesForPlugin: published bundle with sha256 downloads and installs', async () => {
  const runtimesDir = tmpDir();
  const counter = { calls: 0 };
  const original = bundles.getBundleDescriptor;

  // Patch via the module object so ensureBundlesForPlugin's internal call sees
  // the published descriptor. resolveBundlesForPlugin uses the same reference.
  const publishedDescriptor = {
    bundleId: 'r-enrichment',
    version: '1.0.0',
    url: 'https://biof3-uploads.oss-cn-hangzhou.aliyuncs.com/bundles/r-enrichment-1.0.0-macos-arm64.tar.gz',
    sha256: GOOD_SHA,
    sizeBytes: CONTENT.length,
    platforms: ['macos-arm64'],
  };
  bundles.getBundleDescriptor = () => ({ ...publishedDescriptor });
  try {
    const result = await bundles.ensureBundlesForPlugin(
      { requiresBundle: 'r-enrichment', requiresBundleVersion: '1.0.0' },
      { runtimesDir, download: makeDownload(CONTENT, counter), install: makeMockInstall },
    );
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.results[0].status, 'ready');
    assert.equal(result.results[0].alreadyReady, false);
    assert.equal(counter.calls, 1, 'published + not-installed bundle should download once');
    assert.ok(fs.existsSync(result.results[0].installDir));
  } finally {
    bundles.getBundleDescriptor = original;
  }
});

// ── 8. ensureBundlesForPlugin: already provisioned → alreadyReady, no download ─

test('ensureBundlesForPlugin: already-provisioned bundle returns alreadyReady without downloading', async () => {
  const runtimesDir = tmpDir();
  const original = bundles.getBundleDescriptor;
  const publishedDescriptor = {
    bundleId: 'r-enrichment',
    version: '1.0.0',
    url: 'https://biof3-uploads.oss-cn-hangzhou.aliyuncs.com/bundles/r-enrichment-1.0.0-macos-arm64.tar.gz',
    sha256: GOOD_SHA,
    sizeBytes: CONTENT.length,
    platforms: ['macos-arm64'],
  };
  bundles.getBundleDescriptor = () => ({ ...publishedDescriptor });
  try {
    // First call provisions.
    const first = await bundles.ensureBundlesForPlugin(
      { requiresBundle: 'r-enrichment' },
      { runtimesDir, download: makeDownload(CONTENT), install: makeMockInstall },
    );
    assert.equal(first.ok, true);

    // Second call must not download.
    const counter = { calls: 0 };
    const second = await bundles.ensureBundlesForPlugin(
      { requiresBundle: 'r-enrichment' },
      { runtimesDir, download: makeDownload(CONTENT, counter), install: makeMockInstall },
    );
    assert.equal(second.ok, true);
    assert.equal(second.results[0].alreadyReady, true);
    assert.equal(counter.calls, 0, 'no re-download when already provisioned');
  } finally {
    bundles.getBundleDescriptor = original;
  }
});

test('installTarGzBundle extracts a real bundle archive and requires its marker', async () => {
  const root = tmpDir();
  const source = path.join(root, 'source');
  const installDir = path.join(root, 'installed');
  const archive = path.join(root, 'bundle.tar.gz');
  fs.mkdirSync(path.join(source, 'demoPkg'), { recursive: true });
  fs.writeFileSync(
    path.join(source, 'bundle-manifest.json'),
    JSON.stringify({ schemaVersion: 1, bundleId: 'demo' })
  );
  fs.writeFileSync(path.join(source, 'demoPkg', 'DESCRIPTION'), 'Package: demoPkg\n');
  execFileSync('tar', ['-czf', archive, '-C', source, '.']);

  await bundles.installTarGzBundle(archive, installDir);

  assert.ok(fs.existsSync(path.join(installDir, 'bundle-manifest.json')));
  assert.ok(fs.existsSync(path.join(installDir, 'demoPkg', 'DESCRIPTION')));
});

test('installTarGzBundle rejects a manifest for a different bundle', async () => {
  const root = tmpDir();
  const source = path.join(root, 'source');
  const installDir = path.join(root, 'installed');
  const archive = path.join(root, 'bundle.tar.gz');
  fs.mkdirSync(source, { recursive: true });
  fs.writeFileSync(
    path.join(source, 'bundle-manifest.json'),
    JSON.stringify({ schemaVersion: 1, bundleId: 'r-wgcna', bundleVersion: '1.0.0' })
  );
  execFileSync('tar', ['-czf', archive, '-C', source, '.']);

  await assert.rejects(
    bundles.installTarGzBundle(archive, installDir, {
      bundleId: 'r-enrichment',
      version: '1.0.0',
    }),
    (error) => error && error.code === 'bundle_manifest_mismatch'
  );
});

test('ensureBundlesForPlugin uses the real tar.gz installer by default', async () => {
  const root = tmpDir();
  const source = path.join(root, 'source');
  const archive = path.join(root, 'r-enrichment-1.0.0-macos-arm64.tar.gz');
  const runtimesDir = path.join(root, 'runtimes');
  fs.mkdirSync(path.join(source, 'demoPkg'), { recursive: true });
  fs.writeFileSync(
    path.join(source, 'bundle-manifest.json'),
    JSON.stringify({ schemaVersion: 1, bundleId: 'r-enrichment', bundleVersion: '1.0.0' })
  );
  fs.writeFileSync(path.join(source, 'demoPkg', 'DESCRIPTION'), 'Package: demoPkg\n');
  execFileSync('tar', ['-czf', archive, '-C', source, '.']);

  const original = bundles.getBundleDescriptor;
  bundles.getBundleDescriptor = () => ({
    bundleId: 'r-enrichment',
    version: '1.0.0',
    url: 'https://biof3-uploads.oss-cn-hangzhou.aliyuncs.com/bundles/r-enrichment-1.0.0-macos-arm64.tar.gz',
    sha256: crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex'),
    sizeBytes: fs.statSync(archive).size,
    platforms: ['macos-arm64'],
  });
  try {
    const result = await bundles.ensureBundlesForPlugin(
      { requiresBundle: 'r-enrichment', requiresBundleVersion: '1.0.0' },
      {
        runtimesDir,
        download: async (_url, destPath) => fs.copyFileSync(archive, destPath),
      }
    );
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.ok(fs.existsSync(path.join(result.results[0].installDir, 'bundle-manifest.json')));
    assert.ok(fs.existsSync(path.join(result.results[0].installDir, 'demoPkg', 'DESCRIPTION')));
  } finally {
    bundles.getBundleDescriptor = original;
  }
});
