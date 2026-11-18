/**
 * video-storyboard.js — BLOCK-486 / C-55 VIDEO-P2 素材供给与分镜审阅（纯函数，零新依赖）。
 *
 * 蓝本：acceptance/video-north-star-2026-11-18/VIDEO-NORTH-STAR-PLAN.md §5 P2。
 * 只读消费 VideoProjectSpec（BLOCK-482 / P0 产物），不写盘、不新造 Job/Artifact/执行器。
 * 闭环：素材登记 → 统一镜头来源 → 镜头素材替换（不破坏时长/字幕/证据结构）
 *       → 外部素材授权与来源审计 → 可看可改分镜清单 → 音频替换契约 → 完整性 fail-closed。
 *
 * 红线：默认零新依赖（出口④）；图像生成新服务/真实外部搜索属产品级新依赖+外发，
 *       归 pending_user_ruling 留白，本模块不擅自接入；观感 pending_human_eye 零代签。
 */
'use strict';

const SCHEMA_VERSION = 1;

const ASSET_KINDS = ['image', 'video', 'music', 'chart', 'svg', 'genui', '3d_still'];
const LICENSE_STATUS = ['authorized', 'unknown', 'unauthorized'];
const VISUAL_SOURCE_KINDS = ['card', 'image', 'video', 'chart', 'svg', 'genui', '3d_still'];

// 出口④：产品级新依赖/外发边界（本模块只声明，不接入）。
const CONSTRAINTS = Object.freeze({
  zeroNewDependency: true,
  imageGenerationAdapter: 'pending_user_ruling',
  externalAssetSearch: 'pending_user_ruling',
  externalAssetFetch: 'delegated_existing_web_fetch',
});

const EXIT_CRITERIA = Object.freeze([
  'scene_asset_replace_preserves_duration_captions_evidence',
  'every_external_asset_has_license_status_and_provenance',
  'storyboard_review_visible_and_editable_before_render',
  'zero_new_dependency_new_service_requires_user_ruling',
]);

const HUMAN_REVIEW_PENDING = Object.freeze({ status: 'pending_human_eye' });

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
 * 单个外部素材登记：许可/署名/来源/访问日期缺一显著标记，不静默视为已授权。
 * @param {object} asset {id, kind, license, attribution, urlOrPath, accessedAt, licenseStatus}
 */
function registerAsset(asset) {
  const flags = [];
  const a = isObj(asset) ? asset : {};
  const id = str(ownGet(a, 'id')) || 'unknown';
  const license = str(ownGet(a, 'license'));
  const attribution = str(ownGet(a, 'attribution'));
  const urlOrPath = str(ownGet(a, 'urlOrPath'));
  const accessedAt = str(ownGet(a, 'accessedAt'));

  if (!attribution) flags.push('missing_attribution');
  if (!urlOrPath) flags.push('missing_source');
  if (!accessedAt) flags.push('missing_accessed_at');
  if (!license) flags.push('missing_license');

  let licenseStatus = str(ownGet(a, 'licenseStatus'));
  if (!LICENSE_STATUS.includes(licenseStatus)) {
    if (licenseStatus) flags.push('invalid_license_status');
    licenseStatus = 'unknown';
  }

  // provenance 不齐时不允许维持 authorized（不静默信任）。
  const provenanceComplete = !!(license && attribution && urlOrPath && accessedAt);
  if (!provenanceComplete && licenseStatus === 'authorized') {
    licenseStatus = 'unknown';
    if (!flags.includes('provenance_incomplete_for_authorized')) {
      flags.push('provenance_incomplete_for_authorized');
    }
  }

  return {
    ok: flags.length === 0 && licenseStatus !== 'unauthorized',
    id,
    kind: str(ownGet(a, 'kind')),
    licenseStatus,
    provenance: { license, attribution, urlOrPath, accessedAt },
    flags,
  };
}

/**
 * 统一镜头来源：chart/svg/genui/3d_still/card/image/video 归一为镜头来源；未知 kind 兜底 card 并标记。
 */
function normalizeVisualSources(spec) {
  const flags = [];
  const scenes = Array.isArray(ownGet(spec || {}, 'scenes')) ? spec.scenes : [];
  const rows = scenes.map((scene, idx) => {
    const sceneId = str(ownGet(scene, 'id')) || `scene-${idx}`;
    const visual = isObj(ownGet(scene, 'visual')) ? scene.visual : {};
    const rawKind = str(ownGet(visual, 'kind'));
    const assetRefs = Array.isArray(ownGet(visual, 'assetRefs')) ? visual.assetRefs.slice() : [];
    const specRef = ownGet(visual, 'specRef');
    let normalizedKind = rawKind;
    if (!VISUAL_SOURCE_KINDS.includes(rawKind)) {
      normalizedKind = 'card';
      flags.push({ type: 'unknown_visual_kind', sceneId, rawKind });
    }
    return {
      sceneId,
      rawKind,
      normalizedKind,
      assetRefs,
      specRef,
      hasProvenance: assetRefs.length > 0 || !!specRef || normalizedKind === 'card',
    };
  });
  return { ok: true, rows, flags, count: rows.length };
}

