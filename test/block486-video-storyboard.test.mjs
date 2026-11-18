/**
 * BLOCK-486 / C-55 VIDEO-P2 — 素材供给与分镜审阅契约（HK-01 红绿先行）。
 *
 * 蓝本：acceptance/video-north-star-2026-11-18/VIDEO-NORTH-STAR-PLAN.md §5 P2。
 * 钉住八组不变量（对应 P2 七项工作 + 四条出口）：
 *   A) 常量契约与素材登记（ASSET_KINDS / LICENSE_STATUS / registerAsset，缺 provenance 不静默视为已授权）
 *   B) 统一镜头来源（chart/svg/genui/3d_still/card 归一，未知 kind 显著标记）
 *   C) 镜头素材替换不破坏时长/字幕/证据结构（出口①）
 *   D) 外部素材授权状态与来源记录（出口②，缺 provenance 即红）
 *   E) 成片前可看可改分镜清单（出口③）
 *   F) 音频替换契约（不破坏旁白时长/字幕排程）
 *   G) 完整性 fail-closed（观感翻态/授权翻态即红）
 *   H) 出口④零新依赖 + 待裁决留白断言
 * 篡改负测：观感翻 verified / 授权状态翻态 / 替换吞字幕 / 外部素材无 provenance 一律 fail-closed。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const H = require('../core/petri-server/helpers/video-storyboard.js');

const ASSET = (id, over = {}) => ({
  id,
  kind: 'image',
  license: 'CC-BY-4.0',
  attribution: '示例作者',
  urlOrPath: `https://example.org/${id}.png`,
  accessedAt: '2026-11-18',
  licenseStatus: 'authorized',
  ...over,
});
const SCENE = (id, over = {}) => ({
  id,
  durationSec: id === 'sc2' ? 10 : 8,
  narration: `${id} 旁白`,
  captions: [{ startMs: 0, endMs: 4000, text: `${id} 字幕` }],
  visual: { kind: 'card', title: id, text: '卡片' },
  evidenceRefs: [id === 'sc2' ? 'c2' : 'c1'],
  ...over,
});
const SPEC = (over = {}) => ({
  schemaVersion: 1,
  goal: { topic: '瑞利散射', audience: '小学生', language: 'zh', durationSec: 30, aspectRatio: '16:9' },
  assets: [ASSET('a1'), ASSET('a2', { kind: 'music', license: 'public-domain' })],
  claims: [
    { id: 'c1', text: '短波更易散射', sourceIds: ['s1'], confidence: 'high' },
    { id: 'c2', text: '天空呈蓝色', sourceIds: ['s1'], confidence: 'high' },
  ],
  scenes: [SCENE('sc1'), SCENE('sc2', { visual: { kind: 'image', assetRefs: ['a1'] } })],
  audio: { voice: 'zh-female', format: 'wav', narrationRefs: ['sc1', 'sc2'], music: { assetRef: 'a2', gainDb: -18 } },
  qa: { checks: [], status: 'machine_pass', humanReview: { status: 'pending_human_eye' } },
  ...over,
});

// ---------- A) 常量契约与素材登记 ----------
test('A0 — 常量契约：SCHEMA_VERSION=1 / ASSET_KINDS 七类 / LICENSE_STATUS 三档 / VISUAL_SOURCE_KINDS 七类', () => {
  assert.equal(H.SCHEMA_VERSION, 1);
  assert.deepEqual(H.ASSET_KINDS, ['image', 'video', 'music', 'chart', 'svg', 'genui', '3d_still']);
  assert.deepEqual(H.LICENSE_STATUS, ['authorized', 'unknown', 'unauthorized']);
  assert.deepEqual(H.VISUAL_SOURCE_KINDS, ['card', 'image', 'video', 'chart', 'svg', 'genui', '3d_still']);
});

test('A1 — registerAsset 合法登记：许可/署名/来源/授权状态齐全', () => {
  const r = H.registerAsset(ASSET('a1'));
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.licenseStatus, 'authorized');
  assert.deepEqual(r.flags, []);
  assert.equal(r.provenance.license, 'CC-BY-4.0');
});

test('A2 — 篡改负测：缺署名/来源/访问日期不静默视为已授权', () => {
  const r = H.registerAsset(ASSET('bad', { attribution: '', urlOrPath: '', accessedAt: '' }));
  assert.equal(r.ok, false);
  assert.equal(r.licenseStatus, 'unknown');
  assert.ok(r.flags.includes('missing_attribution'));
  assert.ok(r.flags.includes('missing_source'));
  assert.ok(r.flags.includes('missing_accessed_at'));
});

test('A3 — 授权状态非法值归 unknown 并显著标记（不静默信任）', () => {
  const r = H.registerAsset(ASSET('bad2', { licenseStatus: 'super-authorized' }));
  assert.equal(r.licenseStatus, 'unknown');
  assert.ok(r.flags.includes('invalid_license_status'));
});

// ---------- B) 统一镜头来源 ----------
test('B0 — 五类来源归一为镜头来源：chart/svg/genui/3d_still/card 逐项归一且 provenance 保留', () => {
  const spec = SPEC({
    scenes: [
      SCENE('s-chart', { visual: { kind: 'chart', assetRefs: ['a1'] } }),
      SCENE('s-svg', { visual: { kind: 'svg', assetRefs: ['a1'] } }),
      SCENE('s-genui', { visual: { kind: 'genui', sourceRef: 'spec://grid' } }),
      SCENE('s-3d', { visual: { kind: '3d_still', assetRefs: ['a1'] } }),
      SCENE('s-card', { visual: { kind: 'card', title: '卡' } }),
    ],
  });
  const r = H.normalizeVisualSources(spec);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.rows.map((x) => x.normalizedKind), ['chart', 'svg', 'genui', '3d_still', 'card']);
  assert.equal(r.rows.length, 5);
  assert.ok(r.rows[0].assetRefs.includes('a1'), 'provenance/assetRefs 保留不丢');
});

test('B1 — 未知 visual.kind 显著标记 unknown_visual_kind，不静默归一', () => {
  const spec = SPEC({ scenes: [SCENE('s-unknown', { visual: { kind: 'hologram' } })] });
  const r = H.normalizeVisualSources(spec);
  assert.ok(r.flags.some((f) => f.type === 'unknown_visual_kind' && f.sceneId === 's-unknown'));
  assert.equal(r.rows[0].normalizedKind, 'card', '未知来源兜底为 card 并标记');
});

// ---------- C) 镜头替换不破坏结构（出口①） ----------
test('C0 — 替换 sc2 素材后 durationSec/captions/evidenceRefs/narration 逐字段不变（出口①）', () => {
  const spec = SPEC();
  const before = structuredClone(spec.scenes[1]);
  const r = H.replaceSceneAsset(spec, 'sc2', { kind: 'svg', assetRefs: ['a-new'] });
  assert.equal(r.ok, true, JSON.stringify(r));
  const after = r.spec.scenes[1];
  assert.equal(after.durationSec, before.durationSec);
  assert.deepEqual(after.captions, before.captions);
  assert.deepEqual(after.evidenceRefs, before.evidenceRefs);
  assert.equal(after.narration, before.narration);
  assert.deepEqual(after.visual, { kind: 'svg', assetRefs: ['a-new'] });
  assert.equal(r.unchanged.durationSec, true);
  assert.equal(r.unchanged.captions, true);
  assert.equal(r.unchanged.evidenceRefs, true);
  assert.equal(r.unchanged.narration, true);
});

test('C1 — 篡改负测：新素材试图夹带 durationSec/captions 覆盖 → 被忽略并标记', () => {
  const spec = SPEC();
  const before = structuredClone(spec.scenes[1]);
  const r = H.replaceSceneAsset(spec, 'sc2', { kind: 'svg', assetRefs: ['a-new'], durationSec: 999, captions: [] });
  assert.equal(r.ok, true);
  assert.equal(r.spec.scenes[1].durationSec, before.durationSec, '覆盖字段必须被忽略');
  assert.deepEqual(r.spec.scenes[1].captions, before.captions);
  assert.ok(r.flags.includes('ignored_structure_override'));
});

test('C2 — 目标镜头不存在 → ok=false，不误改其它镜头', () => {
  const spec = SPEC();
  const r = H.replaceSceneAsset(spec, 'sc-none', { kind: 'image' });
  assert.equal(r.ok, false);
  assert.ok(r.flags.includes('scene_not_found'));
  assert.deepEqual(r.spec, spec);
});

// ---------- D) 素材授权状态与来源（出口②） ----------
test('D0 — 每个外部素材有授权状态与来源记录 → ok=true（出口②）', () => {
  const r = H.auditAssetProvenance(SPEC());
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.stats, { total: 2, authorized: 2, unknown: 0, unauthorized: 0, missingProvenance: 0 });
});

test('D1 — 篡改负测：外部素材无 provenance → ok=false + missing_provenance（出口②）', () => {
  const spec = SPEC({ assets: [ASSET('a1', { license: '', attribution: '', urlOrPath: '', accessedAt: '' })] });
  const r = H.auditAssetProvenance(spec);
  assert.equal(r.ok, false);
  assert.equal(r.stats.missingProvenance, 1);
  assert.ok(r.flags.some((f) => f.assetId === 'a1' && f.type === 'missing_provenance'));
});

test('D2 — license_unknown 素材不冒充 authorized，显著标记', () => {
  const spec = SPEC({ assets: [ASSET('a1', { license: 'PROPRIETARY-UNKNOWN', licenseStatus: 'unknown' })] });
  const r = H.auditAssetProvenance(spec);
  assert.equal(r.stats.unknown, 1);
  assert.ok(r.rows.find((x) => x.id === 'a1').needsUserRuling === true);
});

// ---------- E) 分镜清单可看可改（出口③） ----------
test('E0 — buildStoryboardReview 逐镜头投影 narration/时长/字幕/来源，editable=true（出口③）', () => {
  const r = H.buildStoryboardReview(SPEC());
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.scenes.length, 2);
  assert.ok(r.scenes.every((s) => s.editable === true));
  assert.ok(r.scenes.every((s) => Array.isArray(s.captions) && Number.isFinite(s.durationSec)));
  assert.ok(r.scenes[1].visualAssetRefs.includes('a1'), '镜头来源投影在场');
  assert.equal(r.humanReview.status, 'pending_human_eye');
});

test('E1 — 可改性断言：对 review 投影执行 replaceSceneAsset 后重审阅结构仍一致', () => {
  const spec = SPEC();
  const r1 = H.buildStoryboardReview(spec);
  const replaced = H.replaceSceneAsset(spec, 'sc2', { kind: 'svg', assetRefs: ['a-new'] });
  const r2 = H.buildStoryboardReview(replaced.spec);
  assert.equal(r2.scenes[1].durationSec, r1.scenes[1].durationSec);
  assert.deepEqual(r2.scenes[1].captions, r1.scenes[1].captions);
  assert.notDeepEqual(r2.scenes[1].visualAssetRefs, r1.scenes[1].visualAssetRefs);
});

// ---------- F) 音频替换契约 ----------
test('F0 — 音频替换只换 music，不破坏旁白时长引用与字幕排程', () => {
  const spec = SPEC();
  const before = structuredClone(spec.audio.narrationRefs);
  const r = H.checkAudioReplacement(spec, { music: { assetRef: 'a3', gainDb: -20 } });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.spec.audio.narrationRefs, before);
  assert.equal(r.spec.audio.music.assetRef, 'a3');
  assert.equal(r.preserved.narrationRefs, true);
  assert.equal(r.preserved.captions, true);
});

test('F1 — 篡改负测：新音频试图改 narrationRefs → 忽略并标记', () => {
  const spec = SPEC();
  const before = structuredClone(spec.audio.narrationRefs);
  const r = H.checkAudioReplacement(spec, { narrationRefs: [], music: { assetRef: 'a3' } });
  assert.deepEqual(r.spec.audio.narrationRefs, before);
  assert.ok(r.flags.includes('ignored_narration_override'));
});

// ---------- G) 完整性与观感零代签 ----------
test('G0 — validateStoryboardIntegrity 汇总正常 + humanReview 留白', () => {
  const r = H.buildStoryboardReview(SPEC());
  const check = H.validateStoryboardIntegrity(r);
  assert.equal(check.ok, true, `完整性: ${check.issues.join('; ')}`);
  assert.equal(check.constraints.pendingHumanEye, true);
});

test('G1 — 篡改负测：顶层 humanReview 翻 verified → validate 红（观感零代签）', () => {
  const r = H.buildStoryboardReview(SPEC());
  r.humanReview = { status: 'verified', note: '代签' };
  assert.equal(H.validateStoryboardIntegrity(r).ok, false);
});

test('G2 — 篡改负测：镜头级观感翻 verified → validate 红', () => {
  const r = H.buildStoryboardReview(SPEC());
  r.scenes[0].humanReview = { status: 'verified' };
  assert.equal(H.validateStoryboardIntegrity(r).ok, false);
});

test('G3 — 篡改负测：授权状态被抬成 authorized 但 provenance 缺 → validate 红', () => {
  const spec = SPEC({ assets: [ASSET('a1', { license: '', urlOrPath: '' })] });
  const review = H.buildStoryboardReview(spec);
  review.assets[0].licenseStatus = 'authorized';
  review.assets[0].provenance = { license: '', urlOrPath: '' };
  assert.equal(H.validateStoryboardIntegrity(review).ok, false);
});

// ---------- H) 出口④：零新依赖 + 待裁决留白 ----------
test('H0 — 出口④：零新 npm 依赖 + 图像生成新服务/真实外部搜索登记为待裁决留白', () => {
  assert.equal(H.CONSTRAINTS.zeroNewDependency, true);
  assert.equal(H.CONSTRAINTS.imageGenerationAdapter, 'pending_user_ruling');
  assert.equal(H.CONSTRAINTS.externalAssetSearch, 'pending_user_ruling');
  assert.equal(H.CONSTRAINTS.externalAssetFetch, 'delegated_existing_web_fetch');
});

test('H1 — 出口逐条对账：四出口判据常量在场', () => {
  assert.deepEqual(H.EXIT_CRITERIA, [
    'scene_asset_replace_preserves_duration_captions_evidence',
    'every_external_asset_has_license_status_and_provenance',
    'storyboard_review_visible_and_editable_before_render',
    'zero_new_dependency_new_service_requires_user_ruling',
  ]);
});
