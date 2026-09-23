#!/usr/bin/env node
/**
 * BLOCK-118 P0 — test-suggest 本地 Laya 供给校准（双供给裁决证据门）。
 *
 * 用法：
 *   node scripts/block118-laya-calibrate.mjs --dry    # 只验语料，零网络
 *   node scripts/block118-laya-calibrate.mjs          # 全量校准（供给=dev decision-config provider）
 *
 * 单源复用：语料与请求组装与 block115 harness 同源（scripts/block115-test-suggest.mjs 导出），
 * 形状漂移即校准失效。供给经 askDecision overrides 显式指定（读 dev decision-config.json
 * provider，防 cwd/data 推导漂移——BLOCK-117 抓真 2 先例），不触 env key、零 API 费用。
 *
 * 判据（沿 block115 P0 门，不放松）：存在 θ 使 adoptedPrecision@θ ≥ 0.80 且
 * adoptedCoverage@θ ≥ 0.50；overall argmax accuracy ≥ 0.80（诊断门）。
 * 双曲线：confidence 门控（现行契约语义，注册表采纳依据）+ top-probability 门控
 * （BLOCK-117 候选池「门控语义改换」诊断证据，不作为采纳依据）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const decisionApi = require('../core/biof3-server/helpers/decision-api.js');
const { buildSuggestDecisionRequest, docsOrEvidenceOnly } = require('../scripts/block115-test-suggest.mjs');
const { mapWithConcurrency, round4, sha256File } = await import('./lib/calibration-common.mjs');

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const CORPUS_FILE = path.join(root, 'acceptance', 'block-115', 'corpus-test-suggest.json');
const EVIDENCE_OUT = path.join(root, 'acceptance', 'block-118', 'calibration-test-suggest-laya.json');
const DEV_CONFIG = path.join(root, '.biof3-dev-user-data', 'data', 'decision-config.json');

const THETA_MIN = 0.05, THETA_MAX = 0.95, THETA_STEP = 0.05;
const PRECISION_GATE = 0.80, COVERAGE_FLOOR = 0.50, ACCURACY_GATE = 0.80;
const FAILURE_RATE_LIMIT = 0.10;
const CONCURRENCY = 5;

function loadCorpus() {
  const doc = JSON.parse(fs.readFileSync(CORPUS_FILE, 'utf8'));
  if (doc.samples.length < 100) throw new Error(`语料不足 100 条（现 ${doc.samples.length}）`);
  const validGolds = [...Object.keys(buildSuggestDecisionRequest(['x']).questions.area.criteria), 'none'];
  for (const s of doc.samples) {
    if (!Array.isArray(s) || s.length !== 4) throw new Error(`样本形状非法：${s[0]}`);
    if (!validGolds.includes(s[2])) throw new Error(`非法 gold：${s[0]}=${s[2]}`);
  }
  return { doc, samples: doc.samples, sha256: sha256File(CORPUS_FILE) };
}

function resolveLayaOverrides() {
  const doc = JSON.parse(fs.readFileSync(DEV_CONFIG, 'utf8'));
  const provider = doc && doc.provider;
  if (!provider || !provider.apiKey) throw new Error(`dev decision-config 无 provider（${DEV_CONFIG}）`);
  return {
    apiKey: provider.apiKey,
    baseUrl: String(provider.baseUrl || 'https://api.typesafe.ai').replace(/\/+$/, ''),
    model: provider.model || 'jev-1.13.0',
  };
}

/** θ 扫描。gateOf: (r) => 数值门控量（confidence 或 topProbability）。 */
function thetaGrid(routeable, gateOf) {
  const grid = [];
  for (let th = THETA_MIN; th <= THETA_MAX + 1e-9; th += THETA_STEP) {
    const adopted = routeable.filter((r) => r.choice !== 'none' && gateOf(r) >= th);
    const adoptedTrue = adopted.filter((r) => r.choice === r.gold).length;
    grid.push({
      theta: round4(th),
      adopted: adopted.length,
      adoptedCoverage: round4(adopted.length / routeable.length),
      adoptedPrecision: adopted.length ? round4(adoptedTrue / adopted.length) : 1,
    });
  }
  const eligible = grid.filter((g) => g.adoptedPrecision >= PRECISION_GATE && g.adoptedCoverage >= COVERAGE_FLOOR);
  eligible.sort((a, b) => b.adoptedCoverage - a.adoptedCoverage);
  return { grid, recommended: eligible[0] ?? null };
}

