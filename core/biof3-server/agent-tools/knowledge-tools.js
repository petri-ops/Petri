/**
 * agent-tools/knowledge-tools.js — BLOCK-69 知识空间 agent 工具面
 *
 * D4「深按需」：knowledge_search 让模型在推理中主动检索知识库（可多轮、可换关键词）；
 * knowledge_status 让模型感知空间开关与文档就绪状态。
 * 只读检索：category=retrieval / sideEffect=none / R0 —— 所有访问档位可用。
 */

const ks = require('../helpers/knowledge-space');
const { getDatabase } = require('../db');

const MAX_HITS = 8;
const HIT_TEXT_CHARS = 700;

async function tool_knowledge_search(args, ctx) {
  const query = String((args && args.query) || '').trim();
  if (!query) {
    return { error: 'query_required', message: 'knowledge_search 需要非空 query。' };
  }
  // BLOCK-99 G4 — 可选 spaceId（管理会话台跨空间检索；缺省 ks_default 零行为变更）。
  // plan §6 验收语义：目标空间开关关闭 = 该空间对 agent 整体不可见（自动召回与工具层同门）。
  let spaceId = ks.SPACE_ID;
  if (args && args.spaceId != null && String(args.spaceId).trim() !== '') {
    try {
      spaceId = ks.resolveSpaceId(args.spaceId);
    } catch (e) {
      return { error: e.code || 'space_not_found', message: `目标知识空间不存在：${args.spaceId}` };
    }
  }
  const space = ks.getSpace(spaceId);
  if (!space || !space.enabled) {
    return {
      spaceEnabled: false,
      hits: [],
      message: `知识空间「${space ? space.name : spaceId}」未启用，无法检索。可在知识空间面板启用，或（管理台中）用 knowledge_space_enable 启用。`,
    };
  }
  const topK = Math.max(1, Math.min(MAX_HITS, (args && args.topK) || ks.INJECT_TOPK));
  const result = await ks.searchKnowledge({ query, topK, spaceId });

  if (result.readyChunks === 0) {
    return {
      spaceEnabled: true,
      hits: [],
      message: '知识空间已启用，但当前没有已就绪的文档（尚未上传或仍在摄取中）。',
    };
  }
  if (!result.embeddingAvailable && result.hits.length === 0) {
    return {
      spaceEnabled: true,
      embeddingAvailable: false,
      hits: [],
      message: '嵌入模型不可用（DashScope key 未配置或调用失败），仅全文通道可用且本次无命中。',
    };
  }
  return {
    spaceEnabled: true,
    embeddingAvailable: result.embeddingAvailable,
    readyChunks: result.readyChunks,
    hits: result.hits.map((hit) => ({
      document: hit.docName,
      chunk: hit.seq + 1,
      score: Number(hit.score.toFixed(4)),
      channels: hit.channels,
      text: String(hit.text || '').slice(0, HIT_TEXT_CHARS),
    })),
  };
}

function tool_knowledge_status(args) {
  // BLOCK-99 G4 — 可选 spaceId（缺省 ks_default 零行为变更）
  let spaceId = ks.SPACE_ID;
  if (args && args.spaceId != null && String(args.spaceId).trim() !== '') {
    try {
      spaceId = ks.resolveSpaceId(args.spaceId);
    } catch (e) {
      return { error: e.code || 'space_not_found', message: `目标知识空间不存在：${args.spaceId}` };
    }
  }
  const space = ks.getSpace(spaceId);
  const docs = ks.listDocuments(spaceId);
  const byStatus = {};
  for (const doc of docs) {
    byStatus[doc.status] = (byStatus[doc.status] || 0) + 1;
  }
  return {
    spaceId,
    spaceName: space ? space.name : spaceId,
    spaceEnabled: !!(space && space.enabled),
    documentCount: docs.length,
    byStatus,
    documents: docs.slice(0, 20).map((doc) => ({
      id: doc.id,
      name: doc.name,
      status: doc.status,
      chunks: doc.chunk_count,
      error: doc.error || undefined,
    })),
  };
}

// BLOCK-94 F5（D6 裁决=做）：按文档深读——knowledge_search 命中后可整篇读取指定文档的分块原文。
// 只读检索：category=retrieval / sideEffect=none / R0。
const READ_MAX_CHUNKS = 50;
const READ_CHUNK_CHARS = 800;

async function tool_knowledge_read(args) {
  const docId = String((args && args.docId) || '').trim();
  if (!docId) {
    return { error: 'doc_id_required', message: 'knowledge_read 需要 docId（可先经 knowledge_search 命中结果获取）。' };
  }
  // BLOCK-99 G4 — 可选 spaceId（跨空间深读；缺省 ks_default 零行为变更）
  let spaceId = ks.SPACE_ID;
  if (args && args.spaceId != null && String(args.spaceId).trim() !== '') {
    try {
      spaceId = ks.resolveSpaceId(args.spaceId);
    } catch (e) {
      return { error: e.code || 'space_not_found', message: `目标知识空间不存在：${args.spaceId}` };
    }
  }
  const space = ks.getSpace(spaceId);
  if (!space || !space.enabled) {
    return {
      spaceEnabled: false,
      message: `知识空间「${space ? space.name : spaceId}」未启用，无法读取。`,
    };
  }
  const doc = ks.getDocument(docId);
  if (!doc || doc.space_id !== spaceId) {
    return { error: 'knowledge_document_not_found', message: `文档不存在：${docId}` };
  }
  if (doc.status !== 'ready') {
    return { error: 'knowledge_document_not_ready', message: `文档尚未就绪（当前状态：${doc.status}）。` };
  }
  const rows = getDatabase()
    .prepare('SELECT seq, text FROM knowledge_chunks WHERE doc_id = ? ORDER BY seq ASC LIMIT ?')
    .all(docId, READ_MAX_CHUNKS);
  return {
    spaceEnabled: true,
    document: { id: doc.id, name: doc.name, chunks: doc.chunk_count },
    truncated: doc.chunk_count > rows.length ? rows.length : undefined,
    chunks: rows.map((row) => ({ seq: row.seq, text: String(row.text || '').slice(0, READ_CHUNK_CHARS) })),
  };
}

module.exports = { tool_knowledge_search, tool_knowledge_status, tool_knowledge_read };
