'use strict';

/**
 * routes/harness/notices.js — BLOCK-78 P2-⑤ 项目持久通知读面
 *
 *   GET  /api/harness/notices?projectId=X&unread=1&limit=50
 *     → { ok, projectId, unread, notices: [...] }
 *   POST /api/harness/notices/seen  { projectId }
 *     → { ok, marked }
 *
 * 通知是事件留痕（append-only + 项目级已读确认）；作业/agent 真相仍在
 * 各自状态机，本读面只回答「有什么是你还没读过的」。
 */

const { getProjectNoticeStore } = require('../../helpers/project-notice-store');

module.exports = {
  register(app) {
    app.get('/api/harness/notices', (req, res) => {
      try {
        const projectId = String((req.query && req.query.projectId) || '').trim();
        if (!projectId) {
          return res.status(400).json({ ok: false, error: 'projectId_required' });
        }
        const unreadOnly = String((req.query && req.query.unread) || '') === '1';
        const limit = parseInt((req.query && req.query.limit) || '50', 10);
        const store = getProjectNoticeStore();
        const notices = store.listNotices({ projectId, unreadOnly, limit });
        return res.json({ ok: true, projectId, unread: store.unreadCount(projectId), notices });
      } catch (error) {
        return res.status(500).json({ ok: false, error: 'notices_failed', message: error.message });
      }
    });

    app.post('/api/harness/notices/seen', (req, res) => {
      try {
        const body = req.body || {};
        const projectId = String(body.projectId || '').trim();
        if (!projectId) {
          return res.status(400).json({ ok: false, error: 'projectId_required' });
        }
        const marked = getProjectNoticeStore().markAllSeen(projectId);
        return res.json({ ok: true, projectId, marked });
      } catch (error) {
        return res.status(500).json({ ok: false, error: 'notices_seen_failed', message: error.message });
      }
    });
  },
};
