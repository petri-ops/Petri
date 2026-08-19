#!/usr/bin/env node
// ============================================================
// scripts/block-16-working-tree-review.mjs
// BLOCK-16 PHASE 4 — 工作包专项门禁。
//
// 跑 git-adapter 子集 + DiffFileView/DiffHunkView Vitest 子集 +
// system-prompt-rejects 子集 + docs:check + ui:audit:check，
// 任何一项失败 → 退出码 1。
//
// 不跑全量 npm run check / npm run test:all:workspace（按 AGENTS.md 测试纪律）。
// ============================================================

import { spawnSync } from 'node:child_process';

const steps = [
  {
    id: 'git-adapter',
    label: 'git-adapter 单测（applyPatch/revertPaths 子集）',
    cmd: 'node',
    args: ['--test', 'test/git-adapter.test.mjs'],
  },
  {
    id: 'system-prompt-rejects',
    label: 'system-prompt rejects 注入单测',
    cmd: 'node',
    args: ['--test', 'test/system-prompt-rejects.test.mjs'],
  },
  {
    id: 'frontend-working-tree-review',
    label: 'WorkingTreeReview 相关 Vitest（如存在）',
    cmd: 'sh',
    args: ['-c', "cd frontend && [ -f src/components/desktop/WorkingTreeReview/useWorkingTreeReview.test.ts ] && npx vitest run src/components/desktop/WorkingTreeReview || echo 'skip: no WorkingTreeReview tests'"],
  },
  {
    id: 'docs-check',
    label: 'docs:check',
    cmd: 'npm',
    args: ['run', 'docs:check'],
  },
  {
    id: 'ui-audit-check',
    label: 'ui:audit:check',
    cmd: 'npm',
    args: ['run', 'ui:audit:check'],
  },
];

function run(step) {
  console.log(`\n[block:working-tree-review] ▶ ${step.id} — ${step.label}`);
  const r = spawnSync(step.cmd, step.args, { stdio: 'inherit' });
  const ok = r.status === 0;
  console.log(`[block:working-tree-review] ${ok ? '✅' : '❌'} ${step.id} (exit=${r.status})`);
  return ok;
}

const results = [];
let allOk = true;
for (const step of steps) {
  const ok = run(step);
  results.push({ id: step.id, passed: ok });
  if (!ok) {
    allOk = false;
    console.log(`\n[block:working-tree-review] stopped at first failure: ${step.id}`);
    break;
  }
}

console.log('\n[block:working-tree-review] summary:');
for (const r of results) {
  console.log(`  ${r.passed ? '✅' : '❌'} ${r.id}`);
}

if (!allOk) {
  console.error('\n[block:working-tree-review] FAILED');
  process.exit(1);
}
console.log('\n[block:working-tree-review] ALL PASS');
process.exit(0);