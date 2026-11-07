/**
 * nso-s2-chain-hash-update.test.mjs — BLOCK-377（S2 / G-09）链哈希 UPDATE 覆盖与篡改负测。
 *
 * 契约：
 *  1. 业务列 UPDATE（reproducibility_status→verified）必须重算该环 chain_hash——
 *     改列不重算=无痕篡改窗口（旧形态缺陷）。
 *  2. 篡改负测：直接改 DB 行的 output_hash → 校验器 fail-closed（exit 1）。
 *  3. legacy 分流：链字段全空的存量行 → 校验器登记 legacy_unhashed 不判红；--strict 判红。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const Database = require('better-sqlite3');
const { ensureResultStudioSchema } = require('../core/shared-backend/result-studio-schema.js');
const { ensureResultWorkflowGraphSchema } = require('../core/shared-backend/result-workflow-graph.js');
const { ensureResultRefTransactionSchema } = require('../core/shared-backend/result-ref-transaction-schema.js');
const { createResultStudioRepository } = require('../core/shared-backend/result-studio-repository.js');
const { computeRevisionChainHash } = require('../core/shared-backend/result-studio-contracts.js');

function buildFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 's2-chain-'));
  const db = new Database(path.join(dir, 't.db'));
  ensureResultStudioSchema(db);
  ensureResultWorkflowGraphSchema(db);
  ensureResultRefTransactionSchema(db);
  const repo = createResultStudioRepository(db, { ensureSchema: false });
  const insert = (family, ordinal, outputHash, repro = 'available') => {
    // 与 insertRevision 同构：插入即建链（ordinal=1 → prev=null）
    const prevRow = db.prepare('SELECT chain_hash FROM artifact_revisions WHERE artifact_family_id=? AND revision_ordinal=?')
      .get(family, ordinal - 1);
    const prev = prevRow ? prevRow.chain_hash : null;
    const chainHash = computeRevisionChainHash(prev, {
      revisionId: `rev_${family}_${ordinal}`, revisionOrdinal: ordinal, artifactId: `art_${family}_${ordinal}`,
      outputHash, validationStatus: 'valid', reproducibilityStatus: repro,
      createdAt: '2026-11-07T00:00:00Z',
    });
    db.prepare(`INSERT INTO artifact_revisions (
      revision_id, contract_version, project_id, artifact_family_id, artifact_id,
      revision_ordinal, output_path, output_hash, validation_status, reproducibility_status,
      change_set_id, is_current, created_at, prev_chain_hash, chain_hash
    ) VALUES (?, 1, 'p1', ?, ?, ?, 'out', ?, 'valid', ?, 'cs1', 0, '2026-11-07T00:00:00Z', ?, ?)`)
      .run(`rev_${family}_${ordinal}`, family, `art_${family}_${ordinal}`, ordinal, outputHash, repro, prev, chainHash);
  };
  return { dir, db, repo, insert };
}

test('S2-G09 业务列 UPDATE（reproducibility_status→verified）重算链哈希', () => {
  const fx = buildFixture();
  try {
    fx.insert('fam', 1, 'hash-A'); // 夹具插入即建链（与 insertRevision 同构）
    const { _test } = require('../core/shared-backend/result-studio-repository.js');
    const chainOf = (r) => computeRevisionChainHash(r.prev_chain_hash, {
      revisionId: r.revision_id, revisionOrdinal: r.revision_ordinal, artifactId: r.artifact_id,
      outputHash: r.output_hash, validationStatus: r.validation_status,
      reproducibilityStatus: r.reproducibility_status, createdAt: r.created_at,
    });
    const row = fx.db.prepare("SELECT * FROM artifact_revisions WHERE revision_id='rev_fam_1'").get();
    assert.equal(row.chain_hash, chainOf(row), '插入即建链且与行值一致');
    // 业务列 UPDATE（不经重算的裸 UPDATE=旧缺陷形态）→ 链失配
    fx.db.prepare("UPDATE artifact_revisions SET reproducibility_status='verified' WHERE revision_id='rev_fam_1'").run();
    const stale = fx.db.prepare("SELECT * FROM artifact_revisions WHERE revision_id='rev_fam_1'").get();
    assert.notEqual(stale.chain_hash, chainOf(stale), '裸 UPDATE 后链必失配（无痕窗口的成因）');
    // 重算钩子（recordReplayProofAndVerifyCohort 内联调用）关闭窗口
    assert.equal(_test.recomputeRevisionChainHash(fx.db, 'rev_fam_1'), true);
    const healed = fx.db.prepare("SELECT * FROM artifact_revisions WHERE revision_id='rev_fam_1'").get();
    assert.equal(healed.chain_hash, chainOf(healed), '重算后链与新行值一致（无痕窗口关闭）');
  } finally {
    fx.db.close();
    fs.rmSync(fx.dir, { recursive: true, force: true });
  }
});

test('S2-G09 篡改负测：改 DB 行 output_hash → 校验器 exit 1', () => {
  const fx = buildFixture();
  try {
    fx.insert('fam', 1, 'hash-A');
    fx.db.prepare("UPDATE artifact_revisions SET chain_hash = ? WHERE revision_id = 'rev_fam_1'")
      .run(computeRevisionChainHash(null, {
        revisionId: 'rev_fam_1', revisionOrdinal: 1, artifactId: 'art_fam_1',
        outputHash: 'hash-A', validationStatus: 'valid', reproducibilityStatus: 'available',
        createdAt: '2026-11-07T00:00:00Z',
      }));
    fx.db.prepare("UPDATE artifact_revisions SET output_hash = 'hash-TAMPERED' WHERE revision_id = 'rev_fam_1'").run();
    const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts/verify-artifact-chain.mjs'), path.join(fx.dir, 't.db')], { encoding: 'utf8' });
    assert.equal(r.status, 1, '篡改必须 fail-closed');
    assert.match(r.stderr || r.stdout, /chain_hash_tampered/);
  } finally {
    fx.db.close();
    fs.rmSync(fx.dir, { recursive: true, force: true });
  }
});

test('S2-G09 legacy 分流：链字段全空存量行不判红；--strict 判红', () => {
  const fx = buildFixture();
  try {
    fx.insert('fam', 1, 'hash-A');
    fx.db.prepare("UPDATE artifact_revisions SET chain_hash=NULL, prev_chain_hash=NULL WHERE revision_id='rev_fam_1'").run();
    const ok = spawnSync(process.execPath, [path.join(ROOT, 'scripts/verify-artifact-chain.mjs'), path.join(fx.dir, 't.db')], { encoding: 'utf8' });
    assert.equal(ok.status, 0, 'legacy_unhashed 存量=登记不判红');
    assert.match(ok.stdout, /legacy_unhashed：1/);
    const strict = spawnSync(process.execPath, [path.join(ROOT, 'scripts/verify-artifact-chain.mjs'), path.join(fx.dir, 't.db'), '--strict'], { encoding: 'utf8' });
    assert.equal(strict.status, 1, '--strict 时 legacy 未回填判红');
  } finally {
    fx.db.close();
    fs.rmSync(fx.dir, { recursive: true, force: true });
  }
});
