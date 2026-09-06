// release-contract.test.mjs — Week 1 发行可信化验证
//
// 运行：node test/release-contract.test.mjs
// 校验：
//   1. release-contract.json 可解析
//   2. channel === 'beta'
//   3. 所有 platforms[*].supported === true 的 platform 必须有非 null runtimeArtifact.url
//   4. goldenPath.tool id 必须在 frontend/src/tools/inventory.ts 中出现（粗略字符串匹配）
//
// 失败即退出非零。

import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// BLOCK-49 加映清债 —— 统一临时 DB 自举（存量：缺 projects 表）
{
  const _fs = await import('node:fs');
  const _os = await import('node:os');
  const _path = await import('node:path');
  const _createRequire = (await import('node:module')).default.createRequire;
  const _req = _createRequire(import.meta.url);
  const _here = dirname(fileURLToPath(import.meta.url));
  const _Database = _req(resolve(_here, '..', 'core', 'biof3-server', 'node_modules', 'better-sqlite3'));
  const _dir = _fs.mkdtempSync(_path.resolve(_os.tmpdir(), 'biof3-sweep-db-'));
  const _boot = new _Database(_path.resolve(_dir, 'biof3.db'));
  const _mig = _path.resolve(_here, '..', 'src', 'migrations');
  for (const f of _fs.readdirSync(_mig).filter((f) => f.endsWith('.sql')).sort()) {
    _boot.exec(_fs.readFileSync(_path.resolve(_mig, f), 'utf8'));
  }
  _boot.close();
  process.env.BIOF3_DB_PATH = _path.resolve(_dir, 'biof3.db');
  process.on('exit', () => { try { _fs.rmSync(_dir, { recursive: true, force: true }); } catch {} });
}

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const contractPath = resolve(repoRoot, 'release-contract.json');
const dataTsPath = resolve(repoRoot, 'frontend/src/tools/inventory.ts');

console.log(`[release-contract] loading ${contractPath}`);
assert(existsSync(contractPath), 'release-contract.json not found at repo root');
assert(existsSync(dataTsPath), 'frontend/src/tools/inventory.ts not found');

const contract = JSON.parse(readFileSync(contractPath, 'utf8'));

// ── 2. channel must be 'beta' for Week 1 ──
assert.strictEqual(
  contract.channel,
  'beta',
  `channel must be 'beta' (got ${JSON.stringify(contract.channel)})`
);
console.log(`✓ channel === 'beta'`);

// ── 3. any platform with supported === true must have non-null runtimeArtifact.url ──
//    强约束：plan 禁止 fabricate size/sha256/url。
//    一旦 platforms[*].supported = true，就必须有可下载的真实 artifact，否则 test 必失败。
assert.ok(Array.isArray(contract.platforms), 'platforms must be an array');
for (const p of contract.platforms) {
  if (p.supported === true) {
    const art = p.runtimeArtifact;
    assert.ok(art && typeof art === 'object', `platform ${p.id}: runtimeArtifact missing`);
    assert.strictEqual(
      typeof art.url,
      'string',
      `platform ${p.id}: runtimeArtifact.url must be a non-null string when supported=true. ` +
        `Either populate the URL or flip supported to false. Plan hard constraint: do not fabricate.`
    );
    assert.strictEqual(
      typeof art.sha256,
      'string',
      `platform ${p.id}: runtimeArtifact.sha256 must be a non-null string when supported=true.`
    );
    assert.strictEqual(
      typeof art.sizeBytes,
      'number',
      `platform ${p.id}: runtimeArtifact.sizeBytes must be a number when supported=true.`
    );
  }
}
console.log(
  `✓ ${contract.platforms.length} platforms checked: ${
    contract.platforms.filter((p) => p.supported).length
  } supported (each has runtimeArtifact.url/sha256/sizeBytes asserted)`
);

// ── 4. goldenPath.tool must appear in _data.ts ──
const toolId = contract?.goldenPath?.tool;
assert.ok(toolId, 'goldenPath.tool missing in contract');
const dataSrc = readFileSync(dataTsPath, 'utf8');
const idPattern = new RegExp(`id:\\s*['"]${toolId}['"]`);
assert.match(
  dataSrc,
  idPattern,
  `goldenPath.tool '${toolId}' not found as a tool id in frontend/src/tools/inventory.ts — golden path must reference a real tool`
);
console.log(`✓ goldenPath.tool '${toolId}' found in _data.ts`);

// ── 5. golden path report format declared ──
assert.ok(contract.goldenPath.reportFormat, 'goldenPath.reportFormat missing');
console.log(`✓ goldenPath.reportFormat === ${contract.goldenPath.reportFormat}`);

console.log('\n所有 release-contract 检查通过');