async function calibrate(corpus, overrides) {
  const t0 = Date.now();
  let inputTokens = 0;
  let failures = 0;
  const responseModels = new Set();
  const perSample = await mapWithConcurrency(corpus.samples, CONCURRENCY, async ([id, changedFiles, gold, group]) => {
    const files = changedFiles.split(',').map((x) => x.trim()).filter(Boolean);
    const { state, questions } = buildSuggestDecisionRequest(files);
    const outcome = await decisionApi.askDecision({ state, questions, overrides });
    if (!outcome.ok) {
      failures++;
      return { id, group, gold, ok: false, reason: outcome.reason };
    }
    const a = outcome.answers.area;
    responseModels.add(outcome.model);
    inputTokens += outcome.usage?.input_tokens ?? 0;
    if (docsOrEvidenceOnly(files)) return { id, group, gold, ok: true, docsEvidence: true, choice: 'none', correct: gold === 'none', confidence: 1, topProbability: 1 };
    const probs = a.probabilities || {};
    return {
      id, group, gold, ok: true,
      choice: a.choice,
      confidence: round4(a.confidence),
      topProbability: round4(probs[a.choice] ?? 0),
      correct: a.choice === gold,
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
  const routeable = valid.filter((r) => !r.docsEvidence);
  const argmaxCorrect = valid.filter((r) => r.correct).length;
  const latency = valid.map((r) => r.elapsedMs).sort((a, b) => a - b);

  const confidenceCurve = thetaGrid(routeable, (r) => r.confidence);
  const probabilityCurve = thetaGrid(routeable, (r) => r.topProbability);
  const bestAny = (curve) => [...curve.grid].sort((a, b) => b.adoptedCoverage - a.adoptedCoverage || b.adoptedPrecision - a.adoptedPrecision)[0];

  const gatePassed = confidenceCurve.recommended !== null && argmaxCorrect / valid.length >= ACCURACY_GATE;
  const verdict = gatePassed
    ? `可采纳：confidence 门 θ=${confidenceCurve.recommended.theta}（precision=${confidenceCurve.recommended.adoptedPrecision}/coverage=${confidenceCurve.recommended.adoptedCoverage}）`
    : `不可采纳：confidence 门控语义下无达门槛 θ（最优=${JSON.stringify(bestAny(confidenceCurve))}）；如需启用须门控语义改换（top-probability 曲线仅作候选池诊断证据，属契约变更另裁）`;
  console.log(`\n裁决：${verdict}`);
  console.log(`top-probability 诊断曲线推荐：${probabilityCurve.recommended ? `θ=${probabilityCurve.recommended.theta} precision=${probabilityCurve.recommended.adoptedPrecision} coverage=${probabilityCurve.recommended.adoptedCoverage}` : '无达标 θ（最优 ' + JSON.stringify(bestAny(probabilityCurve)) + '）'}`);

  return {
    corpus: { file: 'acceptance/block-115/corpus-test-suggest.json', sha256: corpus.sha256, count: corpus.samples.length },
    supply: { baseUrl: overrides.baseUrl, requestModel: overrides.model, responseModels: [...responseModels] },
    apiFailures: failures,
    validCount: valid.length,
    argmaxTop1Accuracy: round4(argmaxCorrect / valid.length),
    latency: { p50Ms: latency[Math.floor(latency.length * 0.5)], p95Ms: latency[Math.floor(latency.length * 0.95)] },
    inputTokens,
    elapsedMs,
    confidenceGate: { ...confidenceCurve, gate: { precision: PRECISION_GATE, coverage: COVERAGE_FLOOR }, verdict: gatePassed ? 'adoptable' : 'not_adoptable' },
    topProbabilityDiagnostic: probabilityCurve,
    gate: {
      criterion: `存在 θ：adoptedPrecision ≥ ${PRECISION_GATE} 且 adoptedCoverage ≥ ${COVERAGE_FLOOR}；且 overall argmax accuracy ≥ ${ACCURACY_GATE}（诊断门）`,
      passed: gatePassed,
      note: 'BLOCK-118 P0：门控语义=confidence（与注册表/生产契约一致）；top-probability 曲线仅为候选池诊断证据，采纳与否另裁。',
    },
    verdict,
    perSample,
  };
}

async function main() {
  const corpus = loadCorpus();
  if (process.argv.slice(2).includes('--dry')) {
    const byGold = {};
    for (const [, , gold] of corpus.samples) byGold[gold] = (byGold[gold] ?? 0) + 1;
    console.log(`语料 ${corpus.samples.length} 条：${JSON.stringify(byGold)}`);
    console.log('--dry 语料校验通过（未发起任何网络请求）');
    return;
  }

  const overrides = resolveLayaOverrides();
  console.log(`供给：${overrides.model} @ ${overrides.baseUrl}（dev decision-config provider，零云 API 费用）`);
  const result = await calibrate(corpus, overrides);
  const evidence = {
    kind: 'block118-test-suggest-laya-calibration',
    version: '1.0.0',
    capturedAt: new Date().toISOString(),
    sourceCommit: require('node:child_process').execSync('git rev-parse HEAD', { cwd: root }).toString().trim(),
    wrapper: 'core/biof3-server/helpers/decision-api.js',
    decisionPoint: 'test-suggest（dev-time，BLOCK-118 双供给）',
    result,
  };
  fs.mkdirSync(path.dirname(EVIDENCE_OUT), { recursive: true });
  fs.writeFileSync(EVIDENCE_OUT, JSON.stringify(evidence, null, 2) + '\n', 'utf8');
  console.log(`证据已写入 ${path.relative(root, EVIDENCE_OUT)}；gate.passed=${result.gate.passed}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
