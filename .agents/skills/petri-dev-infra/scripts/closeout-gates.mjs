#!/usr/bin/env node
/**
 * .agents/skills/petri-dev-infra/scripts/closeout-gates.mjs — `npm run closeout`：收口门禁聚合器（BLOCK-71）
 *
 * canonical 家在 petri-dev-infra skill 内；位置无关：向上查找 package.json 定位仓库根。
 * hygiene 门禁随包自带；docs / ui-audit / tests 三个门禁按格物仓库约定路径探测，
 * 目标仓库缺失时如实标 SKIP-with-reason（不算 PASS），见 PORTING.md。
 *
 * 把治理纪律要求收口必跑的门禁按序执行、fail-fast、最后输出证据清单摘要：
 *   0. audit-compact  AUDIT-LOG 自稳（BLOCK-170；修剪自动化=搬移不改写，属自稳步非门禁语义，
 *      目标仓库无该脚本时自动 SKIP-with-reason）
 *   1. hygiene   工作区卫生（未知 WIP / 死链 / 临时残留 fail-closed）
 *   2. docs      docs:check（文档注册 / canonical 唯一 / 入口 / AUDIT-LOG 台账健康）
 *   3. ui-audit  ui:audit:check（UI 台账契约）
 *   4. tests     test:changed（impact-map 影响范围定向测试）
 *
 * 额外门禁（当前工作包专项门禁等）：`--gate <npm-script>` 可重复，追加在固定门禁之后
 *
 * **报告级门禁**：`--report <npm-script>` 可重复——所有阻塞门禁跑完后执行，**不改变退出码**，
 * 只把结果（退出码 + 失败行数）打印进摘要。用途=「红着走」的存量门禁（如 skills:check 的
 * 5 红插件依赖）至少每次收口都被看见，而不是长期没人知道它红了。
 * 经 `npm run <name>` 执行。`--no-tests` 可跳过 test:changed（仅限纯文档改动等场景，
 * 跳过后摘要中如实标注 skipped，不算 PASS）。
 *
 * **定向语义（BLOCK-272）**：带域元数据的门禁（arch 两门 + knip）在「验证锚点以来改动与
 * 门禁域不相交且配置/基线 digest 未变」时 SKIP-with-reason（摘要如实标注，不算 PASS）。
 * 判定 fail-open：状态缺失/损坏/锚点不可达一律全量；SKIP 不刷新锚点，只有实际全量跑过
 * 且 PASS 才记录。判定实现在 host 仓库 `scripts/lib/gate-skip-state.mjs`（缺失时本特性
 * 自动关闭、门禁照常全量，同 docs/ui-audit 按约定路径探测先例）。
 * `--force-full` 旁路一切跳过与共享 cruise 缓存（发布/CI：`npm run closeout:full`）。
 *
 * 注意：本命令通过 ≠ 收口完成。canonical 回写（work package / roadmap / handoff /
 * AUDIT-LOG / ui-audit 台账）与 docs:reconcile 仍按治理纪律单独执行。
 * 退出码：0 = 全部 PASS；1 = 有 FAIL；2 = 参数错误。
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

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
  const reports = [];
  const skips = new Set();
  let noTests = false;
  let forceFull = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--no_tests') noTests = true;
    else if (arg === '--force-full') forceFull = true;
    else if (arg.startsWith('--skip=')) arg.slice(7).split(',').forEach((s) => skips.add(s.trim()));
    else if (arg === '--gate' || arg === '--report') {
      const name = argv[i + 1];
      if (!name || name.startsWith('--')) { console.error(`${arg} 后必须跟 npm 脚本名`); process.exit(2); }
      (arg === '--gate' ? gates : reports).push(name);
      i += 1;
    } else {
      console.error(`未知参数: ${arg}`);
      process.exit(2);
    }
  }
  return { gates, reports, skips, noTests, forceFull };
}

function repoGate(id, title, relScript, args) {
  const abs = path.join(ROOT, relScript);
  if (!fs.existsSync(abs)) {
    return { id, title, skipped: true, reason: `repo gate script missing: ${relScript}` };
  }
  return { id, title, cmd: process.execPath, args: [abs, ...args] };
}

// BLOCK-272 — 门禁域元数据（host 仓库约定路径，同 repoGate 的 docs/ui-audit 探测先例；
// 目标仓库无对应文件时 computeConfigDigest 按 <missing> 计入，域跳过自动退化为全量）。
// matchFile：改动文件命中即"域内"（→ 全量）；configPaths：配置/基线漂移同样 → 全量。
// **门禁自身实现脚本属于其域**——改门禁代码必须重跑该门禁，不得域跳过（BLOCK-272 自纠）。
const GATE_DOMAINS = {
  'gate:arch-cycles': {
    label: '源码域(src/core/frontend/src)',
    matchFile: (f) =>
      f.startsWith('src/') || f.startsWith('core/') || f.startsWith('frontend/src/') ||
      f === 'scripts/arch-cycles-gate.mjs' || f === 'scripts/lib/arch-cruise.mjs',
    configPaths: ['.dependency-cruiser.cjs', 'acceptance/block-109/arch-cycles-baseline.json'],
  },
  'quality:arch': {
    label: '源码域(src/core/frontend/src)',
    matchFile: (f) =>
      f.startsWith('src/') || f.startsWith('core/') || f.startsWith('frontend/src/') ||
      f === 'scripts/quality-arch.mjs' || f === 'scripts/lib/arch-cruise.mjs',
    configPaths: ['.dependency-cruiser.cjs'],
  },
  'quality:knip:check': {
    label: 'JS/TS 源全域',
    matchFile: (f) => /\.(?:mjs|cjs|js|ts|tsx|jsx)$/.test(f),
    configPaths: ['test/knip-baseline.json', 'knip.json', 'package.json', 'frontend/package.json'],
  },
};

function plan(skips, noTests, extraGates) {
  const fixed = [
    // BLOCK-170 自稳先行：AUDIT-LOG 修剪自动化（搬移不改写），脚本缺失时 repoGate 自动 SKIP-with-reason。
    repoGate('audit-compact', 'AUDIT-LOG 自稳（audit:compact）', path.join('scripts', 'audit-log-compact.mjs'), []),
    { id: 'hygiene', title: '工作区卫生（hygiene:check）', cmd: process.execPath, args: [path.join(SELF_DIR, 'hygiene-check.mjs')] },
    repoGate('docs', '文档治理（docs:check）', path.join('scripts', 'docs-governance.mjs'), ['--check']),
    repoGate('ui-audit', 'UI 台账（ui:audit:check）', path.join('scripts', 'check-ui-productization-audit.mjs'), []),
  ];
  const tests = noTests
    ? [{ id: 'tests', title: '影响范围测试（test:changed）', skipped: true }]
    : [repoGate('tests', '影响范围测试（test:changed）', path.join('scripts', 'test-affected.mjs'), ['--run'])];
  const extras = extraGates.map((name) => {
    const g = { id: name, title: `专项门禁 npm run ${name}`, cmd: NPM, args: ['run', name] };
    if (GATE_DOMAINS[name]) g.domain = GATE_DOMAINS[name];
    return g;
  });
  return [...fixed, ...tests, ...extras].filter((g) => !skips.has(g.id));
}

// BLOCK-272 — host 仓库域跳过判定模块（缺失 → null，特性关闭，门禁照常全量）。
let skipStateModule; // undefined=未加载；null=host 无该 lib；否则为模块命名空间
async function loadSkipStateModule() {
  if (skipStateModule !== undefined) return skipStateModule;
  const abs = path.join(ROOT, 'scripts', 'lib', 'gate-skip-state.mjs');
  skipStateModule = fs.existsSync(abs) ? await import(pathToFileURL(abs).href) : null;
  return skipStateModule;
}

async function main() {
  const { gates: extraGates, reports, skips, noTests, forceFull } = parseArgs(process.argv.slice(2));
  const list = plan(skips, noTests, extraGates);
  const skipMod = await loadSkipStateModule();
  // BLOCK-272：本轮收口运行 ID——arch 共享 cruise 缓存的同轮新鲜度键（子进程经 env 继承）。
  process.env.PETRI_CLOSEOUT_RUN_ID = `closeout-${process.pid}-${Date.now().toString(36)}`;

  console.log(`== 收口门禁聚合（${list.length} 项，fail-fast${forceFull ? '，force-full 全量' : ''}）==`);
  const results = [];
  let failed = false;
  for (let i = 0; i < list.length; i++) {
    const g = list[i];
    if (g.skipped) {
      results.push({ ...g, status: 'SKIPPED' });
      console.log(`\n[${i + 1}/${list.length}] ${g.title} — SKIPPED（${g.reason || '--no-tests'}，如实标注，不算 PASS）`);
      continue;
    }
    if (g.domain && !forceFull && skipMod) {
      const d = skipMod.decideSkip({ gateId: g.id, domain: g.domain, forceFull });
      if (d.skip) {
        results.push({ ...g, status: 'SKIPPED', dur: '0.0', skipReason: d.reason });
        console.log(`\n[${i + 1}/${list.length}] ${g.title} — SKIPPED（${d.reason}；如实标注，不算 PASS）`);
        continue;
      }
      console.log(`（域跳过未命中：${d.reason}——全量执行）`);
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
    // 域门禁只有实际全量跑过且 PASS 才记录锚点（SKIP/FAIL 均不记录，防漂移累积）。
    if (r.status === 0 && g.domain && skipMod) {
      skipMod.recordPass({ gateId: g.id, domain: g.domain });
    }
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
  // 报告级门禁（BLOCK-211 W8）：红着走的存量门禁每次收口都必须被看见，但不阻塞。
  if (reports.length > 0) {
    console.log('\n== 报告级门禁（非阻塞，不改变退出码）==');
    for (const name of reports) {
      const rr = spawnSync(NPM, ['run', name], { cwd: ROOT, encoding: 'utf8', shell: NPM === 'npm.cmd' });
      const text = `${rr.stdout || ''}\n${rr.stderr || ''}`;
      const reds = (text.match(/❌/g) || []).length;
      const status = rr.status === 0 ? 'OK' : `红（exit ${rr.status ?? 'signal'}，${reds} 条）`;
      console.log(`  ${rr.status === 0 ? '✅' : '⚠️ '} npm run ${name} — ${status}`);
    }
  }

  const notRun = list.length - results.length;
  if (notRun > 0) {
    console.log(`\n（fail-fast：${notRun} 项后续门禁未执行，如实留痕）`);
  }
  console.log('\nCLOSEOUT: PASS — 门禁全绿。');
  console.log('提醒：门禁通过 ≠ 收口完成。canonical 回写（work package/roadmap/handoff/AUDIT-LOG/ui-audit 台账）');
  console.log('与 docs:reconcile 仍需按治理纪律完成；收口笔录使用「G0 开发期常态 · 不外推 packaged/Provider/GA」一次。');
}

main().catch((e) => {
  console.error('[closeout] 聚合器内部错误（fail-closed，按 FAIL 处理）：', e && e.message ? e.message : e);
  process.exit(1);
});
