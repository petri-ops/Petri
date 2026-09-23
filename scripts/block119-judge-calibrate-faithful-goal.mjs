#!/usr/bin/env node
/**
 * BLOCK-119 加映 2 — faithful/goal 维度校准 harness（noul θ 扫描；框架沿 fit 校准先例）。
 *
 * 用法：
 *   node scripts/block119-judge-calibrate-faithful-goal.mjs --dry    # 只验语料形状，零网络
 *   node scripts/block119-judge-calibrate-faithful-goal.mjs          # 全量校准（Jev 云）
 *
 * 判据（noul 直判较 fit 严一档）：存在 θ 使 adoptedPrecision@θ ≥ 0.85 且
 * adoptedCoverage@θ ≥ 0.50（θ 作用于 noul 概率：v ≥ θ 判「通过」）。达标→注册表落
 * faithfulPass/goalPass 键（人工按证据编辑）；无达门槛 θ→诚实收缩：注册表保持缺键
 * =observe-only，负裁决落档。trapRate（gold=0 却 v≥θ）单独记录——假通过=编造漏放，
 * 是该维度最危险方向，推荐 θ 选取在达标集中取 coverage 最高（等价 trap 最低的可行点）。
 * 隐私：语料全派生自仓内文档；证据只存 gold/score/延迟与构造 provenance。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { mapWithConcurrency, round4 } from './lib/calibration-common.mjs';

const require = createRequire(import.meta.url);
const decisionApi = require('../core/biof3-server/helpers/decision-api.js');
const { buildJudgeRequest } = require('./lib/harness/judge-core.mjs');

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const CORPUS_FILE = path.join(root, 'acceptance', 'block-119', 'corpus-judge-faithful-goal.json');
const BACKUP_ENV = path.join(root, '.biof3-dev-user-data', 'jev.env.bak-by-user-request');
const EVIDENCE_OUT = path.join(root, 'acceptance', 'block-119', 'calibration-judge-faithful-goal.json');

const THETA_MIN = 0.30, THETA_MAX = 0.90, THETA_STEP = 0.05;
const PRECISION_GATE = 0.85, COVERAGE_FLOOR = 0.50;
const FAILURE_RATE_LIMIT = 0.10;
const CONCURRENCY = 5;

function loadCorpus() {
  const doc = JSON.parse(fs.readFileSync(CORPUS_FILE, 'utf8'));
  const { faithful, goal } = doc.samples;
  if (!Array.isArray(faithful) || !Array.isArray(goal)) throw new Error('语料形状非法：缺 faithful/goal');
  for (const s of faithful) {
    if (typeof s.gold !== 'number' || !s.reference || !s.output) throw new Error(`faithful 样本非法：${s.id}`);
  }
  for (const s of goal) {
    if (!Array.isArray(s.goals) || !Array.isArray(s.goalGold) || s.goals.length !== s.goalGold.length) {
      throw new Error(`goal 样本非法：${s.id}`);
    }
  }
  return doc;
}

/** θ 扫描（noul：v ≥ θ 判正）。 */
function thetaScan(judgments) {
  const positives = judgments.filter((j) => j.gold === 1).length;
  const negatives = judgments.length - positives;
  const grid = [];
  for (let th = THETA_MIN; th <= THETA_MAX + 1e-9; th += THETA_STEP) {
    const adopted = judgments.filter((j) => j.value >= th);
    const truePos = adopted.filter((j) => j.gold === 1).length;
    const traps = adopted.filter((j) => j.gold === 0).length;
    grid.push({
      theta: round4(th),
      adopted: adopted.length,
      adoptedPrecision: adopted.length ? round4(truePos / adopted.length) : 1,
      adoptedCoverage: positives ? round4(truePos / positives) : null,
      trapRate: negatives ? round4(traps / negatives) : 0,
    });
  }
  const eligible = grid.filter((g) => g.adoptedPrecision >= PRECISION_GATE && g.adoptedCoverage != null && g.adoptedCoverage >= COVERAGE_FLOOR);
  eligible.sort((a, b) => b.adoptedCoverage - a.adoptedCoverage);
  return { grid, positives, negatives, recommended: eligible[0] ?? null };
}

