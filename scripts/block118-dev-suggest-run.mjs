#!/usr/bin/env node
/**
 * BLOCK-118 — dev 决策建议日常接线包装（git 改动收集 + 供给选择；test/doc 双模式）。
 *
 * 用法：
 *   npm run test:suggest [-- --supply=cloud|file] [-o out.json]   # 增量测试域建议（block115 内核）
 *   npm run doc:suggest  [-- --supply=cloud|file] [--context "改动说明"] [-o out.json]
 *                                                                  # 文档回写建议（block118 内核）
 *
 * 供给（BLOCK-118 用户裁决「两者都支持」）：
 *   - file（默认）：跟随 data/decision-config.json（与设置页「决策模型接口」同源，
 *     当前可为本机 Laya 或 Jev 云）。
 *   - cloud：从 .biof3-dev-user-data/jev.env.bak-by-user-request 读 TYPESAFE_API_KEY
 *     直连 Jev 云（gitignored 只读，不回显不入仓——quality:secret 红线）。
 *
 * 裸 shell 下 decision-config 默认推导（cwd/data）不存在，须显式锚定 dev 数据面
 * （.biof3-dev-user-data/data/decision-config.json），否则静默降级 no_key。
 * 建议语义与各内核一致：增量附加、只加不减、低置信/降级=零建议。
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const require = createRequire(import.meta.url);
const { resolveSuggestion } = require('../scripts/block115-test-suggest.mjs');
const { resolveDocSuggestions } = require('../scripts/block118-doc-suggest.mjs');

const SEPARATOR = String.fromCharCode(10);

function gitLines(args) {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8' })
      .split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

/** HEAD 对比（staged+unstaged）+ 未跟踪文件，统一正斜杠去重。 */
function collectChangedFiles() {
  const tracked = gitLines(['diff', '--name-only', 'HEAD']);
  const untracked = gitLines(['ls-files', '--others', '--exclude-standard']);
  const seen = new Set();
  const files = [];
  for (const f of [...tracked, ...untracked]) {
    const norm = f.split('\\').join('/');
    if (!seen.has(norm)) {
      seen.add(norm);
      files.push(norm);
    }
  }
  return files;
}

/** 锚定决策配置路径（首个存在者；都不存在不设 env 走内建推导=诚实降级 no_key）。 */
function anchorDecisionConfigPath() {
  if (process.env.BIOF3_DECISION_CONFIG_PATH) return;
  const candidates = [
    path.join(root, '.biof3-dev-user-data', 'data', 'decision-config.json'),
    path.join(root, 'data', 'decision-config.json'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      process.env.BIOF3_DECISION_CONFIG_PATH = p;
      return;
    }
  }
}

