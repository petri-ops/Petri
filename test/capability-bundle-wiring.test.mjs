/**
 * test/capability-bundle-wiring.test.mjs
 *
 * Stage 3 B2 part2 — run-path wiring contract.
 *
 * The two R run paths (core/petri-server/helpers/tools-executor.js and
 * core/petri-server/mcp/registry.js) now call `ensureBundlesForPlugin(cfg)` BEFORE
 * `resolveRLibsForPlugin(cfg)` for R plugins that declare `requiresBundle`.
 * These tests exercise that exact ordered contract WITHOUT spawning a real
 * executor or Rscript: they assert the observable behavior the wiring depends
 * on — download-once, no-download-when-unpublished, zero-impact-when-no-bundle,
 * and the crucial "ensure-then-resolve mounts the freshly installed bundle"
 * integration that makes the `await` ordering matter.
 *
 * Zero network: `ensureBundlesForPlugin` is driven with an injected mock
 * download + a temp runtimesDir; a fabricated sha256 is fine HERE because it
 * only lives inside the test's mock download output, never in the registry.
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
const rLibs = require('../core/shared-backend/r-libs-resolver.js');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'petri-wiring-test-'));
}

function sha256Of(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

const CONTENT = 'wiring-bundle-payload';
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

const PUBLISHED = {
  bundleId: 'r-enrichment',
  version: '1.0.0',
  url: 'https://petri-uploads.oss-cn-hangzhou.aliyuncs.com/bundles/r-enrichment-1.0.0-macos-arm64.tar.gz',
  sha256: GOOD_SHA,
  sizeBytes: CONTENT.length,
  platforms: ['macos-arm64'],
};

/**
 * Replicates the exact guarded call sequence both wiring points use:
 *   if (R plugin && requiresBundle) { try { await ensureBundlesForPlugin(cfg) } catch {} }
 *   const env = resolveRLibsForPlugin(cfg);
 * Returns { ensured, env } so tests can assert both halves of the contract.
 */
async function runWiring(cfg, ensureOptions) {
  let ensured = null;
  if (cfg && cfg.language === 'r' && cfg.requiresBundle) {
    try {
      ensured = await bundles.ensureBundlesForPlugin(cfg, ensureOptions);
    } catch {
      ensured = { ok: false, threw: true };
    }
  }
  const env = rLibs.resolveRLibsForPlugin(cfg);
  return { ensured, env };
}

// ── 1. published + not installed → ensure downloads once, then R_LIBS_USER
//       mounts the freshly installed bundle dir (proves await ordering) ────────

test('wiring: published bundle downloads once and is then mounted via R_LIBS_USER', async () => {
  // Point BOTH the ensure options and resolveRLibsForPlugin's default readiness
  // check at the same runtimesDir by controlling PETRI_LOCAL_DATA_DIR (which
  // defaultRuntimesDir derives runtimes/ from). resolveRLibsForPlugin takes no
  // runtimesDir arg, so this env is the only way to align the two.
  const localData = tmpDir();
  const runtimesDir = path.join(localData, 'runtimes');
  const prevLocalData = process.env.PETRI_LOCAL_DATA_DIR;
  process.env.PETRI_LOCAL_DATA_DIR = localData;

  const counter = { calls: 0 };
  const original = bundles.getBundleDescriptor;
  bundles.getBundleDescriptor = () => ({ ...PUBLISHED });
  try {
    const cfg = {
      language: 'r',
      requiresBundle: 'r-enrichment',
      requiresBundleVersion: '1.0.0',
    };
    const { ensured, env } = await runWiring(cfg, {
      runtimesDir,
      download: makeDownload(CONTENT, counter),
      install: makeMockInstall,
    });

    assert.equal(ensured.ok, true, JSON.stringify(ensured));
    assert.equal(counter.calls, 1, 'published + not-installed must download exactly once');
    const installDir = ensured.results[0].installDir;
    assert.ok(fs.existsSync(installDir), 'install dir must exist after provisioning');

    // The payoff of awaiting ensure BEFORE resolve: the just-installed bundle
    // dir is now on R_LIBS_USER.
    assert.ok(env, 'resolveRLibsForPlugin must return an env once a bundle is ready');
    const parts = env.R_LIBS_USER.split(path.delimiter);
    assert.ok(parts.includes(installDir), `R_LIBS_USER must include ${installDir}, got ${env.R_LIBS_USER}`);
  } finally {
    bundles.getBundleDescriptor = original;
    if (prevLocalData === undefined) delete process.env.PETRI_LOCAL_DATA_DIR;
    else process.env.PETRI_LOCAL_DATA_DIR = prevLocalData;
  }
});

