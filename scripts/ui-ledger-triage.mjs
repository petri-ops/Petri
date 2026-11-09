#!/usr/bin/env node
'use strict';

/**
 * UI 台账状态分诊（BLOCK-332 的测量腿 + 门禁的唯一口径源）。
 *
 * 为什么需要它：`docs/ui-productization-audit.md` 的状态无法用 `grep -c in_progress` 数准——
 * ① 段首标题存在「**in_progress（…）**」与「in_progress → **verified（…）**」两种叠加写法；
 * ② 历史「最后更新」链行里也带 `in_progress` 字样（它们不是条目状态）；
 * ③ 同一 id 可能有多段（UI-185 曾有 6 段），按段计数会虚高。
 * 2026-10-25 已登记「UI 台账精确状态计数待单独规范化」，本脚本把那笔债变成可复核的机械面。
 *
 * 口径（**只解析段首状态，不解析正文与链行**）：
 *   - 条目 = 行首 `## UI-###[a-z]?:` 开头的段；正文到下一个 `## ` 段为止；
 *   - 状态 = 段首行的**最后一个**合法状态词（`verified` / `in_progress` / `cancelled` / `superseded`），
 *     因此「in_progress → **verified（…）**」判 verified；
 *   - 分诊桶：
 *       verified     已验收（无需处理）
 *       closed       已判销/已被取代（superseded / cancelled）
 *       live-missing 实现完成但缺实机腿，且依赖已齐 → **可补**
 *       blocked      依赖未齐或依赖外部条件（环境/授权/真实数据）→ 如实挂起
 *       unknown      段首无合法状态词 → 台账缺陷，门禁红灯
 *
 * 债口径：`debt = live-missing + blocked`，由 `test/ui-ledger-status-contract.test.mjs` 设上限棘轮，
 * 只许下降（补齐或判销后 `--update` 下调），不许新增条目悄悄堆债。
 *
 * 用法：node scripts/ui-ledger-triage.mjs [--json <path>]（只读，不修改台账）
 */

import fs from 'node:fs';
import path from 'node:path';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// POST-S7 H3/B-12——状态词匹配前先剥掉**否定语境**：台账里存在
// 「in_progress（…；按纪律不标 verified）」这类写法，裸 matchAll 取最后一个命中会把
// 未闭合条目误计成 verified（UI-694 / UI-663 实测）。否定短语剥离后按「最后一个真状态」取。
// 只剥紧邻的否定语气词，不猜语义；仍是启发式，权威处置在 plan 的分诊表。
const NEGATED_STATUS_RE = /(?:不标|未标|不冒|不设|不作|非)\s*(verified|in_progress|cancelled|superseded)/g;
const STATUS_RE = /\b(verified|in_progress|cancelled|superseded)\b/g;
const DEP_RE = /(随|依赖|前提|待补|阻塞|blocked)\s*(UI-\d+[a-z]?)/g;
// POST-S7 H2——外因关键词必须按**独立词**匹配：此前裸 `Provider` 会命中组件名
// `ToastProvider`，把纯前端 UI 条目误判成「外因受阻」（UI-702 首跑即踩到）。
// 同一个启发式脆弱性家族见 B-12（STATUS_RE 把「按纪律不标 verified」计成 verified）。
const EXTERNAL_RE = /(需用户裁决|需裁决|G1\+|packaged|(?<![A-Za-z])Provider(?![A-Za-z])|未装|无 key|真实 key|待发令|真实数据|真实环境|异常注入|IPv6|隧道)/;

