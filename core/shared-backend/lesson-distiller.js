'use strict';

/**
 * EVO-2 — Harness 自进化 Distill 纯函数：incidents 聚类 → lesson 候选。
 * 职责边界：只做确定性分组 + 规则映射 + 统计置信，不碰 DB / 网络 / 模型 / 计时 / 文件。
 * 为什么纯函数：HK-01 红绿需可复现；零模型调用、零外发、零新依赖；L1/L2 归因确定性
 * （对标 block114-triage-core 的 A 型「永不模型化」+ loop-failure-diagnoser 的 fault type 分类法）。
 * 证据指针必须回指至少一条 incident 样本（防凭空生成）；低置信标 needs_human 不自动执行。
 */

/** 有界策略（冻结常量）。 */
const LESSON_LIMITS = Object.freeze({
  autoConfidenceThreshold: 0.6,
  minOccurrencesForAuto: 2,
  maxPromptEntries: 8,
  maxPromptChars: 4000,
  maxEvidencePerLesson: 5,
});

/**
 * errorCode → fault family + 默认 scope（复用 loop-failure-diagnoser 的 defaultBehavior 语义）：
 * - auto（auto_retry/auto_repair）：提示/hint 可自动注入
 * - ack（require_user）：需用户裁决的改进卡
 * - draft（block）：只出草案，永不自动执行
 */
const ERROR_SCOPE_RULES = Object.freeze([
  [/unknown_tool|invalid_arguments|invalid_enum|required/i, 'auto', 'invalid_arguments'],
  [/stream_stalled|provider_retry|rate_limit|timeout|gateway/i, 'auto', 'transient_provider'],
  [/sse_|event_replay_failed|sse_task_read_failed|sse_poll_failed/i, 'auto', 'transient_runtime'],
  [/permission|denied|unauthorized|policy/i, 'ack', 'method_not_applicable'],
  [/external|upload|publish|paid/i, 'draft', 'external_side_effect'],
]);

/** source → 行为修正动作候选（可执行、非事实篡改；照 loop-repair-strategy 的 ALLOW 边界）。 */
const SOURCE_ACTIONS = Object.freeze({
  tool_failure: '调用工具前核对工具名与参数 schema；失败反馈读取 suggestions 后改用确切名称重试',
  fatal: '运行失败时保留已出字与产物，按 checkpoint 续跑而非从头重试',
  sse_reason: '订阅失败按 reasonCode 处理：可重试的退避重连，终态的明确告知用户',
  stall: '长上下文停摆时按有界续跑+delta 游标去重，不手动重试整轮任务',
  reject: '用户否决的 hunk 下次生成前先读回灌经验，避免重复同一修改',
});

/**
 * 按 fingerprint 聚类 incidents（纯函数）。
 * @param {Array<object>} incidents - 每条含 fingerprint/source/error_code/normalized/conversation_id/created_at
 * @returns {Array<object>} 簇数组，每簇含 fingerprint/source/errorCode/occurrences/affectedConversations/trend/firstSeen/lastSeen/samples
 */
function clusterIncidents(incidents = []) {
  const byFp = new Map();
  for (const row of Array.isArray(incidents) ? incidents : []) {
    if (!row || typeof row.fingerprint !== 'string' || !row.fingerprint) continue;
    let c = byFp.get(row.fingerprint);
    if (!c) {
      c = {
        fingerprint: row.fingerprint,
        source: row.source || 'unknown',
        errorCode: row.error_code || null,
        occurrences: 0,
        _convs: new Set(),
        _times: [],
        samples: [],
      };
      byFp.set(row.fingerprint, c);
    }
    c.occurrences += 1;
    if (row.conversation_id) c._convs.add(String(row.conversation_id));
    if (row.created_at) c._times.push(String(row.created_at));
    if (c.samples.length < LESSON_LIMITS.maxEvidencePerLesson) {
      c.samples.push({
        normalized: row.normalized || '',
        conversation_id: row.conversation_id || null,
        created_at: row.created_at || null,
      });
    }
  }
  const out = [];
  for (const c of byFp.values()) {
    const times = c._times.slice().sort();
    const half = Math.floor(times.length / 2);
    let trend = 'flat';
    if (times.length >= 3 && half >= 1) {
      const firstHalf = times.slice(0, half).filter(Boolean).length;
      const secondHalf = times.slice(half).filter(Boolean).length;
      if (secondHalf > firstHalf) trend = 'up';
      else if (secondHalf < firstHalf) trend = 'down';
    }
    out.push(Object.freeze({
      fingerprint: c.fingerprint,
      source: c.source,
      errorCode: c.errorCode,
      occurrences: c.occurrences,
      affectedConversations: c._convs.size,
      trend,
      firstSeen: times[0] || null,
      lastSeen: times[times.length - 1] || null,
      samples: Object.freeze(c.samples),
    }));
  }
  return out.sort((a, b) => b.occurrences - a.occurrences);
}

