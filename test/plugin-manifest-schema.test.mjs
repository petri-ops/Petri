// test/plugin-manifest-schema.test.mjs — Week 2 发行可信化验证
//
// 目的：让"声明的 platform"和"实际下载/校验的 artifact"无法再脱节。
//   1. resources/built-in-plugins/manifest.json 必须通过 src/plugin-schema.js 的 validator
//      （与 resources/built-in-plugins/manifest.schema.json 保持一致）
//   2. release-contract.json 里 platforms[*].id === 'macos-arm64' 必须真实有可下载的 artifact；
//      manifest.plugins[*].artifacts.windows-x64 必须为 0 个（不再撒谎）
//   3. selectArtifact() 对当前 platform 命中返回 url；其他 platform 抛 ARTIFACT_MISSING
//   4. 所有非 built-in:// 的 url host 必须落在 ALLOWED_RUNTIME_HOSTS
//
// 运行：node test/plugin-manifest-schema.test.mjs
// 失败即退出非零。

import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const require = createRequire(import.meta.url);

// BLOCK-49 加映清债 —— 统一临时 DB 自举（存量：单跑/全量缺 projects 表）
//（BIOF3_DB_PATH 须在 require db.js 前生效；与 agent-tool-registry.test 同一修法）
{
  const fsx = require('node:fs');
  const osx = require('node:os');
  const pth = require('node:path');
  const urlx = require('node:url');
  const hereDir = pth.dirname(urlx.fileURLToPath(import.meta.url));
  const Database = require(pth.resolve(hereDir, '..', 'core', 'biof3-server', 'node_modules', 'better-sqlite3'));
  const tempDbDir = fsx.mkdtempSync(pth.join(osx.tmpdir(), 'biof3-sweep-db-'));
  const boot = new Database(pth.join(tempDbDir, 'biof3.db'));
  const migrationsDir = pth.resolve(hereDir, '..', 'src', 'migrations');
  for (const f of fsx.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
    boot.exec(fsx.readFileSync(pth.join(migrationsDir, f), 'utf8'));
  }
  boot.close();
  process.env.BIOF3_DB_PATH = pth.join(tempDbDir, 'biof3.db');
  process.on('exit', () => { try { fsx.rmSync(tempDbDir, { recursive: true, force: true }); } catch {} });
}

// BLOCK-83 P4：发行清单拆分——核心仓仅存运行时清单（领域插件清单随领域包）
const manifestPath = resolve(repoRoot, 'resources/runtime/manifest.json');
const schemaPath = resolve(repoRoot, 'resources/runtime/manifest.schema.json');
const placeholdersPath = resolve(repoRoot, 'resources/runtime/manifest.placeholders.json');
const contractPath = resolve(repoRoot, 'release-contract.json');

console.log(`[plugin-schema] repoRoot=${repoRoot}`);

// ── 加载依赖 ──────────────────────────────────────────────────
assert(existsSync(manifestPath), 'manifest.json missing');
assert(existsSync(schemaPath), 'manifest.schema.json missing');
assert(existsSync(placeholdersPath), 'manifest.placeholders.json missing');
assert(existsSync(contractPath), 'release-contract.json missing');

const {
  ALLOWED_RUNTIME_HOSTS,
  selectArtifact,
  assertAllowedUrl,
  validateManifest,
} = require(resolve(repoRoot, 'src/plugin-schema.js'));

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
JSON.parse(readFileSync(schemaPath, 'utf8'));
const placeholders = JSON.parse(readFileSync(placeholdersPath, 'utf8'));
const contract = JSON.parse(readFileSync(contractPath, 'utf8'));

// ── 1. manifest 通过 schema validator ──────────────────────────
console.log(`[plugin-schema] validating ${Object.keys(manifest.plugins).length} plugins`);
const v = validateManifest(manifest);
if (!v.valid) {
  console.error('manifest schema validation FAILED:');
  for (const i of v.issues.slice(0, 30)) console.error('  -', i);
  if (v.issues.length > 30) console.error(`  ... +${v.issues.length - 30} more`);
}
assert.equal(v.valid, true, `manifest failed schema validation: ${v.issues.slice(0, 5).join(' | ')}`);
console.log(`✓ manifest validates against ${schemaPath} (0 issues)`);

// ── 2. no FAKE windows-x64 support: any windows-x64 entry must carry a real
//       descriptor (runtime kind, or concrete sha256+sizeBytes) and a real URL.
//       Real windows-x64 runtime artifacts exist on OSS and pass golden-path,
//       so they are legitimately declared; placeholder/fake entries are not. ──
let windowsEntries = 0;
let macosArm64Entries = 0;
const fakeWindows = [];
for (const [id, plug] of Object.entries(manifest.plugins)) {
  const arts = plug.artifacts || {};
  if (arts['macos-arm64']) macosArm64Entries += 1;
  const win = arts['windows-x64'];
  if (!win) continue;
  windowsEntries += 1;
  if (win.url === null || typeof win.url !== 'string') {
    fakeWindows.push(`${id}: windows-x64.url must be a real string`);
  }
  const isRuntime = plug.kind === 'runtime';
  const hasRealDesc =
    typeof win.sha256 === 'string' && /^[a-f0-9]{64}$/.test(win.sha256) &&
    typeof win.sizeBytes === 'number';
  if (!(isRuntime || hasRealDesc)) {
    fakeWindows.push(
      `${id}: windows-x64 declared without a real descriptor (not a runtime and no sha256+sizeBytes) — fake Windows support not allowed`
    );
  }
}
assert.strictEqual(
  fakeWindows.length,
  0,
  `Fake Windows support detected:\n${fakeWindows.join('\n')}`
);
console.log(`✓ manifest has ${windowsEntries} windows-x64 artifact(s), all with real URLs/descriptors (no fake Windows support)`);

