#!/usr/bin/env node
/**
 * BLOCK-111 P0 — marker→细胞类型判别 Jev choice 校准 harness（plan §3 P0 / §5 证据门）。
 *
 * 用途：用公开发表 marker 知识构建的 104 条标注语料，实测 jev-1.13.0 choice 题型在
 *      「规则表候选集内挑选 + confidence」上的表现，产出 P1 门控阈值初值，
 *      证据落 acceptance/block-111/calibration.json。
 *
 * 用法：
 *   node scripts/block111-p0-calibrate.mjs --dry   # 只校验语料/候选推导一致性，零网络
 *   node scripts/block111-p0-calibrate.mjs         # 全量校准（需 TYPESAFE_API_KEY）
 *
 * 纪律（镜像 block110-calibrate.mjs）：key 只从 env 读；API 失败率 >10% 判不可信退出非零；
 *      候选集由 CELL_MARKERS 规则表按 lookupCellType 同一语义（matches≥2）推导——
 *      模型只挑不造（plan §6 红线），语料不存储候选（规则表是唯一事实源）。
 *      P0 通过判据（评审可改）：存在 θ 使 adoptedAccuracy≥0.95 且 coverage≥0.85
 *      且 trapFalseAdoption≤0.05。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const decisionApi = require('../core/biof3-server/helpers/decision-api.js');
// P1 起候选生成与请求组装单源于 interpret.js（字节同形迁移，契约测试钉住形状）。
const {
  deriveMarkerCandidates,
  buildMarkerDecisionRequest,
} = require('../core/biof3-server/helpers/interpret.js');

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const evidenceDir = path.join(root, 'acceptance', 'block-111');
const CORPUS_FILE = 'corpus-marker-celltype.json';

const THETA_MIN = 0.3, THETA_MAX = 0.95, THETA_STEP = 0.05;
const COVERAGE_FLOOR = 0.85, ACCURACY_GATE = 0.95, TRAP_FALSE_ADOPTION_MAX = 0.05;
const FAILURE_RATE_LIMIT = 0.10;
const CONCURRENCY = 5;

const TRAP_GOLD = '双细胞/混杂（应低置信回退）';

const deriveCandidates = deriveMarkerCandidates;

function sha256File(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

function loadCorpus() {
  const corpusPath = path.join(evidenceDir, CORPUS_FILE);
  const doc = JSON.parse(fs.readFileSync(corpusPath, 'utf8'));
  const samples = doc.samples;
  if (samples.length < 100) throw new Error(`语料不足 100 条（现 ${samples.length}）`);
  for (const s of samples) {
    if (!Array.isArray(s) || s.length !== 4) throw new Error(`样本形状非法：${JSON.stringify(s[0])}`);
  }
  return { doc, samples, sha256: sha256File(corpusPath) };
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

/** --dry：零网络，校验语料完整性与「kind ↔ 推导候选集」一致性。 */
function validateOnly(corpus) {
  const problems = [];
  const byKind = {};
  for (const [id, markers, gold, kind] of corpus.samples) {
    byKind[kind] = (byKind[kind] ?? 0) + 1;
    const candidates = deriveCandidates(markers);
    const goldInCandidates = candidates.some((c) => c.type === gold);
    if (kind === 'empty') {
      if (gold !== null) problems.push(`${id}: empty 样本 gold 应为 null`);
      if (candidates.length !== 0) problems.push(`${id}: 期望零候选，实得 ${candidates.map((c) => c.type).join('|')}`);
    } else if (kind === 'trap') {
      if (gold !== TRAP_GOLD) problems.push(`${id}: trap 样本 gold 应为固定串`);
      if (candidates.length < 2) problems.push(`${id}: trap 应命中 ≥2 条规则制造强制选择，实得 ${candidates.length}`);
    } else {
      if (candidates.length === 0) problems.push(`${id}: 期望有候选，实得零候选`);
      if (!goldInCandidates) problems.push(`${id}: gold「${gold}」不在推导候选集 [${candidates.map((c) => c.type).join('|')}]`);
      if (kind === 'ambiguous' && candidates.length < 2) problems.push(`${id}: ambiguous 应 ≥2 候选，实得 ${candidates.length}`);
      if ((kind === 'canonical' || kind === 'partial' || kind === 'noisy') && candidates.length !== 1) {
        problems.push(`${id}: 单一真值面板应恰 1 候选，实得 ${candidates.length}`);
      }
    }
  }
  console.log(`语料 ${corpus.samples.length} 条：${JSON.stringify(byKind)}`);
  if (problems.length) {
    console.error(`一致性校验 ${problems.length} 处失败：\n` + problems.map((p) => `  - ${p}`).join('\n'));
    process.exit(1);
  }
  const evaluable = corpus.samples.filter((s) => s[3] !== 'empty').length;
  const traps = corpus.samples.filter((s) => s[3] === 'trap').length;
  console.log(`choice 可评估 ${evaluable} 条（trap 占 ${round4(traps / evaluable * 100)}%）；--dry 语料校验通过（未发起任何网络请求）`);
}