/**
 * 从一簇 incidents 生成一条 lesson（纯函数、可执行、带证据指针）。
 * @param {object} cluster - clusterIncidents 的一簇
 * @returns {object} lesson
 */
function buildLesson(cluster = {}) {
  const code = cluster.errorCode || '';
  let scope = 'ack';
  let faultFamily = 'unknown_failure';
  for (const [re, sc, family] of ERROR_SCOPE_RULES) {
    if (re.test(code) || re.test(cluster.source || '')) {
      scope = sc;
      faultFamily = family;
      break;
    }
  }
  const occurrences = Number.isFinite(cluster.occurrences) ? cluster.occurrences : 0;
  const affected = Number.isFinite(cluster.affectedConversations) ? cluster.affectedConversations : 0;
  // 置信：由频次 + 影响面 + 趋势Deterministic 计算（无模型分）
  let confidence = 0.3 + Math.min(0.4, occurrences * 0.08) + Math.min(0.2, affected * 0.05);
  if (cluster.trend === 'up') confidence += 0.05;
  confidence = Math.max(0, Math.min(1, Math.round(confidence * 100) / 100));
  const autoEligible = occurrences >= LESSON_LIMITS.minOccurrencesForAuto
    && confidence >= LESSON_LIMITS.autoConfidenceThreshold
    && scope === 'auto';
  const action = SOURCE_ACTIONS[cluster.source] || '复盘该类失败的最小行为修正，下次同类场景先规避';
  const evidence = (Array.isArray(cluster.samples) ? cluster.samples : [])
    .slice(0, LESSON_LIMITS.maxEvidencePerLesson)
    .map((s) => `fingerprint=${cluster.fingerprint}|at=${s.created_at || '?'}|conv=${s.conversation_id || '?'}|${(s.normalized || '').slice(0, 80)}`);
  return Object.freeze({
    id: `lesson_${cluster.fingerprint}`.slice(0, 64),
    sourceFingerprint: cluster.fingerprint,
    title: `${faultFamily}：${cluster.source || 'failure'} 已出现 ${occurrences} 次`,
    action,
    scope,
    faultFamily,
    confidence,
    evidence: Object.freeze(evidence.length ? evidence : [`fingerprint=${cluster.fingerprint}`]),
    status: autoEligible ? 'active' : 'needs_human',
    createdAt: cluster.firstSeen || null,
    lastSeenAt: cluster.lastSeen || null,
    occurrencesBefore: occurrences,
    occurrencesAfter: 0,
  });
}

/**
 * 一站式 Distill：incidents → lessons（纯函数）。
 * @param {Array<object>} incidents
 * @returns {Array<object>} lesson 数组（按置信降序）
 */
function distillLessons(incidents = []) {
  return clusterIncidents(incidents)
    .map((c) => buildLesson(c))
    .sort((a, b) => b.confidence - a.confidence);
}

module.exports = {
  LESSON_LIMITS,
  ERROR_SCOPE_RULES,
  SOURCE_ACTIONS,
  clusterIncidents,
  buildLesson,
  distillLessons,
};
