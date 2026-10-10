#!/usr/bin/env node
/**
 * BLOCK-115 P0 — 增量测试建议 choice 校准 harness（plan §4 P0 证据门）。
 *
 * 用法：
 *   node scripts/block115-p0-calibrate.mjs --dry   # 只验语料，零网络
 *   node scripts/block115-p0-calibrate.mjs         # 全量校准（需 TYPESAFE_API_KEY）
 *
 * P0 通过判据（评审可改）：存在 θ 使 adoptedPrecision@θ ≥ 0.80 且
 * adoptedCoverage@θ ≥ 0.50；overall argmax accuracy ≥ 0.80（诊断门）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const decisionApi = require('../core/petri-server/helpers/decision-api.js');
// 单源：请求组装引用建议器内核（形状漂移即校准失效）。
const { buildSuggestDecisionRequest, docsOrEvidenceOnly } = require('../scripts/block115-test-suggest.mjs');
// BLOCK-116 校准工具化：机械共性迁移到共享库（touch-and-migrate 纪律）
import {
  mapWithConcurrency as sharedMapWithConcurrency,
  round4 as sharedRound4,
  sha256File as sharedSha256File,
} from './lib/calibration-common.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const evidenceDir = path.join(root, 'acceptance', 'block-115');
const CORPUS_FILE = 'corpus-test-suggest.json';

const THETA_MIN = 0.5, THETA_MAX = 0.95, THETA_STEP = 0.05;
const PRECISION_GATE = 0.80, COVERAGE_FLOOR = 0.50, ACCURACY_GATE = 0.80;
const FAILURE_RATE_LIMIT = 0.10;
const CONCURRENCY = 5;

const sha256File = sharedSha256File;

function loadCorpus() {
  const corpusPath = path.join(evidenceDir, CORPUS_FILE);
  const doc = JSON.parse(fs.readFileSync(corpusPath, 'utf8'));
  if (doc.samples.length < 100) throw new Error(`语料不足 100 条（现 ${doc.samples.length}）`);
  const validGolds = [...Object.keys(buildSuggestDecisionRequest(['x']).questions.area.criteria), 'none'];
  for (const s of doc.samples) {
    if (!Array.isArray(s) || s.length !== 4) throw new Error(`样本形状非法：${s[0]}`);
    if (!validGolds.includes(s[2])) throw new Error(`非法 gold：${s[0]}=${s[2]}`);
  }
  return { doc, samples: doc.samples, sha256: sha256File(corpusPath) };
}

const mapWithConcurrency = sharedMapWithConcurrency;
const round4 = sharedRound4;

function validateOnly(corpus) {
  const byGold = {};
  for (const [, , gold] of corpus.samples) byGold[gold] = (byGold[gold] ?? 0) + 1;
  console.log(`语料 ${corpus.samples.length} 条：${JSON.stringify(byGold)}`);
  console.log('--dry 语料校验通过（未发起任何网络请求）');
}

async function calibrate(corpus) {
  const t0 = Date.now();
  let inputTokens = 0;
  let failures = 0;
  const perSample = await mapWithConcurrency(corpus.samples, CONCURRENCY, async ([id, changedFiles, gold, group]) => {
    const { state, questions } = buildSuggestDecisionRequest(changedFiles.split(',').map((x) => x.trim()).filter(Boolean));
    const outcome = await decisionApi.askDecision({ state, questions });
    if (!outcome.ok) {
      failures++;
      return { id, group, gold, ok: false, reason: outcome.reason };
    }
    const a = outcome.answers.area;
    inputTokens += outcome.usage?.input_tokens ?? 0;
    const docsEvidence = docsOrEvidenceOnly(changedFiles.split(',').map((x) => x.trim()).filter(Boolean));
    if (docsEvidence) return { id, group, gold, ok: true, docsEvidence: true, choice: 'none', correct: gold === 'none', confidence: 1 };
    return {
      id, group, gold, ok: true,
      choice: a.choice,
      confidence: round4(a.confidence),
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
  // 生产前置层镜像：docs/acceptance-only 改动在 L3 之前零出站零建议（确定性 none）
  const routeable = valid.filter((r) => !r.docsEvidence);

  const argmaxCorrect = valid.filter((r) => r.correct).length;
  const latency = valid.map((r) => r.elapsedMs).sort((a, b) => a - b);

  // θ 网格：choice≠none 且 conf≥θ 才出建议（弃权/低置信=零建议）
  const grid = [];
  for (let th = THETA_MIN; th <= THETA_MAX + 1e-9; th += THETA_STEP) {
    const adopted = routeable.filter((r) => r.choice !== 'none' && r.confidence >= th);
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
  const recommended = eligible[0] ?? null;
  const bestAny = [...grid].sort((a, b) => b.adoptedCoverage - a.adoptedCoverage || b.adoptedPrecision - a.adoptedPrecision)[0];
  if (recommended) {
    console.log(`推荐阈值：θ≥${recommended.theta} → coverage=${recommended.adoptedCoverage} precision=${recommended.adoptedPrecision}`);
  } else {
    console.log(`⚠ 未找到达门槛的阈值；最优可达=${JSON.stringify(bestAny)}`);
  }

  return {
    corpus: { file: CORPUS_FILE, sha256: corpus.sha256, count: corpus.samples.length },
    apiFailures: failures,
    validCount: valid.length,
    argmaxTop1Accuracy: round4(argmaxCorrect / valid.length),
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
    criterion: `存在 θ：adoptedPrecision ≥ ${PRECISION_GATE} 且 adoptedCoverage ≥ ${COVERAGE_FLOOR}；且 overall argmax accuracy ≥ ${ACCURACY_GATE}（诊断门）`,
    passed: result.recommendedThreshold !== null && result.argmaxTop1Accuracy >= ACCURACY_GATE,
    note: 'P0 通过判据为立项时提案，P0 评审（D-1~D-5 裁决）可修订；误报代价=多跑一个测试（低危害），故精度门 0.80 低于其他接点。',
  };

  const evidence = {
    kind: 'block115-calibration',
    version: '1.0.0',
    capturedAt: new Date().toISOString(),
    sourceCommit: require('node:child_process').execSync('git rev-parse HEAD', { cwd: root }).toString().trim(),
    model: decisionApi.DECISION_MODEL_PIN,
    wrapper: 'core/petri-server/helpers/decision-api.js',
    decisionPoint: 'scripts/block115-test-suggest.mjs 增量测试建议（W1-5）',
    result,
    gate,
  };

  const outPath = path.join(evidenceDir, 'calibration.json');
  fs.writeFileSync(outPath, JSON.stringify(evidence, null, 2) + '\n', 'utf8');
  console.log(`\n证据已写入 ${path.relative(root, outPath)}；gate.passed=${gate.passed}`);
  if (!gate.passed) process.exit(3);
}

main().catch((err) => { console.error(err); process.exit(1); });
