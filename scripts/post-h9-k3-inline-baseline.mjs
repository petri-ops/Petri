#!/usr/bin/env node
/** 生成/校验 K3 内联样式债冻结基线（只减不增；不放宽，只冻结当前真实读数）。 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { INLINE_DEBT_FILES, countInlineLiterals, adjudicateInlineDebt } from './lib/post-h9-k3-experience.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = 'acceptance/post-h9-2026-11-10/k3/k3-inline-style-baseline.json';

function current() {
  const perFile = {};
  for (const rel of INLINE_DEBT_FILES) perFile[rel] = countInlineLiterals(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
  return perFile;
}

function main(argv) {
  const abs = path.join(ROOT, OUT);
  const now = current();
  if (argv.includes('--freeze')) {
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, `${JSON.stringify({
      schemaVersion: 1,
      kind: 'post-h9-k3-inline-style-baseline',
      generatedAt: new Date().toISOString(),
      policy: '只减不增棘轮：新增内联颜色/z-index 字面量即红；清零后重打。颜色值替换仍需人眼暗色 diff。',
      perFile: now,
    }, null, 2)}\n`);
    console.log(JSON.stringify({ frozen: OUT, perFile: now }, null, 2));
    return;
  }
  const stored = JSON.parse(fs.readFileSync(abs, 'utf8')).perFile;
  const verdict = adjudicateInlineDebt(now, stored);
  console.log(JSON.stringify({ ...verdict, current: now, frozen: stored }, null, 2));
  if (!verdict.ok) process.exitCode = 1;
}

try { main(process.argv.slice(2)); } catch (e) { console.error(`[post-h9:k3-baseline] fail-closed: ${e.message}`); process.exitCode = 1; }
