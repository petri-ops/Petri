'use strict';

/**
 * BLOCK-246 C13 —— 速记板 HTTP 面（`/api/scratchpad`）。
 *
 * 只做 HTTP 翻译：参数解析、状态码、错误文案透传。上限与清洗单源在
 * `core/shared-backend/scratchpad-store.js`（normalizeScratchpadInput），
 * 路由不重复实现第二套校验。
 *
 * 端点：
 * - GET    /api/scratchpad?query=&limit=&offset=  → { ok, entries, total, limit, offset }
 * - POST   /api/scratchpad                        → 201 { ok, entry } | 400 { ok:false, error }
 * - DELETE /api/scratchpad/:entryId               → 204 | 404
 *
 * 为什么图片体积上限在 store 而不在 express 的 body limit：express.json 的 limit 一旦
 * 触发会给用户一个英文 413，无法说明"压缩后再存"；这里把上限交给用户可读的校验，
 * body limit 只作为最后一道防爆护栏（略高于校验上限）。
 */

const express = require('express');

module.exports = function registerScratchpad(app) {
  // 惰性取库：与 routes/index.js 其他模块一致（单例连接，测试可替换 PETRI_DB_PATH）。
  const getStore = () => {
    const db = require('../db').getDatabase();
    const { createScratchpadStore } = require('../../shared-backend/scratchpad-store');
    return createScratchpadStore(db);
  };

  app.get('/api/scratchpad', (req, res) => {
    try {
      const store = getStore();
      const result = store.list({
        query: typeof req.query.query === 'string' ? req.query.query : '',
        limit: req.query.limit,
        offset: req.query.offset,
      });
      return res.json({ ok: true, ...result });
    } catch (error) {
      return res.status(500).json({ ok: false, error: 'scratchpad_list_failed', message: error.message });
    }
  });

  app.post('/api/scratchpad', express.json({ limit: '3mb' }), (req, res) => {
    try {
      const store = getStore();
      const result = store.create(req.body || {});
      if (result.ok === false) {
        return res.status(400).json({ ok: false, error: result.error });
      }
      return res.status(201).json({ ok: true, entry: result.entry });
    } catch (error) {
      return res.status(500).json({ ok: false, error: 'scratchpad_create_failed', message: error.message });
    }
  });

  app.delete('/api/scratchpad/:entryId', (req, res) => {
    try {
      const store = getStore();
      const removed = store.remove(String(req.params.entryId || ''));
      if (!removed) return res.status(404).json({ ok: false, error: 'scratchpad_entry_not_found' });
      return res.status(204).end();
    } catch (error) {
      return res.status(500).json({ ok: false, error: 'scratchpad_delete_failed', message: error.message });
    }
  });
};
