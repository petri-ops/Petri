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
const projectFilter = process.argv[3] || null;

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
const seen = new Map(); // `${project_id}|${family}` -> prev chain hash
for (const row of rows) {
  const key = `${row.project_id}|${row.artifact_family_id}`;
  const expectedPrev = seen.get(key) ?? null;
  if ((row.prev_chain_hash || null) !== expectedPrev) {
    breaks.push(`prev_mismatch: ${row.revision_id} (stored prev=${row.prev_chain_hash}, expected=${expectedPrev})`);
  }
  if (!row.chain_hash) {
    breaks.push(`chain_hash_missing: ${row.revision_id}（惰性回填前的存量行——不算断链，登记）`);
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

if (breaks.length > 0) {
  console.error(`[chain-verify] FAIL（${breaks.length} 断点）：`);
  for (const b of breaks) console.error(`  ${b}`);
  process.exit(1);
}
console.log(`[chain-verify] PASS：${checked} 版链哈希全部复算一致`);
