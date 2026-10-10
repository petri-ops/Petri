#!/usr/bin/env node
/**
 * BLOCK-110 P0 — Jev 中文校准 harness（plan §1.1 P0 交付③）。
 *
 * 用途：用自有中文标注语料实测 jev-1.13.0 的 confidence-accuracy 表现，
 *      产出 P1/P2 门控阈值初值，证据落 acceptance/block-110/calibration.json。
 *
 * 用法：
 *   node scripts/block110-calibrate.mjs --dry                 # 只校验语料完整性与平衡，零网络
 *   node scripts/block110-calibrate.mjs                       # 全量校准（需 TYPESAFE_API_KEY）
 *   node scripts/block110-calibrate.mjs --domain topic-shift  # 只跑单个域
 *
 * 纪律：key 只从 env 读（plan §0 key 裁决）；失败率 >10% 判 API 不稳定退出非零；
 *      阈值推荐=在 coverage≥0.85 约束下最大化 decidedAccuracy（中间带=回退现行为）。
 *      P0 通过判据（评审可改）：存在阈值对使 decidedAccuracy≥0.85 且 coverage≥0.85。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const decisionApi = require('../core/petri-server/helpers/decision-api.js');

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const evidenceDir = path.join(root, 'acceptance', 'block-110');

const DOMAINS = {
  'topic-shift': {
    corpus: 'corpus-topic-shift.json',
    build: (s) => ({
      state: `之前的对话：\n${composeTurns(s[1])}\n\n刚刚的对话：\n${composeTurns(s[2])}`,
      questions: {
        topic_shift: {
          type: 'noul',
          instructions: '「刚刚的对话」是否明显切换到了与「之前的对话」完全不同的新话题？同一话题的延续、追问或细节扩展不算切换。模糊不清按否。',
        },
      },
    }),
    readNoul: (answers) => answers.topic_shift.noul,
  },
  retrieval: {
    corpus: 'corpus-retrieval.json',
    build: (s) => ({
      state: `用户问题：${s[1]}\n\n候选段落：${s[2]}`,
      questions: {
        relevant: {
          type: 'noul',
          instructions: '「候选段落」是否实质性回答了「用户问题」所问的信息？仅主题相关但不含答案内容不算回答。模糊不清按否。',
        },
      },
    }),
    readNoul: (answers) => answers.relevant.noul,
  },
};

const YES_MIN = 0.5, YES_MAX = 0.95, NO_MIN = 0.05, NO_MAX = 0.5, STEP = 0.05;
const COVERAGE_FLOOR = 0.85, ACCURACY_GATE = 0.85, FAILURE_RATE_LIMIT = 0.10;
const CONCURRENCY = 5;

function composeTurns(turns) {
  return turns.map(([role, content]) => `${role}: ${String(content).slice(0, 200)}`).join('\n');
}

function sha256File(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

function loadCorpus(domain) {
  const conf = DOMAINS[domain];
  const corpusPath = path.join(evidenceDir, conf.corpus);
  const doc = JSON.parse(fs.readFileSync(corpusPath, 'utf8'));
  const samples = doc.samples;
  if (samples.length < 30) throw new Error(`${domain} 语料不足 30 条`);
  for (const s of samples) {
    if (!Array.isArray(s) || s.length !== 4) throw new Error(`${domain} 样本形状非法：${s[0]}`);
  }
  const positives = samples.filter((s) => s[3] === true).length;
  return { doc, samples, positives, negatives: samples.length - positives, sha256: sha256File(corpusPath) };
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

async function runDomain(domain) {
  const conf = DOMAINS[domain];
  const corpus = loadCorpus(domain);
  console.log(`\n== ${domain} == 语料 ${corpus.samples.length} 条（true=${corpus.positives} / false=${corpus.negatives}）sha256=${corpus.sha256.slice(0, 12)}…`);

  const t0 = Date.now();
  let inputTokens = 0;
  let failures = 0;
  const perSample = await mapWithConcurrency(corpus.samples, CONCURRENCY, async (s) => {
    const { state, questions } = conf.build(s);
    const outcome = await decisionApi.askDecision({ state, questions });
    if (!outcome.ok) {
      failures++;
      return { id: s[0], label: s[3], ok: false, reason: outcome.reason };
    }
    inputTokens += outcome.usage?.input_tokens ?? 0;
    return { id: s[0], label: s[3], ok: true, noul: conf.readNoul(outcome.answers), elapsedMs: outcome.elapsedMs, attempts: outcome.attempts };
  });
  const elapsedMs = Date.now() - t0;

  const failureRate = failures / corpus.samples.length;
  if (failureRate > FAILURE_RATE_LIMIT) {
    console.error(`${domain}：API 失败率 ${(failureRate * 100).toFixed(1)}% 超限（${failures}/${corpus.samples.length}），校准结果不可信，终止。`);
    process.exit(2);
  }
  const valid = perSample.filter((r) => r.ok);
  const latency = valid.map((r) => r.elapsedMs).sort((a, b) => a - b);
  const p50 = latency[Math.floor(latency.length * 0.5)];
  const p95 = latency[Math.floor(latency.length * 0.95)];

  const positives = valid.filter((r) => r.label === true);
  const negatives = valid.filter((r) => r.label === false);
  const mean = (arr) => arr.reduce((a, b) => a + b, 0) / Math.max(arr.length, 1);

  // 双阈值三区间网格扫描：noul≥yesTh 判 true，noul≤noTh 判 false，中间带弃权（回退现行为）
  const grid = [];
  for (let yesTh = YES_MIN; yesTh <= YES_MAX + 1e-9; yesTh += STEP) {
    for (let noTh = NO_MIN; noTh <= NO_MAX + 1e-9; noTh += STEP) {
      if (yesTh <= noTh) continue;
      let correct = 0, decided = 0;
      for (const r of valid) {
        if (r.noul >= yesTh) { decided++; if (r.label === true) correct++; }
        else if (r.noul <= noTh) { decided++; if (r.label === false) correct++; }
      }
      grid.push({
        yesThreshold: round2(yesTh), noThreshold: round2(noTh),
        decided: decided, coverage: round4(decided / valid.length),
        decidedAccuracy: decided ? round4(correct / decided) : 0,
        correct,
      });
    }
  }
  const eligible = grid.filter((g) => g.coverage >= COVERAGE_FLOOR && g.decidedAccuracy >= ACCURACY_GATE);
  eligible.sort((a, b) => b.decidedAccuracy - a.decidedAccuracy || b.coverage - a.coverage);
  const bestAnyCoverage = [...grid].sort((a, b) => b.decidedAccuracy - a.decidedAccuracy || b.coverage - a.coverage)[0];
  const recommended = eligible[0] ?? null;
  if (recommended) console.log(`推荐阈值：YES≥${recommended.yesThreshold} / NO≤${recommended.noThreshold} → decidedAccuracy=${recommended.decidedAccuracy} coverage=${recommended.coverage}`);
  else console.log(`⚠ 未找到达门槛（acc≥${ACCURACY_GATE} & cov≥${COVERAGE_FLOOR}）的阈值对；最优可达=${JSON.stringify(bestAnyCoverage)}`);

  return {
    corpus: { file: conf.corpus, sha256: corpus.sha256, count: corpus.samples.length, positives: corpus.positives, negatives: corpus.negatives },
    apiFailures: failures,
    validCount: valid.length,
    classMeans: { true: round4(mean(positives.map((r) => r.noul))), false: round4(mean(negatives.map((r) => r.noul))) },
    separation: round4(mean(positives.map((r) => r.noul)) - mean(negatives.map((r) => r.noul))),
    latency: { p50Ms: p50, p95Ms: p95 },
    inputTokens,
    elapsedMs,
    recommendedThresholds: recommended,
    bestOutsideGate: recommended ? null : bestAnyCoverage,
    gridTop: [...grid].sort((a, b) => b.decidedAccuracy - a.decidedAccuracy || b.coverage - a.coverage).slice(0, 15),
    perSample,
  };
}

function round2(n) { return Math.round(n * 100) / 100; }
function round4(n) { return Math.round(n * 10000) / 10000; }

function validateOnly() {
  for (const domain of Object.keys(DOMAINS)) {
    const c = loadCorpus(domain);
    console.log(`✓ ${domain}：${c.samples.length} 条（true=${c.positives} / false=${c.negatives}）sha256=${c.sha256.slice(0, 12)}…`);
  }
  console.log('--dry 语料校验通过（未发起任何网络请求）');
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--dry')) { validateOnly(); return; }

  if (decisionApi.resolveDecisionConfig() === null) {
    console.error('TYPESAFE_API_KEY 未设置：校准必须真实 API 实测（不得伪造证据）。设置后重跑；或用 --dry 只验语料。');
    process.exit(1);
  }
  const domainArg = args.find((a) => a.startsWith('--domain'));
  const domainFilter = domainArg ? domainArg.split('=')[1] ?? args[args.indexOf(domainArg) + 1] : null;
  const domains = domainFilter && DOMAINS[domainFilter] ? [domainFilter] : Object.keys(DOMAINS);

  const results = {};
  for (const domain of domains) {
    results[domain] = await runDomain(domain);
  }

  const gate = {
    criterion: `存在阈值对：decidedAccuracy ≥ ${ACCURACY_GATE} 且 coverage ≥ ${COVERAGE_FLOOR}（中间带=回退现行为）`,
    passed: Object.values(results).every((r) => r.recommendedThresholds !== null),
    note: 'P0 通过判据为立项时提案，P0 评审（D-A/D-B 裁决）可修订；P1 采用 topic-shift 推荐阈值，P2 采用 retrieval 推荐阈值。',
  };

  const evidence = {
    kind: 'block110-calibration',
    version: '1.0.0',
    capturedAt: new Date().toISOString(),
    sourceCommit: require('node:child_process').execSync('git rev-parse HEAD', { cwd: root }).toString().trim(),
    model: decisionApi.DECISION_MODEL_PIN,
    wrapper: 'core/petri-server/helpers/decision-api.js',
    domains: results,
    gate,
  };

  fs.mkdirSync(evidenceDir, { recursive: true });
  const outPath = path.join(evidenceDir, 'calibration.json');
  fs.writeFileSync(outPath, JSON.stringify(evidence, null, 2) + '\n', 'utf8');
  console.log(`\n证据已写入 ${path.relative(root, outPath)}；gate.passed=${gate.passed}`);
  if (!gate.passed) process.exit(3);
}

main().catch((err) => { console.error(err); process.exit(1); });
