#!/usr/bin/env node
// BLOCK-272 — 重量门禁单项计时探针（证据工具，可复跑）。
// 用法：node scripts/block272-timing-probe.mjs <before|after>
// 输出：acceptance/block-272/timing-<phase>.json
// 只计时不改判：四项重量门禁按 closeout 链原始命令逐条执行，记录退出码与秒数。
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const phase = process.argv[2];
if (phase !== 'before' && phase !== 'after') {
  console.error('usage: node scripts/block272-timing-probe.mjs <before|after>');
  process.exit(2);
}

// 跨平台经 shell 解析 npm（Windows cmd 自动解析 npm→npm.cmd；平台分支冻结门
// test/platform-branch-freeze.mjs 要求——本探针不做平台判断）。
const DEPCUISE_BIN = join(ROOT, 'node_modules', 'dependency-cruiser', 'bin', 'dependency-cruiser.mjs');
const gates = [
  { id: 'quality:lint', cmd: 'npm', args: ['run', 'quality:lint', '--silent'] },
  { id: 'quality:types', cmd: 'npm', args: ['run', 'quality:types', '--silent'] },
  // gate:arch-cycles 与 quality:arch 各自完整 cruise 一遍，分开计时以呈现 2x cruise 事实
  { id: 'gate:arch-cycles', cmd: 'npm', args: ['run', 'gate:arch-cycles', '--silent'] },
  { id: 'quality:arch(raw depcruise)', cmd: process.execPath, args: [DEPCUISE_BIN, 'src', 'core', 'frontend/src', '--config', '.dependency-cruiser.cjs'] },
  { id: 'quality:knip:check', cmd: 'npm', args: ['run', 'quality:knip:check', '--silent'] },
];

const results = [];
for (const g of gates) {
  const t0 = Date.now();
  const r = spawnSync(g.cmd, g.args, { cwd: ROOT, encoding: 'utf8', shell: g.cmd !== process.execPath });
  const seconds = Math.round((Date.now() - t0) / 100) / 10;
  const tail = (r.stdout || '').trim().split('\n').slice(-3).join(' | ').slice(0, 200);
  results.push({
    id: g.id,
    exitCode: r.status,
    seconds,
    stdoutTail: tail,
    stderrTail: (r.stderr || '').trim().split('\n').slice(-2).join(' | ').slice(0, 200),
  });
  console.log(`[${g.id}] exit=${r.status} ${seconds}s`);
}

const record = {
  phase,
  capturedAt: new Date().toISOString(),
  head: spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim(),
  note: '单项计时探针：命令形态与 closeout 链一致；eslint/tsc 为无缓存原始形态（before）或改后形态（after）。',
  gates: results,
  totalSeconds: results.reduce((s, r) => s + r.seconds, 0),
};

mkdirSync(join(ROOT, 'acceptance', 'block-272'), { recursive: true });
const out = join(ROOT, 'acceptance', 'block-272', `timing-${phase}.json`);
writeFileSync(out, JSON.stringify(record, null, 2) + '\n');
console.log(`written: ${out} (total ${record.totalSeconds}s)`);
