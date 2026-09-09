/**
 * routes/knowledge.js — BLOCK-69 知识空间 REST 面
 *
 * D6：启用状态单一真相 = DB（knowledge_spaces.enabled），前端经端点读写。
 * D9：「打开知识目录」入口返回 knowledgeRoot 供前端经既有 reveal 通道打开。
 * D7：embeddingAvailable 诚实呈现（DashScope key 未配置时前端渲染诚实空态）。
 */

const express = require('express');
const multer = require('multer');
const ks = require('../helpers/knowledge-space');
const ingest = require('../helpers/knowledge-ingest');
const { getAiSettings } = require('../helpers/ai-settings');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: ingest.MAX_DOCUMENT_BYTES, files: 12 },
  fileFilter: (_req, file, cb) => {
    cb(null, true); // 支持性校验在 createDocument fail-closed 完成（逐文件诚实 error）
  },
}).array('files', 12);

function embeddingAvailable() {
  try {
    const settings = getAiSettings();
    return !!(settings && settings.credential_status && settings.credential_status.dashscope);
  } catch {
    return false;
  }
}

function docView(doc) {
  return {
    id: doc.id,
    name: doc.name,
    kind: doc.kind,
    size: doc.size,
    status: doc.status,
    error: doc.error,
    chunkCount: doc.chunk_count,
    createdAt: doc.created_at,
    updatedAt: doc.updated_at,
  };
}

module.exports = function mountKnowledge(app) {
  // 空间总览：空间行 + 文档清单 + 嵌入可用性 + 存储位置（D9）
  app.get('/api/knowledge/space', async (req, res) => {
    try {
      const space = ks.getSpace();
      res.json({
        status: 'ok',
        space: space
          ? {
              id: space.id,
              name: space.name,
              enabled: !!space.enabled,
              embeddingModel: space.embedding_model,
            }
          : null,
        documents: ks.listDocuments().map(docView),
        embeddingAvailable: embeddingAvailable(),
        knowledgeDir: ks.knowledgeRoot(),
        queueDepth: ingest.ingestQueueDepth(),
      });
    } catch (e) {
      res.status(500).json({ status: 'error', error: e.message });
    }
  });

  // 开关（D6：启用即生效的单一真相）
  app.post('/api/knowledge/space', express.json({ limit: '4kb' }), async (req, res) => {
    try {
      const enabled = !!(req.body && req.body.enabled);
      // D7：无 key 时拒绝假启用
      if (enabled && !embeddingAvailable()) {
        return res.status(409).json({
          status: 'error',
          error: 'knowledge_embed_unavailable（嵌入模型不可用：请先在设置中配置 DashScope key）',
        });
      }
      const space = ks.setSpaceEnabled(enabled);
      res.json({ status: 'ok', space: { id: space.id, name: space.name, enabled: !!space.enabled } });
    } catch (e) {
      res.status(500).json({ status: 'error', error: e.message });
    }
  });

  // 上传（多选；逐文件 fail-closed，失败文件以 error 项返回不整批失败）
  app.post('/api/knowledge/documents', (req, res) => {
    upload(req, res, async (err) => {
      if (err) return res.status(400).json({ status: 'error', error: err.message });
      const files = Array.isArray(req.files) ? req.files : [];
      if (files.length === 0) return res.status(400).json({ status: 'error', error: '未选择文件' });
      const accepted = [];
      const rejected = [];
      for (const file of files) {
        try {
          const doc = await ingest.createDocument({
            name: file.originalname,
            buffer: file.buffer,
            mime: file.mimetype,
          });
          accepted.push(docView(doc));
        } catch (e) {
          rejected.push({ name: file.originalname, error: e.message });
        }
      }
      res.json({ status: 'ok', accepted, rejected });
    });
  });

  // 摄取状态（前端轮询）
  app.get('/api/knowledge/documents', async (req, res) => {
    try {
      res.json({ status: 'ok', documents: ks.listDocuments().map(docView), queueDepth: ingest.ingestQueueDepth() });
    } catch (e) {
      res.status(500).json({ status: 'error', error: e.message });
    }
  });

  // D10：文档级删除（单事务，两通道同灭）
  app.delete('/api/knowledge/documents/:id', async (req, res) => {
    try {
      res.json({ status: 'ok', ...ks.deleteDocument(req.params.id) });
    } catch (e) {
      res.status(e.message === 'knowledge_document_not_found' ? 404 : 500).json({ status: 'error', error: e.message });
    }
  });

  // 单文档重建索引（解析质量差时重跑管道）
  app.post('/api/knowledge/documents/:id/reindex', async (req, res) => {
    try {
      const doc = await ingest.reindexDocument(req.params.id);
      res.json({ status: 'ok', document: doc ? docView(doc) : null });
    } catch (e) {
      res.status(e.message === 'knowledge_document_not_found' ? 404 : 500).json({ status: 'error', error: e.message });
    }
  });

  // D10：清空空间（前端两步确认后调用）
  app.post('/api/knowledge/space/clear', async (req, res) => {
    try {
      res.json({ status: 'ok', ...ks.clearSpace() });
    } catch (e) {
      res.status(500).json({ status: 'error', error: e.message });
    }
  });

  // 检索测试框（D6：摄取质量可自证）
  app.post('/api/knowledge/search', express.json({ limit: '16kb' }), async (req, res) => {
    try {
      const { query, topK } = req.body || {};
      const result = await ks.searchKnowledge({ query, topK: topK || ks.INJECT_TOPK });
      res.json({
        status: 'ok',
        query: result.query,
        hits: result.hits.map((hit) => ({
          docId: hit.docId,
          docName: hit.docName,
          seq: hit.seq,
          score: hit.score,
          channels: hit.channels,
          text: String(hit.text || '').slice(0, 600),
        })),
        readyChunks: result.readyChunks,
        embeddingAvailable: result.embeddingAvailable,
        embeddingError: result.embeddingError || null,
      });
    } catch (e) {
      res.status(500).json({ status: 'error', error: e.message });
    }
  });
};
