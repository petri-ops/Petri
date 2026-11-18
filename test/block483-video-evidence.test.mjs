/*
 * BLOCK-483 注记：r.rows[i].sources[j] 等下标访问作用于测试内自建的固定结构 fixture，
 * 键为常量下标、无外部输入；helper 侧已用 ownGet 收敛动态访问，无需额外 eslint 豁免。
 */
/**
 * BLOCK-483 / C-55 VIDEO-P1 — 科学证据与质量闭环契约（HK-01 红绿先行）。
 *
 * 蓝本：acceptance/video-north-star-2026-11-18/VIDEO-NORTH-STAR-PLAN.md §5 P1。
 * 钉住八组不变量（对应 P1 八项工作）：
 *   A) 来源分级（SOURCE_KINDS 五档 + classifySource）
 *   B) Claim–Evidence 表（逐论断定位来源原文 / accessedAt / excerptRef / traceStatus）
 *   C) 数字/单位/数量级确定性检查（换算错误样本被捕获）
 *   D) 冲突来源并列，不静默择一
 *   E) 低置信/无来源论断显著标记
 *   F) 画面/讲稿科学语义对照（evidenceRefs 悬空即红）
 *   G) AV 质检（黑帧/静音/响度/音画时长/字幕溢出/编码错误；坏字幕/缺音轨被拦）
 *   H) 完整性 fail-closed（篡改 status / 检查项即红）
 * 篡改负测：来源缺 excerptRef / 单位换算翻态 / 冲突被静默择一 / 音轨缺失 / 字幕溢出一律 fail-closed。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const H = require('../core/petri-server/helpers/video-evidence.js');

const SRC = (id, over = {}) => ({
  id, kind: 'web', urlOrPath: `https://example.org/${id}`, title: `${id} 资料`,
  accessedAt: '2026-11-18', publishedAt: '2024-03-01', excerptRef: `原文片段-${id}`, license: 'CC-BY-4.0', ...over,
});
const CLAIM = (id, over = {}) => ({ id, text: '某科学论断', sourceIds: [id === 'c1' ? 's1' : 's2'], confidence: 'high', ...over });
const SPEC = (over = {}) => ({
  schemaVersion: 1,
  goal: { topic: '瑞利散射', audience: '小学生', language: 'zh', durationSec: 36, aspectRatio: '16:9' },
  sources: [SRC('s1'), SRC('s2', { kind: 'paper', urlOrPath: 'https://doi.org/10.1000/rayleigh' })],
  claims: [CLAIM('c1'), CLAIM('c2')],
  scenes: [
    { id: 'sc1', narration: '短波蓝光更易被散射', visual: { kind: 'card', title: '瑞利散射', text: '波长越短越易散射' }, evidenceRefs: ['c1'] },
    { id: 'sc2', narration: '所以天空是蓝色的', visual: { kind: 'card', title: '蓝天', text: '散射蓝光进入眼睛' }, evidenceRefs: ['c2'] },
  ],
  ...over,
});
const PROBE = (over = {}) => ({
  video: { durationSec: 21.92, width: 1280, height: 720, codec: 'h264', blackFrames: 0, frameCount: 526 },
  audio: { present: true, durationSec: 21.9, peakDbfs: -12.4, silentSec: 0.2 },
  subtitles: { count: 3, overflowCount: 0, burned: true },
  ...over,
});

// ---------- A) 来源分级 ----------
test('A0 — 常量契约：SCHEMA_VERSION=1 / SOURCE_KINDS 五档 / CONFIDENCE_LEVELS 三档 / AV_CHECK_NAMES 六项', () => {
  assert.equal(H.SCHEMA_VERSION, 1);
  assert.deepEqual(H.SOURCE_KINDS, ['official_doc', 'paper', 'authority', 'web', 'user_material']);
  assert.deepEqual(H.CONFIDENCE_LEVELS, ['high', 'medium', 'low']);
  assert.deepEqual(H.AV_CHECK_NAMES, ['black_frame', 'silence', 'loudness', 'av_duration_skew', 'subtitle_overflow', 'codec_error']);
});

test('A1 — classifySource 五档识别 + 未知 kind 归 web 且 inferred=true（不静默丢来源）', () => {
  assert.equal(H.classifySource({ kind: 'paper' }).kind, 'paper');
  assert.equal(H.classifySource({ kind: 'authority' }).kind, 'authority');
  assert.equal(H.classifySource({ urlOrPath: 'https://doi.org/10.1/x' }).kind, 'paper', 'DOI 启发式归论文');
  const unknown = H.classifySource({ kind: 'mystery', urlOrPath: 'https://x.org' });
  assert.equal(unknown.kind, 'web');
  assert.equal(unknown.inferred, true);
});

// ---------- B) Claim–Evidence 表 ----------
test('B0 — 合法 spec：逐论断定位来源原文，traced=true，五档分级记录在场', () => {
  const r = H.buildClaimEvidenceTable(SPEC());
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.rows.length, 2);
  assert.ok(r.rows.every((row) => row.traced === true), '每条论断均应定位到来源原文');
  assert.ok(r.rows.every((row) => row.sources.every((s) => s.excerptRef && s.accessedAt && s.urlOrDoi)));
  assert.deepEqual(r.stats, { claims: 2, traced: 2, untraced: 0, conflicts: 0, lowConfidence: 0 });
});

test('B1 — 篡改负测：来源缺 excerptRef → 该论断 untraced（不冒充已溯源）', () => {
  const spec = SPEC();
  delete spec.sources[0].excerptRef;
  const r = H.buildClaimEvidenceTable(spec);
  assert.equal(r.ok, true);
  assert.equal(r.rows[0].traced, false);
  assert.ok(r.rows[0].flags.includes('missing_excerpt'));
  assert.equal(r.stats.untraced, 1);
});

test('B2 — 无来源论断 → no_source 标记，不被当成 traced', () => {
  const spec = SPEC();
  spec.claims = [CLAIM('c1', { sourceIds: [] })];
  const r = H.buildClaimEvidenceTable(spec);
  assert.equal(r.rows[0].traced, false);
  assert.ok(r.rows[0].flags.includes('no_source'));
});

test('B3 — 五论断抽查：全部定位来源原文（出口①），count=5 traced=5', () => {
  const spec = SPEC({
    sources: [SRC('s1'), SRC('s2'), SRC('s3'), SRC('s4'), SRC('s5')],
    claims: ['c1', 'c2', 'c3', 'c4', 'c5'].map((id, i) => CLAIM(id, { sourceIds: [`s${i + 1}`] })),
  });
  const r = H.buildClaimEvidenceTable(spec);
  assert.equal(r.stats.claims, 5);
  assert.equal(r.stats.traced, 5);
  assert.equal(r.stats.untraced, 0);
});

// ---------- C) 数字/单位确定性检查 ----------
test('C0 — 正确换算通过：650 nm = 0.65 μm', () => {
  const r = H.checkNumericClaims([CLAIM('c1', { text: '蓝光波长 650 nm = 0.65 μm，属于可见光' })]);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.issues.length, 0);
  assert.equal(r.checked, 1);
});

test('C1 — 篡改负测：错误换算 650 nm = 65 μm 被捕获（出口②）', () => {
  const r = H.checkNumericClaims([CLAIM('c1', { text: '蓝光波长 650 nm = 65 μm' })]);
  assert.equal(r.ok, false);
  assert.ok(r.issues.some((i) => i.type === 'unit_conversion_mismatch'));
});

test('C2 — 相干换算族：1 km = 1000 m 通过；1 km = 100 m 被拒', () => {
  assert.equal(H.checkNumericClaims([CLAIM('c1', { text: '距离 1 km = 1000 m' })]).ok, true);
  assert.equal(H.checkNumericClaims([CLAIM('c1', { text: '距离 1 km = 100 m' })]).ok, false);
});

// ---------- D) 冲突来源并列 ----------
test('D0 — 冲突来源并列展示，不静默择一（出口③）', () => {
  const spec = SPEC();
  spec.claims = [CLAIM('c1', { text: '波长为 650 nm', sourceIds: ['s1', 's2'] })];
  spec.sources[0].excerptRef = '原文：波长 650 nm';
  spec.sources[1].excerptRef = '原文：波长 700 nm';
  const r = H.detectConflicts(spec);
  const conflict = r.conflicts.find((c) => c.claimId === 'c1');
  assert.ok(conflict, '分歧样本必须被识别为冲突');
  assert.equal(conflict.resolution, 'parallel_display');
  assert.equal(conflict.values.length, 2, '冲突双方并列保留，不择一');
  assert.match(conflict.note, /不静默|用户裁决/);
});

test('D1 — 一致来源不误报冲突', () => {
  const spec = SPEC();
  spec.claims = [CLAIM('c1', { text: '波长为 650 nm', sourceIds: ['s1', 's2'] })];
  spec.sources[0].excerptRef = '原文：波长 650 nm';
  spec.sources[1].excerptRef = '原文：波长 650 nm';
  assert.equal(H.detectConflicts(spec).conflicts.length, 0);
});

// ---------- E) 低置信标记 ----------
test('E0 — 低置信 + 无来源论断显著标记', () => {
  const spec = SPEC();
  spec.claims = [CLAIM('c1', { confidence: 'low' }), CLAIM('c2', { sourceIds: [] })];
  const r = H.markLowConfidence(spec);
  assert.equal(r.count, 2);
  assert.ok(r.flagged.some((f) => f.claimId === 'c1' && f.reason === 'low_confidence'));
  assert.ok(r.flagged.some((f) => f.claimId === 'c2' && f.reason === 'no_source'));
});

// ---------- F) 科学语义对照 ----------
test('F0 — 合法 spec：每个镜头 evidenceRefs 落在 claims 内，alignment ok', () => {
  const r = H.checkScienceAlignment(SPEC());
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.flags.length, 0);
  assert.equal(r.rows.length, 2);
});

test('F1 — 篡改负测：evidenceRefs 悬空 → unknown_evidence_ref，ok=false', () => {
  const spec = SPEC();
  spec.scenes[0].evidenceRefs = ['c-does-not-exist'];
  const r = H.checkScienceAlignment(spec);
  assert.equal(r.ok, false);
  assert.ok(r.flags.some((f) => f.type === 'unknown_evidence_ref'));
});

test('F2 — 无 evidenceRefs 的镜头 → missing_evidence_ref 警告（非致命但可见）', () => {
  const spec = SPEC();
  spec.scenes[0].evidenceRefs = [];
  const r = H.checkScienceAlignment(spec);
  assert.equal(r.ok, true);
  assert.ok(r.flags.some((f) => f.type === 'missing_evidence_ref'));
});

// ---------- G) AV 质检 ----------
test('G0 — 正常 probe：六项 AV 检查全绿', () => {
  const r = H.auditAV(PROBE());
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.checks.length, 6);
  assert.ok(r.checks.every((c) => c.passed));
  assert.equal(r.humanReview.status, 'pending_human_eye', '观感终审不得代签');
});

test('G1 — 篡改负测：缺音轨 → silence/av_duration_skew 红（出口④）', () => {
  const p = PROBE();
  p.audio = { present: false, durationSec: 0, peakDbfs: -120, silentSec: 21.9 };
  const r = H.auditAV(p);
  assert.equal(r.ok, false);
  assert.ok(r.checks.find((c) => c.name === 'silence').passed === false);
  assert.ok(r.checks.find((c) => c.name === 'av_duration_skew').passed === false);
});

test('G2 — 篡改负测：坏字幕溢出 → subtitle_overflow 红（出口④）', () => {
  const p = PROBE();
  p.subtitles.overflowCount = 2;
  const r = H.auditAV(p);
  assert.equal(r.ok, false);
  assert.ok(r.checks.find((c) => c.name === 'subtitle_overflow').passed === false);
});

test('G3 — 黑帧/响度/编码错误样本各自被拦', () => {
  const p1 = PROBE(); p1.video.blackFrames = 5;
  assert.equal(H.auditAV(p1).checks.find((c) => c.name === 'black_frame').passed, false);
  const p2 = PROBE(); p2.audio.peakDbfs = -0.1; // 近 0dB 削波样本（真实合法成片 -2.2dB 不误伤）
  assert.equal(H.auditAV(p2).checks.find((c) => c.name === 'loudness').passed, false);
  const p3 = PROBE(); p3.video.codec = 'unknown_codec';
  assert.equal(H.auditAV(p3).checks.find((c) => c.name === 'codec_error').passed, false);
});

// ---------- H) 汇总与完整性 fail-closed ----------
test('H0 — buildEvidenceReport 汇总六组读数 + humanReview 留白', () => {
  const r = H.buildEvidenceReport(SPEC(), PROBE());
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.ok(r.sections.claimEvidence && r.sections.numeric && r.sections.conflicts && r.sections.lowConfidence && r.sections.alignment && r.sections.av);
  assert.equal(r.humanReview.status, 'pending_human_eye');
  const check = H.validateEvidenceIntegrity(r);
  assert.equal(check.ok, true, `完整性: ${check.issues.join('; ')}`);
});

test('H1 — 篡改负测：把 humanReview 翻成 verified → validateEvidenceIntegrity 红（观感零代签）', () => {
  const r = H.buildEvidenceReport(SPEC(), PROBE());
  r.humanReview = { status: 'verified', note: '代签' };
  assert.equal(H.validateEvidenceIntegrity(r).ok, false);
});

test('H2 — 篡改负测：AV 检查项被改成 passed 但 detail 标红 → 完整性红', () => {
  const r = H.buildEvidenceReport(SPEC(), PROBE());
  const p = PROBE(); p.subtitles.overflowCount = 2;
  r.sections.av = H.auditAV(p);
  r.sections.av.checks.push({ name: 'forged', passed: true, detail: 'FAIL' });
  assert.equal(H.validateEvidenceIntegrity(r).ok, false);
});
