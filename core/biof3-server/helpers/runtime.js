/**
 * helpers/runtime.js — small in-process state shared across routes
 *
 * Extracted from server.js. Contains:
 *   - AI streaming concurrency guard (per-worker + per-user)
 *   - Dashscope embedding rate limit
 *
 * Pure module: no DB, no external services.
 *
 * Public API:
 *   aiConcurrencyAcquire(userId), aiConcurrencyRelease(userId)
 *   getActiveStreamCount() — for /api/ai/health
 *   _checkEmbedRateLimit(userId)
 */

// ============================================================
// AI_CONCURRENCY_GUARD_v1
// ============================================================
const AI_MAX_CONCURRENT_PER_WORKER = 8;
const AI_MAX_CONCURRENT_PER_USER = 5;
// AGENT-CONCURRENCY: reserve 1 slot per user for the primary (main) loop so a
// user's own sub-agent tasks can never starve the main conversational agent.
const AI_MAX_CONCURRENT_SUBAGENT_PER_USER = AI_MAX_CONCURRENT_PER_USER - 1;
let _aiActiveStreams = 0;
const _aiUserStreams = new Map();

function aiConcurrencyAcquire(userId) {
  if (_aiActiveStreams >= AI_MAX_CONCURRENT_PER_WORKER) {
    return {ok: false, reason: 'server_busy', message: '当前对话人数较多，请稍后重试'};
  }
  const userCount = _aiUserStreams.get(userId) || 0;
  if (userCount >= AI_MAX_CONCURRENT_PER_USER) {
    return {ok: false, reason: 'user_limit', message: '你已有多个对话在进行中，请等待完成后再试'};
  }
  _aiActiveStreams++;
  _aiUserStreams.set(userId, userCount + 1);
  return {ok: true};
}

function aiConcurrencyRelease(userId) {
  _aiActiveStreams = Math.max(0, _aiActiveStreams - 1);
  const userCount = _aiUserStreams.get(userId) || 0;
  if (userCount <= 1) _aiUserStreams.delete(userId);
  else _aiUserStreams.set(userId, userCount - 1);
}

// ============================================================
// AGENT_TASK_v1 — task 生命周期并发锁（P2-b 阶段 1）
// 与 aiConcurrencyAcquire 区别：锁绑 task 生命周期（runner finally 释放），
// 而非 HTTP 请求。用户关浏览器→SSE 订阅 close→锁不释放，loop 继续。
// _aiTaskStreams: userId → Map<taskId, isPrimary>
// 主 agent(primary) 始终预留 1 槽；sub-agent 并发上限 = 总数-1，保证主 agent
// 不论启动顺序都能拿到槽位（即「每用户 5 / 预留 1」）。
// ============================================================
const _aiTaskStreams = new Map();

function aiTaskConcurrencyAcquire(userId, taskId, { isPrimary = false } = {}) {
  if (!userId || !taskId) return {ok: false, reason: 'invalid', message: '缺少 userId/taskId'};
  if (_aiActiveStreams >= AI_MAX_CONCURRENT_PER_WORKER) {
    return {ok: false, reason: 'server_busy', message: '当前对话人数较多，请稍后重试'};
  }
  const userMap = _aiTaskStreams.get(userId) || new Map();
  let subagentCount = 0;
  for (const v of userMap.values()) if (v === false) subagentCount++;
  // 总数封顶：主 agent 永远能拿到至少 1 个槽位。
  if (userMap.size >= AI_MAX_CONCURRENT_PER_USER) {
    return {ok: false, reason: 'user_limit', message: '你已有多个对话在进行中，请等待完成后再试'};
  }
  // sub-agent 单独封顶，确保不挤占主 agent 的预留槽。
  if (!isPrimary && subagentCount >= AI_MAX_CONCURRENT_SUBAGENT_PER_USER) {
    return {ok: false, reason: 'user_limit', message: '子任务并发已达上限，请等待其完成后再派生'};
  }
  userMap.set(taskId, isPrimary);
  _aiTaskStreams.set(userId, userMap);
  _aiActiveStreams++;
  return {ok: true};
}

function aiTaskConcurrencyRelease(userId, taskId) {
  if (!userId || !taskId) return;
  _aiActiveStreams = Math.max(0, _aiActiveStreams - 1);
  const userMap = _aiTaskStreams.get(userId);
  if (userMap) {
    userMap.delete(taskId);
    if (userMap.size === 0) _aiTaskStreams.delete(userId);
    else _aiTaskStreams.set(userId, userMap);
  }
}

function getActiveStreamCount() { return _aiActiveStreams; }

// ============================================================
// DASHSCOPE_RATE_LIMIT_v1 — per-user embedding call rate limit
// ============================================================
const _embedCallLog = new Map();

function _checkEmbedRateLimit(userId) {
  if (!userId) return {ok: true};
  const now = Date.now();
  const log = _embedCallLog.get(userId) || [];
  const cutoff = now - 3600_000;
  const fresh = log.filter(t => t >= cutoff);
  const recent = fresh.filter(t => t >= now - 60_000);
  if (recent.length >= 30) {
    return {ok: false, error: 'embedding_rate_limited', message: '语义检索请求太频繁（1 分钟最多 30 次）。请稍候。'};
  }
  if (fresh.length >= 200) {
    return {ok: false, error: 'embedding_hourly_cap', message: '语义检索每小时上限 200 次，请稍后再试。'};
  }
  fresh.push(now);
  _embedCallLog.set(userId, fresh);
  return {ok: true};
}

module.exports = {
  aiConcurrencyAcquire,
  aiConcurrencyRelease,
  aiTaskConcurrencyAcquire,
  aiTaskConcurrencyRelease,
  getActiveStreamCount,
  _checkEmbedRateLimit,
};
