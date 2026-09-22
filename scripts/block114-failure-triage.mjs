#!/usr/bin/env node
/**
 * scripts/block114-failure-triage.mjs — BLOCK-114 W1-4 测试失败归因 CLI（v1 dogfood）。
 *
 * 用法：
 *   node scripts/block114-failure-triage.mjs <failures.json> [-o report.json]
 *
 * 输入 JSON 形状：{ failures: [{ testFile, testName, errorText }] }
 * 输出报告：逐条 {testFile, testName, classifiedAs, layer, confidence?, reason?} + 汇总。
 * 分类内核=scripts/lib/block114-triage-core.mjs（L1 指纹 → L2 环境词表 → L3 决策原语 →
 * needs_human）；登记表=acceptance/block-114/known-failures.json。
 * 退出码：0=分类完成（不代表没有失败）；2=输入非法；3=决策 API 全失败。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { triageFailure } = require('../scripts/lib/block114-triage-core.mjs');

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const REGISTER_PATH = path.join(root, 'acceptance', 'block-114', 'known-failures.json');

async function main() {
  const args = process.argv.slice(2);
  const inputPath = args.find((a) => !a.startsWith('-'));
  const outIdx = args.indexOf('-o');
  const outPath = outIdx !== -1 ? args[outIdx + 1] : null;

  if (!inputPath) {
    console.error('用法：node scripts/block114-failure-triage.mjs <failures.json> [-o report.json]');
    process.exit(2);
  }
  const input = JSON.parse(fs.readFileSync(path.resolve(inputPath), 'utf8'));
  const failures = input.failures || [];
  if (!Array.isArray(failures) || failures.length === 0) {
    console.error('输入无 failures 数组或为空');
    process.exit(2);
  }
  const register = JSON.parse(fs.readFileSync(REGISTER_PATH, 'utf8')).entries || [];

  const results = [];
  for (const f of failures) {
    const r = await triageFailure(
      { testFile: String(f.testFile || ''), testName: String(f.testName || ''), errorText: String(f.errorText || '') },
      register
    );
    results.push({ testFile: f.testFile, testName: f.testName, ...r });
  }

  const summary = results.reduce((acc, r) => {
    acc[r.classifiedAs] = (acc[r.classifiedAs] || 0) + 1;
    return acc;
  }, {});
  const report = {
    kind: 'block114-triage-report',
    version: '1.0.0',
    generatedAt: new Date().toISOString(),
    sourceCommit: require('node:child_process').execSync('git rev-parse HEAD', { cwd: root }).toString().trim(),
    input: path.resolve(inputPath),
    registerSize: register.length,
    total: results.length,
    summary,
    results,
  };

  const text = JSON.stringify(report, null, 2) + '\n';
  if (outPath) {
    fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
    fs.writeFileSync(outPath, text, 'utf8');
    console.log(`报告已写入 ${path.relative(root, path.resolve(outPath))}`);
  } else {
    process.stdout.write(text);
  }
  console.log(`归因完成：${results.length} 条 → ${JSON.stringify(summary)}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
