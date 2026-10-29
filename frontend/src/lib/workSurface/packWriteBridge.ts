/**
 * packWriteBridge.ts — RW-02（C-44 扩展）pack 写桥宿主侧（frontend 移植 + 代理分发）。
 *
 * 职责：校验 pack 上行写消息（与 core/shared-backend/pack-write-bridge-contract.js 同一
 * 词汇与 fail-closed 行为，两侧由各自测试钉住——R4 架构规则禁止前端引后端实现，故为
 * 同源移植而非 import，漂移由两侧契约测试对账）；权限判定（宿主持有声明，pack 不可自宣）；
 * requestId TTL 去重（防重放）；分发到核心既有客户端（不建第二写真相）。
 * 项目归属：projectId/conversationId/artifact scope 全部由宿主注入，pack 消息内声明一律忽略。
 */
import { createAnnotation, deleteAnnotation } from '@/lib/annotation-client';
import { restoreArtifactRevision } from '@/components/result-studio/resultStudioClient';
import { getToken } from '@/lib/authClient';
import type { AnnotationScope } from '@/lib/annotations';

export type PackWriteKind =
  | 'annotation-write'
  | 'annotation-delete'
  | 'selection-save'
  | 'revision-restore'
  | 'revision-replay'
  | 'export-run';

export const PACK_WRITE_KINDS: readonly PackWriteKind[] = [
  'annotation-write',
  'annotation-delete',
  'selection-save',
  'revision-restore',
  'revision-replay',
  'export-run',
];

export const PACK_WRITE_BRIDGE_VERSION = 1;
const MAX_REQUEST_ID_CHARS = 64;
const REPLAY_PHASES = ['preflight', 'confirm'] as const;
const EXPORT_FORMATS = ['method', 'report', 'script'] as const;

export interface PackWriteMessage {
  requestId: string;
  kind: PackWriteKind;
  payload: Record<string, unknown>;
}

export type PackWriteGrant = { granted: true } | { granted: false; reason: string };

/** 声明形态（平铺，与 pack.json writes 值同形；v1 兼容=无 bridgeVersion 仅 annotations）。 */
export interface SurfaceWritesDecl {
  bridgeVersion?: number;
  annotations?: { write?: boolean };
  selection?: { write?: boolean };
  revisions?: { restore?: boolean; replay?: boolean };
  export?: { run?: boolean };
}

function hasNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** surface writes 声明校验（bridgeVersion 门 + 未知键 fail-closed；空 writes=非 v2 声明走 v1 兼容）。 */
export function validateSurfaceWritesDecl(decl: unknown): { ok: true } | { ok: false; code: string } {
  if (!decl || typeof decl !== 'object' || Array.isArray(decl)) return { ok: false, code: 'decl_shape_invalid' };
  const d = decl as SurfaceWritesDecl;
  if (d.bridgeVersion !== PACK_WRITE_BRIDGE_VERSION) return { ok: false, code: 'bridge_version_unsupported' };
  const allowedTop = new Set(['bridgeVersion', 'annotations', 'selection', 'revisions', 'export']);
  const allowedFlags: Record<string, string[]> = {
    annotations: ['write'], selection: ['write'], revisions: ['restore', 'replay'], export: ['run'],
  };
  let declared = 0;
  for (const [key, section] of Object.entries(d)) {
    if (!allowedTop.has(key)) return { ok: false, code: 'writes_key_unknown' };
    if (key === 'bridgeVersion') continue;
    if (!section || typeof section !== 'object') return { ok: false, code: 'writes_section_invalid' };
    for (const flag of Object.keys(section)) {
      if (!allowedFlags[key].includes(flag)) return { ok: false, code: 'writes_flag_unknown' };
      if ((section as Record<string, unknown>)[flag] !== true) return { ok: false, code: 'writes_flag_not_boolean_true' };
    }
    declared += 1;
  }
  if (declared === 0) return { ok: false, code: 'writes_empty' };
  return { ok: true };
}

