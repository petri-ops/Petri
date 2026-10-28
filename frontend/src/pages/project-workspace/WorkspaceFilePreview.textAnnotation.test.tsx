// BLOCK-254 P5 — 文本锚点批注条在文件预览里的挂载形态。
//
// 与 WorkspaceFilePreview.test.tsx 分开成独立文件：那边钉的是头部减负/自动保存/脏检测，
// 这里只钉「文本面有批注条、且没有拖拽画框的开关」这一条接线事实，互不干扰断言基线。

import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ActiveWorkspaceFile } from './types';
import { ThemeProvider } from '@/themes/ThemeProvider';

vi.mock('@/lib/desktopBridge', () => ({
  getBridge: () => ({ writeTextFile: vi.fn() }),
}));

vi.mock('@/components/editor', () => ({
  WorkspaceFilePreviewBridge: (props: { value: string; onChange: (v: string) => void }) => (
    <textarea
      data-testid="mock-editor"
      value={props.value}
      onChange={(event) => props.onChange(event.target.value)}
    />
  ),
}));

import { WorkspaceFilePreview } from './WorkspaceFilePreview';

function textFile(): ActiveWorkspaceFile {
  return {
    name: 'notes.md',
    path: 'notes.md',
    url: 'http://localhost:3001/api/workspaces/p_x/file?path=notes.md',
    workspaceKind: 'local',
    workspaceDir: 'D:/ws',
    modifiedAt: 1,
  } as unknown as ActiveWorkspaceFile;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('BLOCK-254 P5 — 文本面批注条', () => {
  it('UI-624 — 空闲态（无批注/无待填）不渲染空批注条', async () => {
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.includes('/annotations')) {
        return Promise.resolve(new Response(JSON.stringify({ annotations: [], count: 0, limit: 200 }), { status: 200 }));
      }
      return Promise.resolve(new Response('# 标题\n\n正文\n', { status: 200 }));
    }));

    render(
      <ThemeProvider>
        <WorkspaceFilePreview
          file={textFile()}
          refreshVersion={0}
          openError=""
          opening={false}
          onOpen={() => undefined}
          onDownload={() => undefined}
          projectId="p_x"
        />
      </ThemeProvider>,
    );

    await screen.findByText('正文');
    await waitFor(() => expect(screen.queryByTestId('annotation-bar')).toBeNull());
    expect(screen.queryByTestId('annotation-add-to-task')).toBeNull();
  });

  it('有文本批注时渲染批注条（列表 + 加入上下文），且无拖拽画框开关', async () => {
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.includes('/annotations')) {
        return Promise.resolve(new Response(JSON.stringify({
          annotations: [{
            annotationId: 'ann_text_1',
            contractVersion: 1,
            projectId: 'p_x',
            conversationId: null,
            surface: 'workspace-file',
            artifactId: null,
            revisionId: null,
            filePath: 'notes.md',
            entryId: null,
            artifactName: 'notes.md',
            kind: 'text-range',
            page: null,
            rect: [],
            path: [],
            anchor: { kind: 'text-range', startLine: 3, endLine: 3, startColumn: null, endColumn: null, quote: '正文', language: 'md' },
            comment: '这段需要复核',
            color: 'amber',
            author: 'user',
            createdAt: '2026-10-20T00:00:00.000Z',
            updatedAt: '2026-10-20T00:00:00.000Z',
          }],
          count: 1,
          limit: 200,
        }), { status: 200 }));
      }
      return Promise.resolve(new Response('# 标题\n\n正文\n', { status: 200 }));
    }));

    render(
      <ThemeProvider>
        <WorkspaceFilePreview
          file={textFile()}
          refreshVersion={0}
          openError=""
          opening={false}
          onOpen={() => undefined}
          onDownload={() => undefined}
          projectId="p_x"
        />
      </ThemeProvider>,
    );

    const bar = await screen.findByTestId('annotation-bar');
    expect(bar.dataset.mode).toBe('text');
    expect(screen.queryByTestId('annotation-toggle')).toBeNull();
    expect(screen.getByTestId('annotation-add-to-task').textContent).toBe('加入上下文');
  });
});
