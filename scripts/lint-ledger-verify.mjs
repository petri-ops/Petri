#!/usr/bin/env node
/**
 * scripts/lint-ledger-verify.mjs — L0-6（蓝图 L-40/L-88）：lint 台账机械可信 + warnings 分域只减。
 *
 * 两件事：
 *   ① eslint-suppressions.json 必须是 eslint 输出的机械投影——用「空抑制表」跑一次
 *      `eslint . --format json`，逐 file/rule 比对抑制账本 count 与实际违规数：
 *        actual > ledger → 手改 count 或新增违规未走 --suppress-all（必红）；
 *        actual < ledger → 债务已收缩，跑 `npx eslint . --prune-suppressions` 收敛（必红直到收敛）；
 *        实际有违规而账本无条目 → 未登记违规（必红，修根因或 --suppress-all 入账）。
 *      从此「锁的是代码不是账本」：台账只能由 eslint 生成/修剪，裸改即红。
 *   ② warnings 分域只减棘轮——production/test/scripts 三域 warning 计数写入
 *      test/lint-warnings-baseline.json，新增（任一域上涨）即红；下降提示 --update 下调。
 *
 * 用法：node scripts/lint-ledger-verify.mjs [--update]
 *   --update  重打 warnings 基线（只写基线文件，不改抑制台账——台账只归 eslint 管）。
 * 退出码：0 PASS / 1 FAIL（含基线缺席 fail-closed）。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LEDGER = path.join(ROOT, 'eslint-suppressions.json');
const WARN_BASELINE = path.join(ROOT, 'test', 'lint-warnings-baseline.json');
const UPDATE = process.argv.includes('--update');

const domainOf = (file) => {
  if (/\.test\.|\/test\/|^test\//.test(file)) return 'test';
  if (/^scripts\/|^frontend\/scripts\//.test(file)) return 'scripts';
  return 'production';
};

/** 纯函数：抑制台账 == 实际违规（双向相等=机械投影）。供 CLI 与负测契约共用。 */
export function compareLedger(ledger, errorsByFileRule) {
  const issues = [];
  const ledgerFiles = Object.keys(ledger).length;
  let ledgerCount = 0;
  let matchCount = 0;
  for (const [file, byRule] of Object.entries(ledger)) {
    for (const [rule, spec] of Object.entries(byRule)) {
      const expected = Number(spec?.count);
      ledgerCount += 1;
      if (!Number.isFinite(expected)) { issues.push(`台账条目缺 count：${file} :: ${rule}`); continue; }
      const actual = errorsByFileRule.get(file)?.get(rule) || 0;
      if (actual > expected) {
        issues.push(`${file} :: ${rule} 实际 ${actual} > 账本 ${expected}（手改 count 或新增违规未走 --suppress-all——新增违规必红）`);
      } else if (actual < expected) {
        issues.push(`${file} :: ${rule} 实际 ${actual} < 账本 ${expected}（债务已收缩——跑 npx eslint . --prune-suppressions 收敛台账后复跑）`);
      } else {
        matchCount += 1;
      }
    }
  }
  for (const [file, byRule] of errorsByFileRule) {
    for (const [rule, actual] of byRule) {
      const ledgerCountFor = ledger[file]?.[rule]?.count || 0;
      if (!ledgerCountFor) issues.push(`${file} :: ${rule} 实际 ${actual} 处违规未入抑制台账（修根因，或 npx eslint . --suppress-all 入账留痕）`);
    }
  }
  return { issues, ledgerFiles, ledgerCount, matchCount };
}

/** 纯函数：warnings 分域只减棘轮（L-88）。返回 issues 与下降提示。 */
export function compareWarnDomains(current, baseline) {
  const issues = [];
  const improvements = [];
  if (!baseline) {
    issues.push('warnings 分域基线缺席（fail-closed——带 --update 首打基线）');
    return { issues, improvements };
  }
  for (const d of ['production', 'test', 'scripts']) {
    const base = Number(baseline.domains?.[d]);
    if (!Number.isFinite(base)) { issues.push(`warnings 基线缺域 ${d}`); continue; }
    if (current[d] > base) issues.push(`warnings ${d} 域 ${current[d]} > 基线 ${base}（新增 warning 即红——L-88 分域只减）`);
    else if (current[d] < base) improvements.push(`warnings ${d} 域下降 ${base} → ${current[d]}（--update 可下调基线）`);
  }
  return { issues, improvements };
}

