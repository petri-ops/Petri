#!/usr/bin/env node
/**
 * BLOCK-118 P1 — doc-suggest 双供给校准 harness（每文档 noul θ 扫描）。
 *
 * 用法：
 *   node scripts/block118-doc-calibrate.mjs --dry              # 只验语料，零网络
 *   node scripts/block118-doc-calibrate.mjs --supply=laya      # 本地供给（默认，零费用）
 *   node scripts/block118-doc-calibrate.mjs --supply=cloud     # Jev 云（备份 env key，只读）
 *
 * 判据（plan §2「沿 block115 P0 门，评审可改」——本点修订留痕）：每文档存在 θ 使
 * adoptedPrecision@θ ≥ 0.80 且 adoptedCoverage@θ ≥ 0.30（回写建议误报代价=多看一眼文档、
 * 漏报代价=治理台账缺账，故覆盖门低于 block115 的 0.50；修订随证据落档）。
 * 校准请求不带 meta → 零记账（block116 契约：缺省零 DB 依赖）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const decisionApi = require('../core/biof3-server/helpers/decision-api.js');
const { DOC_TARGETS, buildDocSuggestDecisionRequest } = require('../scripts/block118-doc-suggest.mjs');
const { mapWithConcurrency, round4, sha256File } = await import('./lib/calibration-common.mjs');

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const CORPUS_FILE = path.join(root, 'acceptance', 'block-118', 'corpus-doc-suggest.json');
const DEV_CONFIG = path.join(root, '.biof3-dev-user-data', 'data', 'decision-config.json');
const BACKUP_ENV = path.join(root, '.biof3-dev-user-data', 'jev.env.bak-by-user-request');

const THETA_MIN = 0.05, THETA_MAX = 0.95, THETA_STEP = 0.05;
const PRECISION_GATE = 0.80, COVERAGE_FLOOR = 0.30;
const FAILURE_RATE_LIMIT = 0.10;
const CONCURRENCY = 5;

function loadCorpus() {
  const doc = JSON.parse(fs.readFileSync(CORPUS_FILE, 'utf8'));
  if (doc.samples.length < 100) throw new Error(`语料不足 100 条（现 ${doc.samples.length}）`);
  const keys = Object.keys(DOC_TARGETS);
  for (const s of doc.samples) {
    if (!s.id || !Array.isArray(s.files) || !s.gold || typeof s.subject !== 'string') throw new Error(`样本形状非法：${s.id}`);
    for (const k of Object.keys(s.gold)) {
      if (!keys.includes(k)) throw new Error(`非法 gold 键：${s.id}.${k}`);
    }
  }
  return { doc, samples: doc.samples, sha256: sha256File(CORPUS_FILE) };
}

function resolveOverrides(supply) {
  if (supply === 'cloud') {
    let apiKey = null;
    for (const line of fs.readFileSync(BACKUP_ENV, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*TYPESAFE_API_KEY\s*=\s*(.+)\s*$/);
      if (m) apiKey = m[1].replace(/^['"]|['"]$/g, '');
    }
    if (!apiKey) throw new Error('cloud 供给不可用：备份 env 无 TYPESAFE_API_KEY');
    return { apiKey, baseUrl: 'https://api.typesafe.ai', model: 'jev-1.13.0' };
  }
  const doc = JSON.parse(fs.readFileSync(DEV_CONFIG, 'utf8'));
  const provider = doc && doc.provider;
  if (!provider || !provider.apiKey) throw new Error(`dev decision-config 无 provider（${DEV_CONFIG}）`);
  return {
    apiKey: provider.apiKey,
    baseUrl: String(provider.baseUrl || 'https://api.typesafe.ai').replace(/\/+$/, ''),
    model: provider.model || 'jev-1.13.0',
  };
}

function thetaScan(pairs, positives) {
  const grid = [];
  for (let th = THETA_MIN; th <= THETA_MAX + 1e-9; th += THETA_STEP) {
    const adopted = pairs.filter(([, v]) => v >= th);
    const truePos = adopted.filter(([g]) => g === 1).length;
    grid.push({
      theta: round4(th),
      adopted: adopted.length,
      adoptedCoverage: positives ? round4(adopted.length / positives) : null,
      adoptedPrecision: adopted.length ? round4(truePos / adopted.length) : 1,
    });
  }
  const eligible = grid.filter((g) => g.adoptedPrecision >= PRECISION_GATE && g.adoptedCoverage != null && g.adoptedCoverage >= COVERAGE_FLOOR);
  eligible.sort((a, b) => b.adoptedCoverage - a.adoptedCoverage);
  return { grid, recommended: eligible[0] ?? null, positives };
}

async function calibrate(corpus, overrides) {
  const t0 = Date.now();
  let inputTokens = 0;
  let failures = 0;
  const responseModels = new Set();
  const perSample = await mapWithConcurrency(corpus.samples, CONCURRENCY, async (s) => {
    const { state, questions } = buildDocSuggestDecisionRequest(s.files, s.subject || '');
    const outcome = await decisionApi.askDecision({ state, questions, overrides });
    if (!outcome.ok) {
      failures++;
      return { id: s.id, group: s.group, ok: false, reason: outcome.reason };
    }
    responseModels.add(outcome.model);
    inputTokens += outcome.usage?.input_tokens ?? 0;
    const answers = {};
    for (const key of Object.keys(DOC_TARGETS)) {
      const a = outcome.answers[key];
      answers[key] = typeof a?.noul === 'number' ? round4(a.noul) : null;
    }
    return { id: s.id, group: s.group, ok: true, gold: s.gold, answers, elapsedMs: outcome.elapsedMs };
  });
  const elapsedMs = Date.now() - t0;

  const failureRate = failures / corpus.samples.length;
  if (failureRate > FAILURE_RATE_LIMIT) {
    console.error(`API 失败率 ${(failureRate * 100).toFixed(1)}% 超限（${failures}/${corpus.samples.length}），终止。`);
    process.exit(2);
  }
  const valid = perSample.filter((r) => r.ok);
  const latency = valid.map((r) => r.elapsedMs).sort((a, b) => a - b);

  const perDoc = {};
  for (const key of Object.keys(DOC_TARGETS)) {
    const pairs = valid.map((r) => [r.gold[key] ?? 0, r.answers[key]]).filter(([, v]) => v != null);
    const positives = pairs.filter(([g]) => g === 1).length;
    perDoc[key] = thetaScan(pairs, positives);
  }

  const allRecommended = Object.values(perDoc).every((d) => d.recommended !== null);
  const verdict = allRecommended
    ? '可采纳：五文档均有达门槛 θ（' + Object.entries(perDoc).map(([k, d]) => `${k}@${d.recommended.theta}`).join(', ') + '）'
    : '部分/不可采纳：' + Object.entries(perDoc).map(([k, d]) => `${k}=${d.recommended ? 'θ' + d.recommended.theta : '无达标θ(最优P' + [...d.grid].sort((a, b) => b.adoptedCoverage - a.adoptedCoverage || b.adoptedPrecision - a.adoptedPrecision)[0].adoptedPrecision + ')'}`).join(', ');
  console.log(`\n裁决：${verdict}`);

  return {
    corpus: { file: 'acceptance/block-118/corpus-doc-suggest.json', sha256: corpus.sha256, count: corpus.samples.length },
    supply: { baseUrl: overrides.baseUrl, requestModel: overrides.model, responseModels: [...responseModels] },
    apiFailures: failures,
    validCount: valid.length,
    latency: { p50Ms: latency[Math.floor(latency.length * 0.5)], p95Ms: latency[Math.floor(latency.length * 0.95)] },
    inputTokens,
    elapsedMs,
    perDoc,
    gate: {
      criterion: `每文档存在 θ：adoptedPrecision ≥ ${PRECISION_GATE} 且 adoptedCoverage ≥ ${COVERAGE_FLOOR}（覆盖门修订自 block115 的 0.50，理由：回写误报代价=多看一眼、漏报代价=治理缺账，随证据落档）`,
      passed: allRecommended,
      note: 'uiAudit 在生产有确定性硬规则（frontend/src → 必建议），校准曲线仍如实评模型判别力。',
    },
    verdict,
    perSample,
  };
}

async function main() {
  const corpus = loadCorpus();
  if (process.argv.slice(2).includes('--dry')) {
    const positives = {};
    for (const s of corpus.samples) for (const [k, v] of Object.entries(s.gold)) positives[k] = (positives[k] ?? 0) + (v ? 1 : 0);
    console.log(`语料 ${corpus.samples.length} 条：正例 ${JSON.stringify(positives)}`);
    console.log('--dry 语料校验通过（未发起任何网络请求）');
    return;
  }
  const supplyArg = process.argv.find((a) => a.startsWith('--supply='));
  const supply = supplyArg ? supplyArg.split('=')[1] : 'laya';
  if (supply !== 'laya' && supply !== 'cloud') throw new Error('--supply 只支持 laya|cloud');
  const overrides = resolveOverrides(supply);
  console.log(`供给：${overrides.model} @ ${overrides.baseUrl}`);
  const result = await calibrate(corpus, overrides);
  const evidence = {
    kind: 'block118-doc-suggest-calibration',
    version: '1.0.0',
    capturedAt: new Date().toISOString(),
    sourceCommit: require('node:child_process').execSync('git rev-parse HEAD', { cwd: root }).toString().trim(),
    wrapper: 'core/biof3-server/helpers/decision-api.js',
    decisionPoint: 'doc-suggest（dev-time，BLOCK-118 P1）',
    supply,
    result,
  };
  const out = path.join(root, 'acceptance', 'block-118', `calibration-doc-suggest-${supply}.json`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(evidence, null, 2) + '\n', 'utf8');
  console.log(`证据已写入 ${path.relative(root, out)}；gate.passed=${result.gate.passed}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