export function parseSections(text) {
  const entries = [];
  let current = null;
  for (const line of text.split('\n')) {
    const head = line.match(/^## (UI-\d+[a-z]?):\s*(.*)$/);
    if (head) {
      if (current) entries.push(current);
      current = { id: head[1], title: head[2].trim(), body: [] };
      continue;
    }
    if (current) current.body.push(line);
  }
  if (current) entries.push(current);
  return entries;
}

export function triageLedger(text) {
  const sections = parseSections(text);
  const rows = sections.map((entry) => {
    const statuses = [...entry.title.replace(NEGATED_STATUS_RE, "").matchAll(STATUS_RE)].map((m) => m[1]);
    const status = statuses.length ? statuses[statuses.length - 1] : 'unknown';
    const body = `${entry.title}\n${entry.body.join('\n')}`;
    const deps = [...body.matchAll(DEP_RE)].map((m) => m[2]);
    const external = EXTERNAL_RE.test(body);
    let bucket;
    if (status === 'verified') bucket = 'verified';
    else if (status === 'cancelled' || status === 'superseded') bucket = 'closed';
    else if (status !== 'in_progress') bucket = 'unknown';
    else if (deps.length && !external) bucket = 'blocked';
    else bucket = external ? 'blocked' : 'live-missing';
    return { id: entry.id, title: entry.title.slice(0, 90), status, bucket, deps: [...new Set(deps)], external };
  });

  // 依赖可达性：依赖项已 verified 的「blocked」其实可动
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const row of rows) {
    if (row.bucket !== 'blocked' || row.external || !row.deps.length) continue;
    const unmet = row.deps.filter((d) => byId.get(d)?.status !== 'verified');
    row.unmetDeps = unmet;
    if (unmet.length === 0) row.bucket = 'live-missing';
  }

  const counts = rows.reduce((acc, r) => ((acc[r.bucket] = (acc[r.bucket] || 0) + 1), acc), {});
  const ids = new Map();
  for (const row of rows) {
    const list = ids.get(row.id) ?? [];
    list.push(row);
    ids.set(row.id, list);
  }
  // 未闭合 = 仍需动作的桶（verified/closed 都算已收口；同号多段只在「两处都要动作」时才算缺陷）
  const stillOpen = (r) => r.bucket === 'live-missing' || r.bucket === 'blocked' || r.bucket === 'unknown';
  const duplicateOpenIds = [...ids.entries()]
    .filter(([, list]) => list.length > 1 && list.filter(stillOpen).length > 1)
    .map(([id, list]) => ({ id, sections: list.length }));

  return {
    sections: rows.length,
    uniqueIds: ids.size,
    counts,
    debt: (counts['live-missing'] ?? 0) + (counts.blocked ?? 0),
    liveMissing: rows.filter((r) => r.bucket === 'live-missing').map((r) => ({ id: r.id, deps: r.deps, title: r.title })),
    blocked: rows.filter((r) => r.bucket === 'blocked').map((r) => ({ id: r.id, deps: r.unmetDeps ?? r.deps, external: r.external, title: r.title })),
    unknown: rows.filter((r) => r.bucket === 'unknown').map((r) => r.id),
    duplicateOpenIds,
  };
}

function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const text = fs.readFileSync(path.join(root, 'docs', 'ui-productization-audit.md'), 'utf8');
  const report = { generatedAt: new Date().toISOString(), ledger: 'docs/ui-productization-audit.md', ...triageLedger(text) };

  const jsonFlag = process.argv.indexOf('--json');
  if (jsonFlag !== -1 && process.argv[jsonFlag + 1]) {
    const target = resolve(root, process.argv[jsonFlag + 1]);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(`证据：${target}`);
  }

  console.log(`台账段 ${report.sections}（唯一 id ${report.uniqueIds}）· ${Object.entries(report.counts).map(([k, v]) => `${k}=${v}`).join(' · ')} · 债=${report.debt}`);
  console.log(`\n[可补实机腿 ${report.liveMissing.length}]`);
  for (const r of report.liveMissing) console.log(`  ${r.id}${r.deps.length ? ` ← 依赖已齐(${r.deps.join(',')})` : ''} · ${r.title.slice(0, 60)}`);
  console.log(`\n[仍受阻 ${report.blocked.length}]`);
  for (const r of report.blocked) console.log(`  ${r.id} · deps=${(r.deps).join(',') || '-'} · 外部=${r.external} · ${r.title.slice(0, 50)}`);
  if (report.unknown.length) console.log(`\n[无合法状态词 ${report.unknown.length}] ${report.unknown.join(', ')}`);
  if (report.duplicateOpenIds.length) console.log(`\n[同 id 多段且都未闭合] ${report.duplicateOpenIds.map((d) => `${d.id}×${d.sections}`).join(', ')}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
