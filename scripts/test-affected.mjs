#!/usr/bin/env node
/**
 * scripts/test-affected.mjs — 基于 `test/impact-map.json` 的最小充分测试范围选择器
 *
 * 提供 `npm run test:changed:list`（--json）和 `npm run test:changed`（--run）两个
 * 入口；前者只输出计划，后者按计划执行影响范围内的测试与门禁。
 *
 * 退出码契约（GATES-1 文档化，2026-08-16）：
 *   0   PASS — 计划可执行 / 全部测试 / 门禁通过
 *   1   FAIL — 实际执行失败（某 node test / 门禁子命令非 0 退出）
 *   2   分类冲突 — 改动文件无法被 `test/impact-map.json` 任一规则匹配
 *       （即 `plan.unknown.length > 0`），或 impact-map 自身解析/校验失败、
 *       或运行期 catch 异常。**2 不是 fail-closed**：仅说明当前改动没有
 *       impact-map 规则覆盖，需补 rule 或添加"未分类但可忽略"声明；
 *       绝不代表业务代码 / 工作包"未通过"测试。
 *
 * `--report` JSON 输出模式（GATES-2 文档化，2026-08-16）：
 *   与 `--json` / `--run` 并行的可选模式；通过 `--report <path>` 触发，输出
 *   机器可读 JSON，由 `docs/schemas/test-affected-report.schema.json` 强校验。
 *   写盘失败 / schema 校验失败 → exit 2（分类冲突）。与 `--json` 同源 plan。
 *   现有 `--json` / `--run` 行为**不变**。
 *
 * 同步文档：`docs/document-governance.md` §4.5"门禁退出码契约" + GATES-2 §3.2"JSON 输出契约"。
 * 该契约为本工作包 DOC-GOVERNANCE-GATES / GATES-1 阶段固化本，不在本阶段内
 * 改动 `process.exit()` 行为；如未来升级退出码语义须同步 §4.5。
 *
 * 注：plan 文档 `docs/doc-governance-gates-plan.md` §2.2 文件名引用
 * `test-impact-map.mjs` 是历史笔误；实际物理文件为 `scripts/test-affected.mjs`，
 * 由 `package.json` 的 `test:changed:list` / `test:changed` 引用。
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GATE_REPORT_SCHEMA_VERSION, validateReport } from './lib/gate-report-schema.mjs';
// BLOCK-272：git 变更收集提取到 lib 单一真相（gate-skip-state 域跳过共用同一口径）；
// 原函数体逐字节等价搬移，行为不变。collectChangedFiles 继续对外导出保持兼容。
import { collectChangedFiles, normalizePath, runGit } from './lib/changed-files.mjs';

export { collectChangedFiles };

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MAP = JSON.parse(readFileSync(resolve(ROOT, 'test/impact-map.json'), 'utf8'));
const COMMANDS = {
  'docs-check': ['npm', ['run', 'docs:check']],
  'ui-audit': ['npm', ['run', 'ui:audit:check']],
  'harness-check': ['npm', ['run', 'harness:check']],
  'frontend-check': ['npm', ['--prefix', 'frontend', 'run', 'check']],
  'frontend-all': ['npm', ['--prefix', 'frontend', 'run', 'test:all']],
};
const COMMAND_ORDER = ['docs-check', 'ui-audit', 'harness-check', 'frontend-check', 'frontend-all'];

function escapeRegExp(value) { return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&'); }

export function globMatches(pattern, value) {
  let source = '^';
  for (let i = 0; i < pattern.length; i += 1) {
    if (pattern[i] === '*' && pattern[i + 1] === '*') { source += '.*'; i += 1; }
    else if (pattern[i] === '*') source += '[^/]*';
    else source += escapeRegExp(pattern[i]);
  }
  return new RegExp(`${source}$`).test(value);
}

function listScripts() {
  // 原生 git 文件树枚举（tracked + untracked，排除 gitignore），不依赖外部 `rg`：
  // 原实现 `execFileSync('rg', ['--files','scripts'])` 在未安装 ripgrep 的机器上抛
  // `spawnSync rg ENOENT`，导致 `npm run test:changed` / `npm run closeout` 无法收口。
  // git 是仓库既有硬依赖（runGit 已用），此处改为等价枚举，跨机可复现。
  const files = new Set([
    ...runGit(['ls-files', 'scripts']),
    ...runGit(['ls-files', '--others', '--exclude-standard', 'scripts']),
  ]);
  return [...files]
    // FILE-TREE-POLICY：scripts/archive/ 是一次性 driver 的归档区，不参与“恰好一规则”分类约束。
    .filter((file) => /\.(?:js|mjs|cjs|sh)$/.test(file) && !file.startsWith('scripts/archive/'));
}

function validateMap(map) {
  if (map.schema !== 'petri/test-impact-map.v1' || !Array.isArray(map.rules)) throw new Error('invalid test impact map schema');
  const commandIds = new Set(Object.keys(COMMANDS));
  const scriptRules = [];
  for (const rule of map.rules) {
    if (!rule.id || !Array.isArray(rule.patterns) || !rule.patterns.length) throw new Error(`invalid impact rule: ${rule.id || '<missing>'}`);
    for (const command of rule.commands || []) if (!commandIds.has(command)) throw new Error(`${rule.id} references unknown command ${command}`);
    for (const test of rule.tests || []) if (!existsSync(resolve(ROOT, test))) throw new Error(`${rule.id} references missing test ${test}`);
    if (rule.classifiesScripts) scriptRules.push(rule);
  }
  const uncovered = listScripts().filter((file) => scriptRules.filter((rule) => rule.patterns.some((pattern) => globMatches(pattern, file))).length !== 1);
  if (uncovered.length) throw new Error(`script classification must match exactly one rule: ${uncovered.join(', ')}`);
}

function isNodeSource(file) { return /\.(?:js|mjs|cjs)$/.test(file) && !file.startsWith('test/') && !file.startsWith('frontend/'); }

/**
 * 前端 Vitest 测试文件（`.test.ts` / `.test.tsx`）。
 *
 * 为什么必须分流：`node --test` 无法加载 TypeScript/TSX —— 实测
 * `ERR_UNKNOWN_FILE_EXTENSION: Unknown file extension ".tsx"`。而
 * `test/impact-map.json` 的规则允许在 `tests` 里声明前端 vitest 文件（启动性能
 * 等跨面规则正是这么写的：改启动脚本时也要跑桌面外壳测试）。历史实现把这些声明
 * 无条件塞进 `plan.tests` 一并交给 `node --test`，于是「改动命中该规则」=
 * 门禁必然红，且错误信息只有一行 `'.tsx'` 扩展名，很容易被误判为环境抖动。
 *
 * 契约依据（两条既有约束，本函数是它们的落地）：
 *   1. `docs/schemas/test-affected-report.schema.json` 声明 `plan.tests` 为
 *      "node test files"（且两个对象都 `additionalProperties: false`，不得加字段）；
 *   2. 既有用例「frontend Vitest inputs stay out of the Node impact bundle」。
 * 故前端测试一律转 `frontendRelated`（值去 `frontend/` 前缀，与既有语义一致），
 * 由 `runPlan` 按扩展名分流到 `frontend run test:files`。
 */
