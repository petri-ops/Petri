#!/usr/bin/env node
/**
 * BLOCK-119 P0 — fit 维度校准 harness（θ 扫描；判据沿 block115）。
 *
 * 用法：
 *   node scripts/block119-judge-calibrate.mjs --dry    # 只验语料与指针回读，零网络
 *   node scripts/block119-judge-calibrate.mjs          # 全量校准（供给=Jev 云，备份 env key）
 *
 * 判据：存在 θ 使 adoptedPrecision@θ ≥ 0.80 且 adoptedCoverage@θ ≥ 0.50
 * （θ 作用于 fit score 0-4：score ≥ θ 判「契合」）。采纳后注册表落 fitPass=θ、
 * fitRetry=θ-0.5（RETRY 区半档宽）；不可采纳→注册表缺键=observe-only，如实落负裁决。
 * 隐私：证据 JSON 只存样本指针 + gold + score + 延迟，无原文。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const decisionApi = require('../core/petri-server/helpers/decision-api.js');
const { buildJudgeRequest } = require('./lib/harness/judge-core.mjs');
const { mapWithConcurrency, round4 } = await import('./lib/calibration-common.mjs');

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const CORPUS_FILE = path.join(root, 'acceptance', 'block-119', 'corpus-judge-fit.json');
const SRC_DIR = path.join(root, '.petri-dev-user-data', 'data', 'llm-transcripts');
const BACKUP_ENV = path.join(root, '.petri-dev-user-data', 'jev.env.bak-by-user-request');
const EVIDENCE_OUT = path.join(root, 'acceptance', 'block-119', 'calibration-judge-fit.json');

const THETA_MIN = 2.0, THETA_MAX = 4.0, THETA_STEP = 0.25;
const PRECISION_GATE = 0.80, COVERAGE_FLOOR = 0.50;
const FAILURE_RATE_LIMIT = 0.10;
const CONCURRENCY = 5;

/** 指针回读：返回 {request, output}（原文只进内存，不落盘）。 */
function resolveSample(s) {
  const readTurn = (conv, idx) => {
    const r = JSON.parse(
      fs.readFileSync(path.join(SRC_DIR, conv), 'utf8').split(/\r?\n/).filter(Boolean)[idx]
    );
    const lastUser = [...(r.request.messages || [])].reverse().find((m) => m.role === 'user');
    return { request: String(lastUser.content || ''), output: String(r.response.content || '') };
  };
  if (s.kind === 'outcome_positive') return readTurn(s.conv, s.recordIdx);
  return {
    request: readTurn(s.requestFrom, s.requestIdx).request,
    output: readTurn(s.outputFrom, s.outputIdx).output,
  };
}

function loadCorpus() {
  const doc = JSON.parse(fs.readFileSync(CORPUS_FILE, 'utf8'));
  if (doc.samples.length < 100) throw new Error(`语料不足 100 条（现 ${doc.samples.length}）`);
  for (const s of doc.samples) {
    if (typeof s.gold !== 'number' || !s.kind) throw new Error(`样本形状非法：${s.id}`);
  }
  return doc;
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
  return { grid, recommended: eligible[0] ?? null };
}

async function main() {
  const corpus = loadCorpus();
  const resolved = corpus.samples.map((s) => {
    let pair = null;
    try { pair = resolveSample(s); } catch { /* 指针失效样本记失败 */ }
    return { s, pair };
  });
  const valid = resolved.filter((r) => r.pair && r.pair.request && r.pair.output);
  if (process.argv.slice(2).includes('--dry')) {
    const byKind = {};
    for (const s of corpus.samples) byKind[s.kind] = (byKind[s.kind] || 0) + 1;
    console.log(`语料 ${corpus.samples.length} 条（${JSON.stringify(byKind)}）；指针回读成功 ${valid.length} 条`);
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

  let failures = 0;
  const perSample = await mapWithConcurrency(valid, CONCURRENCY, async ({ s, pair }) => {
    const { state, questions } = buildJudgeRequest({ output: pair.output, request: pair.request });
    const outcome = await decisionApi.askDecision({ state, questions: { fit: questions.fit }, overrides });
    if (!outcome.ok || typeof outcome.answers.fit?.score !== 'number') {
      failures++;
      return { id: s.id, kind: s.kind, ok: false, reason: outcome.reason || 'no_score' };
    }
    return { id: s.id, kind: s.kind, gold: s.gold, ok: true, score: round4(outcome.answers.fit.score), elapsedMs: outcome.elapsedMs };
  });
  if (failures / valid.length > FAILURE_RATE_LIMIT) {
    console.error(`API 失败率 ${(failures / valid.length * 100).toFixed(1)}% 超限，终止。`);
    process.exit(2);
  }
  const scored = perSample.filter((r) => r.ok);
  const pairs = scored.map((r) => [r.gold, r.score]);
  const positives = pairs.filter(([g]) => g === 1).length;
  const { grid, recommended } = thetaScan(pairs, positives);
  const byKindAccuracy = {};
  for (const kind of ['outcome_positive', 'turn_mismatch', 'mismatch']) {
    const rows = scored.filter((r) => r.kind === kind);
    if (!rows.length) continue;
    const correct = rows.filter((r) => (r.gold === 1 ? r.score >= 3 : r.score < 3)).length;
    byKindAccuracy[kind] = round4(correct / rows.length);
  }
  const verdict = recommended
    ? `可采纳：fitPass=${recommended.theta}（precision=${recommended.adoptedPrecision}/coverage=${recommended.adoptedCoverage}）`
    : '不可采纳：无达门槛 θ（负裁决落档，注册表保持 observe-only）';
  console.log(`\n裁决：${verdict}`);
  console.log(`分型准确率（score≥3 判契合）：${JSON.stringify(byKindAccuracy)}`);

  const evidence = {
    kind: 'block119-judge-fit-calibration',
    version: '1.0.0',
    capturedAt: new Date().toISOString(),
    sourceCommit: require('node:child_process').execSync('git rev-parse HEAD', { cwd: root }).toString().trim(),
    supply: { baseUrl: overrides.baseUrl, model: overrides.model },
    corpus: { file: 'acceptance/block-119/corpus-judge-fit.json', count: corpus.samples.length, labeling: corpus.labeling },
    caveat: '语料为配对设计下界（结果信号与截断负例在可用数据中不可得，见 corpus.labeling 迭代留痕）；θ 采纳按保守解读，产品门控试点须以 P2 实机采纳率/误拦率复核。',
    apiFailures: failures,
    validCount: scored.length,
    positives,
    perKindAccuracy: byKindAccuracy,
    recommended,
    gate: { criterion: `存在 θ：precision ≥ ${PRECISION_GATE} 且 coverage ≥ ${COVERAGE_FLOOR}`, passed: recommended !== null },
    grid,
    perSample,
  };
  fs.mkdirSync(path.dirname(EVIDENCE_OUT), { recursive: true });
  fs.writeFileSync(EVIDENCE_OUT, JSON.stringify(evidence, null, 2) + '\n');
  console.log(`证据已写入 ${path.relative(root, EVIDENCE_OUT)}；gate.passed=${evidence.gate.passed}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