/**
 * 镜头素材替换：只替换 visual，durationSec/captions/evidenceRefs/narration 逐字段保留（出口①）。
 * 新素材允许携带 durationSec/captions 等结构字段——一律忽略并标记 ignored_structure_override。
 */
function replaceSceneAsset(spec, sceneId, newVisual) {
  const flags = [];
  const src = isObj(spec) ? spec : {};
  const scenes = Array.isArray(ownGet(src, 'scenes')) ? src.scenes : [];
  const idx = scenes.findIndex((s) => str(ownGet(s, 'id')) === sceneId);
  if (idx < 0) {
    return { ok: false, spec: src, flags: ['scene_not_found'], unchanged: {} };
  }
  const before = scenes[idx];
  const nv = isObj(newVisual) ? newVisual : {};
  if (ownGet(nv, 'durationSec') !== undefined || ownGet(nv, 'captions') !== undefined
      || ownGet(nv, 'evidenceRefs') !== undefined || ownGet(nv, 'narration') !== undefined) {
    flags.push('ignored_structure_override');
  }
  const cleanVisual = {};
  for (const key of Object.keys(nv)) {
    if (!['durationSec', 'captions', 'evidenceRefs', 'narration'].includes(key)) {
      cleanVisual[key] = nv[key];
    }
  }
  const nextScenes = scenes.slice();
  nextScenes[idx] = { ...before, visual: cleanVisual };
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
    },
  };
}

/**
 * 外部素材授权与来源审计（出口②）：缺 provenance 即红；license_unknown 显著标记需用户裁决。
 */
function auditAssetProvenance(spec) {
  const flags = [];
  const assets = Array.isArray(ownGet(spec || {}, 'assets')) ? spec.assets : [];
  const rows = [];
  const stats = { total: assets.length, authorized: 0, unknown: 0, unauthorized: 0, missingProvenance: 0 };
  for (const asset of assets) {
    const reg = registerAsset(asset);
    const id = reg.id;
    const provenanceComplete = !!(reg.provenance.license && reg.provenance.attribution
      && reg.provenance.urlOrPath && reg.provenance.accessedAt);
    if (!provenanceComplete) {
      stats.missingProvenance += 1;
      flags.push({ type: 'missing_provenance', assetId: id });
    }
    if (reg.licenseStatus === 'authorized') stats.authorized += 1;
    else if (reg.licenseStatus === 'unauthorized') stats.unauthorized += 1;
    else stats.unknown += 1;
    rows.push({
      id,
      kind: reg.kind,
      licenseStatus: reg.licenseStatus,
      provenance: reg.provenance,
      needsUserRuling: reg.licenseStatus === 'unknown' || !provenanceComplete,
      flags: reg.flags,
    });
  }
  const ok = stats.missingProvenance === 0 && stats.unauthorized === 0;
  return { ok, rows, flags, stats };
}

/**
 * 分镜清单（出口③）：逐镜头投影 narration/时长/字幕/来源，editable=true；观感留白。
 */
function buildStoryboardReview(spec) {
  const src = isObj(spec) ? spec : {};
  const assets = Array.isArray(ownGet(src, 'assets')) ? src.assets : [];
  const assetById = new Map(assets.map((a) => [str(ownGet(a, 'id')), a]));
  const scenes = Array.isArray(ownGet(src, 'scenes')) ? src.scenes : [];
  const provenance = auditAssetProvenance(src);
  const reviewScenes = scenes.map((scene, idx) => {
    const visual = isObj(ownGet(scene, 'visual')) ? scene.visual : {};
    const assetRefs = Array.isArray(ownGet(visual, 'assetRefs')) ? visual.assetRefs.slice() : [];
    return {
      id: str(ownGet(scene, 'id')) || `scene-${idx}`,
      index: idx,
      narration: str(ownGet(scene, 'narration')),
      durationSec: ownGet(scene, 'durationSec'),
      captions: Array.isArray(ownGet(scene, 'captions')) ? scene.captions.slice() : [],
      visual: { ...visual },
      visualAssetRefs: assetRefs,
      evidenceRefs: Array.isArray(ownGet(scene, 'evidenceRefs')) ? scene.evidenceRefs.slice() : [],
      editable: true,
      humanReview: { status: 'pending_human_eye' },
    };
  });
  const assetRows = provenance.rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    licenseStatus: row.licenseStatus,
    provenance: row.provenance,
    needsUserRuling: row.needsUserRuling,
  }));
  // 源 spec 的 assetRefs 可见性（供 E1 可改性断言）。
  void assetById;
  return {
    ok: provenance.ok,
    schemaVersion: SCHEMA_VERSION,
    goal: ownGet(src, 'goal') || {},
    scenes: reviewScenes,
    assets: assetRows,
    constraints: { ...CONSTRAINTS },
    humanReview: { status: 'pending_human_eye' },
  };
}

