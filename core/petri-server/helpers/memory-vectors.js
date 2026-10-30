/**
 * helpers/memory-vectors.js — SEMANTIC_SEARCH_v1 (Layer 3b vector retrieval)
 *
 * Extracted from server.js (Phase 8.6 helper modularization).
 * Embedding calls route through the shared Model Gateway.
 *
 * Public API:
 *   dashscopeEmbed(texts, telemetry) → Promise<Float32Array[]|null>
 *   saveMemoryVector({userId, projectId, kind, refId, page, pageTitle, content, vec, ts, conversationId})
 *   cosineSim(a, b)
 *   retrieveMemories(userId, queryVec, k, threshold, projectId)
 *   buildRetrievalBlock(hits)
 *   makeTurnText(prevMsg, curMsg)
 *   indexLatestTurn(userId, messages, page, pageTitle)
 *   retrieveForPrompt(userId, queryText)
 *   Constants: EMBEDDING_DIM, EMBEDDING_MODEL, RETRIEVE_TOPK, RETRIEVE_THRESHOLD, RETRIEVE_MAX_CHARS, MAX_CONTENT_LEN, TURN_MIN_CHARS
 */

const dbMod = require('../db');
const sqlite = dbMod.getDatabase();
const {v4: uuidv4} = require('uuid');

// One-time table create (idempotent)
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS memory_vectors (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    ref_id TEXT,
    page TEXT,
    page_title TEXT,
    content TEXT NOT NULL,
    embedding BLOB NOT NULL,
    ts TEXT NOT NULL,
    created_at TEXT NOT NULL,
    conversation_id TEXT,
    project_id TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_memvec_user ON memory_vectors(user_id, ts DESC);
  CREATE INDEX IF NOT EXISTS idx_memvec_user_kind ON memory_vectors(user_id, kind);
`);
try { sqlite.exec('ALTER TABLE memory_vectors ADD COLUMN conversation_id TEXT'); } catch {}
try { sqlite.exec('ALTER TABLE memory_vectors ADD COLUMN project_id TEXT'); } catch {}
try { sqlite.exec('CREATE INDEX IF NOT EXISTS idx_memvec_project ON memory_vectors(user_id, project_id, ts DESC)'); } catch {}
try {
  sqlite.exec(`
    UPDATE memory_vectors
    SET project_id = (
      SELECT c.project_id FROM copilot_conversations c
      WHERE c.id = memory_vectors.conversation_id
    )
    WHERE project_id IS NULL
      AND conversation_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM copilot_conversations c
        WHERE c.id = memory_vectors.conversation_id
          AND c.project_id IS NOT NULL
      )
  `);
} catch {}

const { EMBEDDING_DIM, acceptedEmbeddingVectors } = require('./embedding-dim-guard');
const EMBEDDING_MODEL = 'text-embedding-v3';
// BLOCK-205（W6）— 检索/上限参数改由 `helpers/memory-policy` 供（默认值逐字等于原常量）。
const memoryPolicy = require('./memory-policy');
const RETRIEVE_TOPK = memoryPolicy.DEFAULTS.memoryTopK;
const RETRIEVE_THRESHOLD = memoryPolicy.DEFAULTS.memoryThreshold;
const RETRIEVE_MAX_CHARS = memoryPolicy.DEFAULTS.memoryMaxChars;
const MAX_CONTENT_LEN = memoryPolicy.DEFAULTS.memoryMaxChars;
const TURN_MIN_CHARS = 30;

/** Compatibility name; resolves the configured embedding role through the Gateway. */
async function dashscopeEmbed(texts, _telemetry) {
  if (!Array.isArray(texts) || texts.length === 0) return [];
  const { modelGateway } = require('./model-gateway');
  const result = await modelGateway.embed({
    texts: texts.map((text) => (text || '').slice(0, memoryPolicy.memorySettings().maxChars)),
    telemetry: _telemetry || {},
  });
  return acceptedEmbeddingVectors(result);
}

function _bufFromVec(vec) {
  return Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength);
}
function _vecFromBuf(buf) {
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}

function saveMemoryVector({userId, projectId, kind, refId, page, pageTitle, content, vec, ts, conversationId}) {
  if (!userId || !vec || !content) return;
  const id = 'mem_' + uuidv4().slice(0, 12);
  sqlite.prepare(`INSERT INTO memory_vectors(id, user_id, kind, ref_id, page, page_title, content, embedding, ts, created_at, conversation_id, project_id)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, userId, kind, refId || null, page || null, pageTitle || null, content, _bufFromVec(vec),
         ts || new Date().toISOString(), new Date().toISOString(), conversationId || null,
         projectId ? String(projectId) : null);
}

