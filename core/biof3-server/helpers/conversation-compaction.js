'use strict';

/**
 * helpers/conversation-compaction.js — BLOCK-95 B2 会话级 rolling compaction。
 *
 * 红线（plan §4 原则 1「压缩诚实可见」）：
 *   - DB（copilot_messages）原文永不删改——compaction 只作用于发给 LLM 的视图层；
 *   - 每次压缩在 conversation_compaction 表留痕，前端经 messages 信封读到并展示
 *     诚实标记卡（A5）；
 *   - 阈值自动（后台异步，请求路径零延迟）+ 手动触发（POST /:id/compact 同步）。
 *
 * 视图语义：rowid <= covers_rowid 的历史 turns 以摘要参与 LLM 视图（其后消息原样）。
 * 开关：BIOF3_SESSION_COMPACTION=1/true（默认关）；仅在 B1 后端拼装（BIOF3_SERVER_HISTORY_ASSEMBLY）
 * 生效时应用——拼装权在后端是投影的架构前提。
 */

const COMPACTION_ENV = 'BIOF3_SESSION_COMPACTION';
// 触发阈值：历史 token 估算超过该值且消息数超过 MIN_MESSAGES 时折叠旧 turns
const COMPACTION_TRIGGER_TOKENS = 12000;
const MIN_MESSAGES = 24;
// 保留原样的最近消息数（rolling 窗口）
const KEEP_RECENT = 12;
// 摘要输入预算（超长源按行裁剪，摘要 LLM 调用自身的上限保护）
const SUMMARY_SOURCE_CHAR_BUDGET = 60000;

function isSessionCompactionEnabled(env) {
  const raw = (env && env[COMPACTION_ENV]) || '';
  return raw === '1' || raw === 'true';
}

/**
 * 读当前 compaction 记录（同步 sqlite facade）。
 */
function getCompactionSync(sqlite, conversationId) {
  try {
    return sqlite.prepare('SELECT * FROM conversation_compaction WHERE conversation_id=?').get(conversationId) || null;
  } catch {
    return null;
  }
}

/**
 * 视图层投影：rowid <= covers_rowid 的历史替换为一条摘要 user 消息。
 * @param {Array<{role,content,rowid?}>} assembled B1 拼装结果（须带 rowid）
 * @param {{summary:string, covers_rowid:number}|null} compaction
 * @returns {Array<{role,content}>} 投影后的 messages（不含 rowid）
 */
function applyCompactionView(assembled, compaction) {
  if (!compaction || !Array.isArray(assembled) || assembled.length === 0) {
    return assembled.map(({ rowid, ...rest }) => rest);
  }
  const covered = assembled.filter((m) => typeof m.rowid === 'number' && m.rowid <= compaction.covers_rowid);
  const rest = assembled.filter((m) => !(typeof m.rowid === 'number' && m.rowid <= compaction.covers_rowid));
  if (covered.length === 0) return assembled.map(({ rowid, ...rest2 }) => rest2);
  const summaryMessage = {
    role: 'user',
    content: '[会话早期对话摘要（原文详见会话记录）]\n' + compaction.summary + '\n[以上为摘要，此后为原文消息]',
  };
  return [summaryMessage, ...rest.map(({ rowid, ...rest2 }) => rest2)];
}

/**
 * 计算折叠计划：返回 {should, coveredRows, keepRows, sourceTokens}。
 */
function planCompaction(rows, countMessages) {
  if (!Array.isArray(rows) || rows.length <= KEEP_RECENT) return { should: false };
  const { countMessages: count } = require('./token-estimator');
  const est = countMessages || count;
  const sourceTokens = est(rows.map((r) => ({ role: r.role, content: String(r.content || '') })));
  if (sourceTokens < COMPACTION_TRIGGER_TOKENS || rows.length < MIN_MESSAGES) return { should: false, sourceTokens };
  const splitAt = rows.length - KEEP_RECENT;
  return {
    should: true,
    sourceTokens,
    coveredRows: rows.slice(0, splitAt),
    keepRows: rows.slice(splitAt),
  };
}

/**
 * 执行压缩（生成摘要并落库）。同步等待 LLM——手动触发用；
 * 自动触发由调用方包后台（不阻塞请求路径）。
 * @returns {Promise<{ok:boolean, compaction?:object, reason?:string}>}
 */
