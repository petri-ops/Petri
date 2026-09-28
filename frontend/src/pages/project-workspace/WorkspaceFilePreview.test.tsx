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
  it('头部不再有 引用到对话/保存/恢复；md 切换为悬浮铅笔图标（无工具条行）', async () => {
    mockPreviewFetch();
    renderPreview();
    // 悬浮切换：预览态 aria-label=编辑（铅笔），点击进编辑器后变 aria-label=预览（眼睛）
    await waitFor(() => expect(screen.getByLabelText('编辑')).toBeTruthy());
    expect(document.querySelector('[class*="workspaceMarkdownDiffToolbar"]')).toBeNull();
    fireEvent.click(screen.getByLabelText('编辑'));
    await waitFor(() => expect(screen.getByTestId('mock-editor')).toBeTruthy());
    expect(screen.queryByText('引用到对话')).toBeNull();
    expect(screen.queryByText('保存')).toBeNull();
    expect(screen.queryByText('恢复')).toBeNull();
    expect(screen.getByLabelText('预览')).toBeTruthy();
    // 回预览：眼睛点回去，编辑器卸载
    fireEvent.click(screen.getByLabelText('预览'));
    await waitFor(() => expect(screen.queryByTestId('mock-editor')).toBeNull());
  });

  it('自动保存：编辑停顿 ~1.2s 后调用保存链（writeTextFile 收到新内容）', async () => {
    writeTextFileMock.mockResolvedValue({ ok: true });
    mockPreviewFetch();
    renderPreview();
    await waitFor(() => expect(screen.getByLabelText('编辑')).toBeTruthy());
    fireEvent.click(screen.getByLabelText('编辑'));
    await new Promise((r) => setTimeout(r, 300));
    if (!document.querySelector('[data-testid="mock-editor"]')) {
      console.log('DIAG-HTML', document.body.innerHTML.slice(0, 1200));
    }
    const editor = await waitFor(() => screen.getByTestId('mock-editor'));
    fireEvent.change(editor, { target: { value: '# check.md\n\nautosave marker\n' } });
    // 防抖窗口内不应立即保存
    expect(writeTextFileMock).not.toHaveBeenCalled();
    await waitFor(() => expect(writeTextFileMock).toHaveBeenCalled(), { timeout: 3000 });
    const [dir, path, content] = writeTextFileMock.mock.calls[0] as [unknown, string, string];
    expect(path).toBe('check.md');
    expect(String(content)).toContain('autosave marker');
    void dir;
  });

  it('Ctrl+S：立即保存（不等防抖）', async () => {
    writeTextFileMock.mockResolvedValue({ ok: true });
    mockPreviewFetch();
    const view = renderPreview();
    await waitFor(() => expect(screen.getByLabelText('编辑')).toBeTruthy());
    fireEvent.click(screen.getByLabelText('编辑'));
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

// BLOCK-67 实机回归 — 「点击 md 白屏」：hooks 位于 `if (!file)` 提前返回之后，
// 无文件 → 打开文件的首次重渲染 Hook 数变化，React 抛 "Rendered more hooks" 整窗白屏。
// 本用例锁死该顺序：同一次挂载内 file 从 null → 有值 必须不抛错且能渲染编辑器。
describe('UI-323 回归修复：file=null → file 转换不破坏 Hook 顺序', () => {
  it('先以 file=null 渲染，再打开 md 文件：不抛 Hook 顺序错误且预览可用', async () => {
    mockPreviewFetch();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const view = render(
      <ThemeProvider>
        <WorkspaceFilePreview
          file={null}
          refreshVersion={0}
          openError=""
          opening={false}
          onOpen={() => {}}
          onDownload={() => {}}
          projectId="p_x"
        />
      </ThemeProvider>,
    );
    expect(screen.getByText('选择一个文本、图片或 PDF 文件预览')).toBeTruthy();

    view.rerender(
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
    await waitFor(() => expect(screen.getByLabelText('编辑')).toBeTruthy());
    // 关键断言：重渲染期间没有 "Rendered more hooks" 类错误
    const hookErrors = errorSpy.mock.calls
      .map((c) => String(c[0] || ''))
      .filter((t) => /hooks|Rendered more/.test(t));
    expect(hookErrors).toEqual([]);
    errorSpy.mockRestore();
  });

  it('反向转换（file → null）同样不抛错', async () => {
    mockPreviewFetch();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const view = render(
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
    await waitFor(() => expect(screen.getByLabelText('编辑')).toBeTruthy());
    view.rerender(
      <ThemeProvider>
        <WorkspaceFilePreview
          file={null}
          refreshVersion={0}
          openError=""
          opening={false}
          onOpen={() => {}}
          onDownload={() => {}}
          projectId="p_x"
        />
      </ThemeProvider>,
    );
    expect(screen.getByText('选择一个文本、图片或 PDF 文件预览')).toBeTruthy();
    const hookErrors = errorSpy.mock.calls
      .map((c) => String(c[0] || ''))
      .filter((t) => /hooks|Rendered more/.test(t));
    expect(hookErrors).toEqual([]);
    errorSpy.mockRestore();
  });
});

// UI-400-6 补——MD 目录双重回归：
// ① 点击不导航：跳转曾按字面量类名 `.workspaceMarkdownPreview` 查 DOM，CSS Modules 哈希后
//    （dist 实测 `workspaceMarkdownPreview_1nxrm_6588`）零匹配；现跳转经 mdPreviewRef 直接查 h1-h3。
// ② 浮层遮挡正文：目录展开时正文挂 TocGutter 让位类，收起后浮层与让位类一并消失。
describe('UI-400-6 补：MD 目录点击跳转与正文避让', () => {
  it('目录条目解析自源码（围栏伪标题不进目录）；点击条目经 ref 查询精确滚动到对应标题', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('# 标题一\n\n正文\n\n```sh\n# 不是标题\n```\n\n## 标题二\n\n内容\n', { status: 200 }))),
    );
    renderPreview();
    await waitFor(() => expect(screen.getByTitle('标题一')).toBeTruthy());
    expect(screen.getByTitle('标题二')).toBeTruthy();
    expect(screen.queryByTitle('不是标题')).toBeNull();

    const h1 = document.querySelector('h1') as HTMLElement;
    const h2 = document.querySelector('h2') as HTMLElement;
    const scrollH1 = vi.fn();
    const scrollH2 = vi.fn();
    h1.scrollIntoView = scrollH1;
    h2.scrollIntoView = scrollH2;
    fireEvent.click(screen.getByTitle('标题二'));
    expect(scrollH2).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
    expect(scrollH1).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTitle('标题一'));
    expect(scrollH1).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
  });

  it('目录展开时正文挂 TocGutter 让位类；收起后浮层消失、让位类移除', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('# 标题一\n\n正文\n\n## 标题二\n\n内容\n', { status: 200 }))),
    );
    renderPreview();
    await waitFor(() => expect(screen.getByTitle('标题一')).toBeTruthy());
    expect(document.querySelector('[class*="workspaceMarkdownPreviewTocGutter"]')).toBeTruthy();
    fireEvent.click(screen.getByTestId('md-toc-toggle'));
    expect(screen.queryByTitle('标题一')).toBeNull();
    expect(document.querySelector('[class*="workspaceMarkdownPreviewTocGutter"]')).toBeNull();
    // 再展开恢复
    fireEvent.click(screen.getByTestId('md-toc-toggle'));
    expect(screen.getByTitle('标题一')).toBeTruthy();
    expect(document.querySelector('[class*="workspaceMarkdownPreviewTocGutter"]')).toBeTruthy();
  });
});
