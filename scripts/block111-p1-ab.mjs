#!/usr/bin/env node
/**
 * BLOCK-111 P1/P2 — marker 判别二跳 A/B 对账 harness（plan §5「P1 A/B 对账」）。
 *
 * 与 block111-p0-calibrate.mjs 的分工：校准 harness 走裸 askDecision 测「模型+阈值」；
 * 本 harness 走**生产函数** `lookupCellTypeWithConfidence`（guard 显式开 + 真实 key），
 * 端到端对账「二跳 vs 现行 lookupCellType」在语料上的终态正确率/一致率/延迟，
 * 同时验证零候选边界在生产路径的零出站形态。
 *
 * 用法（需 TYPESAFE_API_KEY）：
 *   node scripts/block111-p1-ab.mjs
 *
 * 门限（plan §5）：gatedAccuracy（门控后决策正确率）≥ 0.95 且 endToEndAccuracy ≥ legacyBaseline。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const decisionApi = require('../core/petri-server/helpers/decision-api.js');

// 本 harness 的被测对象是「显式开启形态」（生产默认关由契约测试钉住）。
process.env.PETRI_JEV_MARKER_GUARD = '1';

const interpret = require('../core/petri-server/helpers/interpret.js');

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const evidenceDir = path.join(root, 'acceptance', 'block-111');
const CONCURRENCY = 5;
const FAILURE_RATE_LIMIT = 0.10;
const ACCURACY_GATE = 0.95;

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

async function main() {
  if (decisionApi.resolveDecisionConfig() === null) {
    console.error('TYPESAFE_API_KEY 未设置：A/B 必须真实 API 实测（不得伪造证据）。');
    process.exit(1);
  }
  const corpus = JSON.parse(fs.readFileSync(path.join(evidenceDir, 'corpus-marker-celltype.json'), 'utf8'));
  const evaluable = corpus.samples.filter((s) => s[3] !== 'empty');
  const empties = corpus.samples.filter((s) => s[3] === 'empty');
  console.log(`A/B 语料：choice 可评估 ${evaluable.length}，零候选边界 ${empties.length}`);

  const t0 = Date.now();
  let failures = 0;
  const rows = await mapWithConcurrency(evaluable, CONCURRENCY, async ([id, markers, gold, kind]) => {
    const legacy = interpret.lookupCellType(markers);
    try {
      const d = await interpret.lookupCellTypeWithConfidence(markers);
      if (d.reason === 'no_candidates' || d.reason === 'guard_disabled') {
        return { id, kind, gold, legacy, error: `unexpected_reason:${d.reason}` };
      }
      return {
        id, kind, gold, legacy,
        adopted: d.adopted,
        decisionType: d.type,
        confidence: d.confidence,
        finalType: d.adopted ? d.type : legacy,
      };
    } catch (err) {
      return { id, kind, gold, legacy, error: `throw:${err && err.message}` };
    }
  });
  const elapsedMs = Date.now() - t0;

  failures = rows.filter((r) => r.error).length;
  if (failures / evaluable.length > FAILURE_RATE_LIMIT) {
    console.error(`失败率超限（${failures}/${evaluable.length}）——结果不可信，终止。`);
    process.exit(2);
  }

  // 零候选边界：生产路径必须 no_candidates 直返 null 且零异常
  const emptyResults = await mapWithConcurrency(empties, CONCURRENCY, async ([id, markers]) => {
    const d = await interpret.lookupCellTypeWithConfidence(markers);
    return { id, ok: d.reason === 'no_candidates' && d.type === null && !d.adopted };
  });
  const emptyPass = emptyResults.filter((r) => r.ok).length;

  const valid = rows.filter((r) => !r.error);
  const goldIn = valid.filter((r) => r.kind !== 'trap');
  const traps = valid.filter((r) => r.kind === 'trap');

  const legacyCorrect = goldIn.filter((r) => r.legacy === r.gold).length;
  const adopted = goldIn.filter((r) => r.adopted);
  const adoptedCorrect = adopted.filter((r) => r.decisionType === r.gold).length;
  const finalCorrect = goldIn.filter((r) => r.finalType === r.gold).length;
  const trapAdopted = traps.filter((r) => r.adopted).length;
  const agreement = goldIn.filter((r) => r.adopted && r.decisionType === r.legacy).length;

  // 延迟在 lookupCellTypeWithConfidence 返回值里不透传（helper 不带计时）；以整体墙钟折算均值
  const legacyBaseline = round4(legacyCorrect / goldIn.length);
  const gatedAccuracy = round4(adoptedCorrect / Math.max(adopted.length, 1));
  const endToEndAccuracy = round4(finalCorrect / goldIn.length);

  const gate = {
    criterion: `gatedAccuracy ≥ ${ACCURACY_GATE} 且 endToEndAccuracy ≥ legacyBaseline（终态=采纳用二跳、回退用现行）`,
    gatedAccuracy,
    endToEndAccuracy,
    legacyBaseline,
    passed: gatedAccuracy >= ACCURACY_GATE && endToEndAccuracy >= legacyBaseline,
  };

  const evidence = {
    kind: 'block111-p1-ab',
    version: '1.0.0',
    capturedAt: new Date().toISOString(),
    sourceCommit: require('node:child_process').execSync('git rev-parse HEAD', { cwd: root }).toString().trim(),
    model: decisionApi.DECISION_MODEL_PIN,
    productionPath: 'core/petri-server/helpers/interpret.js lookupCellTypeWithConfidence（guard=1 显式开启）',
    corpus: { file: 'corpus-marker-celltype.json', choiceEvaluable: evaluable.length, emptyBoundary: empties.length },
    apiFailures: failures,
    validCount: valid.length,
    emptyBoundaryPass: `${emptyPass}/${empties.length}`,
    legacyBaseline,
    adoptedCount: adopted.length,
    coverage: round4(adopted.length / goldIn.length),
    gatedAccuracy,
    endToEndAccuracy,
    trapFalseAdoption: traps.length ? round4(trapAdopted / traps.length) : 0,
    agreementWithLegacyWhenAdopted: round4(agreement / Math.max(adopted.length, 1)),
    wallClockMeanMsPerSample: round4(elapsedMs / evaluable.length),
    gate,
    perSample: rows,
  };

  const outPath = path.join(evidenceDir, 'p1-ab.json');
  fs.writeFileSync(outPath, JSON.stringify(evidence, null, 2) + '\n', 'utf8');
  console.log(`legacyBaseline=${legacyBaseline} coverage=${evidence.coverage} gatedAccuracy=${gatedAccuracy} endToEnd=${endToEndAccuracy} trapFalseAdoption=${evidence.trapFalseAdoption}`);
  console.log(`零候选边界 ${evidence.emptyBoundaryPass}；证据已写入 ${path.relative(root, outPath)}；gate.passed=${gate.passed}`);
  if (!gate.passed) process.exit(3);
}

main().catch((err) => { console.error(err); process.exit(1); });
