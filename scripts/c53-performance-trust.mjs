#!/usr/bin/env node
/**
 * scripts/c53-performance-trust.mjs — BLOCK-474 / C-53 P5：性能与可信状态静态扫描。
 *
 * collectPerformanceTrust(root) 是纯函数：从 canonical 真源
 * （BLOCK-154 memo 边界 + BLOCK-466 流式投影 + M55 SSE 续传 + STATE_MATRIX 加载/空/错误态）
 * 机械复算六组读数，不写盘语义部分、不依赖时间：
 *   - streamingProjection 流式投影可信态（pending 强制 / compose→pending 替换 / completed 升级 / 纯 content 投影）
 *   - memoBoundary        memo 渲染边界（React.memo + 三条契约 it）
 *   - sseResume           SSE 断线续传（afterSeq / [DONE] 哨兵 / 跨 chunk 归并 / ping / 负测）
 *   - trustStateMachine   加载/空/错误 12 格 + role=alert/status/aria-busy 证据
 *   - renderSkeleton      首屏占位（compose-stream-pending + 四条接线 it）
 *   - humanEyeSlots       观感留槽（pending_human_eye 保持 in_progress，零代签）
 * 同一批读数派生 acceptance 快照与 resources/design-context/performance-trust.json
 * ——模型可读、可复算，被 test/c53-performance-trust.test.mjs 锚定。
 *
 * 用法：node scripts/c53-performance-trust.mjs            # 写快照+契约+manifest
 *       node scripts/c53-performance-trust.mjs --check    # 只重算并与落盘 value 比对
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { deepStrictEqual } from 'node:assert/strict';
import { STATE_MATRIX } from './ui-design-a11y.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 冻结读数 = 设计不变量（跨工作包生命周期稳定），被消费测试逐读数深等。 */
export const READING_IDS = Object.freeze([
  'streamingProjection', 'memoBoundary', 'sseResume',
  'trustStateMachine', 'renderSkeleton', 'humanEyeSlots',
]);

/** 冻结契约下限（只减必红）：现读 it 数 / SSE 契约数 / 观感槽数。 */
export const TRUST_FLOOR = Object.freeze({
  streamingContractIts: 8,
  memoContractIts: 3,
  sseContractTests: 6,
  skeletonContractIts: 4,
  humanEyeSlots: 2,
  sseContracts: Object.freeze({
    afterSeqResume: true,
    doneSentinel: true,
    crossChunkMerge: true,
    pingTransparent: true,
    terminalOrder: true,
    missingSentinelNegative: true,
  }),
  owner: 'BLOCK-474 / C-53 P5：立项现读 2026-11-18；契约 it/证据缺失必红；观感归 E 不代签',
});

// own-enumerable 查找（BLOCK-456 先例），避免 object-injection 告警。
const ownGet = (obj, key) => Object.entries(obj ?? {}).find(([k]) => k === key)?.[1];
const readText = (rel, root = ROOT) => fs.readFileSync(path.join(root, rel), 'utf8');
const has = (text, re) => re.test(String(text ?? ''));
const count = (text, re) => (String(text ?? '').match(re) || []).length;

/**
 * 纯函数：流式投影可信态。sourcesOverride 为 {rel:text} 映射（测试注入用）。
 * 真源 references.ts（投影语义 + 嵌套 JSON 前缀判据）与 referencesStreaming.ts（streaming 强制 pending）。
 */
