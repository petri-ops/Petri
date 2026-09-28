// UI-451 加映 v2 (P2-2) — 文件 tab 键盘快捷键定向测试：
// Ctrl/Cmd+W 关当前 tab（复用脏确认链，非脏直接关）；Ctrl+Tab/Ctrl+Shift+Tab 循环切换；
// 面板非激活不响应；焦点在 xterm 内让位（readline Ctrl+W=删词）。

import React from 'react';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '@/lib/project-types';
import type { ActiveWorkspaceFile } from './types';

globalThis.fetch = vi.fn(() => Promise.resolve(new Response(
  JSON.stringify({ ok: true, entries: [], total: 0, truncated: false }),
  { status: 200, headers: { 'Content-Type': 'application/json' } },
)));

vi.mock('@/lib/desktopBridge', () => ({ getBridge: () => null }));
vi.mock('./WorkspaceFilePreview', () => ({ WorkspaceFilePreview: () => <div>preview</div> }));
vi.mock('./FileTreeList', () => ({ FileTreeList: () => <div>tree-rows</div> }));

import { RightFileTree } from './RightFileTree';

function makeProject(): Project {
  return {
    id: 'p1',
    name: '项目',
    createdAt: '2026-09-28T00:00:00Z',
    updatedAt: '2026-09-28T00:00:00Z',
    workspaceKind: 'local',
    workspacePath: 'D:/ws',
  };
}

function file(path: string): ActiveWorkspaceFile {
  return { path, name: path.split('/').pop() || path, url: `http://mock/${path}` };
}

const A = file('src/a.txt');
const B = file('src/b.md');
const C = file('src/c.json');

function pressKey(key: string, opts: { ctrl?: boolean; meta?: boolean; shift?: boolean } = {}) {
  fireEvent(window, new KeyboardEvent('keydown', {
    key, bubbles: true, cancelable: true,
    ctrlKey: !!opts.ctrl, metaKey: !!opts.meta, shiftKey: !!opts.shift,
  }));
}

function renderTree(overrides?: { active?: boolean }) {
  const props = {
    onCloseFiles: vi.fn(),
    onActivateFile: vi.fn(),
    onReopenFile: vi.fn(),
  };
  const view = render(
    <RightFileTree
      project={makeProject()}
      active={overrides?.active ?? true}
      openFiles={[A, B, C]}
      activeFile={C}
      onOpenFile={vi.fn()}
      onActivateFile={props.onActivateFile}
      onCloseFiles={props.onCloseFiles}
      onReorderFiles={vi.fn()}
      onRenameFile={vi.fn()}
      onReopenFile={props.onReopenFile}
    />,
  );
  return { view, props };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('UI-451 v2 文件 tab 快捷键', () => {
  it('Ctrl+W：关闭活动 tab（非脏 → 直接 onCloseFiles）', async () => {
    const { props } = renderTree();
    await waitFor(() => expect(document.querySelector('[data-testid="file-tab-strip"]')).toBeTruthy());
    pressKey('w', { ctrl: true });
    expect(props.onCloseFiles).toHaveBeenCalledWith(['src/c.json']);
    expect(document.querySelector('[data-testid="file-tab-close-dialog"]')).toBeNull();
  });

  it('Cmd+W（mac 等价）同样关闭活动 tab', async () => {
    const { props } = renderTree();
    await waitFor(() => expect(document.querySelector('[data-testid="file-tab-strip"]')).toBeTruthy());
    pressKey('w', { meta: true });
    expect(props.onCloseFiles).toHaveBeenCalledWith(['src/c.json']);
  });

  it('Ctrl+Tab：切到下一个；Ctrl+Shift+Tab：切到上一个（传数组既有对象）', async () => {
    const { props } = renderTree();
    await waitFor(() => expect(document.querySelector('[data-testid="file-tab-strip"]')).toBeTruthy());
    pressKey('Tab', { ctrl: true });
    expect(props.onActivateFile).toHaveBeenCalledTimes(1);
    expect(props.onActivateFile.mock.calls[0][0]).toBe(A);
    pressKey('Tab', { ctrl: true, shift: true });
    expect(props.onActivateFile).toHaveBeenCalledTimes(2);
    expect(props.onActivateFile.mock.calls[1][0]).toBe(B);
  });

  it('面板非激活（active=false）不响应', async () => {
    const { props } = renderTree({ active: false });
    await new Promise((r) => setTimeout(r, 50));
    pressKey('w', { ctrl: true });
    pressKey('Tab', { ctrl: true });
    expect(props.onCloseFiles).not.toHaveBeenCalled();
    expect(props.onActivateFile).not.toHaveBeenCalled();
  });

  it('Ctrl+Shift+T：重开最近关闭的 tab（UI-451 v3 Minor）', async () => {
    const { props } = renderTree();
    await waitFor(() => expect(document.querySelector('[data-testid="file-tab-strip"]')).toBeTruthy());
    pressKey('t', { ctrl: true, shift: true });
    expect(props.onReopenFile).toHaveBeenCalledTimes(1);
  });

  it('焦点在 xterm 内让位：不关 tab 不切换', async () => {
    const { props } = renderTree();
    await waitFor(() => expect(document.querySelector('[data-testid="file-tab-strip"]')).toBeTruthy());
    const term = document.createElement('div');
    term.className = 'xterm';
    const input = document.createElement('input');
    term.appendChild(input);
    document.body.appendChild(term);
    input.focus();
    expect(document.activeElement).toBe(input);
    pressKey('w', { ctrl: true });
    pressKey('Tab', { ctrl: true });
    expect(props.onCloseFiles).not.toHaveBeenCalled();
    expect(props.onActivateFile).not.toHaveBeenCalled();
    term.remove();
  });
});