/** Cosine similarity between two Float32Arrays. */
function cosineSim(a, b) {
  let dot = 0, na = 0, nb = 0;
  const n = a.length;
  for (let i = 0; i < n; i++) {
    const x = a[i], y = b[i];
    dot += x * y; na += x * x; nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / Math.sqrt(na * nb);
}

/** Retrieve top-K most similar memory entries for a user against a query vector. */
function retrieveMemories(userId, queryVec, k, threshold, projectId = null) {
  const settings = memoryPolicy.memorySettings();
  const topK = k === undefined ? settings.topK : k;
  const minScore = threshold === undefined ? settings.threshold : threshold;
  if (!userId || !queryVec) return [];
  const rows = projectId
    ? sqlite.prepare('SELECT id, kind, ref_id, page, page_title, content, embedding, ts FROM memory_vectors WHERE user_id = ? AND project_id = ?').all(userId, String(projectId))
    : sqlite.prepare("SELECT id, kind, ref_id, page, page_title, content, embedding, ts FROM memory_vectors WHERE user_id = ? AND COALESCE(project_id, '') = ''").all(userId);
  if (rows.length === 0) return [];
  const scored = rows.map(r => {
    const v = _vecFromBuf(r.embedding);
    const sim = cosineSim(queryVec, v);
    return {sim, row: r};
  });
  scored.sort((a, b) => b.sim - a.sim);
  return scored
    .filter(s => s.sim >= minScore)
    .slice(0, topK)
    .map(s => ({sim: s.sim, ...s.row, embedding: undefined}));
}

/** Build a citation block from retrieved memories — for system prompt injection. */
function buildRetrievalBlock(hits) {
  if (!hits || hits.length === 0) return '';
  let out = '';
  let used = 0;
  for (const h of hits) {
    const when = h.ts ? new Date(h.ts).toLocaleDateString('zh-CN') : '';
    const where = h.page_title || h.page || '';
    const kindLabel = h.kind === 'analysis_summary' ? '分析记录'
                    : h.kind === 'ai_interpret'    ? 'AI 解读'
                    :                                '历史对话';
    const score = '相关度' + Math.round(h.sim * 100) + '%';
    const head = '\n— ' + kindLabel + (when ? ' (' + when + ')' : '') + (where ? ' · ' + where : '') + ' [' + score + ']\n';
    const body = h.content.slice(0, 500);
    // BLOCK-205（W6）— 召回块字符上限也走策略（原 RETRIEVE_MAX_CHARS 常量）
    if (used + head.length + body.length > memoryPolicy.memorySettings().maxChars) break;
    out += head + body;
    used += head.length + body.length;
  }
  return out;
}

/** Aggregate latest two messages into a single "turn" string. */
function makeTurnText(prevMsg, curMsg) {
  const u = (prevMsg && prevMsg.role === 'user') ? prevMsg.content : (curMsg && curMsg.role === 'user' ? curMsg.content : null);
  const a = (curMsg && curMsg.role === 'assistant') ? curMsg.content : null;
  if (u && a) return '用户: ' + u + '\n\nAI: ' + a;
  if (u) return '用户: ' + u;
  if (a) return 'AI: ' + a;
  return '';
}

/** After a chat completes, embed the just-finished turn and persist. */
async function indexLatestTurn(userId, messages, page, pageTitle, projectId = null) {
  if (!userId || !Array.isArray(messages) || messages.length < 2) return;
  const last = messages[messages.length - 1];
  const prev = messages[messages.length - 2];
  const turn = makeTurnText(prev, last);
  if (!turn || turn.length < TURN_MIN_CHARS) return;
  const vecs = await dashscopeEmbed([turn]);
  if (!vecs || !vecs[0]) return;
  saveMemoryVector({
    userId, projectId, kind: 'chat_turn', refId: null,
    page, pageTitle, content: turn, vec: vecs[0],
  });
  console.log('[mem-vec] indexed turn for user', userId, 'len', turn.length);
}

/** Embed a query and retrieve hits. Returns block string ready for prompt injection. */
async function retrieveForPrompt(userId, queryText, projectId = null) {
  if (!userId || !queryText) return '';
  const vecs = await dashscopeEmbed([queryText], {userId});
  if (!vecs || !vecs[0]) return '';
  const hits = retrieveMemories(userId, vecs[0], RETRIEVE_TOPK, RETRIEVE_THRESHOLD, projectId);
  return buildRetrievalBlock(hits);
}

module.exports = {
  acceptedEmbeddingVectors,
  dashscopeEmbed,
  saveMemoryVector,
  cosineSim,
  retrieveMemories,
  buildRetrievalBlock,
  makeTurnText,
  indexLatestTurn,
  retrieveForPrompt,
  EMBEDDING_DIM,
  EMBEDDING_MODEL,
  RETRIEVE_TOPK,
  RETRIEVE_THRESHOLD,
  RETRIEVE_MAX_CHARS,
  MAX_CONTENT_LEN,
  TURN_MIN_CHARS,
};
