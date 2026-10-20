import { getApiPrefix, getToken } from '@/lib/authClient';
import type {
  AnnotationScope,
  ArtifactAnnotation,
  CreateAnnotationInput,
} from '@/lib/annotations';

/**
 * annotation-client.ts — BLOCK-219 Q6 批注 REST 客户端。
 *
 * 三条端点唯一来源 = `core/petri-server/routes/result-studio/annotations.js`；
 * 前端不推导 scope（`surface` 决定 artifact/revision 还是 filePath），也不做
 * 二次上限判断——服务端 409 才是裁决，这里只把响应归一成可显示的错误。
 */

export interface AnnotationListResult {
  annotations: ArtifactAnnotation[];
  count: number;
  limit: number;
}

export class AnnotationClientError extends Error {
  readonly code: string;
  readonly details: Array<{ code: string; message: string }>;

  constructor(code: string, message: string, details: Array<{ code: string; message: string }> = []) {
    super(message);
    this.name = 'AnnotationClientError';
    this.code = code;
    this.details = details;
  }
}

function headers(json = false): HeadersInit {
  const token = getToken();
  return {
    ...(json ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function readError(response: Response): Promise<AnnotationClientError> {
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  const code = typeof data.error === 'string' && data.error ? data.error : `http_${response.status}`;
  const message = typeof data.message === 'string' && data.message
    ? data.message
    : `批注请求失败（HTTP ${response.status}）。`;
  const details = Array.isArray(data.details)
    ? (data.details as Array<{ code?: unknown; message?: unknown }>)
      .filter((item) => item && typeof item.code === 'string')
      .map((item) => ({
        code: String(item.code),
        message: typeof item.message === 'string' ? item.message : '',
      }))
    : [];
  return new AnnotationClientError(code, message, details);
}

function scopeQuery(scope: AnnotationScope): URLSearchParams {
  const query = new URLSearchParams({ projectId: scope.projectId, surface: scope.surface });
  if (scope.surface === 'result-artifact') {
    if (scope.artifactId) query.set('artifactId', scope.artifactId);
    if (scope.revisionId) query.set('revisionId', scope.revisionId);
  } else if (scope.filePath) {
    query.set('filePath', scope.filePath);
  }
  return query;
}

export async function fetchAnnotations(
  scope: AnnotationScope,
  options: { signal?: AbortSignal } = {},
): Promise<AnnotationListResult> {
  const response = await fetch(`${getApiPrefix()}/result-studio/annotations?${scopeQuery(scope).toString()}`, {
    headers: headers(),
    signal: options.signal,
  });
  if (!response.ok) throw await readError(response);
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  const annotations = Array.isArray(data.annotations) ? (data.annotations as ArtifactAnnotation[]) : [];
  return {
    annotations,
    count: Number(data.count) || annotations.length,
    limit: Number(data.limit) || annotations.length,
  };
}

export async function createAnnotation(
  input: CreateAnnotationInput & { conversationId?: string | null; artifactName?: string | null },
): Promise<{ annotation: ArtifactAnnotation; count: number }> {
  const body: Record<string, unknown> = {
    projectId: input.projectId,
    surface: input.surface,
    kind: 'region',
    rect: input.rect,
    comment: input.comment,
    color: input.color || 'amber',
    ...(input.page ? { page: input.page } : {}),
    ...(input.conversationId ? { conversationId: input.conversationId } : {}),
    ...(input.artifactName ? { artifactName: input.artifactName } : {}),
    ...(input.surface === 'result-artifact'
      ? { artifactId: input.artifactId, revisionId: input.revisionId ?? null }
      : { filePath: input.filePath }),
  };
  const response = await fetch(`${getApiPrefix()}/result-studio/annotations`, {
    method: 'POST',
    headers: headers(true),
    body: JSON.stringify(body),
  });
  if (!response.ok) throw await readError(response);
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!data.annotation) throw new AnnotationClientError('annotation_response_invalid', '批注保存响应缺少 annotation。');
  return { annotation: data.annotation as ArtifactAnnotation, count: Number(data.count) || 0 };
}

export async function deleteAnnotation(annotationId: string): Promise<void> {
  const response = await fetch(
    `${getApiPrefix()}/result-studio/annotations/${encodeURIComponent(annotationId)}`,
    { method: 'DELETE', headers: headers() },
  );
  if (!response.ok) throw await readError(response);
}
