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
 * 开关：PETRI_SESSION_COMPACTION——2026-09-18 用户裁决翻默认开（feature-flags 单一真相，设置页可切换；
 * 环境变量 =1/true 强制开、=0/false 强制关）；仅在 B1 后端拼装（PETRI_SERVER_HISTORY_ASSEMBLY）
 * 生效时应用——拼装权在后端是投影的架构前提。
 */

const COMPACTION_ENV = 'PETRI_SESSION_COMPACTION';
// 触发阈值：历史 token 估算超过该值且消息数超过 minMessages 时折叠旧 turns。
// BLOCK-205（W6）— 这四个数改由 `helpers/memory-policy` 供（注册表 `memory-policy` 族）；
// 常量保留为**基线冻结值**的声明处引用，不再参与运行时判定（避免两处真值）。
const memoryPolicy = require('./memory-policy');
const COMPACTION_TRIGGER_TOKENS = memoryPolicy.DEFAULTS.compactionTriggerTokens;
const MIN_MESSAGES = memoryPolicy.DEFAULTS.compactionMinMessages;
// 保留原样的最近消息数（rolling 窗口）
const KEEP_RECENT = memoryPolicy.DEFAULTS.compactionKeepRecent;
// 摘要输入预算（超长源按行裁剪，摘要 LLM 调用自身的上限保护）

