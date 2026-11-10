#!/usr/bin/env node
/**
 * post-H9 全量契约套件门（回归→门禁转化，评审 P1 抓真）。
 *
 * 事故：K0 两处契约（K-01 字面 LIMIT 100 / 台账 in_progress 负测）随 K2 实现演进
 * 与 K7 终态推进而失效，但定向 `test:changed` 只跑改动命中的规则，多个阶段收口时
 * 未同时命中 post-h9-program 规则里的全部契约 → 契约漂移未被拦到总收口六维自查才暴露。
 *
 * 门禁：每次收口无条件跑全部 test/post-h9-*.test.mjs，任何红即红。
 * 自带负测：见各契约测试内的篡改用例；本脚本另校验「测试文件清单非空」防空转。
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEST_DIR = path.join(ROOT, 'test');

function listContracts() {
  return fs.readdirSync(TEST_DIR)
    .filter((f) => /^post-h9-.*\.test\.mjs$/.test(f))
    .sort()
    .map((f) => path.join('test', f));
}

const contracts = listContracts();
if (contracts.length === 0) {
  console.error('[post-h9:contracts] FAIL — 契约文件清单为空（不得空转）');
  process.exit(1);
}

const result = spawnSync(process.execPath, ['--test', ...contracts], {
  cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
});
process.stdout.write(result.stdout || '');
if (result.stderr) process.stderr.write(result.stderr);
const fail = Number((String(result.stdout || '').match(/^ℹ fail (\d+)/m) || [])[1] || 0);
const pass = Number((String(result.stdout || '').match(/^ℹ pass (\d+)/m) || [])[1] || 0);
if (result.status !== 0 || fail !== 0) {
  console.error(`[post-h9:contracts] FAIL — 契约 ${pass} 通过 / ${fail} 红（文件数 ${contracts.length}）`);
  process.exit(1);
}
console.log(`[post-h9:contracts] PASS — ${contracts.length} 个契约文件 / ${pass} 项全绿`);
