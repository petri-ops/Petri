/**
 * svgEditClient.ts — BLOCK-342 W1：SVG 编辑器 REST 客户端。
 *
 * 形状对齐 sceneEditClient（model3d/scene/apply）：op 列表 + before-hash 冲突检测 + 语义 diff。
 * 真值改写只走后端 span 引擎；前端不做 span 改写，也不拼通用 /api/tools 路由。
 */

import { getApiPrefix } from './env';

export interface SvgInspectElement {
  path: number[];
  tag: string;
  id?: string;
  classes?: string[];
  textPreview?: string;
  attrCount: number;
}

export interface SvgInspectTarget {
  tag: string;
  path: number[];
  id?: string;
  attrCount: number;
  childCount: number;
  textPreview?: string;
  selfClosing: boolean;
}

export interface SvgUnsafeFlags {
  script: boolean;
  foreignObject: boolean;
  eventAttrs: number;
  dangerousHref: number;
  dangerousStyle?: number;
  any?: boolean;
}

export interface SvgInspectResult {
  ok: true;
  filePath: string;
  sha256: string;
  sizeBytes: number;
  rootTag: string;
  total: number;
  returned: number;
  truncated: boolean;
  elements: SvgInspectElement[];
  target?: SvgInspectTarget | null;
  unsafe: SvgUnsafeFlags;
  description: string;
}

export interface SvgSemanticDiffEntry {
  op: string;
  target: string;
  detail: string;
  changed: boolean;
}

export interface SvgEditResult {
  ok: true;
  propose?: boolean;
  apply?: boolean;
  filePath: string;
  beforeSha256: string;
  afterSha256: string;
  changed: boolean;
  semanticDiff: SvgSemanticDiffEntry[];
  snapshotPath?: string;
  description?: string;
  next?: string;
}

export interface SvgEditFailure {
  ok: false;
  error: string;
  message?: string;
  requireAck?: boolean;
  hint?: string;
  beforeSha256?: string;
}

export class SvgEditError extends Error {
  code: string;

  requireAck: boolean;

  constructor(code: string, message: string, requireAck = false) {
    super(message);
    this.name = 'SvgEditError';
    this.code = code;
    this.requireAck = requireAck;
  }
}

async function postJson<T>(route: string, body: unknown, timeoutMs: number): Promise<T> {
  const response = await fetch(`${getApiPrefix()}${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const payload = (await response.json().catch(() => null)) as (T & Partial<SvgEditFailure>) | null;
  if (!payload) {
    throw new SvgEditError('svg_response_invalid', `响应不是合法 JSON（HTTP ${response.status}）`);
  }
  if (payload.ok === false) {
    const failure = payload as unknown as SvgEditFailure;
    throw new SvgEditError(failure.error || 'svg_error', failure.message || failure.error || 'SVG 操作失败', failure.requireAck === true);
  }
  return payload;
}

export function inspectSvgFile(input: {
  projectId: string;
  path: string;
  tag?: string;
  limit?: number;
  target?: { id?: string; path?: number[] };
}): Promise<SvgInspectResult> {
  return postJson<SvgInspectResult>('/svg/inspect', input, 15_000);
}

export function editSvgFile(input: {
  projectId: string;
  path: string;
  ops: Array<Record<string, unknown>>;
  apply?: boolean;
  beforeSha256?: string;
}): Promise<SvgEditResult> {
  return postJson<SvgEditResult>('/svg/edit', input, 20_000);
}
