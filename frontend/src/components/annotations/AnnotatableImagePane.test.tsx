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
    fireEvent.click(getByTestId('annotation-kind-ellipse'));

    const overlay = getByLabelText('批注层：volcano.png');
    fireEvent.pointerDown(overlay, { clientX: 20, clientY: 10 });
    fireEvent.pointerMove(overlay, { clientX: 120, clientY: 60 });
    fireEvent.pointerUp(overlay, { clientX: 120, clientY: 60 });

    // BLOCK-300 — 评论就地输入：画完形状，输入框出现在结束位置（overlay inlineComposer）。
    fireEvent.change(getByTestId('annotation-inline-input'), { target: { value: '这个离群点需要复核' } });
    fireEvent.click(getByTestId('annotation-inline-confirm'));

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
      kind: 'ellipse',
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

  it('BLOCK-254 B-2 — 保存后可撤销创建：DELETE 该条并清掉撤销入口', async () => {
    const calls = installFetch((url, init) => {
      if (url.includes('/annotations?') && (!init || !init.method)) {
        return jsonResponse({ annotations: [], count: 0, limit: 200 });
      }
      if (url.endsWith('/result-studio/annotations') && init?.method === 'POST') {
        return jsonResponse({ annotation: createdAnnotation, count: 1 });
      }
      if (url.includes('/annotations/ann-created') && init?.method === 'DELETE') {
        return jsonResponse({ deleted: true });
      }
      return jsonResponse({ error: 'unexpected' }, 500);
    });

    const { getByTestId, getByLabelText, queryByTestId } = render(
      <AnnotatableImagePane
        src="http://mock/volcano.png"
        alt="volcano.png"
        scope={{ projectId: 'p1', surface: 'result-artifact', artifactId: 'a1', revisionId: 'r1' }}
        target={{ surface: 'result-artifact', artifactName: 'volcano.png' }}
        onAddToTask={() => undefined}
      />,
    );

    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    const overlay = getByLabelText('批注层：volcano.png');
    fireEvent.pointerDown(overlay, { clientX: 20, clientY: 10 });
    fireEvent.pointerMove(overlay, { clientX: 120, clientY: 60 });
    fireEvent.pointerUp(overlay, { clientX: 120, clientY: 60 });
    fireEvent.change(getByTestId('annotation-inline-input'), { target: { value: '这个离群点需要复核' } });
    fireEvent.click(getByTestId('annotation-inline-confirm'));

    await waitFor(() => expect(getByTestId('annotation-item')).toBeTruthy());
    const undo = getByTestId('annotation-undo');
    expect(undo.getAttribute('title')).toContain('撤销刚才的创建');

    fireEvent.click(undo);
    await waitFor(() => expect(queryByTestId('annotation-item')).toBeNull());
    expect(calls.some(([url, init]) => url.includes('/annotations/ann-created') && init?.method === 'DELETE')).toBe(true);
    // 撤销完成后栈变空，按钮不应残留成死按钮。
    await waitFor(() => expect(queryByTestId('annotation-undo')).toBeNull());
  });

  it('BLOCK-254 B-2 — 删除可撤销：按原内容重建为新条目，且不重压栈', async () => {
    const existing = {
      ...createdAnnotation,
      annotationId: 'ann-existing',
      kind: 'ellipse',
      page: null,
      rect: [0.2, 0.3, 0.1, 0.1],
      comment: '纵轴尺度看着不对',
      color: 'sky',
    };
    const calls = installFetch((url, init) => {
      if (url.includes('/annotations?') && (!init || !init.method)) {
        return jsonResponse({ annotations: [existing], count: 1, limit: 200 });
      }
      if (url.includes('/annotations/ann-existing') && init?.method === 'DELETE') {
        return jsonResponse({ deleted: true });
      }
      if (url.endsWith('/result-studio/annotations') && init?.method === 'POST') {
        return jsonResponse({ annotation: { ...existing, annotationId: 'ann-restored' }, count: 1 });
      }
      return jsonResponse({ error: 'unexpected' }, 500);
    });

    const { getByTestId, queryByTestId } = render(
      <AnnotatableImagePane
        src="http://mock/volcano.png"
        alt="volcano.png"
        scope={{ projectId: 'p1', surface: 'result-artifact', artifactId: 'a1', revisionId: 'r1' }}
        target={{ surface: 'result-artifact', artifactName: 'volcano.png' }}
        onAddToTask={() => undefined}
      />,
    );

    await waitFor(() => expect(getByTestId('annotation-item')).toBeTruthy());
    fireEvent.click(getByTestId('annotation-remove'));
    await waitFor(() => expect(queryByTestId('annotation-item')).toBeNull());

    const undo = getByTestId('annotation-undo');
    expect(undo.getAttribute('title')).toContain('重建为新条目');
    fireEvent.click(undo);

    await waitFor(() => expect(getByTestId('annotation-item')).toBeTruthy());
    const post = calls.find(([, init]) => init?.method === 'POST');
    expect(parseBody(post?.[1])).toMatchObject({
      rect: [0.2, 0.3, 0.1, 0.1],
      comment: '纵轴尺度看着不对',
      kind: 'ellipse',
      color: 'sky',
    });
    // 补偿动作本身不入栈：撤销后不应还能再撤销同一动作。
    await waitFor(() => expect(queryByTestId('annotation-undo')).toBeNull());
  });

  it('BLOCK-292/300 — 连续批注动线：画完保持可见+就地输入，允许不填；text 点击就地开框', async () => {
    const posts: Record<string, unknown>[] = [];
    const calls = installFetch((url, init) => {
      if (url.includes('/annotations?') && (!init || !init.method)) {
        return jsonResponse({ annotations: [], count: 0, limit: 200 });
      }
      if (url.endsWith('/result-studio/annotations') && init?.method === 'POST') {
        const body = parseBody(init);
        posts.push(body);
        return jsonResponse({ annotation: { ...createdAnnotation, ...body, annotationId: `ann-${posts.length}` }, count: posts.length });
      }
      return jsonResponse({ error: 'unexpected' }, 500);
    });

    const { getByTestId, getByLabelText, queryByTestId } = render(
      <AnnotatableImagePane
        src="http://mock/volcano.png"
        alt="volcano.png"
        onOpenImage={() => undefined}
        scope={{ projectId: 'p1', surface: 'result-artifact', artifactId: 'a1', revisionId: 'r1' }}
        target={{ surface: 'result-artifact', artifactName: 'volcano.png', jobId: 'job-9', revisionOrdinal: 3 }}
        onAddToTask={() => undefined}
      />,
    );

    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    const overlay = getByLabelText('批注层：volcano.png');
    // ①挂载即批注模式（UI-599 自动打开）
    expect(overlay.getAttribute('data-drawing')).toBe('true');

    // ②画第一笔 → pending 预览立即在场 + 就地输入框出现在结束位置
    fireEvent.pointerDown(overlay, { clientX: 20, clientY: 10 });
    fireEvent.pointerMove(overlay, { clientX: 120, clientY: 60 });
    fireEvent.pointerUp(overlay, { clientX: 120, clientY: 60 });
    expect(getByTestId('annotation-pending-rect')).toBeTruthy();
    expect(getByTestId('annotation-inline-input')).toBeTruthy();

    // ③填写并就地确认（✓）→ pending 退场转正；绘制模式保持 true
    fireEvent.change(getByTestId('annotation-inline-input'), { target: { value: '这个离群点需要复核' } });
    fireEvent.click(getByTestId('annotation-inline-confirm'));
    await waitFor(() => expect(getByTestId('annotation-box')).toBeTruthy());
    expect(overlay.getAttribute('data-drawing')).toBe('true');

    // ④第二笔不填写直接确认（「允许不填写」→ 默认文案落库）
    fireEvent.pointerDown(overlay, { clientX: 40, clientY: 20 });
    fireEvent.pointerMove(overlay, { clientX: 150, clientY: 70 });
    fireEvent.pointerUp(overlay, { clientX: 150, clientY: 70 });
    expect(getByTestId('annotation-pending-rect')).toBeTruthy();
    fireEvent.click(getByTestId('annotation-inline-confirm'));
    await waitFor(() => expect(posts.length).toBe(2));
    expect(posts[1]).toMatchObject({ comment: '矩形标注', kind: 'region' });

    // ⑤text 工具：点击图面即就地开框（不拖拽），确认落库 kind=text
    fireEvent.click(getByTestId('annotation-kind-text'));
    fireEvent.pointerDown(overlay, { clientX: 80, clientY: 40 });
    expect(queryByTestId('annotation-pending-rect')).toBeNull();
    expect(getByTestId('annotation-inline-input')).toBeTruthy();
    fireEvent.change(getByTestId('annotation-inline-input'), { target: { value: '看这里的峰值' } });
    fireEvent.keyDown(getByTestId('annotation-inline-input'), { key: 'Enter' });
    await waitFor(() => expect(posts.length).toBe(3));
    expect(posts[2]).toMatchObject({ kind: 'text', comment: '看这里的峰值' });
    const textRect = posts[2].rect as number[];
    // 就地框实际渲染尺寸落库（jsdom 的 BOX mock 下量得全画布；真实尺寸由实机探针取证）
    expect(textRect).toHaveLength(4);
    expect(textRect.every((v) => v >= 0 && v <= 1)).toBe(true);
  });

  it('BLOCK-303 — 箭头端到端：拖拽起点→终点，两点 path 落库 kind=arrow', async () => {
    const posts: Record<string, unknown>[] = [];
    const calls = installFetch((url, init) => {
      if (url.includes('/annotations?') && (!init || !init.method)) {
        return jsonResponse({ annotations: [], count: 0, limit: 200 });
      }
      if (url.endsWith('/result-studio/annotations') && init?.method === 'POST') {
        const body = parseBody(init);
        posts.push(body);
        return jsonResponse({ annotation: { ...createdAnnotation, ...body, annotationId: `ann-${posts.length}` }, count: posts.length });
      }
      return jsonResponse({ error: 'unexpected' }, 500);
    });

    const { getByTestId, getByLabelText } = render(
      <AnnotatableImagePane
        src="http://mock/volcano.png"
        alt="volcano.png"
        onOpenImage={() => undefined}
        scope={{ projectId: 'p1', surface: 'result-artifact', artifactId: 'a1', revisionId: 'r1' }}
        target={{ surface: 'result-artifact', artifactName: 'volcano.png', jobId: 'job-9', revisionOrdinal: 3 }}
        onAddToTask={() => undefined}
      />,
    );

    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    fireEvent.click(getByTestId('annotation-kind-arrow'));
    const overlay = getByLabelText('批注层：volcano.png');
    fireEvent.pointerDown(overlay, { clientX: 20, clientY: 10 });
    fireEvent.pointerMove(overlay, { clientX: 120, clientY: 60 });
    expect(getByTestId('annotation-arrow-draft')).toBeTruthy();
    fireEvent.pointerUp(overlay, { clientX: 120, clientY: 60 });
    expect(getByTestId('annotation-pending-arrow')).toBeTruthy();

    // 不填写直接确认 → 默认文案「箭头标注」+ 两点 path 落库
    fireEvent.click(getByTestId('annotation-inline-confirm'));
    await waitFor(() => expect(posts.length).toBe(1));
    expect(posts[0]).toMatchObject({
      kind: 'arrow',
      comment: '箭头标注',
      path: [[0.1, 0.1], [0.6, 0.6]],
    });
  });
});
