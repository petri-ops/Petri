#!/usr/bin/env node
/** BLOCK-372（NSO Batch-1 / F-20）— artifact revision 链哈希独立校验器。
 * 复算 (project_id, artifact_family_id) 链上每版 chain_hash 并核对；
 * 任一断链/篡改 fail-closed（exit 1）。
 * 用法：node scripts/verify-artifact-chain.mjs <db-path> [project-id]
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dbPath = process.argv[2] || path.join(ROOT, '.petri-dev-user-data', 'data', 'petri.db');
// BLOCK-377（S2 / G-09）——旗标与位置参数分离（--strict 曾被误当 project filter）
// POST-S7 H1/B-06——默认 strict：legacy_unhashed 由「登记不判红」翻为默认判红。
// 存量清单（--inventory）先行；确需容忍旧库时用 --allow-legacy 显式降级（留因于调用点），
// --strict 保留为兼容别名（语义已等于默认）。
const allowLegacy = process.argv.includes('--allow-legacy');
const strict = process.argv.includes('--strict') || !allowLegacy;
// POST-S7 H1/B-06——存量清单先行：--inventory <path> 把 legacy_unhashed 逐版落盘，
// 作为「默认转 strict」的前置材料（翻转本身要动用户库=用户资产，须显式裁决）。
const inventoryIdx = process.argv.indexOf('--inventory');
const inventoryPath = inventoryIdx > -1 ? process.argv[inventoryIdx + 1] : null;
// 旗标的取值也算旗标的一部分，不得漏进位置参数（否则 --inventory <path> 的 path 会被
// 当成 project filter，查询直接返回 0 行——H1 首跑就踩到，靠本测试钉住）。
const flagValues = new Set([inventoryPath].filter(Boolean));
const positional = process.argv.slice(3).filter((a) => !a.startsWith('--') && !flagValues.has(a));
const projectFilter = positional[0] || null;

if (!fs.existsSync(dbPath)) {
  console.error(`[chain-verify] db not found: ${dbPath}`);
  process.exit(2);
}
const Database = require(path.join(ROOT, 'core', 'petri-server', 'node_modules', 'better-sqlite3'));
const db = new Database(dbPath, { readonly: true });

const { computeRevisionChainHash } = require(path.join(ROOT, 'core', 'shared-backend', 'result-studio-contracts.js'));

const rows = db.prepare(`
  SELECT revision_id, project_id, artifact_family_id, revision_ordinal,
         artifact_id, output_hash, validation_status, reproducibility_status,
         created_at, prev_chain_hash, chain_hash
  FROM artifact_revisions
  ${projectFilter ? 'WHERE project_id = ?' : ''}
  ORDER BY project_id, artifact_family_id, revision_ordinal ASC
`).all(...(projectFilter ? [projectFilter] : []));

let checked = 0;
const breaks = [];
// BLOCK-377（S2 / G-09）——分流：惰性回填前的存量缺链行（chain_hash/prev 均空）
// =legacy_unhashed（登记不判红，--strict 时才失败）；真断链/篡改照旧 fail-closed。
const legacyUnhashed = [];
const seen = new Map(); // `${project_id}|${family}` -> prev chain hash
for (const row of rows) {
  const key = `${row.project_id}|${row.artifact_family_id}`;
  const expectedPrev = seen.get(key) ?? null;
  if (!row.chain_hash && row.prev_chain_hash == null) {
    legacyUnhashed.push(row.revision_id);
    seen.set(key, expectedPrev);
    continue;
  }
  if ((row.prev_chain_hash || null) !== expectedPrev) {
    breaks.push(`prev_mismatch: ${row.revision_id} (stored prev=${row.prev_chain_hash}, expected=${expectedPrev})`);
  }
  if (!row.chain_hash) {
    breaks.push(`chain_hash_missing: ${row.revision_id}（有 prev 而无本环哈希=回填中断，可疑）`);
    seen.set(key, expectedPrev);
    continue;
  }
  const computed = computeRevisionChainHash(expectedPrev, {
    revisionId: row.revision_id, revisionOrdinal: row.revision_ordinal,
    artifactId: row.artifact_id, outputHash: row.output_hash,
    validationStatus: row.validation_status,
    reproducibilityStatus: row.reproducibility_status, createdAt: row.created_at,
  });
  if (computed !== row.chain_hash) {
    breaks.push(`chain_hash_tampered: ${row.revision_id} (stored=${row.chain_hash.slice(0, 12)}, computed=${computed.slice(0, 12)})`);
  }
  seen.set(key, row.chain_hash);
  checked += 1;
}
db.close();

if (inventoryPath) {
  const inventory = {
    schemaVersion: 1,
    kind: 'artifact-chain-legacy-unhashed-inventory',
    generatedAt: new Date().toISOString(),
    dbPath: path.resolve(dbPath),
    projectFilter,
    totalRevisions: rows.length,
    hashedRevisions: checked,
    legacyUnhashedCount: legacyUnhashed.length,
    legacyUnhashed,
  };
  fs.mkdirSync(path.dirname(path.resolve(inventoryPath)), { recursive: true });
  fs.writeFileSync(path.resolve(inventoryPath), JSON.stringify(inventory, null, 2));
  console.log(`[chain-verify] inventory -> ${path.resolve(inventoryPath)}`);
}
if (legacyUnhashed.length > 0) {
  console.log(`[chain-verify] legacy_unhashed：${legacyUnhashed.length} 版（惰性回填前存量，${allowLegacy ? '--allow-legacy 显式降级' : '默认判红'}）`);
}
if (breaks.length > 0) {
  console.error(`[chain-verify] FAIL（${breaks.length} 断点）：`);
  for (const b of breaks) console.error(`  ${b}`);
  process.exit(1);
}
if (strict && legacyUnhashed.length > 0) {
  console.error(`[chain-verify] FAIL（默认 strict）：${legacyUnhashed.length} 版 legacy_unhashed 未回填；确需容忍旧库请显式 --allow-legacy 并在调用点留因`);
  process.exit(1);
}
console.log(`[chain-verify] PASS：${checked} 版链哈希全部复算一致`);
