#!/usr/bin/env node
/**
 * K0 数字口径单一化：九组冲突读数从权威源机械复算（禁止手写数字）。
 *
 * 输出每条带 {value, source, command, capturedAt}；生成物整体带 sourceCommit。
 * 文档引用一律指向 acceptance/post-h9-2026-11-10/k0/k0-canonical-readings.json，
 * 不在报告里各写一份读数（blueprint §4 K0 判据 2）。
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const READING_IDS = Object.freeze([
  'closeoutGateCount', 'perfBaseline', 'rafFrameTime', 'reasonCodeCount',
  'silentCatchBaseline', 'unmappedTests', 'uiLedgerCounts', 'earRatio',
  'blueprintStatusParity',
]);

function readJson(rel, root) {
  return JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
}
function readText(rel, root) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

/** 机械复算九组读数；capture 时不写盘，便于负测注入坏源。 */
export function collectReadings(root = ROOT) {
  const pkg = readJson('package.json', root);
  const closeout = pkg.scripts.closeout;
  const gateCount = (closeout.match(/--gate\s+/g) || []).length;
  const reportCount = (closeout.match(/--report\s+/g) || []).length;
  const fixedCount = 4 + 1; // closeout-gates.mjs: audit-compact/hygiene/docs/ui-audit + test:changed
  const perf = readJson('test/perf-baseline.json', root);
  const dom = readJson('acceptance/post-s7-2026-11-10/h8/dom-budget-live.json', root);
  const reasonSrc = readText('core/petri-server/helpers/reason-codes.js', root);
  const reasonBlock = reasonSrc.slice(reasonSrc.indexOf('const REASONS'), reasonSrc.indexOf('function listReasonCodes'));
  const reasonCount = (reasonBlock.match(/^\s{2}[a-z][a-z0-9_]*:/gm) || []).length;
  const catchBaseline = readJson('test/silent-catch-baseline.json', root);
  const coverage = readJson('test/impact-map-coverage-baseline.json', root);
  const impactMap = readJson('test/impact-map.json', root);
  const triage = readJson('acceptance/block-332/ui-ledger-triage.json', root);
  const earManifest = readJson('acceptance/block-351/assetized-manifest.json', root);
  const registry = readJson('docs/DOC-REGISTRY.json', root);
  const readme = readText('docs/README.md', root);
  const postS7 = registry.documents.find((d) => d.id === 'POST-S7-OPTIMIZATION-BLUEPRINT-2026-11-09');
  const h9 = registry.documents.find((d) => d.id === 'POST-H9-OPTIMIZATION-BLUEPRINT-2026-11-10');
  const readmeS7Line = readme.split('\n').find((l) => l.includes('post-s7-optimization-blueprint-2026-11-09.md')) || '';
  const readmeH9Line = readme.split('\n').find((l) => l.includes('post-h9-optimization-blueprint-2026-11-10.md')) || '';
  const capturedAt = new Date().toISOString();
  const mk = (value, source, command) => ({ value, source, command, capturedAt });
  const perfScenario = (key) => perf.scenarios?.[key]?.medianMs ?? perf[key]?.medianMs ?? null;

  const readings = {
    closeoutGateCount: mk(
      { blockingGates: fixedCount + gateCount, extraGates: gateCount, reportOnlyGates: reportCount, fixedGates: fixedCount },
      'package.json:scripts.closeout + closeout-gates.mjs:112-127',
      'node -e "const s=require(\'./package.json\').scripts.closeout;console.log((s.match(/--gate\\s+/g)||[]).length+5)"',
    ),
    perfBaseline: mk(
      {
        coldStartMedianMs: perfScenario('cold_start'), longConversationMedianMs: perfScenario('long_conversation'),
        packagedStartMedianMs: perfScenario('packaged_start'), bigProjectTreeMedianMs: perfScenario('big_project_tree'),
        generatedAt: perf.generatedAt,
      },
      'test/perf-baseline.json',
      'npm run quality:perf',
    ),
    rafFrameTime: mk(
      { p50Ms: dom.frameSamples?.p50Ms, p95Ms: dom.frameSamples?.p95Ms, maxMs: dom.frameSamples?.maxMs, count: dom.frameSamples?.count },
      'acceptance/post-s7-2026-11-10/h8/dom-budget-live.json:frameSamples',
      'node scripts/post-s7-dom-budget-live.cjs',
    ),
    reasonCodeCount: mk(
      { codes: reasonCount, categories: 9 },
      'core/petri-server/helpers/reason-codes.js:31-92',
      'node -e "const r=require(\'./core/petri-server/helpers/reason-codes.js\');console.log(r.listReasonCodes().length)"',
    ),
    silentCatchBaseline: mk(
      { total: catchBaseline.total, fileCount: Object.keys(catchBaseline.files || {}).length, scanRoots: ['core', 'src'] },
      'test/silent-catch-baseline.json / scripts/silent-catch-ratchet.mjs:29',
      'npm run gate:silent-catch',
    ),
    unmappedTests: mk(
      { unmapped: coverage.unmappedTests.length, rules: impactMap.rules.length, updatedAt: coverage.updatedAt },
      'test/impact-map-coverage-baseline.json / test/impact-map.json',
      'npm run test:changed:list',
    ),
    uiLedgerCounts: mk(
      {
        sections: triage.sections, uniqueIds: triage.uniqueIds,
        verified: triage.counts?.verified, debt: triage.debt,
        liveMissing: triage.counts?.['live-missing'], blocked: triage.counts?.blocked,
        note: '另有标题计数口径 494/52/7 与分段解析口径，不混用',
      },
      'acceptance/block-332/ui-ledger-triage.json（分段解析口径）',
      'npm run ui:audit:triage',
    ),
    earRatio: mk(
      {
        assetized: earManifest.totals?.assetized,
        denominator: earManifest.totals?.acceptanceFiles,
        frozenEarPct: earManifest.totals?.earPct,
        note: '冻结台账口径；当次门取样读数须另跑 npm run quality:ear，不复用冻结值',
      },
      'acceptance/block-351/assetized-manifest.json:totals',
      'npm run quality:ear',
    ),
    blueprintStatusParity: mk(
      {
        postS7Registry: postS7?.status ?? null, postS7ReadmeActive: /\*\*active/.test(readmeS7Line),
        postH9Registry: h9?.status ?? null, postH9ReadmePlanned: /\*\*planned/.test(readmeH9Line),
        conflict: postS7?.status === 'completed' && /\*\*active/.test(readmeS7Line),
      },
      'docs/DOC-REGISTRY.json + docs/README.md:1-2',
      'npm run docs:check',
    ),
  };
  return readings;
}

