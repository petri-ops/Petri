#!/usr/bin/env node
/** BLOCK-372 Batch-1 — artifact_revisions 链哈希惰性回填脚本。
 * 按 (project_id, artifact_family_id, revision_ordinal) 排序链式回填存量行的
 * prev_chain_hash / chain_hash（F-20：「回填只能证明回填时刻起的链完整」——如实登记）。
 * 幂等：已回填行跳过。用法：node scripts/backfill-artifact-chain.mjs <db-path> [--dry-run]
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dbPath = process.argv[2] || path.join(ROOT, '.petri-dev-user-data', 'data', 'petri.db');
const dryRun = process.argv.includes('--dry-run');

if (!fs.existsSync(dbPath)) {
  console.error(`[chain-backfill] db not found: ${dbPath}`);
  process.exit(2);
}
const Database = require(path.join(ROOT, 'core', 'petri-server', 'node_modules', 'better-sqlite3'));
const db = new Database(dbPath);

const hasColumns = db.prepare(
  "SELECT COUNT(*) AS n FROM pragma_table_info('artifact_revisions') WHERE name IN ('prev_chain_hash','chain_hash')"
).get();
if (hasColumns.n < 2) {
  console.error('[chain-backfill] 迁移 022 未应用（prev_chain_hash/chain_hash 列缺席）——先跑 migration-runner');
  process.exit(2);
}

const { computeRevisionChainHash } = require(path.join(ROOT, 'core', 'shared-backend', 'result-studio-contracts.js'));

const rows = db.prepare(`
  SELECT revision_id, project_id, artifact_family_id, revision_ordinal,
         artifact_id, output_hash, validation_status, reproducibility_status,
         created_at, prev_chain_hash, chain_hash
  FROM artifact_revisions
  ORDER BY project_id, artifact_family_id, revision_ordinal ASC
`).all();

const tx = dryRun ? null : db.transaction((updates) => {
  for (const u of updates) {
    db.prepare('UPDATE artifact_revisions SET prev_chain_hash = ?, chain_hash = ? WHERE revision_id = ?')
      .run(u.prev, u.chain, u.revisionId);
  }
});

const updates = [];
const seen = new Map();
let alreadyDone = 0;
for (const row of rows) {
  const key = `${row.project_id}|${row.artifact_family_id}`;
  const prev = seen.get(key) ?? null;
  if (row.prev_chain_hash === prev && row.chain_hash) {
    alreadyDone += 1;
    seen.set(key, row.chain_hash);
    continue;
  }
  const chain = computeRevisionChainHash(prev, {
    revisionId: row.revision_id, revisionOrdinal: row.revision_ordinal,
    artifactId: row.artifact_id, outputHash: row.output_hash,
    validationStatus: row.validation_status,
    reproducibilityStatus: row.reproducibility_status, createdAt: row.created_at,
  });
  updates.push({ revisionId: row.revision_id, prev, chain });
  seen.set(key, chain);
}

console.log(`[chain-backfill] 总行 ${rows.length}，已回填 ${alreadyDone}，待回填 ${updates.length}${dryRun ? '（dry-run）' : ''}`);
if (!dryRun && updates.length > 0) tx(updates);
db.close();
console.log(`[chain-backfill] ${dryRun ? 'dry-run 完成' : '回填完成'}——复跑 scripts/verify-artifact-chain.mjs 应 PASS`);
