/**
 * helpers/knowledge-ingest.js — BLOCK-69 P1 文本族摄取管道
 *
 * D2 文档状态机：uploaded → parsing → chunking → embedding → ready | failed(+error)
 * - 解析：knowledge-parsers 按扩展名路由（fail-closed）
 * - 分块：knowledge-space.chunkText（结构感知 + 尺寸上限）
 * - 嵌入：memory-vectors 通道批量编码（DashScope text-embedding-v3，batch≤10）
 * - 落库：chunks + FTS 行单事务写入，失败不落半索引（fail-closed，文档转 failed）
 * - 队列：进程内串行（P1 单机桌面场景，D8）
 *
 * Public API:
 *   createDocument({ name, buffer, size, mime }) → doc row（落原始文件 + 入队摄取）
 *   ingestDocument(docId, { embed } ) → doc row（状态机全程；embed 可注入供测试）
 *   reindexDocument(docId) → doc row（清旧块重跑管道）
 *   ingestQueueDepth()
 */

const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const ks = require('./knowledge-space');
const { parseDocument, checkSupported } = require('./knowledge-parsers');

const sqlite = require('../db').getDatabase();

const EMBED_BATCH_SIZE = 10;
const MAX_DOCUMENT_BYTES = 50 * 1024 * 1024; // P1 文本族 50MB 上限（原始大媒体文件属 P3/P4）
const MIN_CHUNK_FOR_EMBED = 1;

// 进程内串行摄取队列：promise 链即队列，reject 不断链
let _queue = Promise.resolve();
let _queueDepth = 0;

function enqueueIngest(docId, { embed } = {}) {
  _queueDepth += 1;
  _queue = _queue
    .then(() => ingestDocument(docId, { embed }))
    .catch((e) => {
      console.log('[knowledge-ingest] queue item failed:', docId, e && e.message);
    })
    .finally(() => {
      _queueDepth = Math.max(0, _queueDepth - 1);
    });
  return _queue;
}

function ingestQueueDepth() {
  return _queueDepth;
}

function safeDocFilename(originalName) {
  const basename = path.basename(String(originalName || '').normalize('NFKC'));
  const ext = path.extname(basename).toLowerCase();
  const stem = path.basename(basename, path.extname(basename))
    .replace(/[^\p{L}\p{N}._-]+/gu, '_')
    .replace(/^\.+/, '')
    .slice(0, 120);
  return `${stem || 'document'}${ext}`;
}

/**
 * 创建文档：写原始文件 + 建行（uploaded）+ 入队摄取。
 * autoIngest=false 仅供测试/迁移工具落行不排程。
 * 解析器不支持的扩展名在此 fail-closed（不建行不入队）。
 */
async function createDocument({ name, buffer, mime, autoIngest = true, spaceId }) {
  if (!name || !Buffer.isBuffer(buffer)) throw new Error('knowledge_document_fields_required');
  if (buffer.length > MAX_DOCUMENT_BYTES) throw new Error('knowledge_document_too_large');
  checkSupported(name);
  // BLOCK-99 G1 — 目标空间（缺省 ks_default；未知 fail-closed）
  const targetSpace = ks.resolveSpaceId(spaceId);
  const docId = `kdoc_${uuidv4().slice(0, 12)}`;
  const dir = ks.docDir(docId);
  fs.mkdirSync(dir, { recursive: true });
  const safeName = safeDocFilename(name);
  const rawPath = path.join(dir, safeName);
  fs.writeFileSync(rawPath, buffer);
  const ts = new Date().toISOString();
  sqlite
    .prepare(
      `INSERT INTO knowledge_documents (id, space_id, name, kind, mime, size, status, raw_path, created_at, updated_at)
       VALUES (?, ?, ?, 'text', ?, ?, 'uploaded', ?, ?, ?)`
    )
    .run(docId, targetSpace, safeName, mime || null, buffer.length, rawPath, ts, ts);
  if (autoIngest) enqueueIngest(docId);
  return ks.getDocument(docId);
}

/**
 * 摄取状态机全程。embed 可注入（测试）。任何一步失败 → failed(+error)，不落半索引。
 */
