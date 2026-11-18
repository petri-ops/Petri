/**
 * video-advanced-shot.js — BLOCK-487 / C-55 VIDEO-P3 高级镜头（本地 SceneSpec v1 3D 镜头替换）。
 *
 * 蓝本：acceptance/video-north-star-2026-11-18/VIDEO-NORTH-STAR-PLAN.md §5 P3，按用户 2026-11-18
 * 裁决口令收窄：①不引新依赖/不接云生成（文生/图生视频 deferred）②零预算零付费 ③全本地不外发
 * ④沿用 SceneSpec v1 additive 扩展、不建第二套真值 ⑤不碰资格线/G1+、观感 pending_human_eye 零代签。
 *
 * 纯函数、零新依赖，只读消费 VideoProjectSpec（P0 产物）与 SceneSpec v1（BLOCK-459/460 遗产）。
 * 闭环：本地 3D 高级镜头登记 → SceneSpec v1 specRef 引用 → 替换普通镜头不改主干
 *      → 换 producer/换 renderer/加领域三判据 → 生成证据链 → 完整性 fail-closed。
 * 不写盘、不新造 Job/Artifact/执行器；deferred 项只登记不实现；云/付费/外发字段一律 fail-closed。
 */
'use strict';

const SCHEMA_VERSION = 1;
const SHOT_KIND = 'scene3d_v1';
const SCENESPEC_VERSION = 'scene3d/v1';

// 裁决②/③：零预算、不外发；裁决①：不接云生成，云 producer 属 deferred。
const DEFERRED = Object.freeze([
  'text_to_video',
  'image_to_video',
  'character_animation',
  'physics',
  'particles',
  'high_cost_cache_retry_version_compare',
]);
const DEFERRED_STATE = Object.freeze(Object.fromEntries(DEFERRED.map((d) => [d, 'deferred_user_ruling'])));
const DEFERRED_PRODUCERS = Object.freeze(['text_to_video', 'image_to_video', 'cloud', 'cloud_generation', 'remote']);
const ALLOWED_VERDICTS = Object.freeze(['mapping_feasible', 'render_ok', 'verified_local']);

const CONSTRAINTS = Object.freeze({
  zeroNewDependency: true,
  cloudGeneration: 'deferred_user_ruling',
  zeroBudget: true,
  localOnly: true,
  noEgress: true,
  noSecondSceneTruth: true,
  qualificationLineUntouched: true,
  humanReview: 'pending_human_eye',
});

const EXIT_CRITERIA = Object.freeze([
  'advanced_shot_replaces_normal_shot_without_touching_project_trunk',
  'producer_renderer_domain_replaceability_criteria_hold',
  'every_generated_shot_has_source_params_and_verification',
]);

const HUMAN_REVIEW_PENDING = Object.freeze({ status: 'pending_human_eye' });
const STRUCTURE_FIELDS = Object.freeze(['durationSec', 'captions', 'evidenceRefs', 'narration']);

function ownGet(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj || {}, key) ? obj[key] : undefined;
}
function str(v) {
  return typeof v === 'string' ? v.trim() : '';
}
function isObj(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}
function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * 本地 3D 高级镜头登记：来源 specRef / 参数 / 验证 digest 三要素齐全；
 * 云 producer / 付费 / 外发字段出现即 fail-closed（拒绝，不进入替换）。
 */
function registerAdvancedShot(shot) {
  const flags = [];
  const s = isObj(shot) ? shot : {};
  const source = isObj(ownGet(s, 'source')) ? s.source : {};
  const params = isObj(ownGet(s, 'params')) ? s.params : {};
  const verification = isObj(ownGet(s, 'verification')) ? s.verification : {};
  const cost = isObj(ownGet(s, 'cost')) ? s.cost : {};

  const specRef = str(ownGet(source, 'specRef'));
  const producer = str(ownGet(source, 'producer'));
  if (!specRef) flags.push('missing_spec_ref');
  if (!Object.keys(params).length) flags.push('missing_params');
  if (!str(ownGet(verification, 'digest'))) flags.push('missing_verification_digest');
  if (!str(ownGet(verification, 'verdict'))) flags.push('missing_verification_verdict');
  if (!str(ownGet(verification, 'tool'))) flags.push('missing_verification_tool');

  if (DEFERRED_PRODUCERS.includes(producer) || /^(cloud|https?:|\/\/)/i.test(specRef)) {
    flags.push('deferred_producer');
  }
  if (ownGet(cost, 'paid') === true || str(ownGet(cost, 'mode')) === 'paid') flags.push('paid_call_declared');
  if (ownGet(cost, 'external') === true || str(ownGet(cost, 'mode')) === 'cloud') flags.push('egress_declared');

  return {
    ok: flags.length === 0,
    id: str(ownGet(s, 'id')) || 'unknown',
    kind: SHOT_KIND,
    source: { specRef, producer, producerVersion: str(ownGet(source, 'producerVersion')) },
    params: { ...params },
    verification: { ...verification },
    cost: { mode: str(ownGet(cost, 'mode')) || 'zero', paid: ownGet(cost, 'paid') === true, external: ownGet(cost, 'external') === true },
    flags,
  };
}

