import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnnotationClientError, createAnnotation, deleteAnnotation, fetchAnnotations } from './annotation-client';

/** BLOCK-219 Q6 — 批注 REST 客户端的 URL/载荷/错误归一契约。 */

const originalFetch = globalThis.fetch;

function jsonResponse(payload: unknown, status = 200): Response {
  const ok = status >= 200 && status < 300;
  return {
    ok,
    status,
    json: () => Promise.resolve(payload),
  } as unknown as Response;
}

type FetchCall = [string, RequestInit | undefined];

/** 装一个记录调用的 fetch 桩（返回固定响应），避免每个用例重复断言书写。 */
function installFetch(handler: (url: string, init?: RequestInit) => Response): FetchCall[] {
  const calls: FetchCall[] = [];
  globalThis.fetch = ((url: string, init?: RequestInit) => {
    calls.push([String(url), init]);
    return Promise.resolve(handler(String(url), init));
  }) as unknown as typeof fetch;
  return calls;
}

function parseBody(init?: RequestInit): Record<string, unknown> {
  const raw = init?.body;
  if (typeof raw !== 'string') return {};
  return JSON.parse(raw) as Record<string, unknown>;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('fetchAnnotations', () => {
  it('结果产物 scope 用 artifactId/revisionId 查询，不带 filePath', async () => {
    const calls = installFetch(() => jsonResponse({ annotations: [], count: 0, limit: 200 }));

    await fetchAnnotations({
      projectId: 'p1', surface: 'result-artifact', artifactId: 'a1', revisionId: 'r2', filePath: 'ignored.png',
    });

    const url = calls[0][0];
    expect(url).toContain('/result-studio/annotations?');
    expect(url).toContain('projectId=p1');
    expect(url).toContain('surface=result-artifact');
    expect(url).toContain('artifactId=a1');
    expect(url).toContain('revisionId=r2');
    expect(url).not.toContain('filePath');
  });

  it('工作区 scope 用 filePath 查询，不带 artifact 字段', async () => {
    const calls = installFetch(() => jsonResponse({ annotations: [], count: 0, limit: 200 }));

    await fetchAnnotations({ projectId: 'p1', surface: 'workspace-file', filePath: 'reports/qc.pdf' });

    const url = calls[0][0];
    expect(url).toContain('filePath=reports%2Fqc.pdf');
    expect(url).not.toContain('artifactId');
  });
});

describe('createAnnotation', () => {
  it('结果产物批注载荷含 artifactId/revisionId 与归一化矩形', async () => {
    const calls = installFetch(() => jsonResponse({ annotation: { annotationId: 'ann_1', comment: 'x' }, count: 1 }));

    const saved = await createAnnotation({
      projectId: 'p1',
      surface: 'result-artifact',
      artifactId: 'a1',
      revisionId: 'r2',
      artifactName: 'volcano.png',
      rect: [0.1, 0.2, 0.3, 0.4],
      comment: '离群点',
      page: 2,
    });

    expect(saved.annotation.annotationId).toBe('ann_1');
    const body = parseBody(calls[0][1]);
    expect(body).toMatchObject({
      projectId: 'p1',
      surface: 'result-artifact',
      artifactId: 'a1',
      revisionId: 'r2',
      artifactName: 'volcano.png',
      rect: [0.1, 0.2, 0.3, 0.4],
      comment: '离群点',
      page: 2,
      kind: 'region',
      color: 'amber',
    });
    expect(body.filePath).toBeUndefined();
  });

  it('工作区批注只带 filePath，不混入 artifact 身份', async () => {
    const calls = installFetch(() => jsonResponse({ annotation: { annotationId: 'ann_2' }, count: 1 }));

    await createAnnotation({
      projectId: 'p1',
      surface: 'workspace-file',
      filePath: 'reports/qc.pdf',
      rect: [0.1, 0.1, 0.2, 0.2],
      comment: '质控图',
    });

    const body = parseBody(calls[0][1]);
    expect(body.filePath).toBe('reports/qc.pdf');
    expect(body.artifactId).toBeUndefined();
    expect(body.revisionId).toBeUndefined();
  });

  it('服务端校验失败归一成 AnnotationClientError（带 code 与 details）', async () => {
    installFetch(() => jsonResponse({
      error: 'annotation_invalid',
      details: [{ code: 'comment_too_long', message: 'too long' }],
    }, 400));

    await expect(createAnnotation({
      projectId: 'p1',
      surface: 'result-artifact',
      artifactId: 'a1',
      rect: [0.1, 0.1, 0.2, 0.2],
      comment: 'x',
    })).rejects.toMatchObject({
      name: 'AnnotationClientError',
      code: 'annotation_invalid',
      details: [{ code: 'comment_too_long', message: 'too long' }],
    });
  });

  it('超限 409 保留服务端错误码（不吞成通用失败）', async () => {
    installFetch(() => jsonResponse({
      error: 'annotation_limit_reached',
      message: '同一产物/文件最多 200 条批注',
    }, 409));

    await expect(createAnnotation({
      projectId: 'p1',
      surface: 'result-artifact',
      artifactId: 'a1',
      rect: [0.1, 0.1, 0.2, 0.2],
      comment: 'x',
    })).rejects.toBeInstanceOf(AnnotationClientError);
  });
});

describe('deleteAnnotation', () => {
  it('按 id 调用 DELETE，404 归一成错误', async () => {
    const calls = installFetch(() => jsonResponse({ error: 'annotation_not_found' }, 404));

    await expect(deleteAnnotation('ann_missing')).rejects.toMatchObject({ code: 'annotation_not_found' });
    expect(calls[0][0]).toContain('/result-studio/annotations/ann_missing');
    expect(calls[0][1]?.method).toBe('DELETE');
  });
});