/**
 * 音频替换契约：只换 music / voice，narrationRefs 与 captions 不改（旁白时长/字幕排程不破坏）。
 */
function checkAudioReplacement(spec, newAudio) {
  const flags = [];
  const src = isObj(spec) ? spec : {};
  const na = isObj(newAudio) ? newAudio : {};
  const beforeAudio = isObj(ownGet(src, 'audio')) ? src.audio : {};
  const narrationRefs = Array.isArray(ownGet(beforeAudio, 'narrationRefs'))
    ? beforeAudio.narrationRefs.slice() : [];
  if (ownGet(na, 'narrationRefs') !== undefined) flags.push('ignored_narration_override');
  const nextAudio = { ...beforeAudio };
  if (ownGet(na, 'music') !== undefined) nextAudio.music = na.music;
  if (ownGet(na, 'voice') !== undefined) nextAudio.voice = na.voice;
  if (ownGet(na, 'format') !== undefined) nextAudio.format = na.format;
  nextAudio.narrationRefs = narrationRefs;
  const nextSpec = { ...src, audio: nextAudio };
  const captionsOf = (sp) => (Array.isArray(ownGet(sp, 'scenes')) ? sp.scenes : [])
    .map((s) => (Array.isArray(ownGet(s, 'captions')) ? s.captions : []));
  return {
    ok: flags.length === 0,
    spec: nextSpec,
    flags,
    preserved: {
      narrationRefs: deepEqual(nextAudio.narrationRefs, narrationRefs),
      captions: deepEqual(captionsOf(nextSpec), captionsOf(src)),
    },
  };
}

/**
 * 完整性 fail-closed：顶层与镜头级观感翻 verified 即红；授权状态与 provenance 矛盾即红；
 * 检查项 passed 但 detail 标 FAIL 即红。
 */
function validateStoryboardIntegrity(review) {
  const issues = [];
  const r = isObj(review) ? review : {};
  const topReview = ownGet(r, 'humanReview');
  if (!isObj(topReview) || str(ownGet(topReview, 'status')) !== 'pending_human_eye') {
    issues.push('top_human_review_not_pending');
  }
  const scenes = Array.isArray(ownGet(r, 'scenes')) ? r.scenes : [];
  scenes.forEach((s, i) => {
    const sr = ownGet(s, 'humanReview');
    if (!isObj(sr) || str(ownGet(sr, 'status')) !== 'pending_human_eye') {
      issues.push(`scene_${i}_human_review_not_pending`);
    }
  });
  const assets = Array.isArray(ownGet(r, 'assets')) ? r.assets : [];
  assets.forEach((a, i) => {
    const status = str(ownGet(a, 'licenseStatus'));
    const prov = isObj(ownGet(a, 'provenance')) ? ownGet(a, 'provenance') : {};
    const complete = !!(str(ownGet(prov, 'license')) && str(ownGet(prov, 'attribution'))
      && str(ownGet(prov, 'urlOrPath')) && str(ownGet(prov, 'accessedAt')));
    if (status === 'authorized' && !complete) {
      issues.push(`asset_${i}_authorized_without_provenance`);
    }
  });
  const checks = Array.isArray(ownGet(r, 'checks')) ? r.checks : [];
  checks.forEach((c, i) => {
    if (ownGet(c, 'passed') === true && /FAIL|红|error/i.test(str(ownGet(c, 'detail')))) {
      issues.push(`check_${i}_contradictory_detail`);
    }
  });
  return {
    ok: issues.length === 0,
    issues,
    constraints: {
      pendingHumanEye: str(ownGet(topReview, 'status')) === 'pending_human_eye',
      zeroNewDependency: CONSTRAINTS.zeroNewDependency === true,
    },
  };
}

module.exports = {
  SCHEMA_VERSION,
  ASSET_KINDS,
  LICENSE_STATUS,
  VISUAL_SOURCE_KINDS,
  CONSTRAINTS,
  EXIT_CRITERIA,
  HUMAN_REVIEW_PENDING,
  registerAsset,
  normalizeVisualSources,
  replaceSceneAsset,
  auditAssetProvenance,
  buildStoryboardReview,
  checkAudioReplacement,
  validateStoryboardIntegrity,
};
