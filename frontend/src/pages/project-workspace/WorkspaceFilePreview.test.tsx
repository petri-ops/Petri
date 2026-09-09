// BLOCK-74 / UI-323 — WorkspaceFilePreview 头部减负 + 自动保存 + Ctrl/Cmd+S 定向测试。
// Editor 桥与 desktopBridge 全 mock（不发真实 IPC/网络）。

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ActiveWorkspaceFile } from './types';
import { ThemeProvider } from '@/themes/ThemeProvider';

const { writeTextFileMock } = vi.hoisted(() => ({ writeTextFileMock: vi.fn() }));

vi.mock('@/lib/desktopBridge', () => ({
  getBridge: () => ({ writeTextFile: writeTextFileMock }),
}));

// Editor 桥换轻量 textarea 桩：onChange 直通组件，键位事件从容器冒泡。
vi.mock('@/components/editor', () => ({
  WorkspaceFilePreviewBridge: (
    props: { value: string; onChange: (v: string) => void },
  ) => (
    <textarea
      data-testid="mock-editor"
      value={props.value}
      onChange={(e) => props.onChange(e.target.value)}
      readOnly={false}
    />
  ),
}));

import { WorkspaceFilePreview } from './WorkspaceFilePreview';

function mdFile(): ActiveWorkspaceFile {
  return {
    name: 'check.md',
    path: 'check.md',
    url: 'http://localhost:3001/api/workspaces/p_x/file?path=check.md',
    workspaceKind: 'local',
    workspaceDir: 'D:/ws',
    modifiedAt: 1,
  } as unknown as ActiveWorkspaceFile;
}

function renderPreview() {
  return render(
    <ThemeProvider>
      <WorkspaceFilePreview
        file={mdFile()}
        refreshVersion={0}
        openError=""
        opening={false}
        onOpen={() => {}}
        onDownload={() => {}}
        projectId="p_x"
      />
    </ThemeProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function mockPreviewFetch() {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('# check.md\n\nbaseline\n', { status: 200 })));
}

describe('BLOCK-74 预览头部减负', () => {
  it('头部不再有 引用到对话/保存/恢复 按钮；编辑/预览 tabs 保留', async () => {
    mockPreviewFetch();
    renderPreview();
    await waitFor(() => expect(screen.getByText('编辑')).toBeTruthy());
    fireEvent.click(screen.getByText('编辑'));
    await waitFor(() => expect(screen.getByTestId('mock-editor')).toBeTruthy());
    expect(screen.queryByText('引用到对话')).toBeNull();
    expect(screen.queryByText('保存')).toBeNull();
    expect(screen.queryByText('恢复')).toBeNull();
    expect(screen.getByText('编辑')).toBeTruthy();
    expect(screen.getByText('预览')).toBeTruthy();
  });

  it('自动保存：编辑停顿 ~1.2s 后调用保存链（writeTextFile 收到新内容）', async () => {
    writeTextFileMock.mockResolvedValue({ ok: true });
    mockPreviewFetch();
    renderPreview();
    await waitFor(() => expect(screen.getByText('编辑')).toBeTruthy());
    fireEvent.click(screen.getByText('编辑'));
    await new Promise((r) => setTimeout(r, 300));
    if (!document.querySelector('[data-testid="mock-editor"]')) {
      console.log('DIAG-HTML', document.body.innerHTML.slice(0, 1200));
    }
    const editor = await waitFor(() => screen.getByTestId('mock-editor'));
    fireEvent.change(editor, { target: { value: '# check.md\n\nautosave marker\n' } });
    // 防抖窗口内不应立即保存
    expect(writeTextFileMock).not.toHaveBeenCalled();
    await waitFor(() => expect(writeTextFileMock).toHaveBeenCalled(), { timeout: 3000 });
    const [dir, path, content] = writeTextFileMock.mock.calls[0];
    expect(path).toBe('check.md');
    expect(String(content)).toContain('autosave marker');
    void dir;
  });

  it('Ctrl+S：立即保存（不等防抖）', async () => {
    writeTextFileMock.mockResolvedValue({ ok: true });
    mockPreviewFetch();
    const view = renderPreview();
    await waitFor(() => expect(screen.getByText('编辑')).toBeTruthy());
    fireEvent.click(screen.getByText('编辑'));
    const editor = await waitFor(() => screen.getByTestId('mock-editor'));
    fireEvent.change(editor, { target: { value: '# check.md\n\nshortcut content\n' } });
    const body = document.querySelector('[class*="workspacePreviewBody"]') as HTMLElement;
    expect(body).toBeTruthy();
    fireEvent.keyDown(body, { key: 's', ctrlKey: true, bubbles: true, cancelable: true });
    await waitFor(() => expect(writeTextFileMock).toHaveBeenCalled(), { timeout: 300 });
    expect(String(writeTextFileMock.mock.calls[0][2])).toContain('shortcut content');
    void view;
  });
});
