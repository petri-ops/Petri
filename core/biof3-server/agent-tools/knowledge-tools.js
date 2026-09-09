/**
 * agent-tools/knowledge-tools.js — BLOCK-69 知识空间 agent 工具面
 *
 * D4「深按需」：knowledge_search 让模型在推理中主动检索知识库（可多轮、可换关键词）；
 * knowledge_status 让模型感知空间开关与文档就绪状态。
 * 只读检索：category=retrieval / sideEffect=none / R0 —— 所有访问档位可用。
 */

const ks = require('../helpers/knowledge-space');

const MAX_HITS = 8;
const HIT_TEXT_CHARS = 700;

async function tool_knowledge_search(args, ctx) {
  const query = String((args && args.query) || '').trim();
  if (!query) {
    return { error: 'query_required', message: 'knowledge_search 需要非空 query。' };
  }
  const topK = Math.max(1, Math.min(MAX_HITS, (args && args.topK) || ks.INJECT_TOPK));
  const result = await ks.searchKnowledge({ query, topK });

  if (!result.spaceEnabled && result.hits.length === 0) {
    return {
      spaceEnabled: false,
      hits: [],
      message: '知识空间未启用或无命中。若用户期望检索其上传知识库，请提示在右侧「知识空间」面板启用并上传文档。',
    };
  }
  if (result.readyChunks === 0) {
    return {
      spaceEnabled: result.spaceEnabled,
      hits: [],
      message: '知识空间当前没有已就绪的文档（尚未上传或仍在摄取中）。',
    };
  }
  if (!result.embeddingAvailable && result.hits.length === 0) {
    return {
      spaceEnabled: result.spaceEnabled,
      embeddingAvailable: false,
      hits: [],
      message: '嵌入模型不可用（DashScope key 未配置或调用失败），仅全文通道可用且本次无命中。',
    };
  }
  return {
    spaceEnabled: result.spaceEnabled,
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

function tool_knowledge_status() {
  const space = ks.getSpace();
  const docs = ks.listDocuments();
  const byStatus = {};
  for (const doc of docs) {
    byStatus[doc.status] = (byStatus[doc.status] || 0) + 1;
  }
  return {
    spaceEnabled: !!(space && space.enabled),
    documentCount: docs.length,
    byStatus,
    documents: docs.slice(0, 20).map((doc) => ({
      name: doc.name,
      status: doc.status,
      chunks: doc.chunk_count,
      error: doc.error || undefined,
    })),
  };
}

module.exports = { tool_knowledge_search, tool_knowledge_status };
