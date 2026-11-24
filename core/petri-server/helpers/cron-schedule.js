'use strict';

/**
 * helpers/cron-schedule.js — BLOCK-514 Q7 cron 调度纯函数（零依赖）。
 *
 * 范围（additive over automation-store 的 interval 调度；plan=docs/block514-q7-cron-plan.md）：
 *  - parseCron(expr)：五字段（分 时 日 月 周）子集——星号、星号加步进（斜杠 N 形态）、
 *    单值、区间 A-B、区间加步进、逗号列表；域界校验（分 0-59 / 时 0-23 / 日 1-31 /
 *    月 1-12 / 周 0-7，7≡周日）。
 *    不支持的形态**显式拒绝**不静默：字段数≠5（invalid_field_count）、月/星期英文名、
 *    @yearly 等 token（invalid_token）、越界或 A>B（invalid_range）。
 *  - nextFireMs({cron, fromMs, tzOffsetMinutes})：在固定偏移钟面（UTC + 偏移）求下一次
 *    触发 ms；分钟粒度扫描，上限 366 天，永不满足抛 {code:'unsatisfiable'}。
 *
 * 时区语义（零依赖诚实形态）：tz_offset_minutes 为**固定偏移**（480=UTC+8），cron 在该
 * 本地钟面求值；固定偏移无 DST 自动切换——夏令时区须随政策手动调整偏移（如实登记边界，
 * 无 DST 区为主场景）。
 */

const FIELD_SPECS = [
  { name: 'minute', min: 0, max: 59 },
  { name: 'hour', min: 0, max: 23 },
  { name: 'dom', min: 1, max: 31 },
  { name: 'month', min: 1, max: 12 },
  { name: 'dow', min: 0, max: 7 },
];

/** 解析单个域：返回该域的合法取值集合，或 { error: code }。 */
function parseField(raw, spec) {
  const text = String(raw || '').trim();
  if (!text.length) return { error: 'invalid_token' };
  const values = new Set();
  for (const term of text.split(',')) {
    const m = term.match(/^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/);
    if (!m) return { error: 'invalid_token' };
    let lo;
    let hi;
    if (m[1] === '*') {
      lo = spec.min;
      hi = spec.max;
    } else if (m[1].includes('-')) {
      const parts = m[1].split('-');
      lo = Number(parts[0]);
      hi = Number(parts[1]);
      if (!Number.isInteger(lo) || !Number.isInteger(hi)) return { error: 'invalid_token' };
    } else {
      lo = Number(m[1]);
      hi = lo;
      if (!Number.isInteger(lo)) return { error: 'invalid_token' };
    }
    if (lo < spec.min || hi > spec.max || lo > hi) return { error: 'invalid_range' };
    const stepRaw = m[2] !== undefined ? Number(m[2]) : 1;
    if (!Number.isInteger(stepRaw) || stepRaw < 1) return { error: 'invalid_token' };
    if (m[1] === '*' && m[2] !== undefined && stepRaw === 1) {
      for (let v = lo; v <= hi; v += 1) values.add(v);
    } else {
      for (let v = lo; v <= hi; v += stepRaw) values.add(v);
    }
  }
  return { values };
}

/** 解析五字段 cron 表达式。@returns {ok:true, fields:Array<Set>} | {ok:false, code, message} */
function parseCron(expr) {
  const text = String(expr || '').trim().replace(/\s+/g, ' ');
  const parts = text.length ? text.split(' ') : [];
  if (parts.length !== 5) {
    return { ok: false, code: 'invalid_field_count', message: `cron 需要五个字段（分 时 日 月 周），收到 ${parts.length} 个。` };
  }
  const fields = [];
  const partIter = parts[Symbol.iterator]();
  let fieldIndex = 0;
  for (const spec of FIELD_SPECS) {
    fieldIndex += 1;
    const { value: raw } = partIter.next();
    const parsed = parseField(raw, spec);
    if (parsed.error) {
      return {
        ok: false,
        code: parsed.error,
        message: `cron 第 ${fieldIndex} 字段（${spec.name}）不合法：${String(raw)}（${parsed.error}）`,
      };
    }
    fields.push(parsed.values);
  }
  // 周域 7 ≡ 0（周日），标准 cron 惯例
  if (fields[4].has(7)) fields[4].add(0);
  return { ok: true, fields };
}

function matches(fields, date) {
  // date 为「目标时区钟面」的 UTC-getter 视图（调用方已加偏移）
  return fields[0].has(date.getUTCMinutes())
    && fields[1].has(date.getUTCHours())
    && fields[2].has(date.getUTCDate())
    && fields[3].has(date.getUTCMonth() + 1)
    && fields[4].has(date.getUTCDay());
}

/**
 * 求下一次触发（严格晚于 fromMs 的下一个匹配分钟起点）。
 * @throws {Error} code='unsatisfiable'（366 天内无匹配，如 2 月 30 日）
 */
function nextFireMs({ cron, fromMs, tzOffsetMinutes = 0 }) {
  const parsed = parseCron(cron);
  if (!parsed.ok) {
    const err = new Error(parsed.message);
    err.code = parsed.code;
    throw err;
  }
  const offsetMs = (Number(tzOffsetMinutes) || 0) * 60_000;
  // 对齐到分钟起点（严格 > fromMs）
  let t = Math.floor(fromMs / 60_000) * 60_000 + 60_000;
  const deadline = fromMs + 366 * 24 * HOUR_MS;
  while (t <= deadline) {
    // 目标时区钟面 = UTC 毫秒 + 偏移；用 UTC-getter 读钟面字段
    if (matches(parsed.fields, new Date(t + offsetMs))) return t;
    t += 60_000;
  }
  const err = new Error(`cron 在 366 天内无匹配（可能日期永不出现）：${cron}`);
  err.code = 'unsatisfiable';
  throw err;
}

const HOUR_MS = 3_600_000;

module.exports = { parseCron, nextFireMs };