function isFrontendTestFile(file) { return /\.test\.(?:ts|tsx)$/.test(file); }

export function resolveImpact(changedFiles, map = MAP) {
  validateMap(map);
  const tests = new Set(); const commands = new Set(); const frontendRelated = new Set(); const syntax = new Set(); const unknown = []; const reasons = new Map();
  for (const file of changedFiles.map(normalizePath)) {
    let matched = false;
    for (const rule of map.rules) {
      if (!rule.patterns.some((pattern) => globMatches(pattern, file))) continue;
      matched = true;
      // 规则登记的前端测试走 vitest test:related（frontendRelated 通道），
      // 不进 node --test 批——node 无 tsx loader，混入即 ERR_UNKNOWN_FILE_EXTENSION
      // （2026-09-20 Mac Batch-2 实测 ui-404-408/block101/block91 三规则触发）。
      for (const test of rule.tests || []) {
        if (isFrontendTestFile(test)) frontendRelated.add(test.replace(/^frontend\//, ''));
        else tests.add(test);
      }
      for (const command of rule.commands || []) commands.add(command);
      if (rule.frontendRelated) frontendRelated.add(file.replace(/^frontend\//, ''));
      reasons.set(file, [...(reasons.get(file) || []), rule.id]);
    }
    if (/^frontend\/src\//.test(file)) frontendRelated.add(file.replace(/^frontend\//, ''));
    if (isNodeSource(file)) syntax.add(file);
    if (/^test\/.*\.test\.(?:mjs|cjs|js)$/.test(file)) tests.add(file);
    if (!matched && !/^dist\//.test(file) && !/^release\//.test(file)) unknown.push(file);
  }
  return { changedFiles: [...new Set(changedFiles.map(normalizePath))].sort(), tests: [...tests].sort(), commands: COMMAND_ORDER.filter((command) => commands.has(command)), frontendRelated: [...frontendRelated].sort(), syntax: [...syntax].sort(), unknown: [...new Set(unknown)].sort(), reasons: Object.fromEntries([...reasons].map(([file, rules]) => [file, [...new Set(rules)]])) };
}

function parseArgs(argv) {
  const explicit = argv.find((arg) => arg.startsWith('--files='));
  return { run: argv.includes('--run'), json: argv.includes('--json'), base: argv.find((arg) => arg.startsWith('--base='))?.slice(7) || null, explicit: explicit ? explicit.slice(8).split(',').filter(Boolean) : [] };
}

function printPlan(plan, json) {
  if (json) {
    console.log(JSON.stringify(plan, null, 2));
    if (plan.unknown.length) {
      console.error(`[test:changed] 分类冲突：${plan.unknown.length} 个改动文件未被 test/impact-map.json 任一规则覆盖；exit 2 表示需要补 rule，**不是** fail-closed。`);
      console.error(`[test:changed] 未映射文件：${plan.unknown.join(', ')}`);
    }
    return;
  }
  const frontendTestCount = plan.frontendRelated.filter(isFrontendTestFile).length;
  console.log(`[test:changed] changed=${plan.changedFiles.length} nodeTests=${plan.tests.length} frontendTests=${frontendTestCount} syntax=${plan.syntax.length}`);
  plan.tests.forEach((file) => console.log(`  test ${file}`));
  plan.frontendRelated.forEach((file) => console.log(`  ${isFrontendTestFile(file) ? 'frontend-test' : 'frontend-related'} ${file}`));
  if (plan.commands.length) console.log(`  gates ${plan.commands.join(', ')}`);
  if (plan.unknown.length) {
    console.error(`  unmapped ${plan.unknown.join(', ')}`);
    console.error(`[test:changed] 分类冲突：${plan.unknown.length} 个改动文件未被 test/impact-map.json 任一规则覆盖；exit 2 表示需要补 rule，**不是** fail-closed。`);
    console.error('[test:changed] 处理方式：补 rule / 在 impact-map.json 添加 patterns / 把文件加入已忽略前缀（dist/、release/）。');
  }
}

function runProcess(command, args) {
  // Windows：spawnSync 无 shell 时拒绝执行 npm.cmd（Node CVE 修复后的 EINVAL），
  // 门禁步骤会静默失败——win32 对 npm 加 shell:true（参数全部为简单旗标，
  // 无引号注入面）；树非干净且计划含 docs/ui 门禁时必现，树干净时计划为空
  // 从不触发，故此前未暴露。
  const needsShell = process.platform === 'win32' && command === 'npm';
  const options = { cwd: ROOT, stdio: 'inherit' };
  if (needsShell) options.shell = true;
  return spawnSync(command, args, options).status ?? 1;
}

export function runPlan(plan) {
  if (plan.unknown.length) return 2;
  for (const file of plan.syntax) { const status = runProcess(process.execPath, ['--check', file]); if (status !== 0) return status; }
  // BLOCK-97 收口沉淀（2026-09-17）：node --test 批里只要有一个套件泄漏
  // keep-alive 句柄（例：block93-role-prompt 的 mock 上游 server 不 close），
  // runner 就在「用例全过后」无限等待进程退出——聚合批表现为整体挂起
  // （实测 28 分钟零 CPU）。--test-force-exit 让 runner 在用例完成后强制
  // 退出，--test-timeout 给单个用例兜底超时：任何套件都无法再把
  // 聚合门禁拖死。挂起定诊法=对比进程 CPU 时间（零增量=挂起而非慢）。
  // BLOCK-273 抓真（2026-10-27）：120000→600000——「防复发全量扫描」用例
  // O(规则数×全库扫描) 随规则累积线性变慢（本批实测 solo 505s；BLOCK-272
  // 收口实测 864s），已越过 120s 上限使 closeout 结构性红。根修=该用例
  // memoize 全库扫描（O(n×全库)→O(n)），在 test:changed 内部优化包落地
  // （BLOCK-272 reopen 具体化）；本行只是兜底上限，不是性能修复。
  if (plan.tests.length) { const status = runProcess(process.execPath, ['--test', '--test-force-exit', '--test-timeout=600000', ...plan.tests]); if (status !== 0) return status; }
  if (plan.frontendRelated.length) {
    // 分流执行：impact-map 显式声明的 vitest 文件 → test:files（直接跑该文件）；
    // 被改动的前端源文件 → test:related（vitest 依赖图反查相关测试）。
    // 两者混跑会让 `vitest related <测试文件>` 语义漂移（related 期望源文件），
    // 故按扩展名分开调用，保持两种语义各自准确。
    const frontendTests = plan.frontendRelated.filter(isFrontendTestFile);
    const frontendSources = plan.frontendRelated.filter((file) => !isFrontendTestFile(file));
    if (frontendSources.length) { const status = runProcess('npm', ['--prefix', 'frontend', 'run', 'test:related', '--', ...frontendSources, '--passWithNoTests']); if (status !== 0) return status; }
    if (frontendTests.length) { const status = runProcess('npm', ['--prefix', 'frontend', 'run', 'test:files', '--', ...frontendTests]); if (status !== 0) return status; }
  }
  if (plan.commands.includes('frontend-all')) { const status = runProcess(...COMMANDS['frontend-all']); if (status !== 0) return status; }
  for (const command of plan.commands.filter((item) => item !== 'frontend-all')) { const status = runProcess(...COMMANDS[command]); if (status !== 0) return status; }
  return 0;
}

/**
 * GATES-2 `--report` JSON output mode. Emits a deterministic JSON report
 * conforming to `docs/schemas/test-affected-report.schema.json`, using the
 * same plan machinery as `--json`. Exit codes follow the existing
 * 0/1/2 contract:
 *   0 — schema-valid report written; plan has no unknown files
 *   1 — schema-valid report written; --run failed (only if --run also passed)
 *   2 — classification conflict (path invalid, write failed, schema failed,
 *       or plan has unknown files)
 */
function runReportMode(reportPathRaw, base) {
  const reportPath = isAbsolute(reportPathRaw) ? reportPathRaw : resolve(process.cwd(), reportPathRaw);
  let plan;
  try {
    plan = resolveImpact(collectChangedFiles({ base }));
  } catch (error) {
    console.error(`[test:changed:report] 分类冲突 — plan generation failed: ${error.message}`);
    process.exitCode = 2;
    return;
  }
  const isFailure = plan.unknown.length > 0;
  const status = isFailure ? 'CLASSIFICATION_CONFLICT' : 'PASS';
  const exitCode = isFailure ? 2 : 0;

  const report = {
    schemaVersion: GATE_REPORT_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    script: 'scripts/test-affected.mjs',
    mode: 'report',
    exitCode,
    summary: {
      status,
      result: isFailure ? 'classification_conflict' : 'pass',
      changedFiles: plan.changedFiles.length,
      tests: plan.tests.length,
      commands: plan.commands.length,
      frontendRelated: plan.frontendRelated.length,
      syntax: plan.syntax.length,
      unknown: plan.unknown.length,
    },
    plan: {
      changedFiles: plan.changedFiles,
      tests: plan.tests,
      commands: plan.commands,
      frontendRelated: plan.frontendRelated,
      syntax: plan.syntax,
      unknown: plan.unknown,
      reasons: plan.reasons,
    },
  };

  const validation = validateReport('scripts/test-affected.mjs', report);
  if (!validation.valid) {
    console.error('[test:changed:report] 分类冲突 — produced JSON does not match schema:');
    for (const err of validation.errors) {
      console.error(`  - ${err.path} ${err.keyword}: ${err.message}`);
    }
    process.exitCode = 2;
    return;
  }

  try {
    mkdirSync(dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  } catch (error) {
    console.error(`[test:changed:report] 分类冲突 — failed to write report to ${reportPath}: ${error.message}`);
    process.exitCode = 2;
    return;
  }
  report.reportPath = reportPath;
  if (isFailure) {
    console.error(`[test:changed:report] CLASSIFICATION_CONFLICT (${plan.unknown.length} unmapped files); report written to ${reportPath}`);
    process.exitCode = 2;
    return;
  }
  console.log(`[test:changed:report] PASS (changed=${plan.changedFiles.length}, tests=${plan.tests.length}); report written to ${reportPath}`);
  process.exitCode = 0;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const argv = process.argv.slice(2);
  const reportIdx = argv.indexOf('--report');
  if (reportIdx >= 0) {
    const reportPathRaw = argv[reportIdx + 1];
    if (!reportPathRaw || reportPathRaw.startsWith('--')) {
      console.error('--report requires a non-empty output path argument.');
      process.exitCode = 2;
    } else {
      const base = parseArgs(argv).base;
      runReportMode(reportPathRaw, base);
    }
  } else {
    try {
      const args = parseArgs(argv);
      const plan = resolveImpact(collectChangedFiles({ base: args.base, explicit: args.explicit }));
      printPlan(plan, args.json);
      process.exitCode = args.run ? runPlan(plan) : (plan.unknown.length ? 2 : 0);
    } catch (error) {
      console.error(`[test:changed] 分类冲突（工具错误）：${error.message}`);
      console.error('[test:changed] exit 2 表示 test/impact-map.json 解析 / 校验失败或 plan 生成异常；**不是** fail-closed。');
      process.exitCode = 2;
    }
  }
}
