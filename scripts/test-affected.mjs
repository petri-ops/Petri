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

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GATE_REPORT_SCHEMA_VERSION, validateReport } from './lib/gate-report-schema.mjs';

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

function normalizePath(value) { return value.replaceAll('\\', '/').replace(/^\.\//, ''); }

function runGit(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' })
    .split(/\r?\n/).map((line) => normalizePath(line.trim())).filter(Boolean);
}

function listScripts() {
  return execFileSync('rg', ['--files', 'scripts'], { cwd: ROOT, encoding: 'utf8' })
    .split(/\r?\n/).map((line) => normalizePath(line.trim()))
    // FILE-TREE-POLICY：scripts/archive/ 是一次性 driver 的归档区，不参与“恰好一规则”分类约束。
    .filter((file) => /\.(?:js|mjs|cjs|sh)$/.test(file) && !file.startsWith('scripts/archive/'));
}

function validateMap(map) {
  if (map.schema !== 'biof3/test-impact-map.v1' || !Array.isArray(map.rules)) throw new Error('invalid test impact map schema');
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

export function collectChangedFiles({ base = null, explicit = [] } = {}) {
  if (explicit.length) return [...new Set(explicit.map(normalizePath))].sort();
  const files = new Set();
  if (base) runGit(['diff', '--name-only', '--diff-filter=ACMR', `${base}...HEAD`]).forEach((file) => files.add(file));
  runGit(['diff', '--name-only', '--diff-filter=ACMR']).forEach((file) => files.add(file));
  runGit(['diff', '--cached', '--name-only', '--diff-filter=ACMR']).forEach((file) => files.add(file));
  runGit(['ls-files', '--others', '--exclude-standard']).forEach((file) => files.add(file));
  return [...files].sort();
}

function isNodeSource(file) { return /\.(?:js|mjs|cjs)$/.test(file) && !file.startsWith('test/') && !file.startsWith('frontend/'); }

export function resolveImpact(changedFiles, map = MAP) {
  validateMap(map);
  const tests = new Set(); const commands = new Set(); const frontendRelated = new Set(); const syntax = new Set(); const unknown = []; const reasons = new Map();
  for (const file of changedFiles.map(normalizePath)) {
    let matched = false;
    for (const rule of map.rules) {
      if (!rule.patterns.some((pattern) => globMatches(pattern, file))) continue;
      matched = true;
      for (const test of rule.tests || []) tests.add(test);
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
  console.log(`[test:changed] changed=${plan.changedFiles.length} nodeTests=${plan.tests.length} syntax=${plan.syntax.length}`);
  plan.tests.forEach((file) => console.log(`  test ${file}`));
  plan.frontendRelated.forEach((file) => console.log(`  frontend-related ${file}`));
  if (plan.commands.length) console.log(`  gates ${plan.commands.join(', ')}`);
  if (plan.unknown.length) {
    console.error(`  unmapped ${plan.unknown.join(', ')}`);
    console.error(`[test:changed] 分类冲突：${plan.unknown.length} 个改动文件未被 test/impact-map.json 任一规则覆盖；exit 2 表示需要补 rule，**不是** fail-closed。`);
    console.error('[test:changed] 处理方式：补 rule / 在 impact-map.json 添加 patterns / 把文件加入已忽略前缀（dist/、release/）。');
  }
}

function runProcess(command, args) { return spawnSync(command, args, { cwd: ROOT, stdio: 'inherit' }).status ?? 1; }

export function runPlan(plan) {
  if (plan.unknown.length) return 2;
  for (const file of plan.syntax) { const status = runProcess(process.execPath, ['--check', file]); if (status !== 0) return status; }
  if (plan.tests.length) { const status = runProcess(process.execPath, ['--test', ...plan.tests]); if (status !== 0) return status; }
  if (plan.frontendRelated.length) { const status = runProcess('npm', ['--prefix', 'frontend', 'run', 'test:related', '--', ...plan.frontendRelated, '--passWithNoTests']); if (status !== 0) return status; }
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
