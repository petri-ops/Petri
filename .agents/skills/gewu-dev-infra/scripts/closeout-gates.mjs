#!/usr/bin/env node
/**
 * .agents/skills/gewu-dev-infra/scripts/closeout-gates.mjs — `npm run closeout`：收口门禁聚合器（BLOCK-71）
 *
 * canonical 家在 gewu-dev-infra skill 内；位置无关：向上查找 package.json 定位仓库根。
 * hygiene 门禁随包自带；docs / ui-audit / tests 三个门禁按格物仓库约定路径探测，
 * 目标仓库缺失时如实标 SKIP-with-reason（不算 PASS），见 PORTING.md。
 *
 * 把治理纪律要求收口必跑的门禁按序执行、fail-fast、最后输出证据清单摘要：
 *   1. hygiene   工作区卫生（未知 WIP / 死链 / 临时残留 fail-closed）
 *   2. docs      docs:check（文档注册 / canonical 唯一 / 入口）
 *   3. ui-audit  ui:audit:check（UI 台账契约）
 *   4. tests     test:changed（impact-map 影响范围定向测试）
 *
 * 额外门禁（当前工作包专项门禁等）：`--gate <npm-script>` 可重复，追加在固定门禁之后
 * 经 `npm run <name>` 执行。`--no-tests` 可跳过 test:changed（仅限纯文档改动等场景，
 * 跳过后摘要中如实标注 skipped，不算 PASS）。
 *
 * 注意：本命令通过 ≠ 收口完成。canonical 回写（work package / roadmap / handoff /
 * AUDIT-LOG / ui-audit 台账）与 docs:reconcile 仍按治理纪律单独执行。
 * 退出码：0 = 全部 PASS；1 = 有 FAIL；2 = 参数错误。
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SELF_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = (() => {
  let dir = SELF_DIR;
  for (let i = 0; i < 10; i++) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    dir = path.dirname(dir);
  }
  console.error('[closeout] 找不到仓库根（向上无 package.json）');
  process.exit(2);
})();
const NPM = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function parseArgs(argv) {
  const gates = [];
  const skips = new Set();
  let noTests = false;
  for (const arg of argv) {
    if (arg === '--no-tests') noTests = true;
    else if (arg.startsWith('--skip=')) arg.slice(7).split(',').forEach((s) => skips.add(s.trim()));
    else if (arg === '--gate') gates.push(null); // 占位，取下一个参数
    else if (gates.includes(null)) gates[gates.indexOf(null)] = arg;
    else {
      console.error(`未知参数: ${arg}`);
      process.exit(2);
    }
  }
  if (gates.includes(null)) {
    console.error('--gate 后必须跟 npm 脚本名');
    process.exit(2);
  }
  return { gates, skips, noTests };
}

function repoGate(id, title, relScript, args) {
  const abs = path.join(ROOT, relScript);
  if (!fs.existsSync(abs)) {
    return { id, title, skipped: true, reason: `repo gate script missing: ${relScript}` };
  }
  return { id, title, cmd: process.execPath, args: [abs, ...args] };
}

function plan(skips, noTests, extraGates) {
  const fixed = [
    { id: 'hygiene', title: '工作区卫生（hygiene:check）', cmd: process.execPath, args: [path.join(SELF_DIR, 'hygiene-check.mjs')] },
    repoGate('docs', '文档治理（docs:check）', path.join('scripts', 'docs-governance.mjs'), ['--check']),
    repoGate('ui-audit', 'UI 台账（ui:audit:check）', path.join('scripts', 'check-ui-productization-audit.mjs'), []),
  ];
  const tests = noTests
    ? [{ id: 'tests', title: '影响范围测试（test:changed）', skipped: true }]
    : [repoGate('tests', '影响范围测试（test:changed）', path.join('scripts', 'test-affected.mjs'), ['--run'])];
  const extras = extraGates.map((name) => ({ id: name, title: `专项门禁 npm run ${name}`, cmd: NPM, args: ['run', name] }));
  return [...fixed, ...tests, ...extras].filter((g) => !skips.has(g.id));
}

function main() {
  const { gates: extraGates, skips, noTests } = parseArgs(process.argv.slice(2));
  const list = plan(skips, noTests, extraGates);

  console.log(`== 收口门禁聚合（${list.length} 项，fail-fast）==`);
  const results = [];
  let failed = false;
  for (let i = 0; i < list.length; i++) {
    const g = list[i];
    if (g.skipped) {
      results.push({ ...g, status: 'SKIPPED' });
      console.log(`\n[${i + 1}/${list.length}] ${g.title} — SKIPPED（${g.reason || '--no-tests'}，如实标注，不算 PASS）`);
      continue;
    }
    console.log(`\n[${i + 1}/${list.length}] ${g.title}`);
    const t0 = Date.now();
    // npm.cmd（win32）属 .cmd 批处理：新版 Node 禁止无 shell 直接 spawn（EINVAL），
    // 专项门禁经 npm 转发时必须带 shell；固定门禁走 process.execPath 不受影响。
    const r = spawnSync(g.cmd, g.args, { cwd: ROOT, stdio: 'inherit', shell: g.cmd === NPM });
    const dur = ((Date.now() - t0) / 1000).toFixed(1);
    const status = r.status === 0 ? 'PASS' : `FAIL(exit ${r.status ?? 'signal'})`;
    results.push({ ...g, status, dur });
    console.log(`→ ${status}（${dur}s）`);
    if (r.status !== 0) {
      failed = true;
      break;
    }
  }

  console.log('\n== 收口门禁摘要 ==');
  for (const r of results) {
    console.log(`  ${r.status === 'PASS' ? '✅' : r.status === 'SKIPPED' ? '⏭️ ' : '❌'} ${r.title}${r.dur ? `（${r.dur}s）` : ''}`);
  }
  if (failed) {
    const failedGate = results[results.length - 1];
    console.log(`\nCLOSEOUT: FAIL — 首个失败门禁：${failedGate.title}`);
    console.log('修复或如实登记例外后再收口；不得把未跑/失败的门禁表述为通过。');
    process.exit(1);
  }
  const notRun = list.length - results.length;
  if (notRun > 0) {
    console.log(`\n（fail-fast：${notRun} 项后续门禁未执行，如实留痕）`);
  }
  console.log('\nCLOSEOUT: PASS — 门禁全绿。');
  console.log('提醒：门禁通过 ≠ 收口完成。canonical 回写（work package/roadmap/handoff/AUDIT-LOG/ui-audit 台账）');
  console.log('与 docs:reconcile 仍需按治理纪律完成；收口笔录使用「G0 开发期常态 · 不外推 packaged/Provider/GA」一次。');
}

main();