async function calibrate(corpus) {
  const emptySamples = corpus.samples.filter((s) => s[3] === 'empty');
  const evaluableSamples = corpus.samples.filter((s) => s[3] !== 'empty');
  console.log(`语料 ${corpus.samples.length} 条：choice 可评估 ${evaluableSamples.length}，零候选边界 ${emptySamples.length}（不出站）`);

  const t0 = Date.now();
  let inputTokens = 0;
  let failures = 0;
  const perSample = await mapWithConcurrency(evaluableSamples, CONCURRENCY, async (s) => {
    const [id, markers, gold, kind] = s;
    const candidates = deriveCandidates(markers);
    const { state, questions } = buildMarkerDecisionRequest(markers, candidates);
    const outcome = await decisionApi.askDecision({ state, questions });
    if (!outcome.ok) {
      failures++;
      return { id, kind, gold, candidates: candidates.map((c) => c.type), ok: false, reason: outcome.reason };
    }
    const a = outcome.answers.cell_type;
    inputTokens += outcome.usage?.input_tokens ?? 0;
    return {
      id, kind, gold,
      candidates: candidates.map((c) => c.type),
      ok: true,
      choice: a.choice,
      confidence: round4(a.confidence),
      probabilities: a.probabilities,
      correct: a.choice === gold,
      elapsedMs: outcome.elapsedMs,
      attempts: outcome.attempts,
    };
  });
  const elapsedMs = Date.now() - t0;

  const failureRate = failures / evaluableSamples.length;
  if (failureRate > FAILURE_RATE_LIMIT) {
    console.error(`API 失败率 ${(failureRate * 100).toFixed(1)}% 超限（${failures}/${evaluableSamples.length}），校准结果不可信，终止。`);
    process.exit(2);
  }
  const valid = perSample.filter((r) => r.ok);
  const goldIn = valid.filter((r) => r.kind !== 'trap');
  const traps = valid.filter((r) => r.kind === 'trap');

  const argmaxCorrect = goldIn.filter((r) => r.correct).length;
  const latency = valid.map((r) => r.elapsedMs).sort((a, b) => a - b);

  // 阈值网格：conf≥θ 采纳（附置信度），否则回退现行字符串；trap 只看误采纳率
  const grid = [];
  for (let th = THETA_MIN; th <= THETA_MAX + 1e-9; th += THETA_STEP) {
    const adopted = goldIn.filter((r) => r.confidence >= th);
    const trapAdopted = traps.filter((r) => r.confidence >= th).length;
    grid.push({
      theta: round4(th),
      adopted: adopted.length,
      coverage: round4(adopted.length / goldIn.length),
      adoptedAccuracy: adopted.length ? round4(adopted.filter((r) => r.correct).length / adopted.length) : 0,
      trapFalseAdoption: traps.length ? round4(trapAdopted / traps.length) : 0,
    });
  }
  const eligible = grid.filter((g) => g.coverage >= COVERAGE_FLOOR && g.adoptedAccuracy >= ACCURACY_GATE && g.trapFalseAdoption <= TRAP_FALSE_ADOPTION_MAX);
  eligible.sort((a, b) => b.coverage - a.coverage || b.adoptedAccuracy - a.adoptedAccuracy);
  const recommended = eligible[0] ?? null;
  const bestAnyCoverage = [...grid].sort((a, b) => b.coverage - a.coverage || b.adoptedAccuracy - a.adoptedAccuracy)[0];
  if (recommended) {
    console.log(`推荐阈值：conf≥${recommended.theta} → coverage=${recommended.coverage} adoptedAccuracy=${recommended.adoptedAccuracy} trapFalseAdoption=${recommended.trapFalseAdoption}`);
  } else {
    console.log(`⚠ 未找到达门槛（acc≥${ACCURACY_GATE} & cov≥${COVERAGE_FLOOR} & trap≤${TRAP_FALSE_ADOPTION_MAX}）的阈值；最优可达=${JSON.stringify(bestAnyCoverage)}`);
  }

  // 现行基线：lookupCellType 语义（首个最高分命中，无置信度）
  const legacyCorrect = goldIn.filter((r) => {
    const best = deriveCandidates(evaluableSamples.find((s) => s[0] === r.id)[1])[0];
    return best && best.type === r.gold;
  }).length;

  const mean = (arr) => arr.reduce((a, b) => a + b, 0) / Math.max(arr.length, 1);
  return {
    corpus: { file: CORPUS_FILE, sha256: corpus.sha256, count: corpus.samples.length, choiceEvaluable: evaluableSamples.length, emptyBoundary: emptySamples.length },
    apiFailures: failures,
    validCount: valid.length,
    argmaxTop1Accuracy: round4(argmaxCorrect / goldIn.length),
    legacyBaselineAccuracy: round4(legacyCorrect / goldIn.length),
    trapMeanConfidence: round4(mean(traps.map((r) => r.confidence))),
    goldInMeanConfidence: round4(mean(goldIn.map((r) => r.confidence))),
    byKind: Object.fromEntries(['canonical', 'partial', 'noisy', 'ambiguous', 'trap'].map((k) => {
      const rs = valid.filter((r) => r.kind === k);
      return [k, { count: rs.length, argmaxAccuracy: round4(rs.filter((r) => r.correct).length / Math.max(rs.length, 1)), meanConfidence: round4(mean(rs.map((r) => r.confidence))) }];
    })),
    latency: { p50Ms: latency[Math.floor(latency.length * 0.5)], p95Ms: latency[Math.floor(latency.length * 0.95)] },
    inputTokens,
    elapsedMs,
    recommendedThreshold: recommended,
    bestOutsideGate: recommended ? null : bestAnyCoverage,
    grid: grid.map((g) => ({ ...g, correct: undefined })),
    perSample,
  };
}

