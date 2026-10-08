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

/**
 * 打包临时目录为 tar.gz。
 *
 * Windows 自带的 bsdtar 需要两道处理，缺一不可：
 * 1. `--force-local`：否则 `-czf` 后的 `C:\...` 被当成远端主机规格
 *    （`Cannot connect to C: resolve failed`）；
 * 2. 路径正斜杠归一化：`--force-local` 会转义反斜杠，`...\source` 会被拆成
 *    `...\s` + `ource`。
 * macOS 的 bsdtar 拒绝 `--force-local`（非 GNU），故复用生产侧 TAR_FORCE_LOCAL
 * 平台条件（单一知识源，2026-09-20 Mac 首跑实测）。
 */
function tarGz(archive, source) {
  const posix = (value) => String(value).replace(/\\/g, '/');
  execFileSync('tar', [...bundles.TAR_FORCE_LOCAL, '-czf', posix(archive), '-C', posix(source), '.']);
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
  // BLOCK-146 #8 后缺省平台按宿主推导——测「已知 bundle 命中」须显式钉住
  // 已发布描述符的平台（macos-arm64），保持测试在任意宿主上确定。
  const d = bundles.getBundleDescriptor('r-enrichment', { platform: 'macos-arm64' });
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
  // 显式钉住 macos-arm64（已发布描述符平台），宿主无关（BLOCK-146 #8）。
  const out = bundles.resolveBundlesForPlugin(
    { requiresBundle: 'r-enrichment', requiresBundleVersion: '1.0.0' },
    { platform: 'macos-arm64' },
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].bundleId, 'r-enrichment');
  assert.equal(out[0].status, 'ready');
  assert.ok(out[0].descriptor);
});

test('resolveBundlesForPlugin: multiple bundles (array)', () => {
  const out = bundles.resolveBundlesForPlugin(
    { requiresBundle: ['r-enrichment', 'r-wgcna'] },
    { platform: 'macos-arm64' },
  );
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
    // 显式钉住 macos-arm64：本测试证「请求版本无已验证描述符 → unpublished」，
    // 平台命中是前提（BLOCK-146 #8 后缺省按宿主推导）。
    { platform: 'macos-arm64', runtimesDir, download: makeDownload(CONTENT, counter) },
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
  tarGz(archive, source);

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
  tarGz(archive, source);

  await assert.rejects(
    bundles.installTarGzBundle(archive, installDir, {
      bundleId: 'r-enrichment',
      version: '1.0.0',
    }),
    (error) => error && error.code === 'bundle_manifest_mismatch'
  );
});

// ── 9. BLOCK-146 #8：缺省平台按宿主推导（deriveHostPlatform，见生产侧注释）──
//
// 审视发现 #8：DEFAULT_PLATFORM='macos-arm64' 硬编码，两个生产调用点
// （mcp/registry/run-plugin-script.js:65、helpers/tools-executor.js:1518）
// 不传 platform → Windows 宿主判 ready 并下载 mac 二进制（sha256 是真实发布值，
// 校验必过、ledger 持久化 ready 不自愈）。契约：缺省平台必须按宿主推导；
// 宿主平台无对应描述符键时 resolve 为 unknown/null 拒绝下载（fail-closed 不造键）；
// options.platform 显式覆盖保留；installTarGzBundle 校验 manifest 平台一致性。
// 通过 monkeypatch deriveHostPlatform 模拟宿主，测试在任何宿主上都确定。

test('#8 deriveHostPlatform: 平台键与 plugin-schema PLATFORM_IDS / build-r-bundle currentPlatform 约定对齐', () => {
  assert.equal(bundles.deriveHostPlatform('win32', 'x64'), 'windows-x64');
  assert.equal(bundles.deriveHostPlatform('darwin', 'arm64'), 'macos-arm64');
  assert.equal(bundles.deriveHostPlatform('darwin', 'x64'), 'macos-x64');
  assert.equal(bundles.deriveHostPlatform('linux', 'x64'), 'linux-x64');
  assert.equal(bundles.deriveHostPlatform('linux', 'arm64'), 'linux-arm64');
  // 缺省参数读真实宿主（不抛错、返回字符串键）。
  assert.equal(typeof bundles.deriveHostPlatform(), 'string');
});

test('#8 win32 宿主语境：r-enrichment 缺省解析为 null（非 ready，不造键）', () => {
  const original = bundles.deriveHostPlatform;
  bundles.deriveHostPlatform = () => 'windows-x64';
  try {
    assert.equal(bundles.getBundleDescriptor('r-enrichment'), null,
      'win32 宿主不得默认命中 macos-arm64 描述符');
    const resolved = bundles.resolveBundlesForPlugin(
      { requiresBundle: 'r-enrichment', requiresBundleVersion: '1.0.0' },
    );
    assert.equal(resolved.length, 1);
    assert.equal(resolved[0].status, 'unknown');
    assert.equal(resolved[0].descriptor, null);
  } finally {
    bundles.deriveHostPlatform = original;
  }
});

test('#8 win32 宿主语境：ensureBundlesForPlugin 拒绝下载（零 download 调用）', async () => {
  const original = bundles.deriveHostPlatform;
  bundles.deriveHostPlatform = () => 'windows-x64';
  try {
    const runtimesDir = tmpDir();
    const counter = { calls: 0 };
    const result = await bundles.ensureBundlesForPlugin(
      { requiresBundle: 'r-enrichment', requiresBundleVersion: '1.0.0' },
      { runtimesDir, download: makeDownload(CONTENT, counter) },
    );
    assert.equal(result.ok, false);
    assert.equal(result.results[0].status, 'unknown');
    assert.equal(counter.calls, 0,
      'Windows 宿主绝不能下载 macos-arm64 bundle——其 sha256 是真实发布值，下载后校验必过（#8 实证）');
  } finally {
    bundles.deriveHostPlatform = original;
  }
});

