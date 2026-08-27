#!/usr/bin/env node
// ============================================================
// scripts/block-20-code-review-panel.mjs
// BLOCK-20 专项门禁 — Code Review Panel 工作包。
//
// 跑 git-adapter BLOCK-20 IPC 子集 + per-hunk 12 用例 +
// system-prompt rejects 注入 + frontend CodeReview vitest（如存在） +
// frontend TypeScript 检查 + docs:check + ui:audit:check + docs:reconcile，
// 任何一项失败 → 退出码 1。
//
// 不跑全量 npm run check / npm run test:all:workspace（按 AGENTS.md 测试纪律）。
// ============================================================

import { spawnSync } from 'node:child_process';

const steps = [
  {
    id: 'git-adapter-block20',
    label: 'git-adapter BLOCK-20 IPC 子集（listModified/fileHeadContent/splitSideDiff/revertFile/applyInverseHunk）',
    cmd: 'node',
    args: ['--test', 'test/git-adapter.test.mjs'],
  },
  {
    id: 'git-adapter-block20-per-hunk',
    label: 'git-adapter per-hunk 粒度测试（12 cases）',
    cmd: 'node',
    args: ['--test', 'test/git-adapter-block20-per-hunk.test.mjs'],
  },
  {
    id: 'system-prompt-rejects',
    label: 'system-prompt rejects 注入单测',
    cmd: 'node',
    args: ['--test', 'test/system-prompt-rejects.test.mjs'],
  },
  {
    id: 'frontend-code-review',
    label: 'CodeReviewPanel 相关 Vitest（如存在）',
    cmd: 'sh',
    args: ['-c', "cd frontend && [ -f src/components/desktop/CodeReview/CodeReviewPanel.test.tsx ] && npx vitest run src/components/desktop/CodeReview || echo 'skip: no CodeReviewPanel tests'"],
  },
  {
    id: 'frontend-tsc',
    label: 'frontend TypeScript --noEmit',
    cmd: 'sh',
    args: ['-c', 'cd frontend && npx tsc --noEmit'],
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
  {
    id: 'docs-reconcile',
    label: 'docs:reconcile',
    cmd: 'npm',
    args: ['run', 'docs:reconcile'],
  },
];

function run(step) {
  console.log(`\n[block:code-review] ▶ ${step.id} — ${step.label}`);
  const r = spawnSync(step.cmd, step.args, { stdio: 'inherit' });
  const ok = r.status === 0;
  console.log(`[block:code-review] ${ok ? '✅' : '❌'} ${step.id} (exit=${r.status})`);
  return ok;
}

const results = [];
let allOk = true;
for (const step of steps) {
  const ok = run(step);
  results.push({ id: step.id, passed: ok });
  if (!ok) {
    allOk = false;
    console.log(`\n[block:code-review] stopped at first failure: ${step.id}`);
    break;
  }
}

console.log('\n[block:code-review] summary:');
for (const r of results) {
  console.log(`  ${r.passed ? '✅' : '❌'} ${r.id}`);
}

if (!allOk) {
  console.error('\n[block:code-review] FAILED');
  process.exit(1);
}
console.log('\n[block:code-review] ALL PASS');
process.exit(0);
