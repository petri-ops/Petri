/**
 * helpers/memory-vectors.js — SEMANTIC_SEARCH_v1 (Layer 3b vector retrieval)
 *
 * Extracted from server.js (Phase 8.6 helper modularization).
 * Pure module: depends on ../db, uuid, and process.env.DASHSCOPE_API_KEY.
 *
 * For AI usage telemetry, dashscopeEmbed will call
 *   globalThis._biof3.recordAiUsage(...)
 * if available (server.js sets this up). Falls back to noop otherwise.
 *
 * Public API:
 *   dashscopeEmbed(texts, telemetry) → Promise<Float32Array[]|null>
 *   saveMemoryVector({userId, kind, refId, page, pageTitle, content, vec, ts, conversationId})
 *   cosineSim(a, b)
 *   retrieveMemories(userId, queryVec, k, threshold)
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
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_memvec_user ON memory_vectors(user_id, ts DESC);
  CREATE INDEX IF NOT EXISTS idx_memvec_user_kind ON memory_vectors(user_id, kind);
`);

const EMBEDDING_DIM = 1024;
const EMBEDDING_MODEL = 'text-embedding-v3';
const RETRIEVE_TOPK = 3;
const RETRIEVE_THRESHOLD = 0.55;
const RETRIEVE_MAX_CHARS = 1500;
const MAX_CONTENT_LEN = 1500;
const TURN_MIN_CHARS = 30;

function _recordAiUsage(args) {
  try {
    const fn = (globalThis._biof3 && globalThis._biof3.recordAiUsage) || globalThis._biof3RecordAiUsage;
    if (typeof fn === 'function') fn(args);
  } catch {}
}

/** Call DashScope to embed an array of texts. Returns array of Float32Array, or null. */
async function dashscopeEmbed(texts, _telemetry) {
  const _t = _telemetry || {};
  const _start = Date.now();
  const { getApiKey } = require('./ai-settings');
  const apiKey = getApiKey('dashscope');
  if (!apiKey) return null;
  if (!Array.isArray(texts) || texts.length === 0) return [];
  const truncated = texts.map(t => (t || '').slice(0, MAX_CONTENT_LEN));
  const _approxTokens = truncated.reduce((s, t) => s + Math.ceil((t || '').length * 0.7), 0);
  const body = JSON.stringify({
    model: EMBEDDING_MODEL,
    input: {texts: truncated},
  });
  return new Promise((resolve) => {
    const https = require('https');
    let buf = '';
    const r = https.request({
      hostname: 'dashscope.aliyuncs.com',
      port: 443,
      path: '/api/v1/services/embeddings/text-embedding/text-embedding',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey,
        'Content-Length': Buffer.byteLength(body),
      },
      agent: false,
      timeout: 30000,
    }, (res) => {
      res.setEncoding('utf8');
      res.on('data', c => buf += c);
      res.on('end', () => {
        try {
          if (res.statusCode !== 200) {
            console.log('[embed] HTTP', res.statusCode, buf.slice(0,200));
            _recordAiUsage({userId: _t.userId, kind: _t.kind || 'embedding', model: EMBEDDING_MODEL, promptTokens: _approxTokens, latencyMs: Date.now() - _start, errorCode: 'http_' + res.statusCode, conversationId: _t.conversationId});
            resolve(null); return;
          }
          const j = JSON.parse(buf);
          const arr = j?.output?.embeddings;
          if (!Array.isArray(arr)) { resolve(null); return; }
          arr.sort((a, b) => (a.text_index || 0) - (b.text_index || 0));
          const out = arr.map(e => Float32Array.from(e.embedding));
          _recordAiUsage({userId: _t.userId, kind: _t.kind || 'embedding', model: EMBEDDING_MODEL, promptTokens: _approxTokens, latencyMs: Date.now() - _start, conversationId: _t.conversationId});
          resolve(out);
        } catch (e) {
          console.log('[embed] parse err:', e.message);
          resolve(null);
        }
      });
      res.on('error', () => resolve(null));
    });
    r.on('error', (e) => { console.log('[embed] req err:', e.message); resolve(null); });
    r.on('timeout', () => { try { r.destroy(); } catch{} resolve(null); });
    r.write(body);
    r.end();
  });
}

function _bufFromVec(vec) {
  return Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength);
}
function _vecFromBuf(buf) {
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}

function saveMemoryVector({userId, kind, refId, page, pageTitle, content, vec, ts, conversationId}) {
  if (!userId || !vec || !content) return;
  const id = 'mem_' + uuidv4().slice(0, 12);
  sqlite.prepare(`INSERT INTO memory_vectors(id, user_id, kind, ref_id, page, page_title, content, embedding, ts, created_at, conversation_id)
              VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, userId, kind, refId || null, page || null, pageTitle || null, content, _bufFromVec(vec),
         ts || new Date().toISOString(), new Date().toISOString(), conversationId || null);
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
function retrieveMemories(userId, queryVec, k = RETRIEVE_TOPK, threshold = RETRIEVE_THRESHOLD) {
  if (!userId || !queryVec) return [];
  const rows = sqlite.prepare('SELECT id, kind, ref_id, page, page_title, content, embedding, ts FROM memory_vectors WHERE user_id = ?').all(userId);
  if (rows.length === 0) return [];
  const scored = rows.map(r => {
    const v = _vecFromBuf(r.embedding);
    const sim = cosineSim(queryVec, v);
    return {sim, row: r};
  });
  scored.sort((a, b) => b.sim - a.sim);
  return scored
    .filter(s => s.sim >= threshold)
    .slice(0, k)
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
    if (used + head.length + body.length > RETRIEVE_MAX_CHARS) break;
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
async function indexLatestTurn(userId, messages, page, pageTitle) {
  if (!userId || !Array.isArray(messages) || messages.length < 2) return;
  const last = messages[messages.length - 1];
  const prev = messages[messages.length - 2];
  const turn = makeTurnText(prev, last);
  if (!turn || turn.length < TURN_MIN_CHARS) return;
  const vecs = await dashscopeEmbed([turn]);
  if (!vecs || !vecs[0]) return;
  saveMemoryVector({
    userId, kind: 'chat_turn', refId: null,
    page, pageTitle, content: turn, vec: vecs[0],
  });
  console.log('[mem-vec] indexed turn for user', userId, 'len', turn.length);
}

/** Embed a query and retrieve hits. Returns block string ready for prompt injection. */
async function retrieveForPrompt(userId, queryText) {
  if (!userId || !queryText) return '';
  const vecs = await dashscopeEmbed([queryText], {userId});
  if (!vecs || !vecs[0]) return '';
  const hits = retrieveMemories(userId, vecs[0]);
  return buildRetrievalBlock(hits);
}

module.exports = {
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
