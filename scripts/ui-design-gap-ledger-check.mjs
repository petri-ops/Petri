#!/usr/bin/env node
/**
 * UI-D5 (BLOCK-420) — gap-ledger 终态完整性与计数机械校验。
 *  - 每条必须有 id / finding / terminal / evidence；
 *  - 终态封闭集，零 in_progress；
 *  - pending_human_eye / external-blocked / pending_user_ruling 不得出现 verified 措辞；
 *  - 计数由脚本复算写入 summary（不手写编造）。
 * 用法：node scripts/ui-design-gap-ledger-check.mjs [--check]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const LEDGER = path.join(ROOT, 'acceptance/ui-design-assessment-2026-11-11/d5/gap-ledger.json');
export const TERMINALS = ['done', 'done-partial', 'retain-with-reason', 'pending_human_eye', 'external-blocked', 'pending_user_ruling'];

export function verifyLedger(ledger) {
  const problems = [];
  const findings = ledger.findings || [];
  const ids = new Set();
  const counts = Object.fromEntries(TERMINALS.map((t) => [t, 0]));
  for (const f of findings) {
    if (!f.id || !f.finding || !f.terminal || !f.evidence) problems.push(`条目缺字段：${JSON.stringify(f).slice(0, 100)}`);
    if (ids.has(f.id)) problems.push(`重复 id：${f.id}`);
    ids.add(f.id);
    if (!TERMINALS.includes(f.terminal)) problems.push(`${f.id}: 非法终态 ${f.terminal}`);
    else counts[f.terminal] += 1;
    if (f.terminal === 'in_progress') problems.push(`${f.id}: 仍为 in_progress`);
    if (['pending_human_eye', 'external-blocked', 'pending_user_ruling'].includes(f.terminal)) {
      // 否定语境剥离：「不写 verified」「不得写成 verified」不是冒充声明（POST-S7 H3 同型）。
      const text = `${f.finding} ${f.evidence} ${f.supplement || ''}`
        .replace(/(不|不得|禁止|勿|未|非)\s*(得\s*)?(写|标|冒充|声称|当成)?\s*verified/gi, '');
      if (/verified/i.test(text)) problems.push(`${f.id}: 未闭合终态却出现 verified 措辞`);
    }
    if (['pending_human_eye', 'external-blocked', 'pending_user_ruling', 'done-partial', 'retain-with-reason'].includes(f.terminal)
      && (!f.supplement || String(f.supplement).trim().length < 8)) {
      problems.push(`${f.id}: ${f.terminal} 项缺补腿条件/重开判据（或过短）`);
    }
  }
  if (findings.length === 0) problems.push('gap-ledger 无任何条目');
  return { problems, counts, total: findings.length };
}

export function checkFiles() {
  const ledger = JSON.parse(fs.readFileSync(LEDGER, 'utf8'));
  return { ledger, ...verifyLedger(ledger) };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const { ledger, problems, counts, total } = checkFiles();
  if (problems.length) {
    console.error(`[ui-gaps] FAIL — ${problems.length} 项：`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  ledger.summary = { total, byTerminal: counts, inProgress: 0, note: '计数由 scripts/ui-design-gap-ledger-check.mjs 复算写入，不手写编造' };
  fs.writeFileSync(LEDGER, `${JSON.stringify(ledger, null, 2)}\n`);
  fs.writeFileSync(path.join(path.dirname(LEDGER), 'gap-ledger-summary.json'), `${JSON.stringify(ledger.summary, null, 2)}\n`);
  console.log(`[ui-gaps] PASS — ${total} 条逐件终态，零 in_progress；${JSON.stringify(counts)}`);
}
