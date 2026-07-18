/**
 * test/capability-bundles.test.mjs
 *
 * Unit tests for core/shared-backend/capability-bundles.js
 *
 * Stage 3 B1/B2 — pure local, zero network. Provisioning is exercised through
 * injected mock download/hash + a temp runtimesDir; the "ready" path uses a
 * temporarily-published descriptor (a fabricated sha256 is fine HERE because it
 * only lives inside the test's mock download output, never in the registry).
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
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

// ── 1. registry entries exist ─────────────────────────────────────────────────

test('BUNDLE_REGISTRY contains the two real bundle entries', () => {
  assert.ok(bundles.BUNDLE_REGISTRY['r-enrichment'], 'r-enrichment must be registered');
  assert.ok(bundles.BUNDLE_REGISTRY['r-wgcna'], 'r-wgcna must be registered');
  for (const id of ['r-enrichment', 'r-wgcna']) {
    const d = bundles.BUNDLE_REGISTRY[id];
    assert.equal(d.bundleId, id);
    assert.equal(d.version, '1.0.0');
    assert.equal(d.sha256, null, 'sha256 must be null (unpublished, no fabricated hashes)');
    assert.equal(d.sizeBytes, null);
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
  assert.equal(d.sha256, null);
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

test('resolveBundlesForPlugin: single bundle (string) → one unpublished entry', () => {
  const out = bundles.resolveBundlesForPlugin({ requiresBundle: 'r-enrichment', requiresBundleVersion: '1.0.0' });
  assert.equal(out.length, 1);
  assert.equal(out[0].bundleId, 'r-enrichment');
  assert.equal(out[0].status, 'unpublished');
  assert.ok(out[0].descriptor);
});

test('resolveBundlesForPlugin: multiple bundles (array)', () => {
  const out = bundles.resolveBundlesForPlugin({ requiresBundle: ['r-enrichment', 'r-wgcna'] });
  assert.equal(out.length, 2);
  assert.deepEqual(out.map((r) => r.bundleId).sort(), ['r-enrichment', 'r-wgcna']);
  assert.ok(out.every((r) => r.status === 'unpublished'));
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
    { requiresBundle: 'r-enrichment', requiresBundleVersion: '1.0.0' },
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
      { runtimesDir, download: makeDownload(CONTENT, counter) },
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
      { runtimesDir, download: makeDownload(CONTENT) },
    );
    assert.equal(first.ok, true);

    // Second call must not download.
    const counter = { calls: 0 };
    const second = await bundles.ensureBundlesForPlugin(
      { requiresBundle: 'r-enrichment' },
      { runtimesDir, download: makeDownload(CONTENT, counter) },
    );
    assert.equal(second.ok, true);
    assert.equal(second.results[0].alreadyReady, true);
    assert.equal(counter.calls, 0, 'no re-download when already provisioned');
  } finally {
    bundles.getBundleDescriptor = original;
  }
});