// release-contract.macos-arm64 supported flag — Week 4 will flip this to true
const macosArm64Contract = (contract.platforms || []).find((p) => p.id === 'macos-arm64');
assert.ok(macosArm64Contract, 'release-contract.json:platforms must include macos-arm64');
if (macosArm64Contract.supported === true) {
  // Week 4 trigger: once a real signed+notarized artifact exists, this branch fires
  // and asserts runtimeArtifact.url/sha256/sizeBytes are all populated.
  const art = macosArm64Contract.runtimeArtifact;
  assert.ok(art && typeof art === 'object', 'macos-arm64 runtimeArtifact missing');
  assert.strictEqual(typeof art.url, 'string', 'macos-arm64 runtimeArtifact.url must be a non-null string when supported=true');
  assert.strictEqual(typeof art.sha256, 'string', 'macos-arm64 runtimeArtifact.sha256 must be a non-null string when supported=true');
  assert.strictEqual(typeof art.sizeBytes, 'number', 'macos-arm64 runtimeArtifact.sizeBytes must be a number when supported=true');
  console.log(`✓ release-contract.macos-arm64.supported=true with real artifact url/sha256/sizeBytes`);
} else {
  console.log(
    `✓ release-contract.macos-arm64.supported is still false (Week 4 will flip when real signed+notarized build exists; ` +
      `reason: "${macosArm64Contract.reason || 'n/a'}")`
  );
}
assert.ok(
  macosArm64Entries >= 1,
  `manifest must declare at least one macos-arm64 artifact (found ${macosArm64Entries})`
);
console.log(`✓ manifest declares ${macosArm64Entries} macos-arm64 artifacts`);

// ── 3. selectArtifact: hit on macos-arm64, miss on windows-x64 ──
const stubManifest = {
  id: 'stub',
  title: 'Stub',
  version: '1.0.0',
  kind: 'plugin',
  artifacts: {
    'macos-arm64': {
      url: 'https://github.com/BioF3/example/releases/v1/macos-arm64.zip',
      sha256: null,
      sizeBytes: null,
    },
  },
};

const hit = selectArtifact(stubManifest, 'macos-arm64');
assert.strictEqual(hit.platformId, 'macos-arm64');
assert.strictEqual(hit.artifact.url, stubManifest.artifacts['macos-arm64'].url);
console.log(`✓ selectArtifact(stub, 'macos-arm64') → ${hit.artifact.url}`);

let caught = null;
try {
  selectArtifact(stubManifest, 'windows-x64');
} catch (e) {
  caught = e;
}
assert.ok(caught, 'selectArtifact(stub, windows-x64) must throw');
assert.strictEqual(caught.code, 'ARTIFACT_MISSING', `error.code must be ARTIFACT_MISSING, got ${caught.code}`);
assert.deepStrictEqual(caught.supportedPlatforms, ['macos-arm64']);
assert.strictEqual(caught.currentPlatform, 'windows-x64');
console.log(`✓ selectArtifact(stub, 'windows-x64') throws ARTIFACT_MISSING with supportedPlatforms=[macos-arm64]`);

// ── 4. every url host must be in ALLOWED_RUNTIME_HOSTS ─────────
let checked = 0;
const offenders = [];
for (const [id, plug] of Object.entries(manifest.plugins)) {
  for (const [platformId, art] of Object.entries(plug.artifacts || {})) {
    if (typeof art.url !== 'string') continue;
    if (art.url.startsWith('built-in://')) continue;
    let host;
    try { host = new URL(art.url).hostname.toLowerCase(); }
    catch { offenders.push(`${id}/${platformId}: unparseable url ${art.url}`); continue; }
    if (!ALLOWED_RUNTIME_HOSTS.includes(host)) {
      offenders.push(`${id}/${platformId}: host '${host}' not in ALLOWED_RUNTIME_HOSTS`);
    }
    checked += 1;
  }
}
assert.strictEqual(offenders.length, 0, `offending URLs:\n${offenders.join('\n')}`);
console.log(`✓ ${checked} non-built-in URLs all match ALLOWED_RUNTIME_HOSTS=${JSON.stringify(ALLOWED_RUNTIME_HOSTS)}`);

// ── 5. Runtime archives have immutable descriptors and no stale placeholders ──
for (const pid of ['biof3-r-runtime', 'biof3-py-runtime']) {
  const artifact = manifest.plugins[pid].artifacts['macos-arm64'];
  assert.match(artifact.sha256, /^[a-f0-9]{64}$/, `${pid} must have a real SHA-256`);
  assert.ok(Number.isInteger(artifact.sizeBytes) && artifact.sizeBytes > 0, `${pid} must have archive size`);
  assert.equal(
    placeholders.placeholders.some((p) => p.pluginId === pid),
    false,
    `${pid} must not remain in placeholders.json`
  );
}
console.log(`✓ Runtime archives have SHA-256/size descriptors and no stale placeholders`);

// ── 7. assertAllowedUrl built-in:// is allowed; non-whitelisted host throws ──
assertAllowedUrl('built-in://sample-metrics');
assertAllowedUrl('https://github.com/x/y.zip');
let rejected = false;
try { assertAllowedUrl('https://evil.example.com/x.zip'); }
catch { rejected = true; }
assert.ok(rejected, 'assertAllowedUrl must reject non-whitelisted hosts');
console.log(`✓ assertAllowedUrl accepts built-in:// + whitelisted hosts, rejects others`);

console.log('\n所有 plugin-manifest-schema 检查通过');
