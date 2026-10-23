#!/usr/bin/env node
/**
 * scripts/next-work-suggest.mjs — BLOCK-249 收口纪律（用户裁决 2026-10-24）：
 * 「给下一个工作建议必须用 Jev 判一次，并且只给一个建议，禁止"或"式多选。」
 *
 * 用法：
 *   npm run next:suggest -- --context "<本包收口摘要 + 队列/缺口>" \
 *     --candidates "Q7|Q4b|Q5-REM|Q6-REM|Q8-REM|Q9-REM|P4-REM|UI-FIX"
 *
 * 语义：
 *  - advice-only：不做门控、不改任何行为；Jev 不可用（无 key/网络/超时）时按候选**首个**作默认，
 *    并如实标 `reason`（纪律要求仍然只给一个建议）。
 *  - 输出一条人类可读建议 + 一份 JSON（含全部候选，供审计；不构成多选建议）。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { cloudOverrides } = await import('./lib/jev-cloud-supply.mjs');
const decisionApi = require(path.join(ROOT, 'core/petri-server/helpers/decision-api.js'));

function parseArgs(argv) {
  const args = { context: '', candidates: [], json: false, out: null, supply: 'cloud' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') args.json = true;
    else if (arg === '--context') args.context = String(argv[i + 1] || '');
    else if (arg.startsWith('--context=')) args.context = arg.slice('--context='.length);
    else if (arg === '--candidates') args.candidates = String(argv[i + 1] || '');
    else if (arg.startsWith('--candidates=')) args.candidates = arg.slice('--candidates='.length);
    else if (arg === '-o') args.out = argv[i + 1] || null;
    else if (arg === '--supply') args.supply = String(argv[i + 1] || 'cloud');
    else if (arg.startsWith('--supply=')) args.supply = arg.slice('--supply='.length);
  }
  args.candidates = String(args.candidates || '')
    .split('|')
    .map((item) => item.trim())
    .filter(Boolean);
  return args;
}

function slugOf(text, index) {
  const base = String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base || `c${index + 1}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.context.trim() || args.candidates.length === 0) {
    console.error('用法：npm run next:suggest -- --context "<收口摘要 + 队列>" --candidates "Q7|Q4b|..." [--json]');
    process.exit(2);
  }
  const criteria = {};
  const bySlug = new Map();
  args.candidates.forEach((candidate, index) => {
    const slug = slugOf(candidate, index);
    criteria[slug] = candidate;
    bySlug.set(slug, candidate);
  });

  const state = `最近收口与当前队列上下文：\n${args.context.trim()}\n\n候选工作包（必须选一个）：\n${args.candidates.map((c, i) => `${i + 1}. ${c}`).join('\n')}`;
  const questions = {
    next: {
      type: 'choice',
      criteria,
      instructions:
        '从候选中选出最合适的**唯一**下一个工作包。考虑：母纲队列既定顺序与依赖、当前未收口缺口、'
        + '体量与风险、G0 开发期阶段纪律（不外推 packaged/Provider/GA）；单列大包（如 Q4b）需要用户显式发令。'
        + '必须选一个，不要 none。',
    },
  };

  let overrides = {};
  let supplyNote = 'env';
  if (args.supply === 'cloud') {
    const cloud = cloudOverrides(ROOT);
    if (cloud.overrides) { overrides = cloud.overrides; supplyNote = 'cloud'; }
    else supplyNote = `cloud_unavailable:${cloud.error}`;
  }
  const outcome = await decisionApi.askDecision({ state, questions, meta: { point: 'next-work' }, overrides });
  const first = args.candidates[0];
  let choice = first;
  let confidence = null;
  let model = null;
  let reason = 'jev_unavailable_default_queue_head';
  if (outcome.ok && outcome.answers && outcome.answers.next) {
    const answer = outcome.answers.next;
    const picked = bySlug.get(answer.choice);
    if (picked) {
      choice = picked;
      confidence = Number.isFinite(answer.confidence) ? answer.confidence : null;
      model = outcome.model || null;
      reason = 'jev_adopted';
    }
  } else if (!outcome.ok) {
    reason = `jev_unavailable:${outcome.reason}:${supplyNote}`;
  }

  const report = {
    kind: 'next-work-suggestion',
    generatedAt: new Date().toISOString(),
    suggestion: choice,
    confidence,
    model,
    reason,
    ...(outcome.ok && outcome.answers && outcome.answers.next ? { jevChoice: outcome.answers.next.choice } : {}),
    candidates: args.candidates,
    note: '唯一建议（禁止"或"式多选）；Jev 不可用时按候选首个兜底并如实标注。',
  };
  const text = JSON.stringify(report, null, 2);
  if (args.out) {
    fs.mkdirSync(path.dirname(path.resolve(args.out)), { recursive: true });
    fs.writeFileSync(path.resolve(args.out), `${text}\n`, 'utf8');
  }
  if (args.json) {
    process.stdout.write(`${text}\n`);
  } else {
    const suffix = confidence === null ? '' : `（Jev confidence=${confidence.toFixed(2)}）`;
    process.stdout.write(`建议=${choice}${suffix}\n`);
    if (reason !== 'jev_adopted') process.stdout.write(`（说明：${reason}）\n`);
  }
}

main().catch((error) => {
  console.error(`[next-work-suggest] ${error && error.message ? error.message : error}`);
  process.exit(1);
});