export function scanStreamingProjection(root = ROOT, sourcesOverride = null) {
  const read = (rel) => ownGet(sourcesOverride ?? {}, rel) ?? readText(rel, root);
  const streaming = read('frontend/src/components/copilot/gen-ui/referencesStreaming.ts');
  const projection = read('frontend/src/components/copilot/gen-ui/references.ts');
  const contract = read('frontend/src/components/copilot/gen-ui/references-streaming.test.ts');
  return {
    streamingForcesPending: has(streaming, /if\s*\(\s*!?streaming\s*\)/) && has(streaming, /kind:\s*['"]pending['"]/),
    composeToPending: has(streaming, /compose\s*\?\s*\{?\s*kind:\s*['"]pending['"]/) || has(streaming, /part\.kind\s*===\s*['"]compose['"][\s\S]{0,120}kind:\s*['"]pending['"]/),
    completedUpgrade: has(streaming, /projectGenUiReferences\(content,\s*true\)/),
    pureContentProjection: has(streaming, /projectStreamingCompose\(content:\s*string,\s*streaming:\s*boolean\)/),
    jsonPrefixGuard: has(projection, /isComposeJsonPrefix/),
    pendingPart: has(projection, /['"]pending['"]/) && has(projection, /kind:\s*['"]pending['"]/),
    contractItCount: count(contract, /\bit\s*\(/g),
  };
}

/** 纯函数：BLOCK-154 memo 渲染边界。 */
export function scanMemoBoundary(root = ROOT, sourcesOverride = null) {
  const read = (rel) => ownGet(sourcesOverride ?? {}, rel) ?? readText(rel, root);
  const component = read('frontend/src/components/copilot/SimpleChat/SimpleChatMessageRow.tsx');
  const contract = read('frontend/src/components/copilot/SimpleChat/SimpleChatMessageRow.test.tsx');
  return {
    reactMemo: has(component, /React\.memo\s*\(/),
    bailOutIt: has(contract, /bail-out/) && has(contract, /CopilotMarkdown/),
    identityBreakIt: has(contract, /身份变化/) && has(contract, /重渲染/),
    callbackIdentityIt: has(contract, /回调身份/) && has(contract, /击穿/),
    contractItCount: count(contract, /\bit\s*\(/g),
  };
}

/** 纯函数：M55 SSE 断线续传契约。 */
export function scanSseResume(root = ROOT, sourcesOverride = null) {
  const read = (rel) => ownGet(sourcesOverride ?? {}, rel) ?? readText(rel, root);
  const contract = read('test/m4-sse-real-endpoint.test.mjs');
  const parser = read('scripts/lib-sse-frames.mjs');
  return {
    afterSeqResume: has(contract, /afterSeq\s*续传/) && has(contract, /strict|严格递增|>\s*prev/),
    doneSentinel: has(contract, /\[DONE\]|裸 \[DONE\]/),
    crossChunkMerge: has(contract, /跨 chunk|逐字节|半帧归并/),
    pingTransparent: has(contract, /ping.*透明|心跳.*透明|不产出 data 帧/),
    terminalOrder: has(contract, /终态顺序|terminalOrder/),
    missingSentinelNegative: has(contract, /负测|MISSING_DONE_SENTINEL/),
    contractTestCount: count(contract, /\btest\s*\(/g),
    parserInPlace: has(parser, /export function parseSseStream/),
  };
}

/**
 * 纯函数：加载/空/错误可信态状态机。
 * 复用 ui-design-a11y.mjs STATE_MATRIX 的 loading/empty/error × 4 kinds = 12 格判据；
 * 从 TSX 全源现读 role=alert/status / aria-busy / aria-live 证据。
 */
export function scanTrustStateMachine(root = ROOT, sourcesOverride = null) {
  const trustStates = new Set(['loading', 'empty', 'error']);
  const trustCells = STATE_MATRIX.filter((r) => trustStates.has(String(r.key).split(':')[1]));
  const complete = trustCells.length === 12
    && trustCells.every((r) => r.key && r.criterion && r.evidence && r.terminal);
  let chunks = [];
  if (sourcesOverride) {
    chunks = Object.values(sourcesOverride).map(String);
  } else {
    const walk = (dir) => {
      if (!fs.existsSync(dir)) return [];
      const out = [];
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) { out.push(...walk(full)); continue; }
        if (/\.(tsx|ts)$/.test(e.name) && !/\.(test|spec)\./.test(e.name)) out.push(full);
      }
      return out;
    };
    chunks = walk(path.join(root, 'frontend/src')).map((f) => fs.readFileSync(f, 'utf8'));
  }
  const src = chunks.join('\n');
  const evidence = {
    roleAlert: count(src, /role=["']alert["']/g),
    roleStatus: count(src, /role=["']status["']/g),
    ariaBusy: count(src, /aria-busy/g),
    ariaLive: count(src, /aria-live/g),
  };
  return {
    trustCells: trustCells.length,
    complete,
    evidence,
    cells: STATE_MATRIX.length,
  };
}

/** 纯函数：首屏占位（BLOCK-466 流式渲染接线）。 */
export function scanRenderSkeleton(root = ROOT, sourcesOverride = null) {
  const read = (rel) => ownGet(sourcesOverride ?? {}, rel) ?? readText(rel, root);
  const component = read('frontend/src/components/copilot/gen-ui/GenUiMessageContent.tsx');
  const contract = read('frontend/src/components/copilot/gen-ui/GenUiMessageContent.streaming.test.tsx');
  return {
    pendingTestId: has(component, /compose-stream-pending/) && has(component, /data-testid/),
    streamingBranch: has(component, /streaming\s*\n?\s*\?/ ) || has(component, /projectStreamingCompose\(content,\s*true\)/),
    partialPlaceholderIt: has(contract, /partial/) && has(contract, /占位/),
    fullStillPlaceholderIt: has(contract, /完整 spec 仍占位/) || has(contract, /完整.*仍占位/),
    plainTextFastPathIt: has(contract, /纯文本.*快路径/),
    fenceExemptIt: has(contract, /围栏.*豁免|代码围栏/),
    contractItCount: count(contract, /\bit\s*\(/g),
  };
}

/** 观感留槽：本包零观感写面，pending_human_eye 保持 in_progress。 */
function collectHumanEyeSlots() {
  return {
    humanEyeSigned: false,
    status: 'in_progress',
    slots: [
      'C-53 P5 流式占位/骨架动画观感（pending_human_eye，待用户实机过目）',
      'C-53 P5 加载/空/错误态视觉观感（pending_human_eye，待用户实机过目）',
    ],
    readOnly: true,
    note: 'Agent 不代签观感；仅机械复算可信态/性能契约，动画与视觉观感签字槽留用户。',
  };
}

/** 结构完整性 fail-closed：缺读数/缺元数据/value 含 null 子字段即红。 */
export function validatePerformanceTrustIntegrity(readings) {
  const issues = [];
  if (!readings || typeof readings !== 'object') return { ok: false, issues: ['readings 非对象'] };
  for (const id of READING_IDS) {
    const r = ownGet(readings, id);
    if (!r) { issues.push(`${id} 缺席`); continue; }
    for (const k of ['source', 'command', 'capturedAt']) {
      if (!ownGet(r, k)) issues.push(`${id} 缺 ${k}`);
    }
    if (r.value === undefined || r.value === null) { issues.push(`${id} 缺 value`); continue; }
    if (typeof r.value === 'object') {
      const nulls = Object.entries(r.value).filter(([, v]) => v === null || v === undefined).map(([k]) => k);
      if (nulls.length) issues.push(`${id}.value 含 null/undefined 子字段: ${nulls.join(',')}`);
    }
  }
  return { ok: issues.length === 0, issues };
}

/** 纯函数：机械复算全部六组读数。返回 { [id]: {value, source, command, capturedAt} }。 */
export function collectPerformanceTrust(root = ROOT) {
  const capturedAt = new Date().toISOString();
  const mk = (value, source, command) => ({ value, source, command, capturedAt });
  const cmd = 'node scripts/c53-performance-trust.mjs';

  const streamingProjection = scanStreamingProjection(root);
  const memoBoundary = scanMemoBoundary(root);
  const sseResume = scanSseResume(root);
  const trustStateMachine = scanTrustStateMachine(root);
  const renderSkeleton = scanRenderSkeleton(root);
  const humanEyeSlots = collectHumanEyeSlots();

  // fail-closed：任何契约级违例直接抛错，拒绝生成"看起来绿的"快照。
  if (!streamingProjection.streamingForcesPending || !streamingProjection.composeToPending
      || !streamingProjection.completedUpgrade || !streamingProjection.pureContentProjection
      || !streamingProjection.jsonPrefixGuard || !streamingProjection.pendingPart
      || streamingProjection.contractItCount < TRUST_FLOOR.streamingContractIts) {
    throw new Error(`[c53:trust] 流式投影契约违约: ${JSON.stringify(streamingProjection)}`);
  }
  if (!memoBoundary.reactMemo || !memoBoundary.bailOutIt || !memoBoundary.identityBreakIt
      || !memoBoundary.callbackIdentityIt || memoBoundary.contractItCount < TRUST_FLOOR.memoContractIts) {
    throw new Error(`[c53:trust] memo 渲染边界违约: ${JSON.stringify(memoBoundary)}`);
  }
  for (const [k, required] of Object.entries(TRUST_FLOOR.sseContracts)) {
    if (required && !ownGet(sseResume, k)) throw new Error(`[c53:trust] SSE 契约缺失: ${k}`);
  }
  if (sseResume.contractTestCount < TRUST_FLOOR.sseContractTests || !sseResume.parserInPlace) {
    throw new Error(`[c53:trust] SSE 契约测试/解析器缺失: ${JSON.stringify(sseResume)}`);
  }
  if (!trustStateMachine.complete || trustStateMachine.trustCells !== 12 || trustStateMachine.cells !== STATE_MATRIX.length) {
    throw new Error(`[c53:trust] 可信态状态矩阵不完整: ${JSON.stringify(trustStateMachine)}`);
  }
  for (const [k, v] of Object.entries(trustStateMachine.evidence)) {
    if (!(v > 0)) throw new Error(`[c53:trust] 可信态证据缺失: ${k} = ${v}`);
  }
  if (!renderSkeleton.pendingTestId || !renderSkeleton.streamingBranch
      || !renderSkeleton.partialPlaceholderIt || !renderSkeleton.fullStillPlaceholderIt
      || !renderSkeleton.plainTextFastPathIt || !renderSkeleton.fenceExemptIt
      || renderSkeleton.contractItCount < TRUST_FLOOR.skeletonContractIts) {
    throw new Error(`[c53:trust] 首屏占位契约违约: ${JSON.stringify(renderSkeleton)}`);
  }
  if (humanEyeSlots.humanEyeSigned || humanEyeSlots.status !== 'in_progress') {
    throw new Error('[c53:trust] 观感留槽被代签或状态非 in_progress');
  }

  return {
    streamingProjection: mk(streamingProjection, 'referencesStreaming.ts + references.ts + references-streaming.test.ts', cmd),
    memoBoundary: mk(memoBoundary, 'SimpleChatMessageRow.tsx + .test.tsx（BLOCK-154）', cmd),
    sseResume: mk(sseResume, 'm4-sse-real-endpoint.test.mjs + lib-sse-frames.mjs（M55）', cmd),
    trustStateMachine: mk(trustStateMachine, 'ui-design-a11y.mjs STATE_MATRIX + frontend/src TSX 全源', cmd),
    renderSkeleton: mk(renderSkeleton, 'GenUiMessageContent.tsx + .streaming.test.tsx（BLOCK-466）', cmd),
    humanEyeSlots: mk(humanEyeSlots, 'UI 台账 pending_human_eye（观感零代签）', cmd),
  };
}

const sourceCommitOf = (root) => execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();

function main(argv) {
  const readings = collectPerformanceTrust(ROOT);
  const check = validatePerformanceTrustIntegrity(readings);
  if (!check.ok) {
    console.error(`[c53:trust] 读数不合格，拒绝写盘: ${check.issues.join('; ')}`);
    process.exitCode = 1;
    return;
  }
  const sourceCommit = sourceCommitOf(ROOT);
  const snapPath = path.join(ROOT, 'acceptance/block474-c53-p5-performance-trust/performance-trust-snapshot.json');
  const contractPath = path.join(ROOT, 'resources/design-context/performance-trust.json');
  const manifestPath = path.join(ROOT, 'resources/design-context/manifest.json');

  if (argv.includes('--check')) {
    if (!fs.existsSync(snapPath)) { console.error('[c53:trust] 快照缺席，请先生成'); process.exitCode = 1; return; }
    const snap = JSON.parse(fs.readFileSync(snapPath, 'utf8'));
    for (const id of READING_IDS) {
      try { deepStrictEqual(ownGet(readings, id).value, ownGet(snap.readings, id).value); }
      catch { console.error(`[c53:trust] --check 漂移: ${id}`); process.exitCode = 1; return; }
    }
    console.log(JSON.stringify({
      ok: true,
      sourceCommit,
      readingIds: READING_IDS,
      streamingIts: ownGet(readings, 'streamingProjection').value.contractItCount,
      memoIts: ownGet(readings, 'memoBoundary').value.contractItCount,
      sseTests: ownGet(readings, 'sseResume').value.contractTestCount,
      trustCells: ownGet(readings, 'trustStateMachine').value.trustCells,
      skeletonIts: ownGet(readings, 'renderSkeleton').value.contractItCount,
    }, null, 2));
    return;
  }

  const frozenReadings = Object.fromEntries(READING_IDS.map((id) => [id, ownGet(readings, id)]));
  const snapshot = {
    schemaVersion: 1,
    kind: 'c53-performance-trust',
    capability: 'block474-c53-p5-performance-trust',
    sourceCommit,
    platform: `${os.platform()}-${os.arch()}`,
    command: 'node scripts/c53-performance-trust.mjs',
    generatedAt: new Date().toISOString(),
    evidenceClass: 'mechanical-gate',
    verdict: 'measured',
    humanEyeEquivalent: false,
    note: '读数=机械不变量（冻结，消费测试逐读数深等）；观感项 pending_human_eye 不代签，本包只读不改任何 UI 运行时代码。',
    readings: frozenReadings,
  };

  const contract = {
    schemaVersion: 1,
    id: 'petri-performance-trust-contract',
    kind: 'model-readable-performance-trust',
    generatedBy: 'node scripts/c53-performance-trust.mjs',
    sourceCommit,
    generatedAt: new Date().toISOString(),
    derivedFrom: [
      'frontend/src/components/copilot/gen-ui/referencesStreaming.ts + references.ts（BLOCK-466 流式投影）',
      'frontend/src/components/copilot/SimpleChat/SimpleChatMessageRow.tsx + .test.tsx（BLOCK-154 memo）',
      'test/m4-sse-real-endpoint.test.mjs + scripts/lib-sse-frames.mjs（M55 SSE 续传）',
      'scripts/ui-design-a11y.mjs STATE_MATRIX + frontend/src TSX 全源（加载/空/错误态）',
      'frontend/src/components/copilot/gen-ui/GenUiMessageContent.tsx + .streaming.test.tsx（首屏占位）',
    ],
    streamingProjection: ownGet(readings, 'streamingProjection').value,
    memoBoundary: ownGet(readings, 'memoBoundary').value,
    sseResume: ownGet(readings, 'sseResume').value,
    trustStateMachine: ownGet(readings, 'trustStateMachine').value,
    renderSkeleton: ownGet(readings, 'renderSkeleton').value,
    humanEyeSlots: ownGet(readings, 'humanEyeSlots').value,
    boundaries: {
      humanEyeSigned: false,
      readOnly: true,
      note: '观感项（流式占位/骨架动画/加载空错误视觉）pending_human_eye 保持 in_progress，Agent 不代签；本契约为只读机械扫描，不改任何 UI 运行时代码。',
    },
  };

  const contractBuf = Buffer.from(`${JSON.stringify(contract, null, 2)}\n`, 'utf8');
  for (const p of [snapPath, contractPath, manifestPath]) fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(snapPath, `${JSON.stringify(snapshot, null, 2)}\n`);
  fs.writeFileSync(contractPath, contractBuf);

  // manifest 同步（沿 P1/P2/P3/P4 先例）：performance-trust 的 sha256 由生成器自身维护。
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const files = Array.isArray(manifest.files) ? manifest.files : [];
  const sha = createHash('sha256').update(contractBuf).digest('hex');
  const entry = files.find((f) => ownGet(f, 'path') === 'performance-trust.json');
  if (entry) entry.sha256 = sha;
  else files.push({ path: 'performance-trust.json', sha256: sha });
  manifest.files = files;
  manifest.generatedAt = new Date().toISOString();
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  console.log(JSON.stringify({
    written: [snapPath, contractPath, manifestPath].map((p) => path.relative(ROOT, p)),
    sourceCommit,
    readingIds: READING_IDS,
    streamingIts: ownGet(readings, 'streamingProjection').value.contractItCount,
    memoIts: ownGet(readings, 'memoBoundary').value.contractItCount,
    sseTests: ownGet(readings, 'sseResume').value.contractTestCount,
    trustCells: ownGet(readings, 'trustStateMachine').value.trustCells,
    skeletonIts: ownGet(readings, 'renderSkeleton').value.contractItCount,
  }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exitCode = 1; }
}
