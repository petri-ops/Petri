#!/usr/bin/env node
/**
 * K5 性能/矩阵判定器（纯函数 + 只读采集，供篡改负测）。
 *
 * 四类：DOM 节点阈值、三矩阵同源、165 通道账本、EAR 分子分母。
 * 明确边界：本模块的 DOM 判定器是**纯函数阈值门**，不是 CDP 实机量测；
 * 离屏读数不得冒充视觉绿/人眼观感（evidenceClass 固定 mechanical-gate）。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const DOM_NODE_CEILING = 20000;

/** 纯函数：植入 2 万节点必红。 */
export function adjudicateDomNodes(nodeCount, ceiling = DOM_NODE_CEILING) {
  const ok = Number.isFinite(nodeCount) && nodeCount > 0 && nodeCount < ceiling;
  return {
    ok,
    nodeCount,
    ceiling,
    verdict: ok ? 'within-budget' : 'over-budget-or-invalid',
    note: '纯函数阈值门，不是 CDP 实机量测；真实 8 档/270 帧需活栈 + 人眼观感',
  };
}

/** 帧时判定（同批落盘，带长帧比）。 */
export function adjudicateFrameTimes(f) {
  const issues = [];
  if (!(f && Number.isFinite(f.count) && f.count > 0)) issues.push('帧样本数缺失');
  if (!(f && Number.isFinite(f.p50Ms) && Number.isFinite(f.p95Ms))) issues.push('P50/P95 缺失');
  if (f && !(f.p95Ms >= f.p50Ms)) issues.push('P95 < P50 不合理');
  if (f && f.longFrameRatio === undefined) issues.push('longFrameRatio 缺失');
  return { ok: issues.length === 0, issues, verdict: issues.length === 0 ? 'measured-not-visual' : 'frame-readings-invalid' };
}

export function collectPerfMatrixTruth(root = ROOT) {
  const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
  const json = (rel) => JSON.parse(read(rel));

  // ① DOM / 帧率读数（机械读取，不冒充实机）
  const dom = json('acceptance/post-s7-2026-11-10/h8/dom-budget-live.json');
  const frames = { ...(dom.frameSamples || {}) };

  // ② 三矩阵同源性：产物间的派生关系 + 是否被 quality:surface 接线
  const pkg = json('package.json');
  const surfaceScript = pkg.scripts['quality:surface'] || '';
  const matrix = json('acceptance/functional-audit-2026-11-04/surface-matrix.json');
  const capability = read('docs/capability-map.md');
  const shelf = json('acceptance/block-352/shelf-matrix.json');
  const matrices = {
    surfaceWired: /functional-surface-audit\.mjs/.test(surfaceScript),
    capabilityWired: /block357-capability-map\.mjs/.test(surfaceScript),
    shelfWired: /block352-shelf-audit\.mjs/.test(surfaceScript),
    capabilityDerivedFromMatrix: /surface-matrix\.json/.test(read('scripts/block357-capability-map.mjs')),
    capabilityMentionsGenerator: /自动生成，勿手改/.test(capability),
    shelfIndependent: /petri-pack-bio|mode=mock|mcp-server/.test(read('scripts/block352-shelf-audit.mjs')),
    summary: { tools: matrix.summary?.tools, ipcChannels: matrix.summary?.ipcChannels, routes: matrix.summary?.routes },
    shelfKeys: Object.keys(shelf).slice(0, 8),
  };

  // ③ 165 通道账本
  const triage = json('acceptance/post-s7-2026-11-10/h9/ipc-unused-triage.json');
  const channels = {
    total: triage.total,
    surfaceIpcUnused: matrix.summary?.ipcUnusedInRenderer ?? matrix.ipcUnused?.length ?? null,
    needsWiring: (triage.buckets?.needsWiring || []).length,
    retainWithReason: (triage.buckets?.retainWithReason || []).length,
    deletable: (triage.buckets?.deletable || []).length,
  };

  // ④ EAR 分子分母
  const earManifest = json('acceptance/block-351/assetized-manifest.json');
  const earSnapshot = json('acceptance/block-351/ear-snapshot.json');
  const earScript = read('scripts/block351-ear.mjs');
  const ear = {
    assetized: earManifest.totals?.assetized,
    denominator: earManifest.totals?.acceptanceFiles,
    frozenRatio: earManifest.totals?.earPct,
    snapshotRatio: earSnapshot.earPct ?? earSnapshot.ratio,
    threshold: Number((earScript.match(/EAR_THRESHOLD\s*=\s*(\d+)/) || [])[1]),
    formulaUnchanged: /entries\.length\s*\/\s*Math\.max\(1,\s*current\.totalFiles\)/.test(earScript),
    ratchetManifest: /manifest 记录[^%]*%（棘轮只进不退|earNow < recorded/.test(earScript) || /earNow\s*<\s*recorded/.test(earScript),
    targetPct: 45,
  };

  // ⑤ perf 证据 opt-in 与 roll-index --check
  const perfScript = read('scripts/block350-perf-gate.mjs');
  const rollScript = read('scripts/docs-roll-index.mjs');
  return {
    frames,
    domVerdict: dom.verdict,
    domHumanEyeEquivalent: dom.humanEyeEquivalent,
    matrices,
    channels,
    ear,
    perfEvidenceOptIn: /if \(process\.env\.PETRI_PERF_EVIDENCE\)/.test(perfScript),
    perfDefaultNoWriteComment: /默认不写盘/.test(perfScript),
    perfFourFields: ['sourceCommit', 'platform', 'command', 'generatedAt'].every((k) => perfScript.includes(k)),
    rollIndexCheckSupported: /args\.includes\('--check'\)|check/.test(rollScript) && /write:\s*!check/.test(rollScript),
    rollIndexInCloseout: /docs:roll-index/.test(pkg.scripts.closeout),
    perfEvidenceTemplate: json('acceptance/post-s7-2026-11-09/h5/perf-evidence.json'),
  };
}

