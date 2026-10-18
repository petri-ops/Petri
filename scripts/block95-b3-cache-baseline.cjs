#!/usr/bin/env node
'use strict';
/**
 * block95-b3-cache-baseline.cjs — BLOCK-95 B3 cache 基线报告（可复跑）。
 *
 * 读 ai_usage 按 provider/model/kind 分组输出：
 *   - 调用数 / prompt / completion / cache_read / cache_creation / 命中率 / 均值
 *   - 近 N 天趋势与「cache 断链检测」（cache_read 全 0 且 provider 支持 cache 时告警）
 * 证据：acceptance/block-95/block95-b3-cache-baseline.json（B3 度量先行原则的落点）。
 */
const fs = require('node:fs');
const path = require('node:path');
const Database = require(path.join(__dirname, '..', 'core', 'petri-server', 'node_modules', 'better-sqlite3'));
// BLOCK-212 — 静态前缀规模是"可复用上限"的直接指标：它必须与每轮 context 无关。
const systemPrompt = require(path.join(__dirname, '..', 'core', 'petri-server', 'helpers', 'system-prompt.js'));

const DB_FILE = process.env.PETRI_DB_PATH || path.join(__dirname, '..', '.petri-dev-user-data', 'data', 'petri.db');
const EVIDENCE_DIR = path.join(__dirname, '..', 'acceptance', 'block-95');
const CACHE_CAPABLE = /deepseek|anthropic|claude|openai|glm|kimi|qwen/i;

const db = new Database(DB_FILE, { readonly: true });
const rows = db.prepare(`
  SELECT provider, model, kind, COUNT(*) calls,
         SUM(prompt_tokens) promptTokens, SUM(completion_tokens) completionTokens,
         SUM(cache_read_tokens) cacheReadTokens, SUM(cache_creation_tokens) cacheCreationTokens,
         AVG(prompt_tokens) avgPrompt
  FROM ai_usage GROUP BY provider, model, kind ORDER BY promptTokens DESC
`).all();

const groups = rows.map((r) => {
  const hitRate = r.promptTokens > 0 ? +(r.cacheReadTokens / r.promptTokens).toFixed(4) : 0;
  return { ...r, cacheHitRate: hitRate };
});

const total = groups.reduce((a, g) => ({
  calls: a.calls + g.calls,
  promptTokens: a.promptTokens + g.promptTokens,
  cacheReadTokens: a.cacheReadTokens + g.cacheReadTokens,
}), { calls: 0, promptTokens: 0, cacheReadTokens: 0 });
const overallHitRate = total.promptTokens > 0 ? +(total.cacheReadTokens / total.promptTokens).toFixed(4) : 0;

const brokenLinkCandidates = groups.filter(
  (g) => g.cacheReadTokens === 0 && CACHE_CAPABLE.test(g.model || '') && /agent_iter|chat/.test(g.kind)
);

// BLOCK-212 — 静态前缀 vs 动态段体量（无 context 时的静态头才是"永远可复用"的部分）
const prefixProbe = (() => {
  try {
    const parts = systemPrompt.buildSystemPromptParts(null, {});
    return {
      staticPrefixChars: parts.staticPrefix.length,
      staticPrefixTokensApprox: Math.ceil(parts.staticPrefix.length / 3),
      note: '静态前缀=baseRole+运行时身份+principles；动态段（项目/结果/Harness 摘要）已移到消息末尾',
    };
  } catch (error) {
    return { error: String(error && error.message ? error.message : error) };
  }
})();

// BLOCK-212 — 命中率阈值：低于此值视为"前缀在漏"，只报告不阻断
const HIT_RATE_THRESHOLD = Number(process.env.PETRI_CACHE_HIT_THRESHOLD || 0.3);

const report = {
  generatedAt: new Date().toISOString(),
  db: DB_FILE,
  note: 'BLOCK-95 B3 度量先行：prompt cache 基线。B1 后端拼装 + B2 compaction 落地后，前缀稳定性（工具定义→系统提示→对话）是 cache 命中的前提；本报告为翻默认裁决的对账底稿。',
  overall: {
    calls: total.calls, promptTokens: total.promptTokens, cacheReadTokens: total.cacheReadTokens, cacheHitRate: overallHitRate,
    // BLOCK-212：命中率是否低于阈值（prefix 稳定性是否真的起作用）
    belowThreshold: overallHitRate < HIT_RATE_THRESHOLD, hitRateThreshold: HIT_RATE_THRESHOLD,
  },
  staticPrefix: prefixProbe,
  groups,
  brokenLinkCandidates: brokenLinkCandidates.map((g) => ({ provider: g.provider, model: g.model, kind: g.kind, calls: g.calls, promptTokens: g.promptTokens, suspicion: 'cache-capable model but cache_read_tokens===0' })),
};
fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
const out = path.join(EVIDENCE_DIR, 'block95-b3-cache-baseline.json');
fs.writeFileSync(out, JSON.stringify(report, null, 2));

console.log('[block95-b3] overall hit rate =', (overallHitRate * 100).toFixed(2) + '%',
  `(${total.cacheReadTokens}/${total.promptTokens} tokens over ${total.calls} calls)`);
if (brokenLinkCandidates.length > 0) {
  console.log('[block95-b3] ⚠ cache 断链候选（cache-capable 但落库恒 0）:', brokenLinkCandidates.length, '组');
}
console.log('[block212] 静态前缀 =', prefixProbe.staticPrefixChars, 'chars ≈', prefixProbe.staticPrefixTokensApprox, 'tokens（每轮可复用上限）');
if (total.promptTokens > 0 && overallHitRate < HIT_RATE_THRESHOLD) {
  console.log('[block212] ⚠ 命中率', (overallHitRate * 100).toFixed(2) + '% < 阈值', (HIT_RATE_THRESHOLD * 100) + '% —— 前缀可能在漏（或本库样本含大量非缓存渠道）');
}
console.log('report →', out);
