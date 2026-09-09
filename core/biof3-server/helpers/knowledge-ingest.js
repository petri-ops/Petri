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

function enqueueIngest(docId) {
  _queueDepth += 1;
  _queue = _queue
    .then(() => ingestDocument(docId))
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
async function createDocument({ name, buffer, mime, autoIngest = true }) {
  if (!name || !Buffer.isBuffer(buffer)) throw new Error('knowledge_document_fields_required');
  if (buffer.length > MAX_DOCUMENT_BYTES) throw new Error('knowledge_document_too_large');
  checkSupported(name);
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
    .run(docId, ks.SPACE_ID, safeName, mime || null, buffer.length, rawPath, ts, ts);
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
    // parsing：读原始文件 + 解析器路由
    ks.setDocumentStatus(docId, 'parsing');
    const rawPath = doc.raw_path || path.join(ks.docDir(docId), doc.name);
    const buffer = fs.readFileSync(rawPath);
    const parsed = parseDocument(buffer, doc.name);

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
          ks.SPACE_ID,
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

module.exports = {
  EMBED_BATCH_SIZE,
  MAX_DOCUMENT_BYTES,
  createDocument,
  ingestDocument,
  reindexDocument,
  enqueueIngest,
  ingestQueueDepth,
  safeDocFilename,
};