async function main() {
  const corpus = loadCorpus();
  const args = process.argv.slice(2);
  if (args.includes('--dry')) { validateOnly(corpus); return; }

  if (decisionApi.resolveDecisionConfig() === null) {
    console.error('TYPESAFE_API_KEY 未设置：校准必须真实 API 实测（不得伪造证据）。设置后重跑；或用 --dry 只验语料。');
    process.exit(1);
  }

  const result = await calibrate(corpus);

  const gate = {
    criterion: `存在 θ：adoptedAccuracy ≥ ${ACCURACY_GATE} 且 coverage ≥ ${COVERAGE_FLOOR} 且 trapFalseAdoption ≤ ${TRAP_FALSE_ADOPTION_MAX}（conf<θ 一律回退现行字符串）`,
    passed: result.recommendedThreshold !== null,
    note: 'P0 通过判据为立项时提案，P0 评审（D-1~D-5 裁决）可修订；argmaxTop1Accuracy 为诊断指标（未门控），门控后指标以 adoptedAccuracy 为准。',
  };

  const evidence = {
    kind: 'block111-calibration',
    version: '1.0.0',
    capturedAt: new Date().toISOString(),
    sourceCommit: require('node:child_process').execSync('git rev-parse HEAD', { cwd: root }).toString().trim(),
    model: decisionApi.DECISION_MODEL_PIN,
    wrapper: 'core/biof3-server/helpers/decision-api.js',
    decisionPoint: 'interpret.js lookupCellType 二跳（W1-1 marker→细胞类型判别）',
    result,
    gate,
  };

  const outPath = path.join(evidenceDir, 'calibration.json');
  fs.writeFileSync(outPath, JSON.stringify(evidence, null, 2) + '\n', 'utf8');
  console.log(`\n证据已写入 ${path.relative(root, outPath)}；gate.passed=${gate.passed}`);
  if (!gate.passed) process.exit(3);
}

main().catch((err) => { console.error(err); process.exit(1); });
