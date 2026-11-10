#!/usr/bin/env node
/**
 * B-12 机械判档（不需要人的部分）：把 UI 台账 debt 按「是否需要人眼」分桶。
 *
 * 上一轮把 32 条 debt 整体归 pending_human_eye 是过度归类。真实情况：
 *  - blocked 里大量是外部条件 / 已 cancelled / 契约已完成但标注滞后 → 可机械判档；
 *  - live-missing 里一部分已由 CDP DOM 断言代行 → 可标「DOM 绿，仍待人眼」；
 *  - 只有明确写「观感 / 对比度 / 朗读 / 截图过目」的才是真 pending_human_eye。
 * 判据修正（2026-11-10）：ui-ledger-triage.json 的 title 被生成器截断到 ~120 字符，
 * 首版据此判档把 UI-699/698/697 等「待实机观感/走查待人工」误判成 agent 桶，
 * 人眼桶只剩 1 条——属缩分母凑指标。现改从 canonical 原文
 * docs/ui-productization-audit.md 逐件读完整标题行判档，并补齐同义词。
 * 本脚本只产出分诊表与判据，不改台账状态（不冒 verified）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TRIAGE = path.join(ROOT, 'acceptance/block-332/ui-ledger-triage.json');
const OUT = path.join(ROOT, 'acceptance/post-s7-2026-11-10/h10/debt-adjudication.json');

export const HUMAN_EYE_RE = /观感|对比度|朗读|读屏|截图|人眼|VoiceOver|暗色态|实机走查待人工|待实机|实机腿|实机过目|待人工/;
export const EXTERNAL_RE = /隧道|公网|真实数据|packaged|外部条件|R 运行|环境不可得|已取消|cancelled|无实机面可验/;

export function adjudicateRow(row) {
  const text = `${row.id || ''} ${row.reason || row.title || ''}`;
  if (HUMAN_EYE_RE.test(text)) return 'pending_human_eye';
  if (EXTERNAL_RE.test(text)) return 'retain-external-condition';
  return 'agent-adjudicable';
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const t = JSON.parse(fs.readFileSync(TRIAGE, 'utf8'));
  const canonical = fs.readFileSync(path.join(ROOT, 'docs/ui-productization-audit.md'), 'utf8');
  const titleById = new Map();
  for (const line of canonical.split(/\r?\n/)) {
    const m = /^## (UI-\d+): (.*)$/.exec(line);
    if (m) titleById.set(m[1], m[2]);
  }
  const rows = [...(t.liveMissing || []), ...(t.blocked || [])];
  const buckets = { pending_human_eye: [], 'retain-external-condition': [], 'agent-adjudicable': [] };
  for (const r of rows) {
    // 以 canonical 完整标题为准（派生台账 title 被截断），不缩人眼桶。
    const fullTitle = titleById.get(r.id) || r.title || r.reason || '';
    const bucket = adjudicateRow({ id: r.id, reason: fullTitle });
    buckets[bucket].push({ id: r.id, reason: String(fullTitle).slice(0, 220), source: 'canonical-full-title' });
  }
  const evidence = {
    schemaVersion: 1, kind: 'b12-debt-adjudication', generatedAt: new Date().toISOString(),
    totalDebt: rows.length,
    buckets: Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, v.length])),
    humanEyeIds: buckets.pending_human_eye.map((x) => x.id),
    externalIds: buckets['retain-external-condition'].map((x) => x.id),
    agentAdjudicableIds: buckets['agent-adjudicable'].map((x) => x.id),
    detail: buckets,
    decision: '机械分诊，不改台账状态；agent-adjudicable 桶是后续批次可逐件销号的起点，不是已 verified。',
    note: 'DOM 断言 / 机械门不冒充人眼观感；人眼桶保持 pending_human_eye，Agent 不代答。',
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(evidence, null, 2) + '\n');
  console.log('[debt-adjudicate]', JSON.stringify(evidence.buckets));
  process.exit(0);
}
