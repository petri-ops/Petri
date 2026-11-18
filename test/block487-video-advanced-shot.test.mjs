/**
 * BLOCK-487 / C-55 VIDEO-P3 — 高级镜头（本地 SceneSpec v1 3D 镜头）契约（HK-01 红绿先行）。
 *
 * 蓝本：acceptance/video-north-star-2026-11-18/VIDEO-NORTH-STAR-PLAN.md §5 P3，按用户 2026-11-18
 * 裁决口令收窄（零新依赖/不接云生成/全本地不外发/SceneSpec v1 additive 不建第二真值/观感零代签）。
 * 钉住收窄后的不变量（对应三出口 + 裁决约束）：
 *   A) 常量契约与 deferred 清单（云生成/角色/物理/粒子/高成本缓存只登记不实现）
 *   B) registerAdvancedShot：来源/参数/验证三要素齐全；云 producer/付费/外发字段 fail-closed
 *   C) mapSceneSpecV1：scene3d/v1 归一、rest value=0、别名登记、不内嵌第二套 IR
 *   D) replaceSceneWithAdvancedShot：出口①——替换普通镜头不破坏四字段与 timeline
 *   E) checkReplaceability：出口②——换 producer/换 renderer/加领域三判据保持
 *   F) buildGenerationEvidence：出口③——三要素齐全，digest/verdict 非伪造
 *   G) validateAdvancedShotIntegrity + buildAdvancedShotReview：完整性 fail-closed + 三出口 exitChecks
 * 篡改负测：观感翻 verified / 云生成被接受 / 付费或外发字段 / 第二套 IR / 结构被破坏 一律 fail-closed。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const H = require('../core/petri-server/helpers/video-advanced-shot.js');

// 规范本地 3D 高级镜头（来源=SceneSpec v1 specRef，参数=camera/joints 引用，验证=digest+verdict）
const SHOT = (over = {}) => ({
  id: 'shot-3d-sc2',
  kind: 'scene3d_v1',
  source: { specRef: 'scene3d/v1:sc-hinge', producer: 'local_scene3d', producerVersion: '1.6.3' },
  params: { camera: 'orbit-static', jointsRef: 'scene3d/v1:sc-hinge#joints' },
  verification: { tool: 'block459-probe', verdict: 'mapping_feasible', digest: 'sha256:2e803be3' },
  cost: { mode: 'zero', paid: false, external: false },
  ...over,
});

// 规范 SceneSpec v1（additive joints[]，沿 BLOCK-459/460 实测形态）
const SCENESPEC = (over = {}) => ({
  id: 'hinge',
  schemaVersion: 'scene3d/v1',
  source: { producer: 'local_scene3d', producerVersion: '1.6.3', glbSha256: '2e803be3' },
  nodes: [{ id: 'base', kind: 'part', parent: null }],
  joints: [
    { name: 'hinge_arm', kind: 'revolute', axis: [0, 1, 0], range: { min: 0, max: 1.5708, unit: 'rad' }, value: 0, follows: null, ratio: null },
  ],
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
  sources: [{ id: 's1', kind: 'web', urlOrPath: 'https://example.org', accessedAt: '2026-11-18' }],
  claims: [{ id: 'c1', text: '短波更易散射', sourceIds: ['s1'], confidence: 'high' }, { id: 'c2', text: '天空呈蓝色', sourceIds: ['s1'], confidence: 'high' }],
  scenes: [SCENE('sc1'), SCENE('sc2')],
  audio: { voice: 'zh-female', format: 'wav' },
  render: { width: 1280, height: 720, fps: 24, codec: 'libx264', container: 'mp4' },
  timeline: { ok: true, totalMs: 22000, scenes: [{ id: 'sc1', startMs: 0, endMs: 8000 }, { id: 'sc2', startMs: 8000, endMs: 18000 }] },
  qa: { status: 'machine_pass', humanReview: { status: 'pending_human_eye' } },
  ...over,
});

// ---------- A) 常量契约与 deferred 清单 ----------
test('A0 — 常量契约：SCHEMA_VERSION=1 / SHOT_KIND=scene3d_v1 / SCENESPEC_VERSION=scene3d/v1', () => {
  assert.equal(H.SCHEMA_VERSION, 1);
  assert.equal(H.SHOT_KIND, 'scene3d_v1');
  assert.equal(H.SCENESPEC_VERSION, 'scene3d/v1');
});

test('A1 — 三出口契约字符串在场', () => {
  assert.ok(H.EXIT_CRITERIA.includes('advanced_shot_replaces_normal_shot_without_touching_project_trunk'));
  assert.ok(H.EXIT_CRITERIA.includes('producer_renderer_domain_replaceability_criteria_hold'));
  assert.ok(H.EXIT_CRITERIA.includes('every_generated_shot_has_source_params_and_verification'));
});

test('A2 — deferred 清单：文生/图生视频/角色/物理/粒子/高成本缓存只登记不实现', () => {
  for (const d of ['text_to_video', 'image_to_video', 'character_animation', 'physics', 'particles', 'high_cost_cache_retry_version_compare']) {
    assert.ok(H.DEFERRED.includes(d), `${d} 应在 deferred 清单`);
    // eslint-disable-next-line security/detect-object-injection -- d 为上方固定字面量清单枚举（deferred 白名单键），无外部输入面
    assert.equal(H.DEFERRED_STATE[d], 'deferred_user_ruling');
  }
});

test('A3 — 裁决约束：零新依赖/不接云/零付费/不外发/第二真值禁用/资格线不动', () => {
  assert.equal(H.CONSTRAINTS.zeroNewDependency, true);
  assert.equal(H.CONSTRAINTS.cloudGeneration, 'deferred_user_ruling');
  assert.equal(H.CONSTRAINTS.zeroBudget, true);
  assert.equal(H.CONSTRAINTS.localOnly, true);
  assert.equal(H.CONSTRAINTS.noEgress, true);
  assert.equal(H.CONSTRAINTS.noSecondSceneTruth, true);
  assert.equal(H.CONSTRAINTS.qualificationLineUntouched, true);
});

// ---------- B) registerAdvancedShot ----------
test('B0 — 合法登记：来源/参数/验证/成本四块齐全且本地零成本', () => {
  const r = H.registerAdvancedShot(SHOT());
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.kind, 'scene3d_v1');
  assert.deepEqual(r.flags, []);
});

test('B1 — 篡改负测：缺 specRef / 缺参数 / 缺验证 digest 一律不 ok', () => {
  const a = H.registerAdvancedShot(SHOT({ source: { producer: 'local_scene3d' } }));
  assert.equal(a.ok, false);
  assert.ok(a.flags.includes('missing_spec_ref'));
  const b = H.registerAdvancedShot(SHOT({ params: {} }));
  assert.equal(b.ok, false);
  assert.ok(b.flags.includes('missing_params'));
  const c = H.registerAdvancedShot(SHOT({ verification: { tool: 'x', verdict: 'mapping_feasible' } }));
  assert.equal(c.ok, false);
  assert.ok(c.flags.includes('missing_verification_digest'));
});

test('B2 — 篡改负测：云 producer 出现即拒绝（不接云生成）', () => {
  const r = H.registerAdvancedShot(SHOT({ source: { specRef: 'cloud://x', producer: 'text_to_video' }, cost: { mode: 'paid', paid: true, external: true } }));
  assert.equal(r.ok, false);
  assert.ok(r.flags.includes('deferred_producer'));
});

test('B3 — 篡改负测：付费/外发字段出现即拒绝（零预算 + 不外发）', () => {
  const paid = H.registerAdvancedShot(SHOT({ cost: { mode: 'paid', paid: true } }));
  assert.equal(paid.ok, false);
  assert.ok(paid.flags.includes('paid_call_declared'));
  const ext = H.registerAdvancedShot(SHOT({ cost: { mode: 'cloud', external: true } }));
  assert.equal(ext.ok, false);
  assert.ok(ext.flags.includes('egress_declared'));
});

// ---------- C) mapSceneSpecV1 ----------
test('C0 — 归一：SceneSpec v1 → specRef 引用 + joints 映射（不内嵌第二套 IR）', () => {
  const r = H.mapSceneSpecV1(SCENESPEC());
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.schemaVersion, 'scene3d/v1');
  assert.equal(r.specRef, 'scene3d/v1:sc-hinge');
  assert.equal(r.joints.length, 1);
  assert.equal(r.joints[0].name, 'hinge_arm');
  assert.equal(r.embeddedIr, false);
});

test('C1 — 篡改负测：非 scene3d/v1 schema 拒绝', () => {
  const r = H.mapSceneSpecV1(SCENESPEC({ schemaVersion: 'scene3d/v2' }));
  assert.equal(r.ok, false);
  assert.ok(r.flags.includes('unsupported_schema_version'));
});

test('C2 — 篡改负测：posed 导出（joint value≠0）拒绝（rest 校验）', () => {
  const r = H.mapSceneSpecV1(SCENESPEC({ joints: [{ name: 'hinge_arm', kind: 'revolute', value: 0.785 }] }));
  assert.equal(r.ok, false);
  assert.ok(r.flags.includes('posed_export_rejected'));
});

test('C3 — 篡改负测：内嵌第二套 IR 拒绝（不建第二场景真值）', () => {
  const r = H.mapSceneSpecV1(SCENESPEC({ ir: { schemaVersion: '0.1', joints: [] } }));
  assert.equal(r.ok, false);
  assert.ok(r.flags.includes('second_ir_embedded'));
});

test('C4 — 别名登记：程序层 free → 导出层 floating 显著登记', () => {
  const r = H.mapSceneSpecV1(SCENESPEC({ joints: [{ name: 'wobble', kind: 'free', value: 0 }] }));
  assert.equal(r.ok, true);
  assert.equal(r.joints[0].kind, 'floating');
  assert.ok(r.flags.includes('alias_free_to_floating'));
});

// ---------- D) 出口① 替换不破坏主干 ----------
test('D0 — 出口①：sc2 替换为本地 3D 高级镜头，四字段与 timeline 逐项不变', () => {
  const spec = SPEC();
  const r = H.replaceSceneWithAdvancedShot(spec, 'sc2', SHOT());
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.unchanged.durationSec, true);
  assert.equal(r.unchanged.captions, true);
  assert.equal(r.unchanged.evidenceRefs, true);
  assert.equal(r.unchanged.narration, true);
  assert.equal(r.unchanged.timeline, true);
  assert.equal(r.spec.scenes[1].visual.kind, 'scene3d_v1');
});

test('D1 — 篡改负测：替换夹带结构覆盖一律忽略并标记', () => {
  const r = H.replaceSceneWithAdvancedShot(SPEC(), 'sc2', SHOT({ durationSec: 999, captions: [], evidenceRefs: [], narration: '覆盖' }));
  assert.equal(r.ok, true);
  assert.ok(r.flags.includes('ignored_structure_override'));
  assert.equal(r.spec.scenes[1].durationSec, 10);
});

test('D2 — 目标镜头不存在 fail-closed', () => {
  const r = H.replaceSceneWithAdvancedShot(SPEC(), 'sc9', SHOT());
  assert.equal(r.ok, false);
  assert.ok(r.flags.includes('scene_not_found'));
});

test('D3 — 篡改负测：云/付费镜头不得进入替换', () => {
  const r = H.replaceSceneWithAdvancedShot(SPEC(), 'sc2', SHOT({ source: { specRef: 'cloud://x', producer: 'text_to_video' } }));
  assert.equal(r.ok, false);
  assert.ok(r.flags.includes('deferred_producer'));
  assert.equal(r.spec.scenes[1].visual.kind, 'card');
});

// ---------- E) 出口② 三判据 ----------
test('E0 — 出口②：换 producer / 换 renderer / 加领域三判据全 true', () => {
  const replaced = H.replaceSceneWithAdvancedShot(SPEC(), 'sc2', SHOT()).spec;
  const r = H.checkReplaceability(replaced);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.criteria.changeProducer, true);
  assert.equal(r.criteria.changeRenderer, true);
  assert.equal(r.criteria.addDomain, true);
});

test('E1 — 篡改负测：写死 producer/无 renderer 注册/动内核即判据红', () => {
  const base = H.replaceSceneWithAdvancedShot(SPEC(), 'sc2', SHOT()).spec;
  const locked = JSON.parse(JSON.stringify(base));
  locked.scenes[1].visual.producerLock = 'text_to_video';
  locked.scenes[1].visual.rendererLock = null;
  locked.kernelChange = true;
  const r = H.checkReplaceability(locked);
  assert.equal(r.ok, false);
  assert.equal(r.criteria.changeProducer, false);
  assert.equal(r.criteria.addDomain, false);
});

// ---------- F) 出口③ 证据链 ----------
test('F0 — 出口③：source/params/verification 三要素齐全', () => {
  const r = H.buildGenerationEvidence(SHOT());
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.evidence.source, true);
  assert.equal(r.evidence.params, true);
  assert.equal(r.evidence.verification, true);
});

test('F1 — 篡改负测：verdict 非白名单 / digest 伪造（非 sha256: 前缀）即红', () => {
  const bad = H.buildGenerationEvidence(SHOT({ verification: { tool: 'x', verdict: 'verified_magic', digest: '2e803be3' } }));
  assert.equal(bad.ok, false);
  assert.ok(bad.flags.includes('invalid_verdict') || bad.flags.includes('invalid_digest'));
});

// ---------- G) 完整性与 review ----------
test('G0 — buildAdvancedShotReview：三出口 exitChecks 全 true + 观感 pending', () => {
  const r = H.buildAdvancedShotReview(SPEC(), 'sc2', SHOT(), SCENESPEC());
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.exitChecks.advanced_shot_replaces_normal_shot_without_touching_project_trunk, true);
  assert.equal(r.exitChecks.producer_renderer_domain_replaceability_criteria_hold, true);
  assert.equal(r.exitChecks.every_generated_shot_has_source_params_and_verification, true);
  assert.equal(r.humanReview.status, 'pending_human_eye');
  assert.equal(r.scenes[1].humanReview.status, 'pending_human_eye');
});

test('G1 — 篡改负测：顶层观感翻 verified 即完整性红', () => {
  const r = H.buildAdvancedShotReview(SPEC(), 'sc2', SHOT(), SCENESPEC());
  const bad = JSON.parse(JSON.stringify(r));
  bad.humanReview.status = 'verified';
  const v = H.validateAdvancedShotIntegrity(bad);
  assert.equal(v.ok, false);
  assert.ok(v.issues.includes('top_human_review_not_pending'));
});

test('G2 — 篡改负测：deferred 项被翻 active 即完整性红', () => {
  const r = H.buildAdvancedShotReview(SPEC(), 'sc2', SHOT(), SCENESPEC());
  const bad = JSON.parse(JSON.stringify(r));
  bad.deferredState.text_to_video = 'implemented';
  const v = H.validateAdvancedShotIntegrity(bad);
  assert.equal(v.ok, false);
  assert.ok(v.issues.includes('deferred_promoted'));
});

test('G3 — 篡改负测：review 夹带第二套 IR / 云字段即完整性红', () => {
  const r = H.buildAdvancedShotReview(SPEC(), 'sc2', SHOT(), SCENESPEC());
  const bad = JSON.parse(JSON.stringify(r));
  bad.ir = { schemaVersion: '0.1' };
  bad.cloudGeneration = 'active';
  const v = H.validateAdvancedShotIntegrity(bad);
  assert.equal(v.ok, false);
  assert.ok(v.issues.some((x) => /second_ir|cloud/i.test(x)));
});

test('G4 — 完整性绿：合法 review 的 constraints 快照正确', () => {
  const r = H.buildAdvancedShotReview(SPEC(), 'sc2', SHOT(), SCENESPEC());
  const v = H.validateAdvancedShotIntegrity(r);
  assert.equal(v.ok, true, JSON.stringify(v));
  assert.equal(v.constraints.pendingHumanEye, true);
  assert.equal(v.constraints.zeroNewDependency, true);
  assert.equal(v.constraints.cloudGenerationDeferred, true);
});
