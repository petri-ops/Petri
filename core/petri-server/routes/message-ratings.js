'use strict';

/**
 * BLOCK-246 C4 —— 消息评价 HTTP 面（`/api/message-ratings`）。
 *
 * - PUT    /api/message-ratings      body: { messageKey, rating: 'up'|'down'|null, reason?, conversationId?, projectId? }
 *                                    → 200 { ok, rating } | 400 { ok:false, error }
 * - GET    /api/message-ratings/:key → 200 { ok, rating } | 404
 *
 * 校验单源在 shared-backend/message-rating-store（路由不写第二套阈值）。
 */

const express = require('express');

module.exports = function registerMessageRatings(app) {
  const getStore = () => {
    const db = require('../db').getDatabase();
    const { createMessageRatingStore } = require('../../shared-backend/message-rating-store');
    return createMessageRatingStore(db);
  };

  app.put('/api/message-ratings', express.json({ limit: '8kb' }), (req, res) => {
    try {
      const result = getStore().set(req.body || {});
      if (result.ok === false) return res.status(400).json({ ok: false, error: result.error });
      return res.json({ ok: true, rating: result.rating });
    } catch (error) {
      return res.status(500).json({ ok: false, error: 'message_rating_failed', message: error.message });
    }
  });

  app.get('/api/message-ratings/:key', (req, res) => {
    try {
      const rating = getStore().get(String(req.params.key || ''));
      if (!rating) return res.status(404).json({ ok: false, error: 'message_rating_not_found' });
      return res.json({ ok: true, rating });
    } catch (error) {
      return res.status(500).json({ ok: false, error: 'message_rating_read_failed', message: error.message });
    }
  });
};
