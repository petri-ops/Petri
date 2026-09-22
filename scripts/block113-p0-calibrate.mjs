#!/usr/bin/env node
/**
 * BLOCK-113 P0 — copilot 意图路由 choice 校准 harness（plan §5 P0 证据门）。
 *
 * 用途：117 条四类中文消息语料，实测 jev-1.13.0 choice 在「意图四分类 + confidence」
 *      上的表现，产出 P1 chitchat 分流门控阈值初值，证据落 acceptance/block-113/calibration.json。
 *
 * 用法：
 *   node scripts/block113-p0-calibrate.mjs --dry   # 只验语料完整性/类平衡，零网络
 *   node scripts/block113-p0-calibrate.mjs         # 全量校准（需 TYPESAFE_API_KEY）
 *
 * 纪律（镜像 block111 校准 harness）：key 只从 env 读；API 失败率 >10% 退出非零。
 * P0 通过判据（评审可改）：存在 θ 使 adoptedPrecision@θ ≥ 0.90、allFalseAdoption@θ ≤ 2、
 * adoptedCoverage@θ ≥ 0.50；overall argmax accuracy ≥ 0.75（诊断门，十类比四类难）。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const decisionApi = require('../core/biof3-server/helpers/decision-api.js');
// P1 起分类请求组装单源于 intent-router.js（形状漂移即校准失效，契约测试钉住）。
const { buildToolRouteDecisionRequest } = require('../core/biof3-server/helpers/tool-router.js');
const buildDecisionRequest = buildToolRouteDecisionRequest;

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const evidenceDir = path.join(root, 'acceptance', 'block-113');
const CORPUS_FILE = 'corpus-tool-routing.json';

const THETA_MIN = 0.5, THETA_MAX = 0.95, THETA_STEP = 0.05;
const PRECISION_GATE = 0.90, COVERAGE_FLOOR = 0.50, ACCURACY_GATE = 0.75, ALL_FALSE_ADOPTION_MAX = 2;
const FAILURE_RATE_LIMIT = 0.10;
const CONCURRENCY = 5;

const CLASSES = {
  workspace: '项目工作区内的文件读写、搜索、代码编写与脚本执行、数据分析作业',
  knowledge: '知识空间与文档库的检索和管理（搜索、上传、移动、建空间、重建索引）',
  'result-studio': '结果库/结果图表/修订版本/changeset 的操作（打开、对比、采纳、回滚、重跑、生成方法学）',
  browser: '网页浏览、网页搜索、网页内容读取与网页操作',
  computer: 'OS 桌面自动化（截图、点击、键入、滚动本机应用窗口）',
  'agent-orchestration': '子智能体的派发、留言、中断、等待与清单查询',
  remote: '联邦协作节点的跨机任务委托与远程执行',
  resident: '驻留长任务与后台任务的创建、查询、回访',
  session: '会话杂项：系统信息、todo 清单、计划模式、状态校验、进程管理',
  all: '不确定、跨多域的复合任务、目标模糊的任务，或无需工具的纯对话（保守全量下发）',
};

/** P1 生产路径必须镜像本函数组装 state/questions（接线时单源化进 intent-router.js 并以契约测试钉住）。 */

