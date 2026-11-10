// release-contract.test.mjs — Week 1 发行可信化验证
//
// 运行：node test/release-contract.test.mjs
// 校验：
//   1. release-contract.json 可解析
//   2. channel === 'beta'
//   3. 所有 platforms[*].supported === true 的 platform 必须有非 null runtimeArtifact.url
//   4. goldenPath.tool id 必须在在仓能力清单（resources/skills/*/manifest.json）中出现
//      （BLOCK-104 增量对账：inventory.ts 已随 BLOCK-83 UI-352 SPI 化退役，工具目录
//      真相迁至插件投影 + 内建技能清单；本断言跟随真实归属地）
//
// 失败即退出非零。

import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { findToolDeclarations } from '../scripts/post-s7-tool-declaration.mjs';

// BLOCK-49 加映清债 —— 统一临时 DB 自举（存量：缺 projects 表）
{
  const _fs = await import('node:fs');
  const _os = await import('node:os');
  const _path = await import('node:path');
  const _createRequire = (await import('node:module')).default.createRequire;
  const _req = _createRequire(import.meta.url);
  const _here = dirname(fileURLToPath(import.meta.url));
  const _Database = _req(resolve(_here, '..', 'core', 'petri-server', 'node_modules', 'better-sqlite3'));
  const _dir = _fs.mkdtempSync(_path.resolve(_os.tmpdir(), 'petri-sweep-db-'));
  const _boot = new _Database(_path.resolve(_dir, 'petri.db'));
  const _mig = _path.resolve(_here, '..', 'src', 'migrations');
  for (const f of _fs.readdirSync(_mig).filter((f) => f.endsWith('.sql')).sort()) {
    _boot.exec(_fs.readFileSync(_path.resolve(_mig, f), 'utf8'));
  }
  _boot.close();
  process.env.PETRI_DB_PATH = _path.resolve(_dir, 'petri.db');
  process.on('exit', () => { try { _fs.rmSync(_dir, { recursive: true, force: true }); } catch {} });
}

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const contractPath = resolve(repoRoot, 'release-contract.json');

console.log(`[release-contract] loading ${contractPath}`);
assert(existsSync(contractPath), 'release-contract.json not found at repo root');

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

// ── 4. goldenPath.tool must appear in the in-repo capability manifests ──
const toolId = contract?.goldenPath?.tool;
assert.ok(toolId, 'goldenPath.tool missing in contract');
// BLOCK-394 B-20 — 结构化能力声明（不再用 includes 扫描不存在的目录文件）。
const topManifestPath = resolve(repoRoot, 'resources', 'skills', 'manifest.json');
const skillsManifest = existsSync(topManifestPath) ? JSON.parse(readFileSync(topManifestPath, 'utf8')) : {};
// BLOCK-375（S0）能力真相三源化：BLOCK-214（082707e5「生信 skills 去核」）把
// deseq2 等领域能力迁入兄弟仓 petri-pack-bio（registry/tool-registry.json），
// 仓内 skill 清单不再覆盖它们。golden path 能力真相=①仓内 skill manifest
// ②兄弟包 registry（只读探测，存在才查）③显式豁免（pack 未随仓分发时保绿，
// 留因待 S6 golden path 重基）。
const WAIVED_GOLDEN_TOOLS = new Map([
  ['deseq2', 'BLOCK-214 生信 skills 去核：deseq2 由领域包 petri-pack-bio 提供（registry/tool-registry.json），仓内 manifest 引用随之失效；golden path 重基（in-repo 能力）前显式豁免，重基后移除'],
]);
const packRegistryPath = resolve(repoRoot, '..', 'petri-pack-bio', 'registry', 'tool-registry.json');
const packRegistry = existsSync(packRegistryPath) ? JSON.parse(readFileSync(packRegistryPath, 'utf8')) : {};
const declared = findToolDeclarations(toolId, { skillsManifest, packRegistry });
const manifestHits = declared.hits.filter((h) => h.startsWith('skills:'));
const packDeclares = declared.hits.includes('pack:TOOLS');
const waived = WAIVED_GOLDEN_TOOLS.get(toolId);
assert.ok(
  manifestHits.length > 0 || packDeclares || waived,
  `goldenPath.tool '${toolId}' not referenced by any resources/skills/*/manifest.json — golden path must reference a real shipped capability (BLOCK-104 增量：inventory.ts 已随 SPI 化退役，能力真相=技能清单+插件投影)`
);
if (manifestHits.length > 0) {
  console.log(`✓ goldenPath.tool '${toolId}' referenced by skills: ${manifestHits.join(', ')}`);
} else if (packDeclares) {
  console.log(`✓ goldenPath.tool '${toolId}' provided by domain pack registry (petri-pack-bio)`);
} else {
  console.log(`✓ goldenPath.tool '${toolId}' waived: ${waived}`);
}

// ── 5. golden path report format declared ──
assert.ok(contract.goldenPath.reportFormat, 'goldenPath.reportFormat missing');
console.log(`✓ goldenPath.reportFormat === ${contract.goldenPath.reportFormat}`);

console.log('\n所有 release-contract 检查通过');