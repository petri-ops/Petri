'use strict';

/**
 * shared-backend/pack-write-bridge-contract.js — RW-02（C-44 扩展）pack 写桥通用契约。
 *
 * 把 BLOCK-264 冻结的批注窄桥扩为四类写操作（selection-save / revision-restore /
 * revision-replay / export-run + annotation 两 kind 兼容别名）。定位不变：
 * 本文件只冻结词汇与校验（fail-closed）——宿主侧桥（PackSurfaceFrame 分发 + host 代理
 * 核心既有 REST）按此契约实现；**写权限由 pack.json provides.resultSurfaces[].writes
 * 显式声明、宿主校验，pack 侧永远不能自宣**（C-44 红线）。
 *
 * 消息形状（上行 pack → host）：
 *   { type: 'petri:pack-write', requestId, kind, payload }
 *   v1 专用消息（petri:annotation-write / petri:annotation-delete）继续有效（别名）。
 * 下行 host → pack：
 *   { type: 'petri:pack-write-result', requestId, kind, ok, payload?|error? }
 *
 * 防重放：宿主对 requestId 做 TTL 去重（createWriteRequestDedupe，act-ack 同型纪律）。
 * 项目归属：projectId/conversationId 由宿主注入快照，pack 消息里的归属字段一律忽略。
 */

const v1 = require('./pack-annotation-bridge-contract');

const BRIDGE_VERSION = 1;

/** 写操作词汇：宿主代理到核心既有 REST（不建第二写真相）。 */
const WRITE_KINDS = Object.freeze([
  'annotation-write',
  'annotation-delete',
  'selection-save',
  'revision-restore',
  'revision-replay',
  'export-run',
]);

const REPLAY_PHASES = Object.freeze(['preflight', 'confirm']);
const EXPORT_FORMATS = Object.freeze(['method', 'report', 'script']);
const MAX_REQUEST_ID_CHARS = v1.MAX_REQUEST_ID_CHARS;

const MESSAGE_KIND_BY_TYPE = Object.freeze({
  'petri:annotation-write': 'annotation-write',
  'petri:annotation-delete': 'annotation-delete',
});

function hasNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function validateSelectionPayload(payload) {
  const selection = payload && typeof payload === 'object' ? payload.selection : null;
  if (!selection || typeof selection !== 'object' || Array.isArray(selection)) return false;
  if (selection.contractVersion !== 1) return false;
  if (!hasNonEmptyString(selection.entityType)) return false;
  if (!Array.isArray(selection.entityIds)) return false;
  return true;
}

/**
 * 校验 pack 上行写消息（fail-closed）。v1 专用消息按 kind 别名归一。
 * @returns {{ ok: true, message: { requestId, kind, payload } } | { ok: false, code, message }}
 */
function validatePackWriteMessage(raw) {
  if (!raw || typeof raw !== 'object') return { ok: false, code: 'shape_invalid', message: '消息必须是对象' };
  const { type, requestId } = raw;
  if (typeof requestId !== 'string' || !requestId || requestId.length > MAX_REQUEST_ID_CHARS) {
    return { ok: false, code: 'request_id_invalid', message: `requestId 必须是 1..${MAX_REQUEST_ID_CHARS} 字符` };
  }

  let kind;
  let payload;
  if (type === 'petri:pack-write') {
    kind = raw.kind;
    payload = raw.payload;
    if (!WRITE_KINDS.includes(kind)) {
      return { ok: false, code: 'kind_invalid', message: `kind 必须是 ${WRITE_KINDS.join(' | ')}` };
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return { ok: false, code: 'payload_invalid', message: 'payload 必须是对象' };
    }
  } else if (MESSAGE_KIND_BY_TYPE[type]) {
    // v1 专用消息别名：复用 v1 校验后归一
    const legacy = v1.validateBridgeMessage(raw);
    if (!legacy.ok) return legacy;
    kind = MESSAGE_KIND_BY_TYPE[type];
    const m = legacy.message;
    payload = kind === 'annotation-delete'
      ? { annotationId: m.annotationId }
      : { comment: m.comment, kind: m.kind, color: m.color, page: m.page, rect: m.rect, path: m.path, anchor: m.anchor };
  } else {
    return { ok: false, code: 'type_invalid', message: `type 必须是 petri:pack-write | ${Object.keys(MESSAGE_KIND_BY_TYPE).join(' | ')}` };
  }

  switch (kind) {
    case 'annotation-write':
      if (!hasNonEmptyString(payload.comment)) return { ok: false, code: 'comment_invalid', message: 'comment 必须非空' };
      if (payload.rect === undefined && payload.path === undefined && payload.anchor === undefined) {
        return { ok: false, code: 'geometry_required', message: 'annotation-write 必须带 rect / path / anchor 之一' };
      }
      break;
    case 'annotation-delete':
      if (!hasNonEmptyString(payload.annotationId)) return { ok: false, code: 'annotation_id_required', message: '删除必须带 annotationId' };
      break;
    case 'selection-save':
      if (!validateSelectionPayload(payload)) return { ok: false, code: 'selection_invalid', message: 'selection 必须是核心契约形状（contractVersion=1 + entityType + entityIds）' };
      break;
    case 'revision-restore':
      if (!hasNonEmptyString(payload.revisionId)) return { ok: false, code: 'revision_id_required', message: 'restore 必须带 revisionId' };
      break;
    case 'revision-replay':
      if (!hasNonEmptyString(payload.revisionId)) return { ok: false, code: 'revision_id_required', message: 'replay 必须带 revisionId' };
      if (!REPLAY_PHASES.includes(payload.phase)) return { ok: false, code: 'replay_phase_invalid', message: `phase 必须是 ${REPLAY_PHASES.join(' | ')}` };
      break;
    case 'export-run':
      if (!EXPORT_FORMATS.includes(payload.format)) return { ok: false, code: 'export_format_invalid', message: `format 必须是 ${EXPORT_FORMATS.join(' | ')}` };
      break;
    default:
      return { ok: false, code: 'kind_invalid', message: '未知写操作' };
  }

  return { ok: true, message: { requestId, kind, payload } };
}