/** 解析 cloud 供给（备份 env 文件只读，值不回显不落日志）。 */
function cloudOverrides() {
  const envFile = path.join(root, '.biof3-dev-user-data', 'jev.env.bak-by-user-request');
  let raw = '';
  try {
    raw = fs.readFileSync(envFile, 'utf8');
  } catch {
    return { error: `cloud 供给不可用：读不到 ${path.relative(root, envFile)}` };
  }
  let apiKey = null;
  let baseUrl = null;
  let model = null;
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*(TYPESAFE_[A-Z_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const value = m[2].replace(/^['"]|['"]$/g, '');
    if (m[1] === 'TYPESAFE_API_KEY') apiKey = value;
    else if (m[1] === 'TYPESAFE_BASE_URL') baseUrl = value;
    else if (m[1] === 'TYPESAFE_MODEL') model = value;
  }
  if (!apiKey) return { error: 'cloud 供给不可用：备份 env 文件无 TYPESAFE_API_KEY' };
  return { overrides: { apiKey, baseUrl: baseUrl || 'https://api.typesafe.ai', model: model || 'jev-1.13.0' } };
}

async function main() {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf('-o');
  const outPath = outIdx !== -1 ? args[outIdx + 1] : null;
  const supplyArg = args.find((a) => a.startsWith('--supply='));
  const supply = supplyArg ? supplyArg.split('=')[1] : 'file';
  const kindArg = args.find((a) => a.startsWith('--kind='));
  const kind = kindArg ? kindArg.split('=')[1] : 'test';
  const ctxIdx = args.indexOf('--context');
  const context = ctxIdx !== -1 ? args[ctxIdx + 1] : null;
  if (supply !== 'file' && supply !== 'cloud') {
    console.error('用法：npm run test:suggest|doc:suggest [-- --supply=file|cloud] [--context "改动说明"] [-o out.json]');
    process.exit(2);
  }

  anchorDecisionConfigPath();
  let overrides = {};
  if (supply === 'cloud') {
    const cloud = cloudOverrides();
    if (cloud.error) {
      console.error(cloud.error);
      process.exit(3);
    }
    overrides = cloud.overrides;
  }

  const changedFiles = collectChangedFiles();
  if (changedFiles.length === 0) {
    console.log('无改动文件（git diff HEAD + untracked 均为空）——零建议。');
    return;
  }

  const report = kind === 'doc'
    ? await runDocSuggest(changedFiles, overrides, context)
    : await runTestSuggest(changedFiles, overrides);
  report.supply = supply;
  const text = JSON.stringify(report, null, 2) + SEPARATOR;
  if (outPath) {
    const abs = path.resolve(outPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, text, 'utf8');
    console.log(`报告已写入 ${path.relative(root, abs)}`);
  } else {
    process.stdout.write(text);
  }
}

async function runTestSuggest(changedFiles, overrides) {
  const r = await resolveSuggestion(changedFiles, overrides);
  const head = `改动 ${changedFiles.length} 文件`;
  const tail = r.suggest
    ? `建议追加测试域「${r.area}」（${r.suggestions.length} 个测试，conf=${Number(r.confidence).toFixed(2)} ≥ θ=${Number(r.threshold).toFixed(2)}，model=${r.model}）`
    : `零建议（${r.reason}${r.model ? '，model=' + r.model : ''}）`;
  console.log(`[test:suggest] ${head}：${tail}`);
  return {
    kind: 'block118-dev-test-suggest',
    version: '1.0.0',
    generatedAt: new Date().toISOString(),
    changedFiles,
    suggested: r.suggest,
    area: r.area || null,
    confidence: r.confidence ?? null,
    model: r.model ?? null,
    threshold: r.threshold ?? null,
    reason: r.reason,
    suggestions: r.suggestions,
    note: '建议为增量附加（静态 impact-map 下限不受影响）；执行与否由人/流程决定。',
  };
}

async function runDocSuggest(changedFiles, overrides, context) {
  const r = await resolveDocSuggestions(changedFiles, overrides, context ?? '');
  const head = `改动 ${changedFiles.length} 文件${context ? '（含改动说明）' : '（无改动说明——planDoc 判别力会下降，建议 --context 提供）'}`;
  const tail = r.suggest
    ? `建议回写：${r.suggestions.join(', ')}（model=${r.model ?? '-'}${r.reason.startsWith('partial_degraded') ? '；部分降级：' + r.reason : ''}）`
    : `无建议（${r.reason}${r.model ? '，model=' + r.model : ''}）`;
  console.log(`[doc:suggest] ${head}：${tail}`);
  return {
    kind: 'block118-dev-doc-suggest',
    version: '1.0.0',
    generatedAt: new Date().toISOString(),
    changedFiles,
    context: context ?? null,
    suggested: r.suggest,
    reason: r.reason,
    model: r.model ?? null,
    suggestions: r.suggestions,
    perDoc: r.perDoc || null,
    note: '建议为增量附加（不替代任何既有门禁/流程语义）；frontend/src 硬规则命中独立于模型；执行与否由人/流程决定。',
  };
}

main().catch((err) => {
  console.error('test:suggest 失败（建议器永不 throw，此为包装层异常）:', err && err.message);
  process.exit(1);
});