/**
 * SceneSpec v1 → 高级镜头 specRef 引用 + joints 映射（BLOCK-459/460 additive joints[] 遗产）。
 * rest 校验（joint value===0）、别名登记（free→floating）、不内嵌第二套 IR。
 */
function mapSceneSpecV1(sceneSpec) {
  const flags = [];
  const ss = isObj(sceneSpec) ? sceneSpec : {};
  const version = str(ownGet(ss, 'schemaVersion'));
  if (version !== SCENESPEC_VERSION) flags.push('unsupported_schema_version');
  if (ownGet(ss, 'ir') !== undefined || ownGet(ss, 'sceneIr') !== undefined) flags.push('second_ir_embedded');

  const source = isObj(ownGet(ss, 'source')) ? ss.source : {};
  const specId = str(ownGet(ss, 'id')) || str(ownGet(source, 'glbSha256')) || 'local';
  const specRef = `${SCENESPEC_VERSION}:sc-${specId}`;
  const rawJoints = Array.isArray(ownGet(ss, 'joints')) ? ss.joints : [];
  const joints = [];
  for (const j of rawJoints) {
    const jj = isObj(j) ? j : {};
    let kind = str(ownGet(jj, 'kind'));
    if (kind === 'free') {
      kind = 'floating';
      if (!flags.includes('alias_free_to_floating')) flags.push('alias_free_to_floating');
    }
    if (Number(ownGet(jj, 'value')) !== 0) flags.push('posed_export_rejected');
    joints.push({
      name: str(ownGet(jj, 'name')),
      kind,
      axis: ownGet(jj, 'axis'),
      range: ownGet(jj, 'range'),
      value: ownGet(jj, 'value'),
      follows: ownGet(jj, 'follows'),
      ratio: ownGet(jj, 'ratio'),
    });
  }
  // 别名登记（free→floating）是信息性标注，不阻断；其余 flag 均 fail-closed。
  const ok = !flags.some((f) => f !== 'alias_free_to_floating');
  return {
    ok,
    schemaVersion: SCENESPEC_VERSION,
    specRef,
    source: { producer: str(ownGet(source, 'producer')), producerVersion: str(ownGet(source, 'producerVersion')), glbSha256: str(ownGet(source, 'glbSha256')) },
    joints,
    embeddedIr: ownGet(ss, 'ir') !== undefined || ownGet(ss, 'sceneIr') !== undefined,
    flags,
  };
}

/**
 * 出口①：替换普通镜头 visual 为本地 3D 高级镜头；四字段（durationSec/captions/evidenceRefs/narration）
 * 与顶层 timeline 逐字段不变。新镜头夹带结构字段一律忽略并标记。
 */
function replaceSceneWithAdvancedShot(spec, sceneId, advancedShot) {
  const flags = [];
  const src = isObj(spec) ? spec : {};
  const scenes = Array.isArray(ownGet(src, 'scenes')) ? src.scenes : [];
  const idx = scenes.findIndex((s) => str(ownGet(s, 'id')) === sceneId);
  if (idx < 0) return { ok: false, spec: src, flags: ['scene_not_found'], unchanged: {} };

  const reg = registerAdvancedShot(advancedShot);
  if (!reg.ok) return { ok: false, spec: src, flags: reg.flags.slice(), unchanged: {} };
  for (const f of reg.flags) flags.push(`shot_${f}`);
  const raw = isObj(advancedShot) ? advancedShot : {};
  for (const field of STRUCTURE_FIELDS) {
    if (ownGet(raw, field) !== undefined) flags.push('ignored_structure_override');
  }

  const before = scenes[idx];
  const nextScenes = scenes.slice();
  nextScenes[idx] = {
    ...before,
    visual: {
      kind: SHOT_KIND,
      specRef: reg.source.specRef,
      source: reg.source,
      params: reg.params,
      verification: reg.verification,
    },
  };
  const after = nextScenes[idx];
  return {
    ok: true,
    spec: { ...src, scenes: nextScenes },
    flags,
    unchanged: {
      durationSec: after.durationSec === before.durationSec,
      captions: deepEqual(after.captions, before.captions),
      evidenceRefs: deepEqual(after.evidenceRefs, before.evidenceRefs),
      narration: after.narration === before.narration,
      timeline: deepEqual(ownGet(src, 'timeline'), ownGet(src, 'timeline')),
    },
  };
}

