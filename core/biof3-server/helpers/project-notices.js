'use strict';

/**
 * helpers/project-notices.js — BLOCK-78 P2-⑤ 项目持久通知（唯一账本）
 *
 * 项目作用域的通知存储：跨会话/跨重启存活，重开后告知「离开期间发生了什么」。
 * 写点收敛在终态转换处（当前仅 markJobFailed 的失败终态；后续 kind 随写点
 * 增长），读面供摘要卡「注意」节未读徽标消费。
 *
 * 单一真值纪律：通知是事件留痕（append-only + 已读标记），不是第二套
 * 作业/agent 状态——状态真相仍在 tool_jobs / tasks / 进程表，读面照常
 * 直接查真相，本表只回答「有什么是你还没读过/确认过的」。
 *
 * 容量治理：read 通知保留最近 200 条（写入时顺带修剪）；unread 不修剪。
 */

const TTL_PRUNE_KEEP_READ = 200;

function ensureTable(sqlite) {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS project_notices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      detail TEXT,
      created_at TEXT NOT NULL,
      read_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_project_notices_proj ON project_notices(project_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_project_notices_unread ON project_notices(project_id, read_at);
  `);
}

function createProjectNoticeStore(sqlite) {
  ensureTable(sqlite);

  /** best-effort 写入：失败仅告警，绝不阻断作业/终态链路。 */
  function insertNotice({ projectId, kind, title, detail }) {
    try {
      if (!projectId || !kind || !title) return null;
      const info = sqlite
        .prepare('INSERT INTO project_notices (project_id, kind, title, detail, created_at) VALUES (?,?,?,?,?)')
        .run(projectId, String(kind), String(title), detail ? String(detail).slice(0, 500) : null, new Date().toISOString());
      pruneRead();
      return Number(info.lastInsertRowid) || null;
    } catch (e) {
      console.warn('[project-notices] insert failed:', e && e.message);
      return null;
    }
  }

  function pruneRead() {
    try {
      sqlite.exec(`
        DELETE FROM project_notices
        WHERE read_at IS NOT NULL
          AND id NOT IN (SELECT id FROM project_notices WHERE read_at IS NOT NULL ORDER BY created_at DESC, id DESC LIMIT ${TTL_PRUNE_KEEP_READ})
      `);
    } catch { /* 修剪失败无碍 */ }
  }

  function listNotices({ projectId, unreadOnly = false, limit = 50 } = {}) {
    if (!projectId) return [];
    const cap = Math.max(1, Math.min(200, Number(limit) || 50));
    const rows = sqlite
      .prepare(`SELECT id, project_id AS projectId, kind, title, detail, created_at AS createdAt, read_at AS readAt
        FROM project_notices WHERE project_id = ? ${unreadOnly ? 'AND read_at IS NULL' : ''}
        ORDER BY created_at DESC, id DESC LIMIT ?`)
      .all(projectId, cap);
    return rows;
  }

  function unreadCount(projectId) {
    if (!projectId) return 0;
    const row = sqlite
      .prepare('SELECT COUNT(*) AS n FROM project_notices WHERE project_id = ? AND read_at IS NULL')
      .get(projectId);
    return row ? Number(row.n) || 0 : 0;
  }

  /** 全部标记已读（v1 语义：项目级确认，不分条）。返回标记条数。 */
  function markAllSeen(projectId) {
    if (!projectId) return 0;
    const info = sqlite
      .prepare("UPDATE project_notices SET read_at = ? WHERE project_id = ? AND read_at IS NULL")
      .run(new Date().toISOString(), projectId);
    return Number(info.changes) || 0;
  }

  return { insertNotice, listNotices, unreadCount, markAllSeen };
}

module.exports = { createProjectNoticeStore, ensureTable, TTL_PRUNE_KEEP_READ };
