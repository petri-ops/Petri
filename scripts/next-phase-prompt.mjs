#!/usr/bin/env node
/**
 * scripts/next-phase-prompt.mjs — BLOCK-470 / T1：下一阶段提示词机械派生 CLI。
 *
 * 用法：node scripts/next-phase-prompt.mjs [--dry-run] [--date YYYY-MM-DD] [--batch N]
 * 读现读输入（state / AUDIT-LOG / 上一批提示词 §2 / next:suggest --json），
 * 调 next-phase-prompt-core 的纯函数派生草案骨架，幂等落档（目标已存在则不写）。
 *
 * 仅 advice：不自动发令、不自造 R 项、观感零代签。缺关键输入 → external-blocked（exit 0，不阻塞 closeout --report）。
 * 退出码：始终 0（报告级门禁 --report 挂用，不作为阻塞门）；真实状态写在 stdout 摘要。
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { deriveNextPhaseDraft, shouldWriteDraft } from './lib/next-phase-prompt-core.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const DRY = args.includes('--dry-run');
const DATE = flag('--date', new Date().toISOString().slice(0, 10));
const BATCH = Number(flag('--batch', '2'));
const DOCS = path.join(ROOT, 'docs');

const read = (rel) => {
  try { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); } catch { return null; }
};

function latestPrompt() {
  let files;
  try { files = fs.readdirSync(DOCS).filter((f) => /^next-phase-e2e-prompt-\d{4}-\d{2}-\d{2}(?:-b\d+)?\.md$/.test(f)).sort(); }
  catch { return null; }
  if (!files.length) return null;
  const name = files.at(-1);
  const text = fs.readFileSync(path.join(DOCS, name), 'utf8');
  const m = text.match(/```text\n([\s\S]*?)\n```/);
  return { name, body: m ? m[1] : null };
}

function collectSuggestion() {
  // next:suggest 必须带 --context 与 --candidates 才产出建议；候选集取真实可开工项，
  // context 用现读 state/AUDIT-LOG 摘要拼装（由调用方在 main 传入）。
  const context = process.env.NEXT_PROMPT_CONTEXT || '阶段收口后机械派生下一阶段提示词草案（advice-only）';
  const candidates = process.env.NEXT_PROMPT_CANDIDATES || 'C-53-P2|C-55-VIDEO-MVP|Q4b|P4-REM';
  const r = spawnSync('npm', ['run', 'next:suggest', '--', '--supply=cloud', '--json',
    '--context', context, '--candidates', candidates], {
    cwd: ROOT, encoding: 'utf8', timeout: 120000,
  });
  const out = r.stdout || '';
  try {
    const json = JSON.parse(out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1));
    return { suggestion: json.suggestion, confidence: json.confidence ?? null, reason: json.reason || '' };
  } catch {
    return null;
  }
}

function main() {
  const stateSummary = (() => {
    const r = spawnSync('npm', ['run', 'state'], { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
    if (r.status !== 0) return null;
    const out = r.stdout || '';
    const chain = out.split('\n').find((l) => /^\s*03|^[0-9a-f]{7,}/.test(l.trim())) || '';
    const slot = out.split('\n').find((l) => l.includes('串行槽位')) || '';
    return `${chain.trim()}${slot ? '；' + slot.trim() : ''}`.trim() || null;
  })();

  const auditText = read('docs/AUDIT-LOG.md');
  const auditHead = auditText ? (auditText.split('\n').find((l) => l.startsWith('最后更新：')) || null) : null;
  const prev = latestPrompt();
  const suggestion = collectSuggestion();
  // 已完成阶段：从上一批 plan/registry 现读（BLOCK-465 = P0/P1 已完成）；此处保守取空，
  // 由 agent 按现读补齐 completedPhases——机械派生不臆造完成事实。
  const completedPhases = [];
  const humanEye = ['UI-706', 'UI-707', 'UI-709', 'UI-710', 'E类人眼22条'];

  const result = deriveNextPhaseDraft({
    date: DATE, batch: BATCH, stateSummary, auditHead, suggestion,
    previousBody: prev?.body || null, completedPhases,
    humanEyeItems: humanEye,
  });

  if (!result.ok) {
    console.log(`[next-phase-prompt] ${result.reason}：${result.diagnostics.join('；')}`);
    console.log('[next-phase-prompt] 仅 advice，不臆造草案；按 handoff 现读补齐输入后重试。');
    return;
  }

  const target = path.join(DOCS, `next-phase-prompt-${DATE}-b${BATCH}.md`);
  if (!shouldWriteDraft(fs.existsSync(target))) {
    console.log(`[next-phase-prompt] 幂等：目标已存在 ${path.relative(ROOT, target)}，不覆盖。`);
    return;
  }
  if (DRY) {
    // 报告级（closeout --report）用：只读、简短摘要、不落盘（自动任务禁写 git 追踪文件）。
    console.log(`[next-phase-prompt] report-only：建议锚=${suggestion.suggestion}（confidence=${suggestion.confidence ?? 'n/a'}）· ${result.recommendation} · 继承 ${result.inherited.length} 条 R 项 · 仅 advice 未发令。`);
    return;
  }
  fs.writeFileSync(target, result.draft, 'utf8');
  console.log(`[next-phase-prompt] 草案已落档 ${path.relative(ROOT, target)}（${result.recommendation}；继承 ${result.inherited.length} 条 R 项；仅 advice，未发令）。`);
  console.log('[next-phase-prompt] 提醒：草案需 agent 按现读蓝图填充七要素正文 + 三件套登记后才可交付；禁止自动开工。');
}

main();
