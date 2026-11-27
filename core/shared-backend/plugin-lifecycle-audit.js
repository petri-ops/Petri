/**
 * QODER-L6 P1 — 插件生命周期/权限审计统一投影（2026-11-23）。
 *
 * 默认口径：沿用现有 JSONL 惯例（trust-policy.js 的 appendAudit 同形），非评审稿写的 SQLite。
 * 只读投影 + 追加 JSONL；不读写凭据、不改 handler、投影不承载信任真源（不随配置导出）。
 * 零新依赖。
 */
'use strict';

const VALID_KINDS = new Set(['trust', 'install', 'uninstall', 'enable', 'disable', 'guard_ack']);
const SENSITIVE_KEYS = new Set(['token', 'authorizationUrl', 'apiKey', 'secret', 'password', 'accessToken']);

/** JSONL 逐行解析：坏行跳过并计数，不让一条脏记录整份失败。 */
function parseAuditLines(text) {
  const events = [];
  let skipped = 0;
  for (const line of String(text || '').split('\n')) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed && typeof parsed === 'object' && VALID_KINDS.has(String(parsed.kind))) events.push(parsed);
      else skipped += 1;
    } catch {
      skipped += 1;
    }
  }
  return { events, skipped };
}

/** 统一事件 → JSONL 行；脱敏敏感字段；未知类型拒绝（返回 null）。 */
function formatAuditEvent(event) {
  if (!event || !VALID_KINDS.has(String(event.kind))) return null;
  const clean = { at: String(event.at || '').slice(0, 40), actor: String(event.actor || '').slice(0, 80), kind: event.kind };
  for (const key of ['from', 'to']) {
    const value = Object.entries(event).find(([k]) => k === key)?.[1];
    if (value !== undefined && value !== null) Object.assign(clean, { [key]: String(value).slice(0, 160) });
  }
  for (const key of Object.keys(event)) {
    if (SENSITIVE_KEYS.has(key)) continue;
    if (!['at', 'actor', 'kind', 'from', 'to'].includes(key)) Object.assign(clean, { [key]: Object.entries(event).find(([k]) => k === key)?.[1] });
  }
  return JSON.stringify(clean);
}

/**
 * 多源投影合并（只读）：source.events[] 或 source.lines(JSONL 文本) → 统一事件按时间排序。
 * 不改写任何源对象；投影只供展示审计，不被当作信任判断真源。
 */
function projectUnifiedAudit(sources = []) {
  const events = [];
  for (const source of Array.isArray(sources) ? sources : []) {
    if (!source || typeof source !== 'object') continue;
    if (Array.isArray(source.events)) events.push(...source.events.filter((e) => e && VALID_KINDS.has(String(e.kind))));
    if (typeof source.lines === 'string') events.push(...parseAuditLines(source.lines).events);
  }
  events.sort((a, b) => String(a.at || '').localeCompare(String(b.at || '')));
  return { events, total: events.length, readonlyProjection: true };
}

module.exports = { VALID_KINDS, parseAuditLines, formatAuditEvent, projectUnifiedAudit };