function isSessionCompactionEnabled(env) {
  // BLOCK-95 B2 灰度收编：解析权在 feature-flags（env 强制 > 设置页持久化 > 默认开）
  const { resolveFlag } = require('./feature-flags');
  return resolveFlag('session_compaction', env);
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
function applyCompactionView(assembled, compaction, opts = {}) {
  if (!compaction || !Array.isArray(assembled) || assembled.length === 0) {
    return assembled.map(({ rowid: _rowid, ...rest }) => rest);
  }
  const covered = assembled.filter((m) => typeof m.rowid === 'number' && m.rowid <= compaction.covers_rowid);
  const rest = assembled.filter((m) => !(typeof m.rowid === 'number' && m.rowid <= compaction.covers_rowid));
  if (covered.length === 0) return assembled.map(({ rowid: _rowid, ...rest2 }) => rest2);
  // BLOCK-98 M2 — resilience 模式追加转写回查指针 + 续接纪律（D2）；无 opts 时
  // B2 legacy 文案逐字节不变（契约测试锁定）。
  const resilienceExtra = opts && opts.resilienceEnabled
    ? '\n' + require('./agent-resilience').continuationLines(opts.transcriptPath || null)
    : '';
  const summaryMessage = {
    role: 'user',
    content: '[会话早期对话摘要（原文详见会话记录）]\n' + compaction.summary + resilienceExtra + '\n[以上为摘要，此后为原文消息]',
  };
  return [summaryMessage, ...rest.map(({ rowid: _rowid, ...rest2 }) => rest2)];
}

/**
 * 计算折叠计划：返回 {should, coveredRows, keepRows, sourceTokens}。
 */
function planCompaction(rows, countMessages, opts = {}) {
  const settings = memoryPolicy.compactionSettings();
  if (!Array.isArray(rows) || rows.length <= settings.keepRecent) return { should: false };
  const { countMessages: count } = require('./token-estimator');
  const est = countMessages || count;
  const sourceTokens = est(rows.map((r) => ({ role: r.role, content: String(r.content || '') })));
  // BLOCK-98 M2 — resilience 模式阈值由 planThreshold 公式给出（经 opts.threshold
  // 传入），否则维持 B2 固定 12K（legacy 逐字节兼容）。
  const threshold = Number(opts && opts.threshold) || settings.triggerTokens;
  if (sourceTokens < threshold || rows.length < settings.minMessages) return { should: false, sourceTokens };
  const splitAt = rows.length - settings.keepRecent;
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
async function compactConversationNow({ userId, conversationId, sqlite, telemetryExtra, resilienceOpts }) {
  if (!userId || !conversationId || !sqlite) return { ok: false, reason: 'missing_args' };
  const rows = sqlite.prepare(
    'SELECT rowid, role, content, ts FROM copilot_messages WHERE conversation_id=? ORDER BY rowid ASC'
  ).all(conversationId);
  // BLOCK-98 M2 — resilience 模式：阈值走公式（resilienceOpts.threshold），
  // 摘要走 9 章节模板 + maxTokens 1200；无 resilienceOpts 时 B2 legacy 逐字节不变。
  const resilience = resilienceOpts && resilienceOpts.enabled
    ? { threshold: Number(resilienceOpts.threshold) || null, transcriptPath: resilienceOpts.transcriptPath || null }
    : null;
  const plan = resilience && resilience.threshold
    ? planCompaction(rows, null, { threshold: resilience.threshold })
    : planCompaction(rows);
  if (!plan.should) return { ok: false, reason: plan.sourceTokens != null ? 'below_threshold' : 'too_few_messages' };

  // 摘要源（含角色与时间线；超预算时从头部裁剪，保留最近语境）
  // BLOCK-205（W6）— 预算来自策略（默认 60000，与接线前逐字相同）
  const settings = memoryPolicy.compactionSettings();
  let lines = plan.coveredRows.map((m) => `${m.role === 'user' ? '用户' : 'AI'}: ${String(m.content || '')}`);
  let joined = lines.join('\n\n');
  if (joined.length > settings.summaryBudgetChars) {
    joined = joined.slice(joined.length - settings.summaryBudgetChars);
  }

  const existing = getCompactionSync(sqlite, conversationId);
  const { callModelTask } = require('./model-tasks');
  // BLOCK-98 M2 — resilience 模式切换 9 章节系统提示词 + maxTokens 1200。
  const resilienceSystem = resilience
    ? require('./agent-resilience').SUMMARY_NINE_SECTION_PROMPT
    : null;
  const userPrompt = resilience && existing
    ? '已有摘要：\n' + existing.summary + '\n\n新增较早对话：\n' + joined + '\n\n请输出合并后的新摘要（仍保持 9 章节结构）。'
    : (existing
      ? '已有摘要：\n' + existing.summary + '\n\n新增较早对话：\n' + joined + '\n\n请输出合并后的新摘要。'
      : '请总结以下较早的对话：\n' + joined);
  const result = await callModelTask({
    role: 'summary',
    messages: [
      {
        role: 'system',
        content: resilienceSystem
          || '你是会话上下文压缩助手。把较早的对话折叠成中文要点摘要，供后续对话作为背景。保留：用户的任务目标、已做过的关键决定、重要结论、用过的参数/文件/实体名、未完成事项。要求：不超过 500 字；"- " 列表；时间顺序；与已有摘要合并而非重复；保留专有名词与数字。',
      },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.3,
    maxTokens: resilience ? 1200 : 800,
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
function maybeCompactInBackground({ userId, conversationId, sqlite, presetId, maxOutput }) {
  // BLOCK-98 M2 — 门控升级：B2 开关或 resilience 总开关任一开启即进入；
  // resilience 模式阈值由公式（preset 窗口真值）给出，B2 模式维持 12K legacy。
  const b2 = isSessionCompactionEnabled(process.env);
  const resilience = require('./agent-resilience');
  const resilienceOn = !b2 && resilience.isResilienceEnabled(process.env);
  if (!b2 && !resilienceOn) return;
  try {
    let threshold;
    if (resilienceOn) {
      let window = 0;
      try {
        const { getChatModelPreset } = require('./ai-settings');
        const preset = presetId ? getChatModelPreset(presetId) : null;
        window = preset && Number(preset.contextWindow) > 0 ? Number(preset.contextWindow) : 0;
      } catch {}
      const planT = resilience.planThreshold(window, Number(maxOutput) || 0);
      threshold = planT ? planT.threshold : undefined;
      if (threshold == null) return; // 窗口未知 → 不猜测，维持原文（诚实降级）
    }
    const rows = sqlite.prepare(
      'SELECT rowid, role, content, ts FROM copilot_messages WHERE conversation_id=? ORDER BY rowid ASC'
    ).all(conversationId);
    const plan = threshold != null ? planCompaction(rows, null, { threshold }) : planCompaction(rows);
    if (!plan.should) return;
    const existing = getCompactionSync(sqlite, conversationId);
    if (existing && existing.covers_rowid >= (plan.coveredRows[plan.coveredRows.length - 1] || {}).rowid) return;
    const resilienceOpts = resilienceOn
      ? { enabled: true, threshold, transcriptPath: resilience.transcriptPathFor(conversationId) }
      : null;
    // 后台：await 由 setImmediate 链独立消化，失败静默（下次请求再试）
    setImmediate(() => {
      compactConversationNow({ userId, conversationId, sqlite, resilienceOpts })
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