// ── 2. unpublished descriptor (sha256=null) → no download, no throw,
//       run path continues on base runtime ────────────────────────────────────

test('wiring: unpublished bundle does not download, does not throw, run continues', async () => {
  const localData = tmpDir();
  const runtimesDir = path.join(localData, 'runtimes');
  const prevLocalData = process.env.PETRI_LOCAL_DATA_DIR;
  process.env.PETRI_LOCAL_DATA_DIR = localData;

  const counter = { calls: 0 };
  const original = bundles.getBundleDescriptor;
  bundles.getBundleDescriptor = () => ({
    ...PUBLISHED,
    sha256: null,
    sizeBytes: null,
  });
  try {
    const cfg = {
      language: 'r',
      requiresBundle: 'r-enrichment',
      requiresBundleVersion: '1.0.0',
      // no pluginDir / no ready bundle ⇒ resolveRLibsForPlugin returns null
    };
    const { ensured, env } = await runWiring(cfg, {
      runtimesDir,
      download: makeDownload(CONTENT, counter),
    });

    assert.equal(ensured.ok, false, 'unpublished bundle is not ok');
    assert.equal(ensured.results[0].status, 'unpublished');
    assert.equal(counter.calls, 0, 'must NOT download an unpublished bundle');
    // Run path continues: no throw reached this point, and env is simply null
    // (no lib to mount) — identical to pre-wiring behavior.
    assert.equal(env, null, 'no ready bundle ⇒ no R_LIBS_USER env, run on base runtime');
  } finally {
    bundles.getBundleDescriptor = original;
    if (prevLocalData === undefined) delete process.env.PETRI_LOCAL_DATA_DIR;
    else process.env.PETRI_LOCAL_DATA_DIR = prevLocalData;
  }
});

// ── 3. no requiresBundle → ensure is never invoked, zero impact ───────────────

test('wiring: plugin without requiresBundle never calls ensure', async () => {
  const counter = { calls: 0 };
  const original = bundles.ensureBundlesForPlugin;
  // Spy: if the guard is wrong and calls through, this bumps the counter.
  bundles.ensureBundlesForPlugin = async (...args) => {
    counter.calls += 1;
    return original(...args);
  };
  try {
    const cfg = { language: 'r' }; // no requiresBundle
    const { ensured, env } = await runWiring(cfg, {});
    assert.equal(ensured, null, 'ensure must not run for a bundle-less plugin');
    assert.equal(counter.calls, 0, 'ensureBundlesForPlugin must never be called');
    assert.equal(env, null, 'no bundle, no pluginDir ⇒ no env');
  } finally {
    bundles.ensureBundlesForPlugin = original;
  }
});

// ── 4. non-R plugin (python) with a requiresBundle → ensure not invoked ───────

test('wiring: non-R plugin never triggers bundle provisioning', async () => {
  const counter = { calls: 0 };
  const original = bundles.ensureBundlesForPlugin;
  bundles.ensureBundlesForPlugin = async (...args) => {
    counter.calls += 1;
    return original(...args);
  };
  try {
    const cfg = { language: 'python', requiresBundle: 'r-enrichment' };
    const { ensured } = await runWiring(cfg, {});
    assert.equal(ensured, null);
    assert.equal(counter.calls, 0, 'python plugins must not provision R bundles');
  } finally {
    bundles.ensureBundlesForPlugin = original;
  }
});
