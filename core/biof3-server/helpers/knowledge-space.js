/**
 * helpers/knowledge-space.js — BLOCK-69 知识空间检索内核
 *
 * 第三数据域（独立于 memory_vectors 对话记忆域与项目工作区数据面）：
 * - knowledge_spaces / knowledge_documents / knowledge_chunks 由 migration 009 管理
 * - knowledge_chunks_fts：FTS5 trigram 全文虚表（关键词精确通道）
 * - 向量通道：Float32Array BLOB（编码沿用 memory-vectors 方案，独立建表不改其语义）
 *
 * 检索：双通道（向量 cosine 阈值 + FTS trigram，<3 字短词走 LIKE 兜底）→ RRF 融合。
 *
 * Public API:
 *   getSpace() / setSpaceEnabled(enabled)
 *   listDocuments() / getDocument(id)
 *   chunkText(text)
 *   searchKnowledge({ query, topK, embed })
 *   buildPromptBlock(hits, maxChars)
 *   deleteDocument(docId) / clearSpace()
 *   knowledgeRoot() — <LOCAL_DATA_DIR>/knowledge 原始文件根
 *   Constants: SPACE_ID, EMBEDDING_DIM, EMBEDDING_MODEL, VECTOR_THRESHOLD, INJECT_TOPK
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const dbMod = require('../db');
const sqlite = dbMod.getDatabase();

const SPACE_ID = 'ks_default';
const EMBEDDING_DIM = 1024;
const EMBEDDING_MODEL = 'text-embedding-v3';
// D4 轻按需：向量通道沿用 memory-vectors 0.55 阈值先例；注入上限 ≤3 块
const VECTOR_THRESHOLD = 0.55;
const VECTOR_TOPK = 6;
const FTS_TOPK = 6;
const INJECT_TOPK = 3;
const INJECT_MAX_CHARS = 1800;
// RRF 融合常数（标准 k=60）
const RRF_K = 60;
// D3 分块：结构感知 + 尺寸上限（~800 token ≈ 1600 字符混合中英），少量重叠
const CHUNK_MAX_CHARS = 1600;
const CHUNK_OVERLAP_CHARS = 120;
const CHUNK_MIN_CHARS = 40;
// 短于该长度的查询不做检索（省一次无效 embedding）
const QUERY_MIN_CHARS = 2;
// BLOCK-94 F6 规模化：向量通道为暴力全表扫描（JS cosine），chunk 数观测警戒阈值。
// 超阈值只告警不阻断（诚实观测）；sqlite-vec/ANN 引入与否属依赖裁决（plan §8 评估报告）。
const SCAN_WARN_THRESHOLD = 50000;

const DOC_STATUS = ['uploaded', 'parsing', 'chunking', 'embedding', 'ready', 'failed'];

function knowledgeRoot() {
  const root =
    process.env.BIOF3_LOCAL_DATA_DIR ||
    path.join(os.homedir(), 'Documents', 'BioF3-Local');
  return path.join(root, 'knowledge');
}

function docDir(docId) {
  return path.join(knowledgeRoot(), docId);
}

function now() {
  return new Date().toISOString();
}

// ---- 空间 ----

function getSpace() {
  return sqlite.prepare('SELECT * FROM knowledge_spaces WHERE id = ?').get(SPACE_ID) || null;
}

function setSpaceEnabled(enabled) {
  sqlite
    .prepare('UPDATE knowledge_spaces SET enabled = ?, updated_at = ? WHERE id = ?')
    .run(enabled ? 1 : 0, now(), SPACE_ID);
  return getSpace();
}

// ---- 文档 ----

function listDocuments() {
  return sqlite
    .prepare('SELECT * FROM knowledge_documents WHERE space_id = ? ORDER BY updated_at DESC')
    .all(SPACE_ID);
}

// BLOCK-94 F1 分页：面板/REST 列表面可分页（内部全量路径沿用 listDocuments）
function listDocumentsPage({ limit, offset } = {}) {
  const lim = Math.max(1, Math.min(Number.parseInt(limit, 10) || 50, 200));
  const off = Math.max(0, Number.parseInt(offset, 10) || 0);
  const documents = sqlite
    .prepare('SELECT * FROM knowledge_documents WHERE space_id = ? ORDER BY updated_at DESC LIMIT ? OFFSET ?')
    .all(SPACE_ID, lim, off);
  const total = sqlite
    .prepare('SELECT COUNT(*) AS c FROM knowledge_documents WHERE space_id = ?')
    .get(SPACE_ID).c;
  return { documents, total, hasMore: off + documents.length < total, limit: lim, offset: off };
}

function getDocument(id) {
  return sqlite.prepare('SELECT * FROM knowledge_documents WHERE id = ?').get(id) || null;
}

function setDocumentStatus(id, status, extra = {}) {
  const doc = getDocument(id);
  if (!doc) throw new Error('knowledge_document_not_found');
  if (!DOC_STATUS.includes(status)) throw new Error('knowledge_status_invalid');
  sqlite
    .prepare(
      `UPDATE knowledge_documents
       SET status = ?, error = ?, chunk_count = COALESCE(?, chunk_count), updated_at = ?
       WHERE id = ?`
    )
    .run(status, extra.error ?? null, extra.chunkCount ?? null, now(), id);
  return getDocument(id);
}

// ---- D3 分块：结构感知（标题/段落边界）+ 尺寸上限 + 少量重叠 ----

const HEADING_RE = /^#{1,6}\s+\S|^=+\s\S.*=+\s*$/;

function chunkText(text) {
  const normalized = String(text || '').replace(/\r\n/g, '\n').replace(/\t/g, '  ');
  if (!normalized.trim()) return [];

  // 先按空行切段落，标题行独立成段；超限段落再按句子/行边界硬切
  const paragraphs = [];
  let current = [];
  for (const line of normalized.split('\n')) {
    if (HEADING_RE.test(line.trim()) && current.length) {
      paragraphs.push(current.join('\n'));
      current = line === '' ? [] : [line];
    } else {
      current.push(line);
    }
    if (line === '' && current.length && current[0] === '') {
      current = [];
    }
  }
  if (current.length) paragraphs.push(current.join('\n'));

  const units = [];
  for (const para of paragraphs) {
    if (!para.trim()) continue;
    if (para.length <= CHUNK_MAX_CHARS) {
      units.push(para);
      continue;
    }
    // 超限段落：优先句号/问叹号/换行切句，仍超限再按字符硬切
    const sentences = para.split(/(?<=[。！？!?\n])/);
    let buf = '';
    for (const sentence of sentences) {
      if (buf.length + sentence.length > CHUNK_MAX_CHARS && buf.trim()) {
        units.push(buf);
        buf = sentence;
      } else {
        buf += sentence;
      }
      while (buf.length > CHUNK_MAX_CHARS) {
        units.push(buf.slice(0, CHUNK_MAX_CHARS));
        buf = buf.slice(CHUNK_MAX_CHARS - CHUNK_OVERLAP_CHARS);
      }
    }
    if (buf.trim()) units.push(buf);
  }

  // 相邻小块合并到预算内（碎块 <MIN 并入前块）；标题起始的块永不并入前块，
  // 保证「节」边界在结构感知分块下不被打包步吞掉
  const packed = [];
  for (const unit of units) {
    const last = packed[packed.length - 1];
    const startsWithHeading = HEADING_RE.test(unit.split('\n', 1)[0].trim());
    if (
      last &&
      !startsWithHeading &&
      last.length + unit.length + 1 <= CHUNK_MAX_CHARS &&
      (unit.length < CHUNK_MIN_CHARS || last.length < CHUNK_MIN_CHARS)
    ) {
      packed[packed.length - 1] = `${last}\n${unit}`;
    } else {
      packed.push(unit);
    }
  }

  return packed
    .map((t) => t.trim())
    .filter(Boolean)
    .map((text, seq) => ({ seq, text }));
}

// ---- 向量编码（沿用 memory-vectors 通道；可注入 embed 供测试）----

async function embedTexts(texts, telemetry) {
  const { dashscopeEmbed } = require('./memory-vectors');
  return dashscopeEmbed(texts, telemetry);
}

function vecFromBuf(buf) {
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
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

// ---- FTS 通道 ----

function ftsQueryFromTokens(tokens) {
  return tokens
    .map((t) => `"${t.replace(/"/g, '""')}"`)
    .join(' OR ');
}

function isShortToken(token) {
  // trigram 下限：含 CJK 的 <3 字 token 无法命中；纯 ASCII <3 亦无法命中
  return [...token].length < 3;
}

function splitQueryTokens(query) {
  return String(query || '')
    .trim()
    .split(/[\s,，。;；!？?·、\n]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

function ftsSearchRaw(query, limit) {
  const tokens = splitQueryTokens(query);
  const ftsTokens = tokens.filter((t) => !isShortToken(t));
  const shortTokens = tokens.filter(isShortToken);
  const hits = [];
  const seen = new Set();
  let matchFailed = false;
  const pushRows = (rows) => {
    for (const row of rows) {
      if (seen.has(row.chunk_id)) continue;
      seen.add(row.chunk_id);
      hits.push({ chunkId: row.chunk_id, text: row.fts_text, channels: { fts: hits.length + 1 } });
    }
  };
  if (ftsTokens.length) {
    try {
      const rows = sqlite
        .prepare(
          `SELECT chunk_id, text AS fts_text, bm25(knowledge_chunks_fts) AS rank
           FROM knowledge_chunks_fts WHERE knowledge_chunks_fts MATCH ?
           ORDER BY rank LIMIT ?`
        )
        .all(ftsQueryFromTokens(ftsTokens), limit);
      pushRows(rows);
    } catch {
      // MATCH 语法不可解析（纯符号等）→ 降级 LIKE；BLOCK-94 F5 起诚实标注不再静默
      matchFailed = true;
    }
  }
  if (shortTokens.length) {
    // <3 字短词 trigram 无法索引 → LIKE 子串兜底（D8：万级 chunk 内暴力扫描可接受）
    for (const token of shortTokens) {
      const like = `%${token.replace(/[%_]/g, '')}%`;
      const rows = sqlite
        .prepare(
          `SELECT f.chunk_id AS chunk_id, f.text AS fts_text
           FROM knowledge_chunks_fts f
           WHERE f.text LIKE ?
           LIMIT ?`
        )
        .all(like, limit);
      pushRows(rows);
      if (hits.length >= limit) break;
    }
  }
  return { hits: hits.slice(0, limit), matchFailed };
}

function ftsSearch(query, limit) {
  return ftsSearchRaw(query, limit).hits;
}

// ---- RRF 融合 ----

function fuseRank(vectorHits, ftsHits, topK) {
  const scores = new Map();
  const bump = (key, delta, patch) => {
    const entry = scores.get(key) || { score: 0, channels: {}, entry: patch.entry };
    entry.score += delta;
    Object.assign(entry.channels, patch.channels);
    scores.set(key, entry);
  };
  vectorHits.forEach((hit, idx) => {
    bump(hit.chunkId, 1 / (RRF_K + idx + 1), {
      entry: hit,
      channels: { vector: hit.sim },
    });
  });
  ftsHits.forEach((hit, idx) => {
    bump(hit.chunkId, 1 / (RRF_K + idx + 1), {
      entry: hit,
      channels: { fts: hit.channels ? hit.channels.fts : idx + 1 },
    });
  });
  return [...scores.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map(({ score, channels, entry }) => ({
      chunkId: entry.chunkId,
      docId: entry.docId,
      docName: entry.docName,
      seq: entry.seq,
      text: entry.text,
      score,
      channels,
    }));
}

// BLOCK-94 F6 规模化：规模观测指标（ready chunk 数 + 扫描警戒阈值判定）
function scaleStats() {
  const row = sqlite
    .prepare(
      `SELECT COUNT(*) AS c FROM knowledge_chunks k
       JOIN knowledge_documents d ON d.id = k.doc_id
       WHERE k.space_id = ? AND d.status = 'ready'`
    )
    .get(SPACE_ID);
  const readyChunks = row ? row.c : 0;
  return {
    readyChunks,
    scanWarnThreshold: SCAN_WARN_THRESHOLD,
    scanWarning: readyChunks > SCAN_WARN_THRESHOLD,
  };
}

// ---- 检索入口 ----

// BLOCK-94 F1 嵌入模型一致性：向量 chunk 记录产出模型；换嵌入模型后旧向量隔离并计数暴露（提示重建）
function staleEmbeddingStats() {
  const row = sqlite
    .prepare(
      `SELECT COUNT(*) AS chunks, COUNT(DISTINCT k.doc_id) AS docs
       FROM knowledge_chunks k
       JOIN knowledge_documents d ON d.id = k.doc_id
       WHERE k.space_id = ? AND d.status = 'ready' AND k.embedding IS NOT NULL
         AND (k.model IS NULL OR k.model != ?)`
    )
    .get(SPACE_ID, EMBEDDING_MODEL);
  return { staleChunks: row ? row.chunks : 0, staleDocs: row ? row.docs : 0 };
}

async function searchKnowledge({ query, topK = INJECT_TOPK, embed, docId } = {}) {
  const q = String(query || '').trim();
  const space = getSpace();
  const base = {
    query: q,
    spaceEnabled: !!(space && space.enabled),
    readyChunks: 0,
    hits: [],
    embeddingAvailable: true,
    // BLOCK-94 F5：FTS MATCH 语法失败（纯符号查询等）降级 LIKE 时诚实标注
    ftsDegraded: false,
    // BLOCK-94 F5：按文档过滤（可选）
    docId: docId ? String(docId) : null,
  };
  if (!q || [...q].length < QUERY_MIN_CHARS) return base;

  const docFilter = base.docId ? ' AND k.doc_id = ?' : '';
  const docParams = base.docId ? [base.docId] : [];
  const totalRow = sqlite
    .prepare(
      `SELECT COUNT(*) AS c FROM knowledge_chunks k
       JOIN knowledge_documents d ON d.id = k.doc_id
       WHERE k.space_id = ? AND d.status = 'ready'${docFilter}`
    )
    .get(SPACE_ID, ...docParams);
  base.readyChunks = totalRow ? totalRow.c : 0;
  base.staleEmbedding = staleEmbeddingStats();
  if (base.readyChunks === 0) return base;

  const embedFn = embed || embedTexts;
  let queryVec = null;
  try {
    const vecs = await embedFn([q], { kind: 'knowledge_search' });
    if (Array.isArray(vecs) && vecs[0]) queryVec = vecs[0];
    else base.embeddingAvailable = false;
  } catch (e) {
    base.embeddingAvailable = false;
    base.embeddingError = e && e.message ? e.message : String(e);
  }

  // 向量通道：只扫 ready 文档、当前嵌入模型产出的 chunk（旧模型向量隔离，防跨模型错误相似度）
  let vectorHits = [];
  if (queryVec) {
    const rows = sqlite
      .prepare(
        `SELECT k.id AS chunkId, k.doc_id AS docId, k.seq AS seq, k.text AS text, k.embedding AS embedding,
                d.name AS docName
         FROM knowledge_chunks k
         JOIN knowledge_documents d ON d.id = k.doc_id
         WHERE k.space_id = ? AND d.status = 'ready' AND k.embedding IS NOT NULL AND k.model = ?${docFilter}`
      )
      .all(SPACE_ID, EMBEDDING_MODEL, ...docParams);
    vectorHits = rows
      .map((row) => ({
        chunkId: row.chunkId,
        docId: row.docId,
        docName: row.docName,
        seq: row.seq,
        text: row.text,
        sim: cosineSim(queryVec, vecFromBuf(row.embedding)),
      }))
      .filter((hit) => hit.sim >= VECTOR_THRESHOLD)
      .sort((a, b) => b.sim - a.sim)
      .slice(0, VECTOR_TOPK);
  }

  // FTS 通道：只索引 ready 文档（写入侧保证；查询侧联表再校验一次）
  const ftsRaw = ftsSearchRaw(q, FTS_TOPK);
  // BLOCK-94 F5 降级诚实化：MATCH 语法失败，或查询不含任何字母/数字/CJK（纯符号、无索引可用词）
  base.ftsDegraded =
    ftsRaw.matchFailed || splitQueryTokens(q).every((t) => !/[\p{L}\p{N}]/u.test(t));
  const ftsHits = [];
  for (const hit of ftsRaw.hits) {
    const row = sqlite
      .prepare(
        `SELECT k.id AS chunkId, k.doc_id AS docId, k.seq AS seq, k.text AS text, d.name AS docName
         FROM knowledge_chunks k
         JOIN knowledge_documents d ON d.id = k.doc_id
         WHERE k.id = ? AND d.status = 'ready'${docFilter}`
      )
      .get(hit.chunkId, ...docParams);
    if (row) {
      ftsHits.push({ ...row, channels: { fts: hit.channels.fts } });
    }
  }

  base.hits = fuseRank(vectorHits, ftsHits, topK);
  return base;
}

// ---- 注入块 ----

function buildPromptBlock(hits, maxChars = INJECT_MAX_CHARS) {
  if (!Array.isArray(hits) || hits.length === 0) return { block: '', usedChars: 0 };
  let body = '';
  let used = 0;
  for (const hit of hits) {
    const channelLabel =
      hit.channels.vector != null && hit.channels.fts != null
        ? '向量+全文'
        : hit.channels.fts != null
          ? '全文'
          : '向量';
    const head = `\n— 《${hit.docName || hit.docId}》第 ${hit.seq + 1} 块 [${channelLabel}]\n`;
    const text = String(hit.text || '').slice(0, 900);
    if (used + head.length + text.length > maxChars) break;
    body += head + text;
    used += head.length + text.length;
  }
  if (!body) return { block: '', usedChars: 0 };
  const block =
    '\n\n=== 知识空间检索结果（用户上传知识库，回答相关问题时优先依据；与题无关时忽略） ===' +
    body +
    '\n=== 知识空间检索结果结束（如需更多细节可调用 knowledge_search 工具深查） ===';
  return { block, usedChars: used };
}

// ---- D4 轻按需：agent 每 turn 自动召回（启用才检索；无命中不注入任何内容）----

async function buildAgentTurnBlock(query, { embed, docId } = {}) {
  const space = getSpace();
  if (!space || !space.enabled) return { block: '', usedChars: 0, hitCount: 0, hits: [] };
  const result = await searchKnowledge({ query, topK: INJECT_TOPK, embed, docId });
  const { block, usedChars } = buildPromptBlock(result.hits);
  // BLOCK-94 F5：citations 溯源数据（注入了哪些块），前端渲染「知识溯源」条
  const hits = result.hits.map((h) => ({
    docId: h.docId,
    docName: h.docName,
    seq: h.seq,
    channels: h.channels,
  }));
  return { block, usedChars, hitCount: result.hits.length, hits };
}

// ---- BLOCK-94 F1 挂点收敛：agent-runner 与 ai-agent/chat 的同构注入逻辑单源化 ----
// 纯去重零行为变更：取最新 user 消息（剥 [附件…] 前缀）→ 启用且命中才拼接注入块。
// embed 可注入供契约测试；任何内部失败静默零注入（与原两处 catch {} 语义一致）。

async function buildTurnInjection(systemPrompt, messages, { embed } = {}) {
  let knowledgeTokens = 0;
  let citations = [];
  try {
    const latestUserMsg = [...(Array.isArray(messages) ? messages : [])]
      .reverse()
      .find((m) => m && m.role === 'user' && typeof m.content === 'string');
    const cleanQuery = latestUserMsg
      ? latestUserMsg.content.replace(/^\[[^\]]+\]\s*\n?/, '').trim()
      : '';
    if (cleanQuery) {
      const knowledgeTurn = await buildAgentTurnBlock(cleanQuery, { embed });
      if (knowledgeTurn.block) {
        systemPrompt += knowledgeTurn.block;
        knowledgeTokens = Math.ceil(knowledgeTurn.usedChars / 4);
        citations = knowledgeTurn.hits || [];
      }
    }
  } catch {}
  return { systemPrompt, knowledgeTokens, citations };
}

// ---- D10 删除语义：单事务清库，两通道同灭；原始文件随后移除 ----

function deleteDocument(docId) {
  const doc = getDocument(docId);
  if (!doc) throw new Error('knowledge_document_not_found');
  const tx = sqlite.transaction(() => {
    sqlite
      .prepare('DELETE FROM knowledge_chunks_fts WHERE chunk_id IN (SELECT id FROM knowledge_chunks WHERE doc_id = ?)')
      .run(docId);
    sqlite.prepare('DELETE FROM knowledge_chunks WHERE doc_id = ?').run(docId);
    sqlite.prepare('DELETE FROM knowledge_documents WHERE id = ?').run(docId);
  });
  tx();
  try {
    fs.rmSync(docDir(docId), { recursive: true, force: true });
  } catch (e) {
    // 索引已一致删除；原始文件移除失败如实留痕，不假删
    console.log('[knowledge] raw file cleanup failed for', docId, e && e.message);
  }
  return { deleted: docId, name: doc.name };
}

function clearSpace() {
  const docs = listDocuments();
  const tx = sqlite.transaction(() => {
    sqlite.prepare('DELETE FROM knowledge_chunks_fts').run();
    sqlite.prepare('DELETE FROM knowledge_chunks WHERE space_id = ?').run(SPACE_ID);
    sqlite.prepare('DELETE FROM knowledge_documents WHERE space_id = ?').run(SPACE_ID);
  });
  tx();
  try {
    fs.rmSync(knowledgeRoot(), { recursive: true, force: true });
  } catch (e) {
    console.log('[knowledge] root cleanup failed:', e && e.message);
  }
  return { cleared: docs.length };
}

module.exports = {
  SPACE_ID,
  EMBEDDING_DIM,
  EMBEDDING_MODEL,
  VECTOR_THRESHOLD,
  VECTOR_TOPK,
  FTS_TOPK,
  INJECT_TOPK,
  INJECT_MAX_CHARS,
  RRF_K,
  CHUNK_MAX_CHARS,
  CHUNK_OVERLAP_CHARS,
  CHUNK_MIN_CHARS,
  QUERY_MIN_CHARS,
  DOC_STATUS,
  knowledgeRoot,
  docDir,
  getSpace,
  setSpaceEnabled,
  listDocuments,
  listDocumentsPage,
  getDocument,
  setDocumentStatus,
  staleEmbeddingStats,
  scaleStats,
  SCAN_WARN_THRESHOLD,
  chunkText,
  embedTexts,
  cosineSim,
  ftsSearch,
  splitQueryTokens,
  fuseRank,
  searchKnowledge,
  buildPromptBlock,
  buildAgentTurnBlock,
  buildTurnInjection,
  deleteDocument,
  clearSpace,
};