async function compactConversationNow({ userId, conversationId, sqlite, telemetryExtra }) {
  if (!userId || !conversationId || !sqlite) return { ok: false, reason: 'missing_args' };
  const rows = sqlite.prepare(
    'SELECT rowid, role, content, ts FROM copilot_messages WHERE conversation_id=? ORDER BY rowid ASC'
  ).all(conversationId);
  const plan = planCompaction(rows);
  if (!plan.should) return { ok: false, reason: plan.sourceTokens != null ? 'below_threshold' : 'too_few_messages' };

  // 摘要源（含角色与时间线；超预算时从头部裁剪，保留最近语境）
  let lines = plan.coveredRows.map((m) => `${m.role === 'user' ? '用户' : 'AI'}: ${String(m.content || '')}`);
  let joined = lines.join('\n\n');
  if (joined.length > SUMMARY_SOURCE_CHAR_BUDGET) {
    joined = joined.slice(joined.length - SUMMARY_SOURCE_CHAR_BUDGET);
  }

  const existing = getCompactionSync(sqlite, conversationId);
  const { callModelTask } = require('./model-tasks');
  const result = await callModelTask({
    role: 'summary',
    messages: [
      {
        role: 'system',
        content: '你是会话上下文压缩助手。把较早的对话折叠成中文要点摘要，供后续对话作为背景。保留：用户的任务目标、已做过的关键决定、重要结论、用过的参数/文件/实体名、未完成事项。要求：不超过 500 字；"- " 列表；时间顺序；与已有摘要合并而非重复；保留专有名词与数字。',
      },
      {
        role: 'user',
        content: existing
          ? '已有摘要：\n' + existing.summary + '\n\n新增较早对话：\n' + joined + '\n\n请输出合并后的新摘要。'
          : '请总结以下较早的对话：\n' + joined,
      },
    ],
    temperature: 0.3,
    maxTokens: 800,
    telemetry: { userId, kind: 'session_compaction', conversationId, ...(telemetryExtra || {}) },
  });
  const summary = result && typeof result.text === 'string' ? result.text.trim() : '';
  if (!summary) return { ok: false, reason: 'empty_summary' };

  const covers = plan.coveredRows[plan.coveredRows.length - 1];
  const nowIso = new Date().toISOString();
  sqlite.prepare(`
    INSERT INTO conversation_compaction(conversation_id, user_id, summary, covers_rowid, covers_count, source_tokens, model, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?)
    ON CONFLICT(conversation_id) DO UPDATE SET
      summary=excluded.summary, covers_rowid=excluded.covers_rowid, covers_count=excluded.covers_count,
      source_tokens=excluded.source_tokens, model=excluded.model, updated_at=excluded.updated_at
  `).run(conversationId, userId, summary, covers.rowid, plan.coveredRows.length, plan.sourceTokens, result.model || null, nowIso, nowIso);

  return {
    ok: true,
    compaction: getCompactionSync(sqlite, conversationId),
    detail: { covered: plan.coveredRows.length, keep: plan.keepRows.length, sourceTokens: plan.sourceTokens },
  };
}

/**
 * 自动触发检查（后台执行，不阻塞请求路径）：
 * 历史超阈值且无未覆盖增量（rowid > covers_rowid 的未压缩消息 token 超过增量阈值）时重新压缩。
 */
function maybeCompactInBackground({ userId, conversationId, sqlite }) {
  if (!isSessionCompactionEnabled(process.env)) return;
  try {
    const rows = sqlite.prepare(
      'SELECT rowid, role, content, ts FROM copilot_messages WHERE conversation_id=? ORDER BY rowid ASC'
    ).all(conversationId);
    const plan = planCompaction(rows);
    if (!plan.should) return;
    const existing = getCompactionSync(sqlite, conversationId);
    if (existing && existing.covers_rowid >= (plan.coveredRows[plan.coveredRows.length - 1] || {}).rowid) return;
    // 后台：await 由 setImmediate 链独立消化，失败静默（下次请求再试）
    setImmediate(() => {
      compactConversationNow({ userId, conversationId, sqlite })
        .then((r) => {
          if (r.ok) {
            try { console.log('[block95-b2] compaction updated conv=' + conversationId + ' covered=' + r.detail.covered); } catch {}
          }
        })
        .catch(() => {});
    });
  } catch {}
}

module.exports = {
  COMPACTION_ENV,
  COMPACTION_TRIGGER_TOKENS,
  MIN_MESSAGES,
  KEEP_RECENT,
  isSessionCompactionEnabled,
  getCompactionSync,
  applyCompactionView,
  planCompaction,
  compactConversationNow,
  maybeCompactInBackground,
};
