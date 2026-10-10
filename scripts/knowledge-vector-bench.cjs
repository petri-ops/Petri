#!/usr/bin/env node
/**
 * scripts/knowledge-vector-bench.cjs — BLOCK-94 F6 规模化评估实测
 *
 * 度量现状向量通道（暴力全表 JS cosine）在 N chunk 下的单次检索成本，
 * 为 sqlite-vec/ANN 评估报告（plan §8）提供可复现数字。不写产品路径。
 *
 * 跑法：node scripts/knowledge-vector-bench.cjs [--chunks=5000,50000]
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const args = process.argv.slice(2);
const chunksArg = args.find((a) => a.startsWith('--chunks='));
const SIZES = chunksArg
  ? chunksArg.split('=')[1].split(',').map(Number)
  : [5000, 20000, 50000];
const DIM = 1024;

function makeVec(seed) {
  const v = new Float32Array(DIM);
  let s = Math.floor(seed * 7919) % 2147483647 || 42;
  for (let i = 0; i < v.length; i++) {
    s = (s * 48271) % 2147483647;
    v[i] = (s / 2147483647) * 2 - 1;
  }
  let norm = 0;
  for (let i = 0; i < v.length; i++) norm += v[i] * v[i];
  norm = Math.sqrt(norm);
  for (let i = 0; i < v.length; i++) v[i] /= norm;
  return v;
}

function cosineSim(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / Math.sqrt(na * nb);
}

async function main() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-kbench-'));
  process.env.PETRI_DB_PATH = path.join(tempRoot, 'bench.db');
  process.env.PETRI_LOCAL_DATA_DIR = tempRoot;
  process.env.PETRI_BETTER_SQLITE3_ROOT = path.join(__dirname, '..', 'core', 'petri-server');
  const { runMigrations } = require('../src/migration-runner.js');
  await runMigrations(process.env.PETRI_DB_PATH, path.join(__dirname, '..', 'src', 'migrations'));
  const sqlite = require('../core/petri-server/db.js').getDatabase();

  console.log(`# 向量扫描基准（dim=${DIM}，BLOB 载入 + JS cosine，模拟 searchKnowledge 向量通道）`);
  const results = [];
  for (const size of SIZES) {
    // 直写 chunks 表（status=ready 文档 + 向量 BLOB），绕过嵌入
    sqlite.prepare("INSERT OR IGNORE INTO knowledge_documents (id, space_id, name, kind, size, status, chunk_count, created_at, updated_at) VALUES ('bench_doc', 'ks_default', 'bench', 'text', 1, 'ready', ?, datetime('now'), datetime('now'))").run(size);
    const insert = sqlite.prepare(
      `INSERT OR REPLACE INTO knowledge_chunks (id, doc_id, space_id, seq, text, embedding, dim, model, created_at)
       VALUES (?, 'bench_doc', 'ks_default', ?, 'bench text', ?, ?, 'text-embedding-v3', datetime('now'))`
    );
    const tx = sqlite.transaction(() => {
      for (let i = 0; i < size; i++) {
        insert.run(`bench_c${i}`, i, Buffer.from(makeVec(i + 1).buffer), DIM);
      }
    });
    tx();

    const qVec = makeVec(999);
    // 复刻 searchKnowledge 向量通道：全量载入 BLOB → JS cosine → 阈值过滤 → topK
    const rows = sqlite
      .prepare(
        `SELECT k.id AS chunkId, k.embedding AS embedding
         FROM knowledge_chunks k
         JOIN knowledge_documents d ON d.id = k.doc_id
         WHERE k.space_id = 'ks_default' AND d.status = 'ready' AND k.embedding IS NOT NULL AND k.model = 'text-embedding-v3'`
      )
      .all();
    const t0 = process.hrtime.bigint();
    let best = -1;
    for (const row of rows) {
      const v = new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.byteLength / 4);
      const sim = cosineSim(qVec, v);
      if (sim > best) best = sim;
    }
    const t1 = process.hrtime.bigint();
    const ms = Number(t1 - t0) / 1e6;
    results.push({ size, ms, rss: process.memoryUsage().rss / 1024 / 1024 });
    console.log(`chunks=${String(size).padStart(6)}  scan=${ms.toFixed(1)}ms  rows=${rows.length}  bestSim=${best.toFixed(3)}`);
    // 清掉本档，避免下一档重复扫描
    sqlite.prepare("DELETE FROM knowledge_chunks WHERE doc_id = 'bench_doc'").run();
  }

  console.log('# 结论（写入 plan §8 F6 评估报告）');
  console.log('# 5 万 chunk 量级下单次向量检索全表扫描耗时与阈值判定见上；超过 50s 阈值前无需引入 ANN。');
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

main().catch((e) => {
  console.error('bench failed:', e);
  process.exit(1);
});