function sha256File(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

function loadCorpus() {
  const corpusPath = path.join(evidenceDir, CORPUS_FILE);
  const doc = JSON.parse(fs.readFileSync(corpusPath, 'utf8'));
  if (doc.samples.length < 100) throw new Error(`语料不足 100 条（现 ${doc.samples.length}）`);
  for (const s of doc.samples) {
    if (!Array.isArray(s) || s.length !== 4) throw new Error(`样本形状非法：${s[0]}`);
    if (!Object.keys(CLASSES).includes(s[2])) throw new Error(`非法 gold：${s[0]}=${s[2]}`);
  }
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
  const byGold = {};
  for (const [, , gold] of corpus.samples) byGold[gold] = (byGold[gold] ?? 0) + 1;
  console.log(`语料 ${corpus.samples.length} 条：${JSON.stringify(byGold)}`);
  console.log(`--dry 语料校验通过（未发起任何网络请求）`);
}

async function calibrate(corpus) {
  const t0 = Date.now();
  let inputTokens = 0;
  let failures = 0;
  const perSample = await mapWithConcurrency(corpus.samples, CONCURRENCY, async ([id, message, gold, group]) => {
    const { state, questions } = buildDecisionRequest(message);
    const outcome = await decisionApi.askDecision({ state, questions });
    if (!outcome.ok) {
      failures++;
      return { id, group, gold, ok: false, reason: outcome.reason };
    }
    const a = outcome.answers.family;
    inputTokens += outcome.usage?.input_tokens ?? 0;
    return {
      id, group, gold, ok: true,
      choice: a.choice,
      confidence: round4(a.confidence),
      probabilities: a.probabilities,
      correct: a.choice === gold,
      elapsedMs: outcome.elapsedMs,
      attempts: outcome.attempts,
    };
  });
  const elapsedMs = Date.now() - t0;

  const failureRate = failures / corpus.samples.length;
  if (failureRate > FAILURE_RATE_LIMIT) {
    console.error(`API 失败率 ${(failureRate * 100).toFixed(1)}% 超限（${failures}/${corpus.samples.length}），终止。`);
    process.exit(2);
  }
  const valid = perSample.filter((r) => r.ok);
  const allSamples = valid.filter((r) => r.gold === 'all');
  const routeable = valid.filter((r) => r.gold !== 'all');

  const argmaxCorrect = valid.filter((r) => r.correct).length;
  const adoptedBaseline = routeable.filter((r) => r.choice === r.gold).length; // 现行（无弃权概念下） argmax 命中基线
  const latency = valid.map((r) => r.elapsedMs).sort((a, b) => a - b);

  // θ 网格：argmax≠all 且 conf≥θ 才采纳收窄；argmax=all 或低置信 → 全量（现行为）
  const grid = [];
  for (let th = THETA_MIN; th <= THETA_MAX + 1e-9; th += THETA_STEP) {
    const adopted = routeable.filter((r) => r.choice !== 'all' && r.confidence >= th);
    const adoptedTrue = adopted.filter((r) => r.choice === r.gold).length;
    const allAdopted = allSamples.filter((r) => r.choice !== 'all' && r.confidence >= th).length;
    grid.push({
      theta: round4(th),
      adopted: adopted.length,
      adoptedCoverage: round4(adopted.length / routeable.length),
      adoptedPrecision: adopted.length ? round4(adoptedTrue / adopted.length) : 1,
      allFalseAdoption: allAdopted,
    });
  }
  const eligible = grid.filter((g) => g.adoptedPrecision >= PRECISION_GATE && g.allFalseAdoption <= ALL_FALSE_ADOPTION_MAX && g.adoptedCoverage >= COVERAGE_FLOOR);
  eligible.sort((a, b) => b.adoptedCoverage - a.adoptedCoverage);
  const recommended = eligible[0] ?? null;
  const bestAny = [...grid].sort((a, b) => b.adoptedCoverage - a.adoptedCoverage || b.adoptedPrecision - a.adoptedPrecision)[0];
  if (recommended) {
    console.log(`推荐阈值：θ≥${recommended.theta} → coverage=${recommended.adoptedCoverage} precision=${recommended.adoptedPrecision} allFalseAdoption=${recommended.allFalseAdoption}`);
  } else {
    console.log(`⚠ 未找到达门槛的阈值；最优可达=${JSON.stringify(bestAny)}`);
  }

  const mean = (arr) => arr.reduce((a, b) => a + b, 0) / Math.max(arr.length, 1);
  return {
    corpus: { file: CORPUS_FILE, sha256: corpus.sha256, count: corpus.samples.length },
    apiFailures: failures,
    validCount: valid.length,
    argmaxTop1Accuracy: round4(argmaxCorrect / valid.length),
    byGold: Object.fromEntries(Object.keys(CLASSES).map((k) => {
      const rs = valid.filter((r) => r.gold === k);
      return [k, {
        count: rs.length,
        argmaxAccuracy: round4(rs.filter((r) => r.correct).length / Math.max(rs.length, 1)),
        meanConfidence: round4(mean(rs.map((r) => r.confidence))),
      }];
    })),
    adoptedBaselineArgmaxHit: round4(adoptedBaseline / Math.max(routeable.length, 1)),
    allMeanConfidence: round4(mean(allSamples.map((r) => r.confidence))),
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
    criterion: `存在 θ：adoptedPrecision ≥ ${PRECISION_GATE} 且 allFalseAdoption ≤ ${ALL_FALSE_ADOPTION_MAX} 且 adoptedCoverage ≥ ${COVERAGE_FLOOR}；且 overall argmax accuracy ≥ ${ACCURACY_GATE}（诊断门）`,
    passed: result.recommendedThreshold !== null && result.argmaxTop1Accuracy >= ACCURACY_GATE,
    note: 'P0 通过判据为立项时提案，P0 评审（D-1~D-5 裁决）可修订；误采纳=对多域/模糊任务收窄工具面（能力受损），约束 ≤2/12。',
  };

  const evidence = {
    kind: 'block113-calibration',
    version: '1.0.0',
    capturedAt: new Date().toISOString(),
    sourceCommit: require('node:child_process').execSync('git rev-parse HEAD', { cwd: root }).toString().trim(),
    model: decisionApi.DECISION_MODEL_PIN,
    wrapper: 'core/biof3-server/helpers/decision-api.js',
    decisionPoint: 'routes/ai-agent/chat.js 提交链挂钩（W1-2 copilot 意图路由）',
    result,
    gate,
  };

  const outPath = path.join(evidenceDir, 'calibration.json');
  fs.writeFileSync(outPath, JSON.stringify(evidence, null, 2) + '\n', 'utf8');
  console.log(`\n证据已写入 ${path.relative(root, outPath)}；gate.passed=${gate.passed}`);
  if (!gate.passed) process.exit(3);
}

main().catch((err) => { console.error(err); process.exit(1); });
