import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { AnnotatableImagePane } from './AnnotatableImagePane';

/**
 * BLOCK-219 Q6 — 图像批注宿主端到端（组件级）：
 * 拖拽 → 写评论 → 落库 → 加入任务，四步全在同一实例上验证。
 */

const BOX = { left: 0, top: 0, width: 200, height: 100, right: 200, bottom: 100, x: 0, y: 0 } as DOMRect;

const createdAnnotation = {
  annotationId: 'ann-created',
  contractVersion: 1,
  projectId: 'p1',
  conversationId: null,
  surface: 'result-artifact',
  artifactId: 'a1',
  revisionId: 'r1',
  filePath: null,
  artifactName: 'volcano.png',
  kind: 'region',
  page: null,
  rect: [0.1, 0.1, 0.5, 0.5],
  comment: '这个离群点需要复核',
  color: 'amber',
  author: 'user',
  createdAt: '2026-10-20T00:00:00.000Z',
  updatedAt: '2026-10-20T00:00:00.000Z',
};

type FetchCall = [string, RequestInit | undefined];

function jsonResponse(payload: unknown, status = 200): Response {
  const ok = status >= 200 && status < 300;
  return { ok, status, json: () => Promise.resolve(payload) } as unknown as Response;
}

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
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(BOX);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('AnnotatableImagePane', () => {
  it('拖拽→评论→保存→加入任务：批注走旁路 API，prompt 含身份与评论', async () => {
    const calls = installFetch((url, init) => {
      if (url.includes('/annotations?') && (!init || !init.method)) {
        return jsonResponse({ annotations: [], count: 0, limit: 200 });
      }
      if (url.endsWith('/result-studio/annotations') && init?.method === 'POST') {
        return jsonResponse({ annotation: createdAnnotation, count: 1 });
      }
      return jsonResponse({ error: 'unexpected' }, 500);
    });

    const onAddToTask = vi.fn();
    const { getByTestId, getByLabelText } = render(
      <AnnotatableImagePane
        src="http://mock/volcano.png"
        alt="volcano.png"
        onOpenImage={() => undefined}
        scope={{ projectId: 'p1', surface: 'result-artifact', artifactId: 'a1', revisionId: 'r1' }}
        target={{ surface: 'result-artifact', artifactName: 'volcano.png', jobId: 'job-9', revisionOrdinal: 3 }}
        onAddToTask={onAddToTask}
      />,
    );

    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    fireEvent.click(getByTestId('annotation-toggle'));

    const overlay = getByLabelText('批注层：volcano.png');
    fireEvent.pointerDown(overlay, { clientX: 20, clientY: 10 });
    fireEvent.pointerMove(overlay, { clientX: 120, clientY: 60 });
    fireEvent.pointerUp(overlay, { clientX: 120, clientY: 60 });

    fireEvent.change(getByTestId('annotation-comment-input'), { target: { value: '这个离群点需要复核' } });
    fireEvent.click(getByTestId('annotation-save'));

    await waitFor(() => expect(getByTestId('annotation-item')).toBeTruthy());
    const postCall = calls.find(([, init]) => init?.method === 'POST');
    expect(postCall).toBeTruthy();
    const body = parseBody(postCall?.[1]);
    expect(body).toMatchObject({
      projectId: 'p1',
      surface: 'result-artifact',
      artifactId: 'a1',
      revisionId: 'r1',
      rect: [0.1, 0.1, 0.5, 0.5],
      comment: '这个离群点需要复核',
    });
    expect(body.filePath).toBeUndefined();

    fireEvent.click(getByTestId('annotation-add-to-task'));
    expect(onAddToTask).toHaveBeenCalledTimes(1);
    const prompt = String(onAddToTask.mock.calls[0][0]);
    expect(prompt).toContain('结果产物「volcano.png」');
    expect(prompt).toContain('任务 job-9');
    expect(prompt).toContain('第 3 版');
    expect(prompt).toContain('这个离群点需要复核');
    expect(prompt).toContain('原始产物文件未被修改');
  });

  it('缺少产物身份时不发请求，只显示诚实原因', () => {
    const calls = installFetch(() => jsonResponse({ annotations: [], count: 0, limit: 200 }));

    const { getByTestId, queryByTestId } = render(
      <AnnotatableImagePane
        src="http://mock/volcano.png"
        alt="volcano.png"
        scope={null}
        target={{ surface: 'result-artifact' }}
        onAddToTask={() => undefined}
      />,
    );

    expect(getByTestId('annotation-unavailable').textContent).toContain('缺少产物身份');
    expect(queryByTestId('annotation-toggle')).toBeNull();
    expect(calls).toHaveLength(0);
  });
});