/**
 * 写类声明形状校验（宿主读 pack.json 后调用；bridgeVersion 门 + 未知键 fail-closed）。
 * 形状：{ bridgeVersion: 1, writes: { annotations?: {write}, selection?: {write},
 *         revisions?: {restore?, replay?}, export?: {run?} } }
 */
/** 声明形态（平铺）：{ bridgeVersion: 1, annotations?: {write}, selection?: {write}, revisions?: {restore,replay}, export?: {run} } */
function validateSurfaceWritesDecl(decl) {
  if (!decl || typeof decl !== 'object' || Array.isArray(decl)) return { ok: false, code: 'decl_shape_invalid' };
  if (decl.bridgeVersion !== BRIDGE_VERSION) return { ok: false, code: 'bridge_version_unsupported' };
  const allowedTop = new Set(['bridgeVersion', 'annotations', 'selection', 'revisions', 'export']);
  const sections = ['annotations', 'selection', 'revisions', 'export'];
  const allowedFlags = { annotations: ['write'], selection: ['write'], revisions: ['restore', 'replay'], export: ['run'] };
  let declared = 0;
  for (const key of Object.keys(decl)) {
    if (!allowedTop.has(key)) return { ok: false, code: 'writes_key_unknown' };
    if (key === 'bridgeVersion') continue;
    const section = decl[key];
    if (!section || typeof section !== 'object' || Array.isArray(section)) return { ok: false, code: 'writes_section_invalid' };
    for (const flag of Object.keys(section)) {
      if (!allowedFlags[key].includes(flag)) return { ok: false, code: 'writes_flag_unknown' };
      if (section[flag] !== true) return { ok: false, code: 'writes_flag_not_boolean_true' };
    }
    declared += 1;
  }
  if (declared === 0) return { ok: false, code: 'writes_empty' };
  return { ok: true };
}

/**
 * 权限判定：宿主持有的 surface 声明 × 写类（pack 侧无权自评；消息内声明一律忽略）。
 * v1 兼容：annotations={write:true}（无 writes 层）继续授予 annotation 两 kind。
 */
function evaluateWriteGrant(surfaceDecl, kind) {
  if (!surfaceDecl || typeof surfaceDecl !== 'object') return { granted: false, reason: 'write_not_granted' };
  if (validateSurfaceWritesDecl(surfaceDecl).ok) {
    const grantedByKind = {
      'annotation-write': Boolean(surfaceDecl.annotations && surfaceDecl.annotations.write === true),
      'annotation-delete': Boolean(surfaceDecl.annotations && surfaceDecl.annotations.write === true),
      'selection-save': Boolean(surfaceDecl.selection && surfaceDecl.selection.write === true),
      'revision-restore': Boolean(surfaceDecl.revisions && surfaceDecl.revisions.restore === true),
      'revision-replay': Boolean(surfaceDecl.revisions && surfaceDecl.revisions.replay === true),
      'export-run': Boolean(surfaceDecl.export && surfaceDecl.export.run === true),
    };
    if (grantedByKind[kind]) return { granted: true };
    // 未授予时沿用 v1 的批注拒绝语义（同因同码）
    return kind.startsWith('annotation')
      ? { granted: false, reason: 'annotation_write_not_granted' }
      : { granted: false, reason: 'write_not_granted' };
  }
  // 非 v2 声明形态：仅 v1 批注窄桥语义生效
  if (kind === 'annotation-write' || kind === 'annotation-delete') {
    return evaluateWriteGrantLegacy(surfaceDecl, kind);
  }
  return { granted: false, reason: 'bridge_version_unsupported' };
}

function evaluateWriteGrantLegacy(surfaceDecl, kind) {
  const legacy = v1.evaluateWriteGrant(surfaceDecl);
  if (legacy.granted) return { granted: true };
  return { granted: false, reason: 'annotation_write_not_granted' };
}

/**
 * requestId TTL 去重（宿主侧防重放；act-ack 同型纪律：短 TTL + 首见即占）。
 * claim(requestId, now) → { ok: true } | { ok: false, reason: 'replay_duplicate' | 'replay_expired' }
 */
function createWriteRequestDedupe({ ttlMs = 10_000 } = {}) {
  const seen = new Map();
  return {
    claim(requestId, now = Date.now()) {
      if (!hasNonEmptyString(requestId)) return { ok: false, reason: 'request_id_invalid' };
      const first = seen.get(requestId);
      if (first === undefined) {
        seen.set(requestId, now);
        return { ok: true };
      }
      const age = now - first;
      return age <= ttlMs
        ? { ok: false, reason: 'replay_duplicate' }
        : { ok: false, reason: 'replay_expired' };
    },
  };
}

/** 通用回执形状（宿主 → pack）。 */
function packWriteResult(requestId, kind, ok, payload) {
  return {
    type: 'petri:pack-write-result',
    requestId,
    kind,
    ok,
    ...(ok ? { payload } : { error: payload }),
  };
}

module.exports = {
  BRIDGE_VERSION,
  WRITE_KINDS,
  REPLAY_PHASES,
  EXPORT_FORMATS,
  validatePackWriteMessage,
  validateSurfaceWritesDecl,
  evaluateWriteGrant,
  createWriteRequestDedupe,
  packWriteResult,
};
