// BLOCK-254 P5 — 文本锚点批注条在文件预览里的挂载形态。
//
// 与 WorkspaceFilePreview.test.tsx 分开成独立文件：那边钉的是头部减负/自动保存/脏检测，
// 这里只钉「文本面有批注条、且没有拖拽画框的开关」这一条接线事实，互不干扰断言基线。

import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
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
  it('文本族预览渲染文本模式批注条，且不渲染拖拽画框开关', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('# 标题\n\n正文\n', { status: 200 }))));

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
    // 文本面没有「拖拽框选」这回事，只能由选区产生锚点。
    expect(screen.queryByTestId('annotation-toggle')).toBeNull();
    // 列表/加入任务常驻（空批注时禁用但可见）。
    expect(screen.getByTestId('annotation-add-to-task')).toBeTruthy();
  });
});