/** 校核读数完整性；坏源（缺字段/缺元数据）必须判红，供负测消费。 */
export function validateReadings(readings, sourceCommit) {
  const issues = [];
  if (!readings || typeof readings !== 'object') return { ok: false, issues: ['readings 非对象'] };
  for (const id of READING_IDS) {
    const r = readings[id];
    if (!r) { issues.push(`${id} 缺席`); continue; }
    for (const k of ['value', 'source', 'command', 'capturedAt']) {
      if (r[k] === undefined || r[k] === null || r[k] === '') issues.push(`${id} 缺 ${k}`);
    }
    if (r.value && typeof r.value === 'object') {
      const nulls = Object.entries(r.value).filter(([, v]) => v === null || v === undefined).map(([k]) => k);
      if (nulls.length) issues.push(`${id} 读数含 null/undefined 子字段（源解析失败）: ${nulls.join(',')}`);
    }
  }
  if (!/^[0-9a-f]{40}$/.test(String(sourceCommit || ''))) issues.push('sourceCommit 非 40 位 sha');
  return { ok: issues.length === 0, issues };
}

function sourceCommitOf(root = ROOT) {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
}

function main(argv) {
  const out = 'acceptance/post-h9-2026-11-10/k0/k0-canonical-readings.json';
  const readings = collectReadings();
  const sourceCommit = sourceCommitOf();
  const check = validateReadings(readings, sourceCommit);
  if (!check.ok) {
    console.error(`[post-h9:k0-readings] 读数不合格，拒绝写盘: ${JSON.stringify(check.issues)}`);
    process.exitCode = 1;
    return;
  }
  if (argv.includes('--check')) {
    console.log(JSON.stringify({ ok: true, sourceCommit, readingIds: READING_IDS }, null, 2));
    return;
  }
  const payload = {
    schemaVersion: 1,
    kind: 'post-h9-k0-canonical-readings',
    sourceCommit,
    platform: `${os.platform()}-${os.arch()}`,
    command: 'node scripts/lib/post-h9-k0-readings.mjs',
    generatedAt: new Date().toISOString(),
    evidenceClass: 'mechanical-gate',
    verdict: 'measured',
    humanEyeEquivalent: false,
    stack: 'none',
    policy: '文档引用一律指向本 JSON；不同轮次 perf/rAF 读数不得混用，历史读数不回填',
    readings,
  };
  const abs = path.join(ROOT, out);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(JSON.stringify({ written: out, sourceCommit, readingIds: READING_IDS }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exitCode = 1; }
}