async function main() {
  const corpus = loadCorpus();
  const { faithful, goal } = corpus.samples;
  if (process.argv.slice(2).includes('--dry')) {
    const goalJudgments = goal.reduce((n, g) => n + g.goals.length, 0);
    console.log(`faithful ${faithful.length}（正 ${faithful.filter((s) => s.gold === 1).length}）；goal 变体 ${goal.length} × 判定 ${goalJudgments}——形状 OK`);
    console.log('--dry 通过（未发起任何网络请求）');
    return;
  }

  let apiKey = null;
  for (const line of fs.readFileSync(BACKUP_ENV, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*TYPESAFE_API_KEY\s*=\s*(.+)\s*$/);
    if (m) apiKey = m[1].replace(/^['"]|['"]$/g, '');
  }
  if (!apiKey) throw new Error('cloud 供给不可用：备份 env 无 TYPESAFE_API_KEY');
  const overrides = { apiKey, baseUrl: 'https://api.typesafe.ai', model: 'jev-1.13.0' };

  // ── faithful 逐样本 ──
  let failures = 0;
  const faithfulRows = await mapWithConcurrency(faithful, CONCURRENCY, async (s) => {
    const { state, questions } = buildJudgeRequest({ output: s.output, request: s.request, reference: s.reference });
    const outcome = await decisionApi.askDecision({ state, questions: { faithful: questions.faithful }, overrides, meta: { point: 'output-judge', threshold: null } });
    if (!outcome.ok || typeof outcome.answers.faithful?.noul !== 'number') {
      failures++;
      return { id: s.id, ok: false };
    }
    return { id: s.id, kind: s.kind, gold: s.gold, value: round4(outcome.answers.faithful.noul), elapsedMs: outcome.elapsedMs, ok: true };
  });

  // ── goal 逐变体（一次调用判全部目标） ──
  const goalRows = await mapWithConcurrency(goal, CONCURRENCY, async (s) => {
    const { state, questions } = buildJudgeRequest({ output: s.output, request: s.request, reference: s.reference, goals: s.goals });
    const qs = {};
    s.goals.forEach((_, i) => { qs[`goal_${i}`] = questions[`goal_${i}`]; });
    const outcome = await decisionApi.askDecision({ state, questions: qs, overrides, meta: { point: 'output-judge', threshold: null } });
    const values = s.goals.map((_, i) => outcome.answers?.[`goal_${i}`]?.noul);
    if (!outcome.ok || values.some((v) => typeof v !== 'number')) {
      failures++;
      return { id: s.id, ok: false };
    }
    return { id: s.id, kind: s.kind, ok: true, judgments: s.goalGold.map((gold, i) => ({ goalIndex: i, gold, value: round4(values[i]) })) };
  });

  if (failures / (faithful.length + goal.length) > FAILURE_RATE_LIMIT) {
    console.error(`API 失败率超限（${failures} 失败），终止。`);
    process.exit(2);
  }

  const faithfulJudgments = faithfulRows.filter((r) => r.ok).map((r) => ({ gold: r.gold, value: r.value }));
  const goalJudgments = goalRows.filter((r) => r.ok).flatMap((r) => r.judgments);
  const faithfulScan = thetaScan(faithfulJudgments);
  const goalScan = thetaScan(goalJudgments);

  const verdictOf = (name, scan) => scan.recommended
    ? `${name} 可采纳：θ=${scan.recommended.theta}（precision=${scan.recommended.adoptedPrecision}/coverage=${scan.recommended.adoptedCoverage}/trap=${scan.recommended.trapRate}）`
    : `${name} 不可采纳：无达门槛 θ（注册表保持缺键=observe-only）`;
  console.log(`\n${verdictOf('faithful', faithfulScan)}`);
  console.log(verdictOf('goal', goalScan));

  const evidence = {
    kind: 'block119-judge-faithful-goal-calibration',
    version: '1.0.0',
    capturedAt: new Date().toISOString(),
    sourceCommit: require('node:child_process').execSync('git rev-parse HEAD', { cwd: root }).toString().trim(),
    supply: { baseUrl: overrides.baseUrl, model: overrides.model },
    corpus: { file: 'acceptance/block-119/corpus-judge-faithful-goal.json', labeling: corpus.labeling, docs: corpus.docs },
    gate: {
      criterion: `存在 θ：precision ≥ ${PRECISION_GATE} 且 coverage ≥ ${COVERAGE_FLOOR}（noul 直判较 fit 严一档）`,
      faithfulPassed: faithfulScan.recommended !== null,
      goalPassed: goalScan.recommended !== null,
    },
    faithful: {
      count: faithfulJudgments.length,
      positives: faithfulScan.positives,
      negatives: faithfulScan.negatives,
      recommended: faithfulScan.recommended,
      grid: faithfulScan.grid,
      byKind: faithfulRows.filter((r) => r.ok).reduce((acc, r) => {
        (acc[r.kind] = acc[r.kind] || []).push(r.value >= (faithfulScan.recommended?.theta ?? 0.5) ? 1 : 0);
        return acc;
      }, {}),
    },
    goal: {
      judgments: goalJudgments.length,
      positives: goalScan.positives,
      negatives: goalScan.negatives,
      recommended: goalScan.recommended,
      grid: goalScan.grid,
    },
    apiFailures: failures,
    perSample: { faithful: faithfulRows, goal: goalRows },
  };
  fs.mkdirSync(path.dirname(EVIDENCE_OUT), { recursive: true });
  fs.writeFileSync(EVIDENCE_OUT, JSON.stringify(evidence, null, 2) + '\n');
  console.log(`证据已写入 ${path.relative(root, EVIDENCE_OUT)}；faithfulPassed=${evidence.gate.faithfulPassed} goalPassed=${evidence.gate.goalPassed}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