test('#8 显式 platform 覆盖保留：win32 宿主上显式请求 macos-arm64 仍取到描述符', () => {
  const original = bundles.deriveHostPlatform;
  bundles.deriveHostPlatform = () => 'windows-x64';
  try {
    const d = bundles.getBundleDescriptor('r-enrichment', { platform: 'macos-arm64' });
    assert.ok(d, '显式 platform 覆盖必须继续生效');
    assert.equal(d.platform, 'macos-arm64');
    assert.equal(d.sha256, 'a857831d0d548cc6f9d856684ccec32c0241af018521c5d0641349ade0be1820');
  } finally {
    bundles.deriveHostPlatform = original;
  }
});

test('#8 mac 宿主语境（对照）：缺省解析命中 macos-arm64 且描述符携带 resolved platform', () => {
  const original = bundles.deriveHostPlatform;
  bundles.deriveHostPlatform = () => 'macos-arm64';
  try {
    const d = bundles.getBundleDescriptor('r-enrichment');
    assert.ok(d, 'macOS Apple Silicon 宿主缺省解析必须继续命中');
    assert.equal(d.platform, 'macos-arm64');
  } finally {
    bundles.deriveHostPlatform = original;
  }
});

test('#8 installTarGzBundle：manifest 平台与期望不一致拒装（bundle_platform_mismatch）', async () => {
  const root = tmpDir();
  const source = path.join(root, 'source');
  const installDir = path.join(root, 'installed');
  const archive = path.join(root, 'bundle.tar.gz');
  fs.mkdirSync(source, { recursive: true });
  fs.writeFileSync(
    path.join(source, 'bundle-manifest.json'),
    JSON.stringify({ schemaVersion: 1, bundleId: 'r-enrichment', bundleVersion: '1.0.0', platform: 'macos-arm64' })
  );
  tarGz(archive, source);

  await assert.rejects(
    bundles.installTarGzBundle(archive, installDir, {
      bundleId: 'r-enrichment',
      version: '1.0.0',
      platform: 'windows-x64',
    }),
    (error) => error && error.code === 'bundle_platform_mismatch',
    '期望平台与 manifest 声明平台不一致的 archive 必须拒装'
  );
});

test('#8 installTarGzBundle：expected.platform 缺席时维持既有校验面（不新增平台断言）', async () => {
  const root = tmpDir();
  const source = path.join(root, 'source');
  const installDir = path.join(root, 'installed');
  const archive = path.join(root, 'bundle.tar.gz');
  fs.mkdirSync(path.join(source, 'demoPkg'), { recursive: true });
  fs.writeFileSync(
    path.join(source, 'bundle-manifest.json'),
    JSON.stringify({ schemaVersion: 1, bundleId: 'r-enrichment', bundleVersion: '1.0.0' })
  );
  fs.writeFileSync(path.join(source, 'demoPkg', 'DESCRIPTION'), 'Package: demoPkg\n');
  tarGz(archive, source);

  await bundles.installTarGzBundle(archive, installDir, {
    bundleId: 'r-enrichment',
    version: '1.0.0',
  });
  assert.ok(fs.existsSync(path.join(installDir, 'bundle-manifest.json')));
});

test('#8 ensureBundlesForPlugin：resolved platform 穿入安装期望——平台不符的 archive 装失败', async () => {
  const root = tmpDir();
  const source = path.join(root, 'source');
  const archive = path.join(root, 'r-enrichment-1.0.0-windows-x64.tar.gz');
  const runtimesDir = path.join(root, 'runtimes');
  fs.mkdirSync(path.join(source, 'demoPkg'), { recursive: true });
  // archive 内 manifest 声明 macos-arm64，描述符却按 windows-x64 解析 → 拒装。
  fs.writeFileSync(
    path.join(source, 'bundle-manifest.json'),
    JSON.stringify({ schemaVersion: 1, bundleId: 'r-enrichment', bundleVersion: '1.0.0', platform: 'macos-arm64' })
  );
  fs.writeFileSync(path.join(source, 'demoPkg', 'DESCRIPTION'), 'Package: demoPkg\n');
  tarGz(archive, source);

  const original = bundles.getBundleDescriptor;
  bundles.getBundleDescriptor = () => ({
    bundleId: 'r-enrichment',
    version: '1.0.0',
    platform: 'windows-x64',
    url: 'https://biof3-uploads.oss-cn-hangzhou.aliyuncs.com/bundles/r-enrichment-1.0.0-windows-x64.tar.gz',
    sha256: crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex'),
    sizeBytes: fs.statSync(archive).size,
    platforms: ['windows-x64'],
  });
  try {
    const result = await bundles.ensureBundlesForPlugin(
      { requiresBundle: 'r-enrichment', requiresBundleVersion: '1.0.0' },
      {
        runtimesDir,
        download: async (_url, destPath) => fs.copyFileSync(archive, destPath),
      }
    );
    assert.equal(result.ok, false, JSON.stringify(result));
    assert.equal(result.results[0].ok, false);
    assert.equal(result.results[0].error, 'bundle_platform_mismatch');
  } finally {
    bundles.getBundleDescriptor = original;
  }
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
  tarGz(archive, source);

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
