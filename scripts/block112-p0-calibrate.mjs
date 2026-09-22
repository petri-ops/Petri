#!/usr/bin/env node
/**
 * BLOCK-112 P0 — copilot 意图路由 choice 校准 harness（plan §5 P0 证据门）。
 *
 * 用途：117 条四类中文消息语料，实测 jev-1.13.0 choice 在「意图四分类 + confidence」
 *      上的表现，产出 P1 chitchat 分流门控阈值初值，证据落 acceptance/block-112/calibration.json。
 *
 * 用法：
 *   node scripts/block112-p0-calibrate.mjs --dry   # 只验语料完整性/类平衡，零网络
 *   node scripts/block112-p0-calibrate.mjs         # 全量校准（需 TYPESAFE_API_KEY）
 *
 * 纪律（镜像 block111 校准 harness）：key 只从 env 读；API 失败率 >10% 退出非零。
 * P0 通过判据（评审可改）：存在 θ 使 chitchatPrecision@θ ≥ 0.95、taskFalseAdoption@θ = 0、
 * chitchatRecall@θ ≥ 0.60；overall argmax accuracy ≥ 0.85（诊断门）。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const decisionApi = require('../core/biof3-server/helpers/decision-api.js');
// P1 起分类请求组装单源于 intent-router.js（形状漂移即校准失效，契约测试钉住）。
const { buildIntentDecisionRequest } = require('../core/biof3-server/helpers/intent-router.js');

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const evidenceDir = path.join(root, 'acceptance', 'block-112');
const CORPUS_FILE = 'corpus-intent-routing.json';

const THETA_MIN = 0.5, THETA_MAX = 0.95, THETA_STEP = 0.05;
const PRECISION_GATE = 0.95, RECALL_FLOOR = 0.60, ACCURACY_GATE = 0.85;
const FAILURE_RATE_LIMIT = 0.10;
const CONCURRENCY = 5;

const CLASSES = {
  chitchat: '闲聊寒暄、情绪陪伴、致谢、身份或能力闲问等纯对话诉求，无任何数据/文件/工具动作',
  task: '对数据/文件/项目/分析/代码有执行诉求（跑、画、建、改、修、导出等）',
  knowledge_qa: '概念/方法/原理的纯解释性或选型咨询提问，无执行动作',
  result_studio: '对既有结果/图表/版本/运行状态的操作指令与查询（打开、导出、切换、重跑、存修订、查进度）',
};

/** P1 生产路径必须镜像本函数组装 state/questions（接线时单源化进 intent-router.js 并以契约测试钉住）。 */
function buildDecisionRequest(message) {
  return {
    state: `用户在 AI 工作台聊天框发送的消息：\n${String(message).slice(0, 600)}`,
    questions: {
      intent: {
        type: 'choice',
        criteria: { ...CLASSES },
        instructions:
          '判断用户消息的主要意图类别。消息同时含问候/致谢与执行诉求时以执行诉求为准（task）；'
          + '纯概念解释、选型或结果解读咨询且无操作指令为 knowledge_qa；'
          + '对既有结果/版本/运行状态的操作与查询为 result_studio；'
          + '全部诉求可由纯对话满足（寒暄、陪伴、致谢、身份或能力闲问）为 chitchat。',
      },
    },
  };
}

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
  for (const [id, , gold] of corpus.samples) byGold[gold] = (byGold[gold] ?? 0) + 1;
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
    const a = outcome.answers.intent;
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
  const chitchatSamples = valid.filter((r) => r.gold === 'chitchat');
  const taskSamples = valid.filter((r) => r.gold === 'task');

  const argmaxCorrect = valid.filter((r) => r.correct).length;
  const latency = valid.map((r) => r.elapsedMs).sort((a, b) => a - b);

  // θ 网格：argmax=chitchat 且 conf≥θ 才采纳（走快路径）；其余一律现行 loop
  const grid = [];
  for (let th = THETA_MIN; th <= THETA_MAX + 1e-9; th += THETA_STEP) {
    const adopted = valid.filter((r) => r.choice === 'chitchat' && r.confidence >= th);
    const adoptedTrue = adopted.filter((r) => r.gold === 'chitchat').length;
    const taskAdopted = taskSamples.filter((r) => r.choice === 'chitchat' && r.confidence >= th).length;
    grid.push({
      theta: round4(th),
      adopted: adopted.length,
      chitchatRecall: round4(adoptedTrue / chitchatSamples.length),
      chitchatPrecision: adopted.length ? round4(adoptedTrue / adopted.length) : 1,
      taskFalseAdoption: taskAdopted,
    });
  }
  const eligible = grid.filter((g) => g.chitchatPrecision >= PRECISION_GATE && g.taskFalseAdoption === 0 && g.chitchatRecall >= RECALL_FLOOR);
  eligible.sort((a, b) => b.chitchatRecall - a.chitchatRecall);
  const recommended = eligible[0] ?? null;
  const bestAny = [...grid].sort((a, b) => b.chitchatRecall - a.chitchatRecall || b.chitchatPrecision - a.chitchatPrecision)[0];
  if (recommended) {
    console.log(`推荐阈值：θ≥${recommended.theta} → chitchatRecall=${recommended.chitchatRecall} precision=${recommended.chitchatPrecision} taskFalseAdoption=${recommended.taskFalseAdoption}`);
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
    chitchatMeanConfidence: round4(mean(chitchatSamples.map((r) => r.confidence))),
    taskMeanConfidenceWhenPredictedChitchat: round4(mean(taskSamples.filter((r) => r.choice === 'chitchat').map((r) => r.confidence))),
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
    criterion: `存在 θ：chitchatPrecision ≥ ${PRECISION_GATE} 且 taskFalseAdoption = 0 且 chitchatRecall ≥ ${RECALL_FLOOR}；且 overall argmax accuracy ≥ ${ACCURACY_GATE}（诊断门）`,
    passed: result.recommendedThreshold !== null && result.argmaxTop1Accuracy >= ACCURACY_GATE,
    note: 'P0 通过判据为立项时提案，P0 评审（D-1~D-5 裁决）可修订；taskFalseAdoption=0 指语料内 task 类样本零误采纳（误路由代价=真任务被直答，属用户可见伤害，零容忍）。',
  };

  const evidence = {
    kind: 'block112-calibration',
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