async function ingestDocument(docId, { embed } = {}) {
  const doc = ks.getDocument(docId);
  if (!doc) throw new Error('knowledge_document_not_found');

  try {
    // parsing：读原始文件 + 解析器路由（BLOCK-94 F2 起 PDF 等异步解析器，await 兼容同步解析器）
    ks.setDocumentStatus(docId, 'parsing');
    const rawPath = doc.raw_path || path.join(ks.docDir(docId), doc.name);
    const buffer = fs.readFileSync(rawPath);
    const parsed = await parseDocument(buffer, doc.name);
    if (parsed.kind && parsed.kind !== doc.kind) {
      sqlite.prepare('UPDATE knowledge_documents SET kind = ? WHERE id = ?').run(parsed.kind, docId);
    }

    // chunking：结构感知分块
    ks.setDocumentStatus(docId, 'chunking');
    const chunks = ks.chunkText(parsed.text);
    if (chunks.length === 0) {
      throw new Error('knowledge_chunk_empty（文档无有效文本内容）');
    }

    // embedding：批量编码；无 key / 失败 → failed（D7 不静默降级为无向量索引）
    ks.setDocumentStatus(docId, 'embedding');
    const embedFn = embed || ks.embedTexts;
    const texts = chunks.map((c) => c.text.slice(0, 1500));
    const vectors = new Array(chunks.length).fill(null);
    for (let i = 0; i < texts.length; i += EMBED_BATCH_SIZE) {
      const batch = texts.slice(i, i + EMBED_BATCH_SIZE);
      const vecs = await embedFn(batch, { kind: 'knowledge_ingest', docId });
      if (!Array.isArray(vecs)) {
        throw new Error('knowledge_embed_unavailable（嵌入模型不可用：请先在设置中配置 DashScope key）');
      }
      vecs.forEach((vec, j) => {
        if (vec) vectors[i + j] = vec;
      });
    }
    const embeddedCount = vectors.filter(Boolean).length;
    if (embeddedCount < Math.min(MIN_CHUNK_FOR_EMBED, chunks.length)) {
      throw new Error('knowledge_embed_failed（所有分块嵌入失败）');
    }

    // 落库：chunks + FTS 单事务（ready 才对外可见——searchKnowledge 只扫 ready 文档）
    const tx = sqlite.transaction(() => {
      // trigram FTS5 陷阱：对 UNINDEXED 列的 LIKE/GLOB 谓词会被 trigram-LIKE 优化劫持
      // 且错误恒返回空（SELECT/DELETE 皆然）——重建删除必须走等值 IN 子查询
      sqlite
        .prepare('DELETE FROM knowledge_chunks_fts WHERE chunk_id IN (SELECT id FROM knowledge_chunks WHERE doc_id = ?)')
        .run(docId);
      sqlite.prepare('DELETE FROM knowledge_chunks WHERE doc_id = ?').run(docId);
      const insertChunk = sqlite.prepare(
        `INSERT INTO knowledge_chunks (id, doc_id, space_id, seq, text, embedding, dim, model, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      const insertFts = sqlite.prepare(
        'INSERT INTO knowledge_chunks_fts (chunk_id, text) VALUES (?, ?)'
      );
      const nowTs = new Date().toISOString();
      chunks.forEach((chunk, idx) => {
        const chunkId = `${docId}_c${chunk.seq}`;
        const vec = vectors[idx];
        insertChunk.run(
          chunkId,
          docId,
          doc.space_id, // BLOCK-99 G1 — 按文档归属空间落块（曾写死 ks.SPACE_ID 致跨空间块错标）
          chunk.seq,
          chunk.text,
          vec ? Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength) : null,
          vec ? vec.length : null,
          vec ? ks.EMBEDDING_MODEL : null,
          nowTs
        );
        insertFts.run(chunkId, chunk.text);
      });
      sqlite
        .prepare('UPDATE knowledge_documents SET chunk_count = ?, updated_at = ? WHERE id = ?')
        .run(chunks.length, new Date().toISOString(), docId);
    });
    tx();
    return ks.setDocumentStatus(docId, 'ready');
  } catch (e) {
    const message = e && e.message ? e.message : String(e);
    console.log('[knowledge-ingest] failed:', docId, message);
    return ks.setDocumentStatus(docId, 'failed', { error: message });
  }
}

/** 重建索引：清旧块（含 FTS）后重跑管道。原始文件缺失 → failed。 */
async function reindexDocument(docId) {
  const doc = ks.getDocument(docId);
  if (!doc) throw new Error('knowledge_document_not_found');
  const rawPath = doc.raw_path || path.join(ks.docDir(docId), doc.name);
  if (!fs.existsSync(rawPath)) {
    return ks.setDocumentStatus(docId, 'failed', { error: 'knowledge_raw_file_missing（原始文件已不在，无法重建）' });
  }
  enqueueIngest(docId);
  return ks.getDocument(docId);
}

// ---- BLOCK-94 F1 可靠底盘：启动恢复 + 失败批量重试 ----

// 队列为进程内 promise 链：重启后 uploaded/parsing/chunking/embedding 中间态文档会永久卡住。
// 服务启动时（mountKnowledge）调用：中间态文档按 updated_at 升序（先来先摄）自动重排入队。
// 原始文件缺失的会在管道内诚实转 failed（knowledge_raw_file_missing / 读文件失败）。
function recoverInterruptedIngest({ embed } = {}) {
  const rows = sqlite
    .prepare(
      `SELECT id FROM knowledge_documents
       WHERE space_id = ? AND status IN ('uploaded', 'parsing', 'chunking', 'embedding')
       ORDER BY updated_at ASC`
    )
    .all(ks.SPACE_ID);
  for (const row of rows) enqueueIngest(row.id, { embed });
  if (rows.length > 0) {
    console.log(`[knowledge-ingest] boot recovery: requeued ${rows.length} interrupted document(s)`);
  }
  return { requeued: rows.length, docIds: rows.map((r) => r.id), settled: _queue };
}

// failed 文档批量重试（含解析器就绪后的 PDF 等历史失败）。原始文件缺失的逐项诚实跳过。
function retryFailedDocuments({ embed } = {}) {
  const rows = sqlite
    .prepare(`SELECT id FROM knowledge_documents WHERE space_id = ? AND status = 'failed' ORDER BY updated_at ASC`)
    .all(ks.SPACE_ID);
  const skipped = [];
  let requeued = 0;
  for (const row of rows) {
    const doc = ks.getDocument(row.id);
    const rawPath = doc ? doc.raw_path || path.join(ks.docDir(row.id), doc.name) : null;
    if (!rawPath || !fs.existsSync(rawPath)) {
      skipped.push({ id: row.id, reason: 'knowledge_raw_file_missing' });
      continue;
    }
    enqueueIngest(row.id, { embed });
    requeued += 1;
  }
  return { requeued, skipped, settled: _queue };
}

module.exports = {
  EMBED_BATCH_SIZE,
  MAX_DOCUMENT_BYTES,
  createDocument,
  ingestDocument,
  reindexDocument,
  enqueueIngest,
  ingestQueueDepth,
  recoverInterruptedIngest,
  retryFailedDocuments,
  safeDocFilename,
};