/**
 * 出口②：换 producer / 换 renderer / 加领域三判据在 3D 域内保持。
 * producerLock=deferred / rendererLock 非空 / kernelChange=true 任一出现即对应判据红。
 */
function checkReplaceability(spec) {
  const flags = [];
  const src = isObj(spec) ? spec : {};
  const scenes = Array.isArray(ownGet(src, 'scenes')) ? src.scenes : [];
  const advanced = scenes.filter((s) => str(ownGet(isObj(ownGet(s, 'visual')) ? s.visual : {}, 'kind')) === SHOT_KIND);
  const kernelChange = ownGet(src, 'kernelChange') === true || ownGet(src, 'ir') !== undefined;
  let changeProducer = !kernelChange;
  let changeRenderer = !kernelChange;
  for (const s of advanced) {
    const v = ownGet(s, 'visual');
    const producerLock = str(ownGet(v, 'producerLock'));
    if (producerLock && DEFERRED_PRODUCERS.includes(producerLock)) {
      changeProducer = false;
      flags.push('producer_locked_to_deferred');
    }
    if (ownGet(v, 'rendererLock') !== undefined && ownGet(v, 'rendererLock') !== null) {
      changeRenderer = false;
      flags.push('renderer_locked');
    }
  }
  const addDomain = !kernelChange;
  if (kernelChange) flags.push('kernel_change_forbidden');
  return {
    ok: changeProducer && changeRenderer && addDomain,
    criteria: { changeProducer, changeRenderer, addDomain },
    advancedShotCount: advanced.length,
    flags,
  };
}

/**
 * 出口③：生成证据链——source/params/verification 三要素齐全；digest 带 sha256: 前缀、verdict 白名单。
 */
function buildGenerationEvidence(shot) {
  const flags = [];
  const s = isObj(shot) ? shot : {};
  const source = isObj(ownGet(s, 'source')) ? s.source : {};
  const params = isObj(ownGet(s, 'params')) ? s.params : {};
  const verification = isObj(ownGet(s, 'verification')) ? s.verification : {};
  const digest = str(ownGet(verification, 'digest'));
  const verdict = str(ownGet(verification, 'verdict'));

  const evidence = {
    source: !!str(ownGet(source, 'specRef')),
    params: Object.keys(params).length > 0,
    verification: !!digest && !!verdict,
  };
  if (!evidence.source) flags.push('missing_source');
  if (!evidence.params) flags.push('missing_params');
  if (!evidence.verification) flags.push('missing_verification');
  if (digest && !/^sha256:/i.test(digest)) flags.push('invalid_digest');
  if (verdict && !ALLOWED_VERDICTS.includes(verdict)) flags.push('invalid_verdict');

  return { ok: flags.length === 0, evidence, flags };
}

/**
 * 完整性 fail-closed：观感翻态 / deferred 被翻 implemented / 第二套 IR / 云生成激活 / 矛盾 detail 即红。
 */
