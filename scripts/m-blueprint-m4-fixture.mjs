#!/usr/bin/env node
/**
 * M4-1 本地长任务 fixture：生成 / 校验 / 删除三命令（零出网零真实 Provider）。
 *
 * 用法：
 *   node scripts/m-blueprint-m4-fixture.mjs --generate [--turns=1000] [--seed=42]
 *   node scripts/m-blueprint-m4-fixture.mjs --verify
 *   node scripts/m-blueprint-m4-fixture.mjs --delete
 * 证据落 acceptance/m-blueprint-2026-11-11/m4/fixture/（仅本包自有目录）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const M = require(path.join(ROOT, 'core/petri-server/agent-tools/long-task-observability.js'));
const DIR = path.join(ROOT, 'acceptance/m-blueprint-2026-11-11/m4/fixture');
const MANIFEST = path.join(DIR, 'manifest.json');
const DATA = path.join(DIR, 'fixture.json');

const args = process.argv.slice(2);
const num = (k, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${k}=`));
  return hit ? Number(hit.split('=')[1]) : fallback;
};
const modes = ['generate', 'verify', 'delete'].filter((m) => args.includes(`--${m}`));
if (modes.length !== 1) {
  process.stderr.write('用法：node scripts/m-blueprint-m4-fixture.mjs --generate|--verify|--delete\n');
  process.exit(2);
}

if (modes[0] === 'generate') {
  const fx = M.generateFixture({ turns: num('turns', M.FIXTURE_MIN_TURNS), seed: num('seed', 42) });
  const check = M.verifyFixture(fx);
  if (!check.ok) { process.stderr.write(`[m4-fixture] 生成即校验失败：${check.issues.join(', ')}\n`); process.exit(1); }
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(MANIFEST, `${JSON.stringify(fx.manifest, null, 2)}\n`);
  fs.writeFileSync(DATA, `${JSON.stringify({ messages: fx.messages, parts: fx.parts, todos: fx.todos })}\n`);
  process.stdout.write(`[m4-fixture] 生成 ${fx.manifest.turnCount} 轮 / ${fx.manifest.messageCount} messages / ${fx.manifest.partCount} parts，seed=${fx.manifest.seed} provider=mock network=false\n`);
  process.exit(0);
}

if (modes[0] === 'verify') {
  if (!fs.existsSync(MANIFEST) || !fs.existsSync(DATA)) {
    process.stderr.write('[m4-fixture] manifest/fixture 缺席——先跑 --generate\n');
    process.exit(1);
  }
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  const data = JSON.parse(fs.readFileSync(DATA, 'utf8'));
  const out = M.verifyFixture({ manifest, ...data });
  process.stdout.write(`[m4-fixture] 校验 ${out.ok ? 'PASS' : 'FAIL'}（${out.issues.length} issues）manifest.turnCount=${manifest.turnCount}\n`);
  for (const i of out.issues) process.stdout.write(`  ✖ ${i}\n`);
  process.exit(out.ok ? 0 : 1);
}

// delete：只删本包自有 fixture 目录，不触碰任何在制 WIP
if (!fs.existsSync(DIR)) { process.stdout.write('[m4-fixture] 目录已不存在，无需删除\n'); process.exit(0); }
fs.rmSync(DIR, { recursive: true, force: true });
process.stdout.write('[m4-fixture] 已删除本包自有 fixture 目录\n');
process.exit(0);
