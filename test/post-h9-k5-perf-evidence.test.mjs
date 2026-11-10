/**
 * K5 性能与证据门禁化契约（新机械门负测 + 逐件篡改负测 + V/L 边界不冒充）。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  listProgramEvidence, adjudicateEvidenceSet, validateEvidenceFile, PROGRAM_DIR,
} from '../scripts/lib/post-h9-k5-evidence-gate.mjs';
import {
  collectPerfMatrixTruth, adjudicatePerfMatrix, adjudicateDomNodes, adjudicateFrameTimes,
  DOM_NODE_CEILING,
} from '../scripts/lib/post-h9-k5-perf-matrix.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const truth = collectPerfMatrixTruth(ROOT);
const tamper = (patch) => adjudicatePerfMatrix({ ...truth, ...patch });
const mustRed = (v, prefix) => {
  assert.equal(v.ok, false, `${prefix} 篡改后必须判红`);
  assert.ok(v.issues.some((i) => i.startsWith(prefix)), `应产生 ${prefix} 归因: ${v.issues.join(' / ')}`);
};

// ---- K-32 证据元数据门（新机械门） ----
test('K-32：本程序全部 JSON 元数据齐备，严格无例外', () => {
  const files = listProgramEvidence(ROOT);
  const v = adjudicateEvidenceSet(files, (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8')));
  assert.equal(v.ok, true, v.issues.join(' / '));
  assert.ok(v.fileCount >= 30);
  assert.equal(v.verdict, 'program-evidence-metadata-complete');
  assert.equal(v.classes['human-eye'], undefined, 'Agent 未产出任何人眼证据（不冒充）');
  assert.ok(v.classes['decision-material'] >= 1);
});

test('K-32：元数据源与写入器同源（REQUIRED_META 与证据门一致）', () => {
  const sample = JSON.parse(fs.readFileSync(path.join(ROOT, PROGRAM_DIR, 'k0/k0-criteria-verdict.json'), 'utf8'));
  const v = validateEvidenceFile('sample', sample);
  assert.equal(v.ok, true, v.issues.join(' / '));
  assert.equal(typeof sample.sourceCommit, 'string');
});

test('负测 新机械门：删任一必填字段 → 判红', () => {
  const good = JSON.parse(fs.readFileSync(path.join(ROOT, PROGRAM_DIR, 'k0/k0-criteria-verdict.json'), 'utf8'));
  for (const k of ['sourceCommit', 'platform', 'command', 'generatedAt', 'evidenceClass', 'verdict', 'humanEyeEquivalent', 'stack']) {
    const bad = { ...good };
    delete bad[k];
    assert.equal(validateEvidenceFile('bad', bad).ok, false, `删 ${k} 必须判红`);
  }
});

test('负测 新机械门：sourceCommit 短 sha / 非人眼冒充人眼 / 决策材料写 PASS → 判红', () => {
  const good = JSON.parse(fs.readFileSync(path.join(ROOT, PROGRAM_DIR, 'k0/k0-criteria-verdict.json'), 'utf8'));
  assert.equal(validateEvidenceFile('x', { ...good, sourceCommit: 'abc123' }).ok, false);
  assert.equal(validateEvidenceFile('x', { ...good, humanEyeEquivalent: true }).ok, false);
  assert.equal(validateEvidenceFile('x', { ...good, evidenceClass: 'decision-material', verdict: 'PASS' }).ok, false);
});

test('负测 新机械门：证据目录为空 / JSON 损坏 / 新增一份缺字段文件 → 判红', () => {
  assert.equal(adjudicateEvidenceSet([]).ok, false);
  assert.equal(adjudicateEvidenceSet(['fake.json'], () => { throw new Error('broken'); }).ok, false);
  const files = listProgramEvidence(ROOT);
  const v = adjudicateEvidenceSet([...files, 'acceptance/post-h9-2026-11-10/k5/fake.json'], (rel) =>
    rel.endsWith('fake.json') ? { kind: 'x' } : JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8')));
  assert.equal(v.ok, false);
});

test('K-32：历史证据不回填（门只扫本程序目录）', () => {
  const files = listProgramEvidence(ROOT);
  assert.ok(files.every((f) => f.startsWith(PROGRAM_DIR)));
  const missing = ['acceptance/post-s7-2026-11-10/h9/structural-triage.json', 'acceptance/post-s7-2026-11-10/h9/cv-ab.json'];
  for (const rel of missing) assert.ok(!files.includes(rel));
});

// ---- K-04 perf 默认写盘冲突 ----
test('K-04：perf 证据仍 opt-in 且默认不写盘（不擅自改既有裁决）', () => {
  assert.equal(truth.perfEvidenceOptIn, true);
  assert.equal(truth.perfDefaultNoWriteComment, true);
  assert.equal(truth.perfFourFields, true);
  const e = truth.perfEvidenceTemplate;
  assert.equal(typeof e.sourceCommit, 'string');
  assert.equal(e.samplesGreen, 5);
});

test('K-04：roll-index --check 支持存在但未入 closeout（现状校准）', () => {
  assert.equal(truth.rollIndexCheckSupported, true);
  assert.equal(truth.rollIndexInCloseout, false);
});

test('负测 K-04：把 opt-in 改成默认写盘 → 判红', () => {
  mustRed(tamper({ perfEvidenceOptIn: false }), 'K-04');
});

test('负测 K-32：把 roll-index 冒充已入链 → 判红', () => {
  mustRed(tamper({ rollIndexInCloseout: true }), 'K-32');
});

// ---- K-03/23 DOM / 帧率阈值门 ----
test('K-03/23：DOM 阈值纯函数门，植入 2 万节点必红', () => {
  assert.equal(adjudicateDomNodes(7202).ok, true);
  assert.equal(adjudicateDomNodes(DOM_NODE_CEILING).ok, false);
  assert.equal(adjudicateDomNodes(DOM_NODE_CEILING + 1).ok, false);
  assert.equal(adjudicateDomNodes(0).ok, false);
  assert.equal(adjudicateDomNodes(Number.NaN).ok, false);
});

test('K-03/23：帧时读数 270 帧 P50 8.4 / P95 10.3 / 长帧 0，且非人眼证据', () => {
  assert.equal(truth.frames.count, 270);
  assert.equal(truth.frames.p50Ms, 8.4);
  assert.equal(truth.frames.p95Ms, 10.3);
  assert.equal(truth.frames.longFrameRatio, 0);
  assert.equal(truth.domHumanEyeEquivalent, false);
  assert.equal(adjudicateFrameTimes(truth.frames).ok, true);
});

test('负测 帧时：P95 < P50 / 缺样本 / 缺 longFrameRatio → 判红', () => {
  assert.equal(adjudicateFrameTimes({ ...truth.frames, p95Ms: 1 }).ok, false);
  assert.equal(adjudicateFrameTimes({ count: 0 }).ok, false);
  const f = { ...truth.frames }; delete f.longFrameRatio;
  assert.equal(adjudicateFrameTimes(f).ok, false);
});

test('负测 K-23：把离屏读数冒充人眼 → 判红', () => {
  mustRed(tamper({ domHumanEyeEquivalent: true }), 'K-23');
});

// ---- K-24 三矩阵同源 ----
test('K-24：三矩阵非同源现状如实登记（capability 下游派生、shelf 独立源）', () => {
  assert.equal(truth.matrices.surfaceWired, true);
  assert.equal(truth.matrices.capabilityWired, true);
  assert.equal(truth.matrices.shelfWired, false);
  assert.equal(truth.matrices.capabilityDerivedFromMatrix, true);
  assert.equal(truth.matrices.shelfIndependent, true);
  assert.equal(truth.matrices.summary.tools, 115);
});

test('负测 K-24：把 shelf 冒充已接入同源生成器 → 判红', () => {
  mustRed(tamper({ matrices: { ...truth.matrices, shelfWired: true } }), 'K-24');
});

// ---- K-25 165 通道账本 ----
test('K-25：165 = 124 + 41 + 0，surface-matrix 与 triage 一致，零静默消失', () => {
  assert.equal(truth.channels.total, 165);
  assert.equal(truth.channels.needsWiring, 124);
  assert.equal(truth.channels.retainWithReason, 41);
  assert.equal(truth.channels.deletable, 0);
  assert.equal(truth.channels.surfaceIpcUnused, 165);
});

test('负测 K-25：删一条通道 / 缩总数 → 判红', () => {
  mustRed(tamper({ channels: { ...truth.channels, needsWiring: 123 } }), 'K-25');
  mustRed(tamper({ channels: { ...truth.channels, total: 164 } }), 'K-25');
});

// ---- K-26 EAR ----
test('K-26：EAR 分子 871 / 分母 2013 / 43.3%，阈值 40 与公式零改动，manifest 真棘轮在场（L0-3）', () => {
  assert.equal(truth.ear.assetized, 871);
  assert.equal(truth.ear.denominator, 2013);
  assert.equal(truth.ear.frozenRatio, 43.3);
  assert.equal(truth.ear.threshold, 40);
  assert.equal(truth.ear.formulaUnchanged, true);
  assert.equal(truth.ear.ratchetManifest, true);
  assert.equal(truth.ear.targetPct, 45);
});

test('负测 K-26：缩分母凑 45% / 改阈值凑达标 / 移除真棘轮 → 判红', () => {
  mustRed(tamper({ ear: { ...truth.ear, denominator: 1900 } }), 'K-26');
  mustRed(tamper({ ear: { ...truth.ear, threshold: 43 } }), 'K-26');
  mustRed(tamper({ ear: { ...truth.ear, ratchetManifest: false } }), 'K-26');
});

test('K5 五类不变量在真实源码下成立', () => {
  const v = adjudicatePerfMatrix(truth);
  assert.equal(v.ok, true, v.issues.join(' / '));
  assert.equal(v.verdict, 'perf-evidence-invariants-verified-v-l-deferred');
});

test('负测：事实整体缺席 → fail-closed 判红', () => {
  assert.equal(adjudicatePerfMatrix({}).ok, false);
});
