'use strict';

/**
 * shared-backend/pack-annotation-bridge-contract.js — BLOCK-264（C-44）pack 批注写桥契约（冻结骨架）。
 *
 * 定位：pack iframe（petri-pack:// 独立 origin）写批注的**消息契约与权限边界**。
 * 本文件只冻结词汇与校验（fail-closed）——宿主侧桥接线（PackSurfaceFrame 事件
 * 分发 + pack.json 能力声明消费）按此契约实现，pack 侧永远不能自宣写权限。
 *
 * 消息形状（上行 pack → host，postMessage）：
 *   { type: 'petri:annotation-write', requestId, projectId, surface, kind, rect|path|anchor,
 *     comment, color?, page? }
 *   { type: 'petri:annotation-delete', requestId, annotationId }
 * 下行 host → pack（回执）：
 *   { type: 'petri:annotation-write-result', requestId, ok, annotationId?, error? }
 *
 * 权限模型（宿主侧强制，pack 侧只是请求方）：
 *   1. pack.json provides.resultSurfaces[].annotations = { write: true } 显式声明
 *      （缺省 false——不声明即只读）；
 *   2. 宿主校验消息来源 iframe 的 packId 与声明的 surface 匹配；
 *   3. 写入走核心既有 REST/契约（normalizeAnnotationInput v2）——pack 不自带校验器，
 *      不建第二真相；越权/未声明一律 403 形态回执 error='annotation_write_not_granted'。
 */

// 白名单：pack 只能写在宿主当前渲染的 surface 上（宿主注入 surfaceContext）
const BRIDGE_MESSAGE_TYPES = Object.freeze(['petri:annotation-write', 'petri:annotation-delete']);
const BRIDGE_RESULT_TYPES = Object.freeze(['petri:annotation-write-result', 'petri:annotation-delete-result']);

const MAX_BRIDGE_COMMENT_CHARS = 500;
const MAX_REQUEST_ID_CHARS = 64;

/**
 * 校验 pack 上行消息（fail-closed；未知字段/越界值拒绝）。
 * @returns {{ ok: true, message: normalized } | { ok: false, code: string, message: string }}
 */
function validateBridgeMessage(raw) {
  if (!raw || typeof raw !== 'object') return { ok: false, code: 'shape_invalid', message: '消息必须是对象' };
  const { type, requestId } = raw;
  if (!BRIDGE_MESSAGE_TYPES.includes(type)) {
    return { ok: false, code: 'type_invalid', message: `type 必须是 ${BRIDGE_MESSAGE_TYPES.join(' | ')}` };
  }
  if (typeof requestId !== 'string' || !requestId || requestId.length > MAX_REQUEST_ID_CHARS) {
    return { ok: false, code: 'request_id_invalid', message: `requestId 必须是 1..${MAX_REQUEST_ID_CHARS} 字符` };
  }
  if (type === 'petri:annotation-delete') {
    if (typeof raw.annotationId !== 'string' || !raw.annotationId) {
      return { ok: false, code: 'annotation_id_required', message: '删除必须带 annotationId' };
    }
    return { ok: true, message: { type, requestId, annotationId: raw.annotationId } };
  }
  // write：正文与几何走核心契约（normalizeAnnotationInput），这里只查桥层字段
  const comment = typeof raw.comment === 'string' ? raw.comment : '';
  if (!comment || comment.length > MAX_BRIDGE_COMMENT_CHARS) {
    return { ok: false, code: 'comment_invalid', message: `comment 必须是 1..${MAX_BRIDGE_COMMENT_CHARS} 字` };
  }
  if (raw.rect === undefined && raw.path === undefined && raw.anchor === undefined) {
    return { ok: false, code: 'geometry_required', message: 'write 必须带 rect / path / anchor 之一（交给核心契约校验）' };
  }
  return {
    ok: true,
    message: {
      type,
      requestId,
      kind: typeof raw.kind === 'string' ? raw.kind : 'region',
      comment,
      color: typeof raw.color === 'string' ? raw.color : undefined,
      page: raw.page,
      rect: raw.rect,
      path: raw.path,
      anchor: raw.anchor,
    },
  };
}

/**
 * 权限判定：pack 声明 × 宿主上下文（宿主侧调用；pack 侧无权自评）。
 * @param {{ annotations?: { write?: boolean } }} surfaceDecl pack.json 的 surface 声明
 * @returns {{ granted: boolean, reason?: string }}
 */
function evaluateWriteGrant(surfaceDecl) {
  const granted = Boolean(surfaceDecl && surfaceDecl.annotations && surfaceDecl.annotations.write === true);
  return granted
    ? { granted: true }
    : { granted: false, reason: 'annotation_write_not_granted' };
}

/** 回执形状（宿主 → pack）。 */
function bridgeResult(requestId, ok, payload) {
  return {
    type: ok ? 'petri:annotation-write-result' : 'petri:annotation-write-result',
    requestId,
    ok,
    ...(ok ? { annotationId: payload } : { error: payload }),
  };
}

module.exports = {
  BRIDGE_MESSAGE_TYPES,
  BRIDGE_RESULT_TYPES,
  MAX_BRIDGE_COMMENT_CHARS,
  validateBridgeMessage,
  evaluateWriteGrant,
  bridgeResult,
};