function validateAdvancedShotIntegrity(review) {
  const issues = [];
  const r = isObj(review) ? review : {};
  const topReview = ownGet(r, 'humanReview');
  if (!isObj(topReview) || str(ownGet(topReview, 'status')) !== 'pending_human_eye') issues.push('top_human_review_not_pending');

  const scenes = Array.isArray(ownGet(r, 'scenes')) ? r.scenes : [];
  scenes.forEach((s, i) => {
    if (str(ownGet(s, 'visual'), 'kind') === SHOT_KIND) {
      const sr = ownGet(s, 'humanReview');
      if (!isObj(sr) || str(ownGet(sr, 'status')) !== 'pending_human_eye') issues.push(`scene_${i}_human_review_not_pending`);
    }
  });

  const deferredState = isObj(ownGet(r, 'deferredState')) ? r.deferredState : {};
  for (const d of DEFERRED) {
    if (ownGet(deferredState, d) !== undefined && ownGet(deferredState, d) !== 'deferred_user_ruling') {
      issues.push('deferred_promoted');
      break;
    }
  }
  if (ownGet(r, 'ir') !== undefined || ownGet(r, 'sceneIr') !== undefined) issues.push('second_ir_embedded');
  if (ownGet(r, 'cloudGeneration') !== undefined && str(ownGet(r, 'cloudGeneration')) !== 'deferred_user_ruling') issues.push('cloud_generation_active');

  const exitChecks = isObj(ownGet(r, 'exitChecks')) ? r.exitChecks : {};
  Object.entries(exitChecks).forEach(([k, v]) => {
    if (v !== true) issues.push(`exit_check_false:${k}`);
  });

  const constraints = isObj(ownGet(r, 'constraints')) ? r.constraints : {};
  return {
    ok: issues.length === 0,
    issues,
    constraints: {
      pendingHumanEye: str(ownGet(topReview, 'status')) === 'pending_human_eye',
      zeroNewDependency: ownGet(constraints, 'zeroNewDependency') === true,
      cloudGenerationDeferred: str(ownGet(constraints, 'cloudGeneration')) === 'deferred_user_ruling',
    },
  };
}

/**
 * 汇总 review：对 P0 真实工程做一次本地 3D 高级镜头替换，逐条计算三出口 exitChecks + deferred 快照。
 */
function buildAdvancedShotReview(spec, sceneId, advancedShot, sceneSpec) {
  const rep = replaceSceneWithAdvancedShot(spec, sceneId, advancedShot);
  const unchanged = rep.unchanged || {};
  const structuralIntact = ['durationSec', 'captions', 'evidenceRefs', 'narration', 'timeline'].every((k) => unchanged[k] === true);
  const replaceability = rep.ok ? checkReplaceability(rep.spec) : { ok: false, criteria: {} };
  const evidence = buildGenerationEvidence(advancedShot);
  const mapped = mapSceneSpecV1(sceneSpec);

  const exitChecks = {
    advanced_shot_replaces_normal_shot_without_touching_project_trunk: rep.ok && structuralIntact,
    producer_renderer_domain_replaceability_criteria_hold: rep.ok && replaceability.ok,
    every_generated_shot_has_source_params_and_verification: rep.ok && evidence.ok && mapped.ok,
  };

  const src = rep.ok ? rep.spec : (isObj(spec) ? spec : {});
  const scenes = Array.isArray(ownGet(src, 'scenes')) ? src.scenes : [];
  const reviewScenes = scenes.map((s, i) => ({
    id: str(ownGet(s, 'id')) || `scene-${i}`,
    visual: { ...(isObj(ownGet(s, 'visual')) ? s.visual : {}) },
    humanReview: { status: 'pending_human_eye' },
  }));

  const review = {
    ok: Object.values(exitChecks).every(Boolean),
    schemaVersion: SCHEMA_VERSION,
    shotKind: SHOT_KIND,
    sceneId: str(sceneId),
    scenes: reviewScenes,
    exitChecks,
    evidence: { ...evidence.evidence },
    sceneSpecMapping: { ok: mapped.ok, specRef: mapped.specRef, jointCount: mapped.joints.length, flags: mapped.flags },
    constraints: { ...CONSTRAINTS },
    deferredState: { ...DEFERRED_STATE },
    deferred: DEFERRED.slice(),
    humanReview: { status: 'pending_human_eye' },
  };
  review.integrity = validateAdvancedShotIntegrity(review);
  return review;
}

module.exports = {
  SCHEMA_VERSION,
  SHOT_KIND,
  SCENESPEC_VERSION,
  DEFERRED,
  DEFERRED_STATE,
  ALLOWED_VERDICTS,
  CONSTRAINTS,
  EXIT_CRITERIA,
  HUMAN_REVIEW_PENDING,
  registerAdvancedShot,
  mapSceneSpecV1,
  replaceSceneWithAdvancedShot,
  checkReplaceability,
  buildGenerationEvidence,
  validateAdvancedShotIntegrity,
  buildAdvancedShotReview,
};
