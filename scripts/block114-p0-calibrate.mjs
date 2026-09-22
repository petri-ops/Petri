#!/usr/bin/env node
/**
 * BLOCK-114 P0 — L3 语义残差层校准 harness（plan §4 P0 证据门）。
 *
 * 用途：104 条四类失败样本，实测 jev-1.13.0 choice 对「语义残差失败归因」的表现，
 *      产出 L3 门控阈值初值，证据落 acceptance/block-114/calibration.json。
 *
 * 用法：
 *   node scripts/block114-p0-calibrate.mjs --dry   # 只验语料（含「不命中 L2 词表」断言），零网络
 *   node scripts/block114-p0-calibrate.mjs         # 全量校准（需 TYPESAFE_API_KEY）
 *
 * P0 通过判据（评审可改）：存在 θ 使 adoptedPrecision@θ ≥ 0.95 且
 * nrMisroute@θ = 0（gold=new_regression 被采纳为非回归——零容忍）且
 * adoptedCoverage@θ ≥ 0.60；overall argmax accuracy ≥ 0.85（诊断门）。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const decisionApi = require('../core/biof3-server/helpers/decision-api.js');
// 单源：L3 请求组装与 L2 词表均引用 triage-core（形状漂移即校准失效）。
const { buildTriageDecisionRequest, matchesEnvironmentPattern } = require('../scripts/lib/block114-triage-core.mjs');

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const evidenceDir = path.join(root, 'acceptance', 'block-114');
const CORPUS_FILE = 'corpus-failure-triage.json';

const THETA_MIN = 0.5, THETA_MAX = 0.95, THETA_STEP = 0.05;
const PRECISION_GATE = 0.95, COVERAGE_FLOOR = 0.60, ACCURACY_GATE = 0.85;
const FAILURE_RATE_LIMIT = 0.10;
const CONCURRENCY = 5;

function sha256File(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

function loadCorpus() {
  const corpusPath = path.join(evidenceDir, CORPUS_FILE);
  const doc = JSON.parse(fs.readFileSync(corpusPath, 'utf8'));
  if (doc.samples.length < 100) throw new Error(`语料不足 100 条（现 ${doc.samples.length}）`);
  return { doc, samples: doc.samples, sha256: sha256File(corpusPath) };
}

async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function round4(n) { return Math.round(n * 10000) / 10000; }

function validateOnly(corpus) {
  const problems = [];
  const byGold = {};
  for (const [id, testFile, testName, errorText, gold] of corpus.samples) {
    byGold[gold] = (byGold[gold] ?? 0) + 1;
    // L3 语料约束：errorText 不得命中 L2 确定性词表（否则生产路径不会进 L3）
    if (matchesEnvironmentPattern(errorText)) problems.push(`${id}: errorText 命中 L2 词表（生产不会进 L3）`);
    if (!testFile || !testName || !errorText) problems.push(`${id}: 字段缺失`);
  }
  console.log(`语料 ${corpus.samples.length} 条：${JSON.stringify(byGold)}`);
  if (problems.length) {
    console.error(`校验失败：\n` + problems.map((x) => `  - ${x}`).join('\n'));
    process.exit(1);
  }
  console.log(`--dry 语料校验通过（未发起任何网络请求）`);
}

async function calibrate(corpus) {
  const t0 = Date.now();
  let inputTokens = 0;
  let failures = 0;
  const perSample = await mapWithConcurrency(corpus.samples, CONCURRENCY, async ([id, testFile, testName, errorText, gold, group]) => {
    const { state, questions } = buildTriageDecisionRequest({ testFile, testName, errorText });
    const outcome = await decisionApi.askDecision({ state, questions });
    if (!outcome.ok) {
      failures++;
      return { id, group, gold, ok: false, reason: outcome.reason };
    }
    const a = outcome.answers.attribution;
    inputTokens += outcome.usage?.input_tokens ?? 0;
    return {
      id, group, gold, ok: true,
      choice: a.choice,
      confidence: round4(a.confidence),
      // gold 映射：L3 三类下 new_regression/known_existing 的正确 choice=defect
      //（known_existing 由 L1 独占；defect=「需人工关注的缺陷类失败」）
      correct: a.choice === (gold === 'new_regression' || gold === 'known_existing' ? 'defect' : gold),
      elapsedMs: outcome.elapsedMs,
    };
  });
  const elapsedMs = Date.now() - t0;

  const failureRate = failures / corpus.samples.length;
  if (failureRate > FAILURE_RATE_LIMIT) {
    console.error(`API 失败率 ${(failureRate * 100).toFixed(1)}% 超限（${failures}/${corpus.samples.length}），终止。`);
    process.exit(2);
  }
  const valid = perSample.filter((r) => r.ok);

  const argmaxCorrect = valid.filter((r) => r.correct).length;
  const latency = valid.map((r) => r.elapsedMs).sort((a, b) => a - b);

  // θ 网格（镜像生产 L3 语义）：choice=new_regression 保守采纳；其余 conf≥θ 采纳
  const grid = [];
  for (let th = THETA_MIN; th <= THETA_MAX + 1e-9; th += THETA_STEP) {
    const adopted = [];
    let nrMisroute = 0;
    for (const r of valid) {
      if (r.choice === 'defect') adopted.push(r);
      else if (r.confidence >= th) {
        adopted.push(r);
        if (r.gold === 'new_regression') nrMisroute++;
      }
    }
    const adoptedTrue = adopted.filter((r) => (r.choice === 'defect' ? (r.gold === 'new_regression' || r.gold === 'known_existing') : r.choice === r.gold)).length;
    grid.push({
      theta: round4(th),
      adopted: adopted.length,
      adoptedCoverage: round4(adopted.length / valid.length),
      adoptedPrecision: adopted.length ? round4(adoptedTrue / adopted.length) : 1,
      nrMisroute,
    });
  }
  const eligible = grid.filter((g) => g.adoptedPrecision >= PRECISION_GATE && g.nrMisroute === 0 && g.adoptedCoverage >= COVERAGE_FLOOR);
  eligible.sort((a, b) => b.adoptedCoverage - a.adoptedCoverage);
  const recommended = eligible[0] ?? null;
  const bestAny = [...grid].sort((a, b) => b.adoptedCoverage - a.adoptedCoverage || b.adoptedPrecision - a.adoptedPrecision)[0];
  if (recommended) {
    console.log(`推荐阈值：θ≥${recommended.theta} → coverage=${recommended.adoptedCoverage} precision=${recommended.adoptedPrecision} nrMisroute=${recommended.nrMisroute}`);
  } else {
    console.log(`⚠ 未找到达门槛的阈值；最优可达=${JSON.stringify(bestAny)}`);
  }

  const mean = (arr) => arr.reduce((a, b) => a + b, 0) / Math.max(arr.length, 1);
  return {
    corpus: { file: CORPUS_FILE, sha256: corpus.sha256, count: corpus.samples.length },
    apiFailures: failures,
    validCount: valid.length,
    argmaxTop1Accuracy: round4(argmaxCorrect / valid.length),
    byGold: Object.fromEntries(['defect', 'environment', 'flaky'].map((k) => {
      const rs = valid.filter((r) => (r.gold === 'new_regression' || r.gold === 'known_existing' ? 'defect' : r.gold) === k);
      return [k, {
        count: rs.length,
        argmaxAccuracy: round4(rs.filter((r) => r.correct).length / Math.max(rs.length, 1)),
        meanConfidence: round4(mean(rs.map((r) => r.confidence))),
      }];
    })),
    latency: { p50Ms: latency[Math.floor(latency.length * 0.5)], p95Ms: latency[Math.floor(latency.length * 0.95)] },
    inputTokens,
    elapsedMs,
    recommendedThreshold: recommended,
    bestOutsideGate: recommended ? null : bestAny,
    grid,
    perSample,
  };
}

async function main() {
  const corpus = loadCorpus();
  if (process.argv.slice(2).includes('--dry')) { validateOnly(corpus); return; }

  if (decisionApi.resolveDecisionConfig() === null) {
    console.error('TYPESAFE_API_KEY 未设置：校准必须真实 API 实测（不得伪造证据）。');
    process.exit(1);
  }

  const result = await calibrate(corpus);
  const gate = {
    criterion: `存在 θ：adoptedPrecision ≥ ${PRECISION_GATE} 且 nrMisroute = 0 且 adoptedCoverage ≥ ${COVERAGE_FLOOR}；且 overall argmax accuracy ≥ ${ACCURACY_GATE}（诊断门）`,
    passed: result.recommendedThreshold !== null && result.argmaxTop1Accuracy >= ACCURACY_GATE,
    note: 'P0 评审修正（2026-09-22，证据驱动）：首轮四类校准 known_existing argmax 仅 39.3%——「在册与否」是登记表属性非文本语义（认识论不可判），D-1 修正为 L3 三类（defect/environment/flaky），known_existing 由 L1 登记表独占；defect 采纳即输出 new_regression（保守方向交人工）。nrMisroute=0 为 D-3 零容忍。',
  };

  const evidence = {
    kind: 'block114-calibration',
    version: '1.0.0',
    capturedAt: new Date().toISOString(),
    sourceCommit: require('node:child_process').execSync('git rev-parse HEAD', { cwd: root }).toString().trim(),
    model: decisionApi.DECISION_MODEL_PIN,
    wrapper: 'core/biof3-server/helpers/decision-api.js',
    decisionPoint: 'scripts/lib/block114-triage-core.mjs L3 语义残差层（W1-4 测试失败归因）',
    result,
    gate,
  };

  const outPath = path.join(evidenceDir, 'calibration.json');
  fs.writeFileSync(outPath, JSON.stringify(evidence, null, 2) + '\n', 'utf8');
  console.log(`\n证据已写入 ${path.relative(root, outPath)}；gate.passed=${gate.passed}`);
  if (!gate.passed) process.exit(3);
}

main().catch((err) => { console.error(err); process.exit(1); });
