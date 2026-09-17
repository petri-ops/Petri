/**
 * routes/knowledge.js — BLOCK-69 知识空间 REST 面
 *
 * D6：启用状态单一真相 = DB（knowledge_spaces.enabled），前端经端点读写。
 * D9：「打开知识目录」入口返回 knowledgeRoot 供前端经既有 reveal 通道打开。
 * D7：embeddingAvailable 诚实呈现（DashScope key 未配置时前端渲染诚实空态）。
 */

const express = require('express');
const fs = require('fs');
const multer = require('multer');
const sqlite = require('../db').getDatabase();
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
  // BLOCK-94 F1 启动恢复：重启后中间态文档（uploaded/parsing/chunking/embedding）自动重排入队
  ingest.recoverInterruptedIngest();

  // 空间总览：空间行 + 文档清单（分页）+ 嵌入可用性 + 存储位置（D9）+ 嵌入模型失配统计
  app.get('/api/knowledge/space', async (req, res) => {
    try {
      const space = ks.getSpace();
      const page = ks.listDocumentsPage({
        limit: req.query.docLimit,
        offset: req.query.docOffset,
      });
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
        documents: page.documents.map(docView),
        documentsTotal: page.total,
        documentsHasMore: page.hasMore,
        documentsLimit: page.limit,
        documentsOffset: page.offset,
        // BLOCK-94 F1：换嵌入模型后旧模型向量被隔离，>0 时前端提示重建
        staleEmbedding: ks.staleEmbeddingStats(),
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

  // BLOCK-94 F3：粘贴文本直接入库（D4 裁决=做；URL 网页摄取评估结论=本期不做）
  app.post('/api/knowledge/documents/paste', express.json({ limit: '2mb' }), async (req, res) => {
    try {
      const text = String((req.body && req.body.text) || '');
      if (!text.trim()) {
        return res.status(400).json({ status: 'error', error: '粘贴内容为空' });
      }
      const rawName = String((req.body && req.body.name) || '').trim();
      const baseName = rawName || `粘贴文本-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '')}`;
      const name = baseName.toLowerCase().endsWith('.txt') ? baseName : `${baseName}.txt`;
      const doc = await ingest.createDocument({
        name,
        buffer: Buffer.from(text, 'utf8'),
        mime: 'text/plain',
      });
      res.json({ status: 'ok', document: docView(doc) });
    } catch (e) {
      const code = e.message === 'knowledge_document_too_large' ? 413 : 500;
      res.status(code).json({ status: 'error', error: e.message });
    }
  });

  // 摄取状态（前端轮询；BLOCK-94 F1 分页）
  app.get('/api/knowledge/documents', async (req, res) => {
    try {
      const page = ks.listDocumentsPage({ limit: req.query.limit, offset: req.query.offset });
      res.json({
        status: 'ok',
        documents: page.documents.map(docView),
        total: page.total,
        hasMore: page.hasMore,
        limit: page.limit,
        offset: page.offset,
        queueDepth: ingest.ingestQueueDepth(),
      });
    } catch (e) {
      res.status(500).json({ status: 'error', error: e.message });
    }
  });

  // BLOCK-94 F1：failed 文档批量重试（原始文件缺失的逐项诚实跳过）
  app.post('/api/knowledge/documents/retry-failed', async (req, res) => {
    try {
      const result = ingest.retryFailedDocuments();
      res.json({
        status: 'ok',
        requeued: result.requeued,
        skipped: result.skipped,
        queueDepth: ingest.ingestQueueDepth(),
      });
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

  // BLOCK-94 F4：文档预览（索引分块全文 + 原始文件位置；打开原文件走既有 files.openPath 通道）
  app.get('/api/knowledge/documents/:id/preview', async (req, res) => {
    try {
      const doc = ks.getDocument(req.params.id);
      if (!doc) return res.status(404).json({ status: 'error', error: 'knowledge_document_not_found' });
      const chunks = sqlite
        .prepare('SELECT seq, text FROM knowledge_chunks WHERE doc_id = ? ORDER BY seq ASC')
        .all(doc.id);
      const rawPath = doc.raw_path || ks.docDir(doc.id) + '/' + doc.name;
      res.json({
        status: 'ok',
        document: docView(doc),
        chunks,
        rawPath,
        rawAvailable: fs.existsSync(rawPath),
      });
    } catch (e) {
      res.status(500).json({ status: 'error', error: e.message });
    }
  });

  // BLOCK-94 F4：批量删除（单事务逐文档两通道同灭；不存在项诚实列出）
  app.post('/api/knowledge/documents/batch-delete', express.json({ limit: '64kb' }), async (req, res) => {
    try {
      const ids = Array.isArray(req.body && req.body.ids) ? req.body.ids.map(String) : [];
      if (ids.length === 0) return res.status(400).json({ status: 'error', error: '未选择文档' });
      if (ids.length > 200) return res.status(400).json({ status: 'error', error: '单批最多 200 篇' });
      const deleted = [];
      const missing = [];
      for (const id of ids) {
        try {
          deleted.push((ks.deleteDocument(id)).deleted);
        } catch (e) {
          if (e.message === 'knowledge_document_not_found') missing.push(id);
          else throw e;
        }
      }
      res.json({ status: 'ok', deleted, missing });
    } catch (e) {
      res.status(500).json({ status: 'error', error: e.message });
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

  // 检索测试框（D6：摄取质量可自证；BLOCK-94 F5：docId 过滤 + 降级诚实标注）
  app.post('/api/knowledge/search', express.json({ limit: '16kb' }), async (req, res) => {
    try {
      const { query, topK, docId } = req.body || {};
      const result = await ks.searchKnowledge({
        query,
        topK: topK || ks.INJECT_TOPK,
        docId: docId ? String(docId) : undefined,
      });
      res.json({
        status: 'ok',
        query: result.query,
        docId: result.docId,
        hits: result.hits.map((hit) => ({
          docId: hit.docId,
          docName: hit.docName,
          seq: hit.seq,
          score: hit.score,
          channels: hit.channels,
          text: String(hit.text || '').slice(0, 600),
        })),
        readyChunks: result.readyChunks,
        ftsDegraded: !!result.ftsDegraded,
        // searchKnowledge 未实际尝试嵌入（无 ready chunk 早退）时以凭据检查为准，避免假 true
        embeddingAvailable: result.readyChunks === 0 ? embeddingAvailable() : result.embeddingAvailable,
        embeddingError: result.embeddingError || null,
      });
    } catch (e) {
      res.status(500).json({ status: 'error', error: e.message });
    }
  });
};
