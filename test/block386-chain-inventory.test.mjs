/**
 * POST-S7 H1/B-06 —— 产物链 legacy_unhashed 存量清单模式。
 *
 * 为什么要这一步：把 `legacy_unhashed` 从「登记不判红」翻成默认 strict 属于**数据操作**
 * （需要回填用户库里的存量版本），动的是用户资产，必须先有可复算的存量清单。本测试钉住
 * `--inventory` 的语义：清单包含总版数 / 已哈希版数 / 逐条 legacy 版本 id，且不影响
 * 既有 PASS/FAIL 语义（清单模式不是放行模式）。
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(import.meta.dirname, '..');
const Database = require(path.join(ROOT, 'core', 'petri-server', 'node_modules', 'better-sqlite3'));
const { computeRevisionChainHash } = require(path.join(ROOT, 'core', 'shared-backend', 'result-studio-contracts.js'));

function seedDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-chain-inv-'));
  const dbPath = path.join(dir, 'petri.db');
  const db = new Database(dbPath);
  db.exec(`CREATE TABLE artifact_revisions (
    revision_id TEXT PRIMARY KEY, project_id TEXT, artifact_family_id TEXT, revision_ordinal INTEGER,
    artifact_id TEXT, output_hash TEXT, validation_status TEXT, reproducibility_status TEXT,
    created_at TEXT, prev_chain_hash TEXT, chain_hash TEXT
  )`);
  const insert = db.prepare(`INSERT INTO artifact_revisions
    (revision_id, project_id, artifact_family_id, revision_ordinal, artifact_id, output_hash,
     validation_status, reproducibility_status, created_at, prev_chain_hash, chain_hash)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  // 一条合规已哈希版本
  const first = {
    revisionId: 'rev_hash_1', revisionOrdinal: 1, artifactId: 'art_1', outputHash: 'a'.repeat(64),
    validationStatus: 'valid', reproducibilityStatus: 'available', createdAt: '2026-11-09T00:00:00.000Z',
  };
  insert.run('rev_hash_1', 'p1', 'fam1', 1, 'art_1', 'a'.repeat(64), 'valid', 'available',
    first.createdAt, null, computeRevisionChainHash(null, first));
  // 一条 legacy（chain_hash / prev 皆空）
  insert.run('rev_legacy_1', 'p1', 'fam1', 2, 'art_1', 'b'.repeat(64), 'valid', 'available',
    '2026-11-09T01:00:00.000Z', null, null);
  db.close();
  return { dir, dbPath };
}

test('--inventory 落盘 legacy_unhashed 逐版清单，且不改 PASS/FAIL 语义', () => {
  const { dir, dbPath } = seedDb();
  const inventoryPath = path.join(dir, 'out', 'inventory.json');
  const stdout = execFileSync(process.execPath, [
    path.join(ROOT, 'scripts', 'verify-artifact-chain.mjs'), dbPath, '--inventory', inventoryPath, '--allow-legacy',
  ], { encoding: 'utf8' });

  assert.match(stdout, /inventory ->/);
  assert.match(stdout, /PASS/, '清单模式本身不改变判定；容忍旧库靠显式 --allow-legacy');
  const inventory = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
  assert.equal(inventory.kind, 'artifact-chain-legacy-unhashed-inventory');
  assert.equal(inventory.totalRevisions, 2);
  assert.equal(inventory.hashedRevisions, 1);
  assert.equal(inventory.legacyUnhashedCount, 1);
  assert.deepEqual(inventory.legacyUnhashed, ['rev_legacy_1']);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('默认（无旗标）即 strict：legacy_unhashed 判红', () => {
  const { dir, dbPath } = seedDb();
  assert.throws(
    () => execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'verify-artifact-chain.mjs'), dbPath], { encoding: 'utf8' }),
    (error) => error.status === 1 && /legacy_unhashed/.test(String(error.stderr)),
  );
  fs.rmSync(dir, { recursive: true, force: true });
});

test('--strict 仍对 legacy_unhashed 判红（兼容别名不削弱严格模式）', () => {
  const { dir, dbPath } = seedDb();
  assert.throws(
    () => execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'verify-artifact-chain.mjs'), dbPath, '--strict'], { encoding: 'utf8' }),
    (error) => error.status === 1 && /legacy_unhashed/.test(String(error.stderr)),
  );
  fs.rmSync(dir, { recursive: true, force: true });
});