/** 权限判定（宿主持有声明；v1 annotations={write:true} 兼容）。 */
export function evaluateWriteGrant(surfaceDecl: SurfaceWritesDecl | null | undefined, kind: PackWriteKind): PackWriteGrant {
  if (!surfaceDecl || typeof surfaceDecl !== 'object') return { granted: false, reason: 'write_not_granted' };
  const v2Ok = validateSurfaceWritesDecl(surfaceDecl).ok;
  if (v2Ok) {
    const grantedByKind: Record<PackWriteKind, boolean> = {
      'annotation-write': surfaceDecl.annotations?.write === true,
      'annotation-delete': surfaceDecl.annotations?.write === true,
      'selection-save': surfaceDecl.selection?.write === true,
      'revision-restore': surfaceDecl.revisions?.restore === true,
      'revision-replay': surfaceDecl.revisions?.replay === true,
      'export-run': surfaceDecl.export?.run === true,
    };
    if (grantedByKind[kind]) return { granted: true };
    return kind.startsWith('annotation')
      ? { granted: false, reason: 'annotation_write_not_granted' }
      : { granted: false, reason: 'write_not_granted' };
  }
  if (kind === 'annotation-write' || kind === 'annotation-delete') {
    return surfaceDecl.annotations?.write === true
      ? { granted: true }
      : { granted: false, reason: 'annotation_write_not_granted' };
  }
  return { granted: false, reason: 'bridge_version_unsupported' };
}

/** 校验上行写消息（v1 专用消息按 kind 别名归一；payload 按 kind fail-closed）。 */
export function validatePackWriteMessage(
  raw: unknown,
): { ok: true; message: PackWriteMessage } | { ok: false; code: string; message: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, code: 'shape_invalid', message: '消息必须是对象' };
  }
  const data = raw as Record<string, unknown>;
  const { type, requestId } = data;
  if (!hasNonEmptyString(requestId) || requestId.length > MAX_REQUEST_ID_CHARS) {
    return { ok: false, code: 'request_id_invalid', message: `requestId 必须是 1..${MAX_REQUEST_ID_CHARS} 字符` };
  }
  let kind: PackWriteKind;
  let payload: Record<string, unknown>;
  if (type === 'petri:pack-write') {
    kind = data.kind as PackWriteKind;
    payload = data.payload as Record<string, unknown>;
    if (!PACK_WRITE_KINDS.includes(kind)) {
      return { ok: false, code: 'kind_invalid', message: `kind 必须是 ${PACK_WRITE_KINDS.join(' | ')}` };
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return { ok: false, code: 'payload_invalid', message: 'payload 必须是对象' };
    }
  } else if (type === 'petri:annotation-write' || type === 'petri:annotation-delete') {
    kind = type === 'petri:annotation-write' ? 'annotation-write' : 'annotation-delete';
    payload = data;
  } else {
    return { ok: false, code: 'type_invalid', message: 'type 必须是 petri:pack-write | petri:annotation-write | petri:annotation-delete' };
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
    case 'selection-save': {
      const selection = payload.selection as Record<string, unknown> | undefined;
      if (!selection || typeof selection !== 'object' || selection.contractVersion !== 1
        || !hasNonEmptyString(selection.entityType) || !Array.isArray(selection.entityIds)) {
        return { ok: false, code: 'selection_invalid', message: 'selection 必须是核心契约形状' };
      }
      break;
    }
    case 'revision-restore':
      if (!hasNonEmptyString(payload.revisionId)) return { ok: false, code: 'revision_id_required', message: 'restore 必须带 revisionId' };
      break;
    case 'revision-replay':
      if (!hasNonEmptyString(payload.revisionId)) return { ok: false, code: 'revision_id_required', message: 'replay 必须带 revisionId' };
      if (!REPLAY_PHASES.includes(payload.phase as (typeof REPLAY_PHASES)[number])) {
        return { ok: false, code: 'replay_phase_invalid', message: `phase 必须是 ${REPLAY_PHASES.join(' | ')}` };
      }
      break;
    case 'export-run':
      if (!EXPORT_FORMATS.includes(payload.format as (typeof EXPORT_FORMATS)[number])) {
        return { ok: false, code: 'export_format_invalid', message: `format 必须是 ${EXPORT_FORMATS.join(' | ')}` };
      }
      break;
    default:
      return { ok: false, code: 'kind_invalid', message: '未知写操作' };
  }
  return { ok: true, message: { requestId, kind, payload } };
}

/** requestId TTL 去重（防重放；act-ack 同型纪律）。 */
export function createWriteRequestDedupe(options: { ttlMs?: number } = {}) {
  const ttlMs = options.ttlMs ?? 10_000;
  const seen = new Map<string, number>();
  return {
    claim(requestId: string, now = Date.now()): { ok: true } | { ok: false; reason: 'replay_duplicate' | 'replay_expired' | 'request_id_invalid' } {
      if (!hasNonEmptyString(requestId)) return { ok: false, reason: 'request_id_invalid' };
      const first = seen.get(requestId);
      if (first === undefined) {
        seen.set(requestId, now);
        return { ok: true };
      }
      return now - first <= ttlMs
        ? { ok: false, reason: 'replay_duplicate' }
        : { ok: false, reason: 'replay_expired' };
    },
  };
}