/** 总裁决：证据/矩阵/账本/EAR 四类不变量 + 边界项不得冒充已交付。 */
export function adjudicatePerfMatrix(input) {
  const issues = [];
  const conclusions = {};
  const t = {
    frames: {}, matrices: {}, channels: {}, ear: {},
    ...(input && typeof input === 'object' ? input : {}),
  };
  t.matrices = t.matrices || {};
  t.channels = t.channels || {};
  t.ear = t.ear || {};

  // K-03/23：帧时读数与 DOM 判定器
  let n = issues.length;
  const frame = adjudicateFrameTimes(t.frames);
  for (const i of frame.issues) issues.push(`K-23: ${i}`);
  if (t.domHumanEyeEquivalent !== false) issues.push('K-23: DOM 离屏读数被冒充人眼观感');
  if (adjudicateDomNodes(DOM_NODE_CEILING).ok !== false) issues.push('K-23: 植入 2 万节点未判红');
  conclusions['K-03/23'] = issues.length === n ? 'threshold-gate-mechanical-live-deferred' : 'drift';

  // K-24：三矩阵同源现状（不冒充已同源）
  n = issues.length;
  if (!(t.matrices.surfaceWired && t.matrices.capabilityWired)) issues.push('K-24: quality:surface 接线被破坏');
  if (t.matrices.shelfWired !== false) issues.push('K-24: shelf 已被接入，现状校准失效');
  if (!(t.matrices.capabilityDerivedFromMatrix && t.matrices.capabilityMentionsGenerator)) issues.push('K-24: capability-map 下游派生关系被破坏');
  if (t.matrices.shelfIndependent !== true) issues.push('K-24: shelf 独立数据源现状被改写');
  conclusions['K-24'] = issues.length === n ? 'non-homogeneous-truth-recorded' : 'drift';

  // K-25：165 零静默消失
  n = issues.length;
  const c = t.channels;
  if (!(c.total === 165 && c.needsWiring === 124 && c.retainWithReason === 41 && c.deletable === 0)) issues.push('K-25: 165/124/41/0 账本被改写或通道静默消失');
  if (c.surfaceIpcUnused !== 165) issues.push('K-25: surface-matrix 的 165 与 triage 不一致');
  conclusions['K-25'] = issues.length === n ? 'ledger-intact-adjudication-pending' : 'drift';

  // K-26：EAR 分子分母
  n = issues.length;
  const e = t.ear;
  if (!(e.assetized === 871 && e.denominator === 2013 && e.frozenRatio === 43.3)) issues.push('K-26: EAR 冻结分子/分母被改写（不得缩分母）');
  if (!(e.threshold === 40 && e.formulaUnchanged)) issues.push('K-26: 阈值或公式被改写（不得改数字凑达标）');
  if (e.ratchetManifest !== true) issues.push('K-26: EAR 对 manifest 记录值的真棘轮被移除（L0-3）');
  if (e.targetPct !== 45) issues.push('K-26: 45% 目标被改写');
  conclusions['K-26'] = issues.length === n ? 'ratio-reported-target-pending' : 'drift';

  // K-32 / K-04：opt-in 与 roll-index 边界
  n = issues.length;
  if (!(t.perfEvidenceOptIn && t.perfDefaultNoWriteComment && t.perfFourFields)) issues.push('K-04: perf opt-in 语义或四字段模板被破坏');
  if (t.rollIndexCheckSupported !== true) issues.push('K-32: roll-index --check 支持被破坏');
  if (t.rollIndexInCloseout !== false) issues.push('K-32: roll-index 入链状态被改写（现状校准失效）');
  conclusions['K-32/K-04'] = issues.length === n ? 'metadata-enforced-optin-preserved' : 'drift';

  return {
    ok: issues.length === 0, issues, conclusions,
    verdict: issues.length === 0 ? 'perf-evidence-invariants-verified-v-l-deferred' : 'perf-matrix-drift',
  };
}

function main() {
  const truth = collectPerfMatrixTruth();
  const verdict = adjudicatePerfMatrix(truth);
  console.log(JSON.stringify({ verdict, frames: truth.frames, matrices: truth.matrices, channels: truth.channels, ear: truth.ear }, null, 2));
  if (!verdict.ok) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (e) { console.error(`[post-h9:k5] fail-closed: ${e.message}`); process.exitCode = 1; }
}
