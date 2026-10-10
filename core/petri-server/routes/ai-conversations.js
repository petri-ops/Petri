/**
 * routes/ai-conversations.js — multi-conversation support endpoints.
 * Migrated from server.js as part of MODULES_BATCH1_v1.
 *
 * Uses the Promise facade over desktop SQLite for route handlers.
 */
const express = require('express');
const dbMod = require('../db');
const adb = dbMod.getAsyncDatabase();
let _projectColumnReady = null;

function _newConvId() {
  const {v4: uuidv4} = require('uuid');
  return 'conv_' + uuidv4().slice(0, 12);
}

function _projectIdFromReq(req) {
  const raw = (req.query && req.query.project_id) || (req.body && (req.body.project_id || req.body.projectId));
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed ? trimmed.slice(0, 120) : null;
}

function ensureProjectColumn() {
  if (!_projectColumnReady) {
    _projectColumnReady = (async () => {
      try { await adb.prepare('ALTER TABLE copilot_conversations ADD COLUMN project_id TEXT').run(); } catch {}
      try { await adb.prepare('CREATE INDEX IF NOT EXISTS idx_conv_project ON copilot_conversations(user_id, project_id, status, updated_at DESC)').run(); } catch {}
    })();
  }
  return _projectColumnReady;
}