function runEslintUnsuppressed() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'block404-lint-'));
  const emptySuppressions = path.join(tmpDir, 'empty-suppressions.json');
  fs.writeFileSync(emptySuppressions, '{}');
  try {
    const eslintBin = path.join(ROOT, 'node_modules', 'eslint', 'bin', 'eslint.js');
    // 自定义计数 formatter（内建 json 会带全文件 source，实测 11MB+ 直接爆内存/管道）
    const fmt = path.join(ROOT, 'scripts', 'lib', 'eslint-counts-formatter.cjs');
    let out;
    try {
      out = execFileSync(process.execPath, [eslintBin, '.', '--format', fmt,
        '--cache', '--cache-location', path.join(ROOT, 'node_modules', '.cache', 'petri-eslint', '.eslintcache'), '--cache-strategy', 'content',
        '--suppressions-location', emptySuppressions], {
        cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 900000,
      });
    } catch (e) {
      // 抑制表为空时存在违规 = eslint exit 1 是**预期**路径；stdout 仍带完整计数。
      // exit 2 = 配置/执行层真错误，照抛（fail-closed）。
      if (e.status === 1 && e.stdout) out = String(e.stdout);
      else throw e;
    }
    return JSON.parse(out);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function main() {
  const report = runEslintUnsuppressed();
  const errorsByFileRule = new Map();
  const warnByDomain = { production: 0, test: 0, scripts: 0 };
  let errorTotal = 0;
  let warnTotal = 0;
  // formatter 输出：{ "<abs>": { errors, warnings, rules: {ruleId: n} } }
  for (const [abs, counts] of Object.entries(report || {})) {
    const rel = path.relative(ROOT, abs).replaceAll('\\', '/');
    errorTotal += Number(counts.errors) || 0;
    warnTotal += Number(counts.warnings) || 0;
    warnByDomain[domainOf(rel)] += Number(counts.warnings) || 0;
    const byRule = new Map(Object.entries(counts.rules || {}));
    if (byRule.size) errorsByFileRule.set(rel, byRule);
  }

  const issues = [];
  // ① 抑制台账 == 实际违规（机械投影）
  let ledger;
  try {
    ledger = JSON.parse(fs.readFileSync(LEDGER, 'utf8'));
  } catch (e) {
    console.error(`[lint:ledger] 抑制台账不可读：${e.message}`);
    process.exit(1);
  }
  const ledgerCheck = compareLedger(ledger, errorsByFileRule);
  issues.push(...ledgerCheck.issues);

  // ② warnings 分域只减棘轮（L-88）
  let baseline = null;
  try {
    baseline = JSON.parse(fs.readFileSync(WARN_BASELINE, 'utf8'));
  } catch { /* 首次运行缺基线 */ }
  if (!baseline && UPDATE) {
    const fresh = { schemaVersion: 1, kind: 'lint-warnings-domain-baseline', domains: warnByDomain, total: warnTotal, generatedAt: new Date().toISOString(), note: 'L0-6（L-88）warnings 分域只减棘轮基线；只许 --update 下调，任一域上涨即红' };
    fs.writeFileSync(WARN_BASELINE, JSON.stringify(fresh, null, 2) + '\n');
    console.log(`[lint:ledger] warnings 基线已写（production=${warnByDomain.production} test=${warnByDomain.test} scripts=${warnByDomain.scripts} total=${warnTotal}）`);
  } else {
    const warnCheck = compareWarnDomains(warnByDomain, baseline);
    issues.push(...warnCheck.issues);
    for (const i of warnCheck.improvements) console.log(`[lint:ledger] ${i}`);
  }

  console.log(`[lint:ledger] 实际违规 ${errorTotal} 处 / 台账 ${ledgerCheck.ledgerFiles} 文件 ${ledgerCheck.ledgerCount} 条（逐条相等 ${ledgerCheck.matchCount}）；warnings ${warnTotal}（P${warnByDomain.production}/T${warnByDomain.test}/S${warnByDomain.scripts}）`);
  if (issues.length) {
    console.error(`[lint:ledger] FAIL（${issues.length} 项）`);
    for (const i of issues.slice(0, 30)) console.error(`  ✖ ${i}`);
    if (issues.length > 30) console.error(`  …另外 ${issues.length - 30} 项`);
    process.exitCode = 1;
  } else {
    console.log('[lint:ledger] PASS（台账=eslint 机械投影；warnings 分域未上涨）');
  }
}

main();