export interface PackWriteHostContext {
  surfaceDecl: SurfaceWritesDecl | null;
  projectId: string;
  conversationId: string | null;
  /** 宿主当前渲染的 artifact scope（annotation 写入的定位真相；pack 不可自宣）。 */
  annotationScope: AnnotationScope | null;
}

export type PackWriteResult =
  | { ok: true; kind: PackWriteKind; payload: Record<string, unknown> }
  | { ok: false; kind: PackWriteKind; error: string };

/** 核心 REST 统一出口（getToken bearer；与 resultStudioClient.requestJson 同鉴权形态）。 */
async function coreRest(path: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  const token = getToken();
  const response = await fetch(`/api/result-studio${path}`, {
    ...init,
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const code = typeof data.error === 'string' && data.error ? data.error : `result_studio_request_failed_${response.status}`;
    const message = typeof data.message === 'string' && data.message ? data.message : code;
    throw Object.assign(new Error(message), { code });
  }
  return data;
}

/**
 * 创建宿主写代理：pack 面写请求的唯一入口。
 * 校验 → 授权 → 去重 → 分发核心客户端；任何一步失败返回 ok=false + 确定性 error。
 */
export function createPackWriteHost(context: PackWriteHostContext, options: { ttlMs?: number } = {}) {
  const dedupe = createWriteRequestDedupe(options);
  return {
    /** 处理一条上行写消息，返回回执（宿主 postMessage 回 iframe）。 */
    async handlePackWrite(raw: unknown): Promise<PackWriteResult> {
      const validated = validatePackWriteMessage(raw);
      if (!validated.ok) {
        return { ok: false, kind: 'annotation-write', error: `${validated.code}: ${validated.message}` };
      }
      const { requestId, kind, payload } = validated.message;
      const grant = evaluateWriteGrant(context.surfaceDecl, kind);
      if (!grant.granted) {
        return { ok: false, kind, error: grant.reason };
      }
      const claim = dedupe.claim(requestId);
      if (!claim.ok) {
        return { ok: false, kind, error: claim.reason };
      }
      try {
        if (kind === 'annotation-write') {
          if (!context.annotationScope) throw Object.assign(new Error('annotation_scope_unavailable'), { code: 'annotation_scope_unavailable' });
          const created = await createAnnotation({
            ...context.annotationScope,
            conversationId: context.conversationId,
            comment: String(payload.comment),
            kind: (payload.kind as never) || 'region',
            ...(payload.rect !== undefined ? { rect: payload.rect as [number, number, number, number] } : {}),
            ...(payload.path !== undefined ? { path: payload.path as [number, number][] } : {}),
            ...(payload.anchor !== undefined ? { anchor: payload.anchor as never } : {}),
            ...(payload.color !== undefined ? { color: payload.color as never } : {}),
            ...(payload.page !== undefined ? { page: payload.page as number } : {}),
          });
          return { ok: true, kind, payload: { annotationId: created.annotation.annotationId, count: created.count } };
        }
        if (kind === 'annotation-delete') {
          await deleteAnnotation(String(payload.annotationId));
          return { ok: true, kind, payload: { annotationId: payload.annotationId } };
        }
        if (kind === 'selection-save') {
          const selection = payload.selection as Record<string, unknown>;
          const saved = await coreRest('/selection', {
            method: 'POST',
            body: JSON.stringify({ ...selection, projectId: context.projectId, conversationId: context.conversationId }),
          });
          const selectionId = typeof saved.selectionId === 'string' ? saved.selectionId : '';
          return { ok: true, kind, payload: { selectionId } };
        }
        if (kind === 'revision-restore') {
          const restored = await restoreArtifactRevision(String(payload.revisionId));
          return { ok: true, kind, payload: { revisionId: restored.revision.revisionId, changeSetId: restored.changeSet.changeSetId } };
        }
        // revision-replay / export-run：契约+授权+去重已过；核心链路由宿主按面接续
        // （replay 需 contextToken 机制、export 走 methods-export 的 LLM 门——如实返回未接线）。
        return { ok: false, kind, error: 'write_kind_host_wiring_pending' };
      } catch (error) {
        const code = (error as { code?: string }).code || 'pack_write_dispatch_failed';
        return { ok: false, kind, error: code };
      }
    },
  };
}