module.exports = function mountConversations(app) {
  async function updateConversation(req, res) {
    const userId = req.user && req.user.id;
    if (!userId) return res.status(401).json({status:'error', error:'未授权'});
    try {
      const row = await adb.prepare('SELECT id FROM copilot_conversations WHERE id=? AND user_id=?').get(req.params.id, userId);
      if (!row) return res.status(404).json({status:'error', error:'not_found'});
      const sets = []; const values = [];
      if (req.body && typeof req.body.title === 'string') { sets.push('title=?'); values.push(req.body.title.slice(0, 100)); }
      if (req.body && (req.body.status === 'active' || req.body.status === 'archived')) { sets.push('status=?'); values.push(req.body.status); }
      if (sets.length === 0) return res.status(400).json({status:'error', error:'no_updates'});
      sets.push('updated_at=?'); values.push(new Date().toISOString());
      values.push(req.params.id, userId);
      await adb.prepare(`UPDATE copilot_conversations SET ${sets.join(', ')} WHERE id=? AND user_id=?`).run(...values);
      res.json({status:'ok'});
    } catch (e) { res.status(500).json({status:'error', error: e.message}); }
  }

  app.get('/api/ai/conversations', async (req, res) => {
    const userId = req.user && req.user.id;
    if (!userId) return res.status(401).json({status:'error', error:'未授权'});
    try {
      await ensureProjectColumn();
      const status = (req.query.status === 'archived') ? 'archived' : (req.query.status === 'all' ? null : 'active');
      const projectId = _projectIdFromReq(req);
      // BLOCK-88 P2（D3）— 默认视图隔离：联邦委托会话（origin='federation-delegation'）
      // 不混入宿主默认会话列表；?includeFederated=1 显式查看（独立可见可清理）。
      const includeFederated = req.query.includeFederated === '1';
      const cols = 'id, title, status, last_page, project_id, message_count, created_at, updated_at, last_topic_shift_at, last_topic_shift_reason, parent_id, origin';
      const where = ['user_id=?'];
      const values = [userId];
      if (status) { where.push('status=?'); values.push(status); }
      if (projectId) { where.push('project_id=?'); values.push(projectId); }
      // BLOCK-88 P3：includeFederated=1 且未指定项目时跨项目列出（含已绑定项目的
      // 联邦委托会话——它们 project_id 非空，会被下方空项目子句挡掉）。
      else if (!includeFederated) where.push("COALESCE(project_id, '')=''");
      if (!includeFederated) where.push("(origin IS NULL OR origin != 'federation-delegation')");
      const rows = await adb.prepare(`SELECT ${cols} FROM copilot_conversations WHERE ${where.join(' AND ')} ORDER BY updated_at DESC LIMIT 100`).all(...values);
      res.json({status:'ok', conversations: rows});
    } catch (e) { res.status(500).json({status:'error', error: e.message}); }
  });

  app.post('/api/ai/conversations', express.json({limit: '8kb'}), async (req, res) => {
    const userId = req.user && req.user.id;
    if (!userId) return res.status(401).json({status:'error', error:'未授权'});
    try {
      await ensureProjectColumn();
      const id = _newConvId();
      const now = new Date().toISOString();
      const title = String((req.body && req.body.title) || '新对话').slice(0, 100);
      const lastPage = (req.body && req.body.lastPage) || null;
      const projectId = _projectIdFromReq(req);
      await adb.prepare('INSERT INTO copilot_conversations(id, user_id, title, status, last_page, project_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)')
        .run(id, userId, title, 'active', lastPage, projectId, now, now);
      res.json({status:'ok', conversation: {id, title, status:'active', last_page: lastPage, project_id: projectId, message_count: 0, created_at: now, updated_at: now}});
    } catch (e) { res.status(500).json({status:'error', error: e.message}); }
  });

  app.get('/api/ai/conversations/:id', async (req, res) => {
    const userId = req.user && req.user.id;
    if (!userId) return res.status(401).json({status:'error', error:'未授权'});
    try {
      const row = await adb.prepare('SELECT * FROM copilot_conversations WHERE id=? AND user_id=?').get(req.params.id, userId);
      if (!row) return res.status(404).json({status:'error', error:'not_found'});
      res.json({status:'ok', conversation: row});
    } catch (e) { res.status(500).json({status:'error', error: e.message}); }
  });

  // POST update (workaround for nginx PATCH bug — same body shape as PATCH)
  app.post('/api/ai/conversations/:id/update', express.json({limit: '8kb'}), updateConversation);

  // PATCH compatibility route retained for older clients.
  app.patch('/api/ai/conversations/:id', express.json({limit: '8kb'}), updateConversation);

  app.delete('/api/ai/conversations/:id', async (req, res) => {
    const userId = req.user && req.user.id;
    if (!userId) return res.status(401).json({status:'error', error:'未授权'});
    try {
      const row = await adb.prepare('SELECT id FROM copilot_conversations WHERE id=? AND user_id=?').get(req.params.id, userId);
      if (!row) return res.status(404).json({status:'error', error:'not_found'});
      try { await adb.prepare('DELETE FROM memory_vectors WHERE conversation_id=? AND user_id=?').run(req.params.id, userId); } catch {}
      await adb.prepare('DELETE FROM copilot_messages WHERE conversation_id=?').run(req.params.id);
      await adb.prepare('DELETE FROM copilot_conversations WHERE id=? AND user_id=?').run(req.params.id, userId);
      res.json({status:'ok'});
    } catch (e) { res.status(500).json({status:'error', error: e.message}); }
  });

  app.get('/api/ai/conversations/:id/messages', async (req, res) => {
    const userId = req.user && req.user.id;
    if (!userId) return res.status(401).json({status:'error', error:'未授权'});
    try {
      const conv = await adb.prepare('SELECT id FROM copilot_conversations WHERE id=? AND user_id=?').get(req.params.id, userId);
      if (!conv) return res.status(404).json({status:'error', error:'not_found'});
      const limit = Math.max(1, Math.min(500, parseInt(req.query.limit) || 100));
      // BLOCK-95 A1 — 游标分页：默认返回最新 limit 条（修复旧语义「最旧 limit 条」
      // 导致长会话看不到最近消息）；?before=<rowid> 向上取更旧一页。
      // 游标用 rowid 而非 ts：fork 会话全部消息同 ts（同 now 批量插入），ts 游标会丢页。
      const before = req.query.before ? Math.max(1, parseInt(req.query.before, 10) || 0) : 0;
      const pageSql = 'SELECT id, role, content, meta_json, ts, rowid AS _rid FROM copilot_messages WHERE conversation_id=?'
        + (before ? ' AND rowid < ?' : '')
        + ' ORDER BY rowid DESC LIMIT ?';
      const pageArgs = before ? [req.params.id, before, limit + 1] : [req.params.id, limit + 1];
      const rows = await adb.prepare(pageSql).all(...pageArgs);
      const hasMore = rows.length > limit;
      const page = rows.slice(0, limit);
      page.reverse(); // 展示序 = 时间升序
      let windowOffset = 0;
      let nextBefore = null;
      if (page.length > 0) {
        const minRid = page[0]._rid;
        if (hasMore) nextBefore = minRid;
        const cnt = await adb.prepare('SELECT COUNT(*) AS c FROM copilot_messages WHERE conversation_id=? AND rowid < ?').get(req.params.id, minRid);
        windowOffset = cnt.c;
      }
      const items = page.map(r => {
        const { _rid, ...rest } = r;
        return {...rest, meta: r.meta_json ? (() => { try { return JSON.parse(r.meta_json); } catch { return null; } })() : null};
      });
      // BLOCK-95 B2/A5 — 压缩留痕诚实可见：会话存在 compaction 记录时随信封下发，
      // 前端在信息流展示「上下文压缩视图」标记卡（DB 原文始终可见）。
      let compaction = null;
      try {
        const cRow = await adb.prepare('SELECT summary, covers_count, source_tokens, updated_at FROM conversation_compaction WHERE conversation_id=?').get(req.params.id);
        if (cRow) {
          compaction = {
            summary: cRow.summary,
            coversCount: cRow.covers_count,
            sourceTokens: cRow.source_tokens,
            updatedAt: cRow.updated_at,
          };
        }
      } catch {}
      res.json({status:'ok', messages: items, hasMore, nextBefore, windowOffset, total: windowOffset + items.length, compaction});
    } catch (e) { res.status(500).json({status:'error', error: e.message}); }
  });

  // UI-444 — 会话导出 Markdown：配 preload files.downloadFromUrl（静默落 Downloads，
  // 点击即下载心智）。组合逻辑单源在 helpers/conversation-export.js（纯函数可测）。
  app.get('/api/ai/conversations/:id/export.md', async (req, res) => {
    const userId = req.user && req.user.id;
    if (!userId) return res.status(401).json({status:'error', error:'未授权'});
    try {
      const conv = await adb.prepare('SELECT id, title, project_id, created_at FROM copilot_conversations WHERE id=? AND user_id=?').get(req.params.id, userId);
      if (!conv) return res.status(404).json({status:'error', error:'not_found'});
      const rows = await adb.prepare('SELECT role, content, ts FROM copilot_messages WHERE conversation_id=? ORDER BY rowid ASC').all(req.params.id);
      const { composeConversationMarkdown } = require('../helpers/conversation-export');
      const markdown = composeConversationMarkdown({ conversation: conv, messages: rows });
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="conversation-export.md"');
      res.status(200).send(markdown);
    } catch (e) { res.status(500).json({status:'error', error: e.message}); }
  });

  // BLOCK-95 B2 — 手动触发会话压缩（同步等待摘要生成；开关关时诚实 409）。
  app.post('/api/ai/conversations/:id/compact', async (req, res) => {
    const userId = req.user && req.user.id;
    if (!userId) return res.status(401).json({status:'error', error:'未授权'});
    const { isSessionCompactionEnabled, compactConversationNow } = require('../helpers/conversation-compaction');
    if (!isSessionCompactionEnabled(process.env)) {
      return res.status(409).json({status:'error', error:'session compaction disabled'});
    }
    try {
      const conv = await adb.prepare('SELECT id FROM copilot_conversations WHERE id=? AND user_id=?').get(req.params.id, userId);
      if (!conv) return res.status(404).json({status:'error', error:'not_found'});
      const sqliteSync = dbMod.getDatabase();
      const result = await compactConversationNow({ userId, conversationId: req.params.id, sqlite: sqliteSync });
      if (!result.ok) {
        return res.json({status:'ok', compacted:false, reason: result.reason});
      }
      res.json({status:'ok', compacted:true, compaction: {
        summary: result.compaction.summary,
        coversCount: result.compaction.covers_count,
        sourceTokens: result.compaction.source_tokens,
        updatedAt: result.compaction.updated_at,
      }, detail: result.detail});
    } catch (e) { res.status(500).json({status:'error', error: e.message}); }
  });

  app.post('/api/ai/conversations/:id/dismiss-topic-shift', async (req, res) => {
    const userId = req.user && req.user.id;
    if (!userId) return res.status(401).json({status:'error', error:'未授权'});
    try {
      const r = await adb.prepare('UPDATE copilot_conversations SET last_topic_shift_at=NULL, last_topic_shift_reason=NULL WHERE id=? AND user_id=?').run(req.params.id, userId);
      if (r.changes === 0) return res.status(404).json({status:'error', error:'not_found'});
      res.json({status:'ok'});
    } catch (e) { res.status(500).json({status:'error', error: e.message}); }
  });

  // POST /api/ai/conversations/:id/fork — create a new conversation from an existing one
  // Optional body.untilIndex: if provided (0-based), only copy messages up to that index (inclusive).
  app.post('/api/ai/conversations/:id/fork', express.json({limit: '8kb'}), async (req, res) => {
    const userId = req.user && req.user.id;
    if (!userId) return res.status(401).json({status:'error', error:'未授权'});
    try {
      const source = await adb.prepare('SELECT * FROM copilot_conversations WHERE id=? AND user_id=?').get(req.params.id, userId);
      if (!source) return res.status(404).json({status:'error', error:'not_found'});

      const forkId = _newConvId();
      const now = new Date().toISOString();
      const title = String((req.body && req.body.title) || source.title + ' (分支)').slice(0, 100);
      const lastPage = source.last_page || null;
      const projectId = source.project_id || null;
      const parentId = source.id;

      await adb.prepare('INSERT INTO copilot_conversations(id, user_id, title, status, last_page, project_id, parent_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)')
        .run(forkId, userId, title, 'active', lastPage, projectId, parentId, now, now);

      // Copy messages — optionally limited by untilIndex (0-based, inclusive).
      // When not specified, all messages are copied (existing behaviour).
      const untilIndex = (req.body && typeof req.body.untilIndex === 'number') ? Math.max(0, Math.floor(req.body.untilIndex)) : null;
      const messages = await adb.prepare('SELECT role, content, meta_json FROM copilot_messages WHERE conversation_id=? ORDER BY ts ASC').all(req.params.id);
      const messagesToCopy = (untilIndex !== null && untilIndex < messages.length) ? messages.slice(0, untilIndex + 1) : messages;
      if (messagesToCopy.length > 0) {
        const stmt = adb.prepare('INSERT INTO copilot_messages(id, conversation_id, role, content, meta_json, ts) VALUES (?,?,?,?,?,?)');
        for (const msg of messagesToCopy) {
          const msgId = 'msg_' + require('uuid').v4().slice(0, 12);
          stmt.run(msgId, forkId, msg.role, msg.content, msg.meta_json, now);
        }
      }

      await adb.prepare('UPDATE copilot_conversations SET message_count=? WHERE id=?').run(messagesToCopy.length, forkId);

      res.json({
        status: 'ok',
        conversation: {
          id: forkId,
          title,
          status: 'active',
          last_page: lastPage,
          project_id: projectId,
          message_count: messagesToCopy.length,
          created_at: now,
          updated_at: now,
          parent_id: parentId,
        }
      });
    } catch (e) { res.status(500).json({status:'error', error: e.message}); }
  });
};
