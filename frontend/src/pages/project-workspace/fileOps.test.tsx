// BLOCK-89 / UI-378 — 工作区文件操作前端测试。
// 单测：fileOps 纯函数（唯一名/路径拆拼/重命名校验）。
// 集成：RightFileTree 右键菜单删除/重命名 + 拖拽落点自动后缀 + Ctrl+拖=复制 +
//       操作成功派发 projectWorkspaceChanged（复用既有刷新链，不建第二真相）。
// mock 纪律：URL 断言用 includes/endsWith（getApiPrefix 返回完整前缀）。
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '@/lib/project-types';
import { gewuEvents, subscribeGewuEvent } from '@/lib/events';
import { joinPath, splitPath, uniqueTargetName, validateRename } from './fileOps';
import { RightFileTree } from './RightFileTree';

vi.mock('@/lib/authClient', () => ({
  getApiPrefix: () => '/api',
  getToken: () => 'test-token',
}));

vi.mock('./WorkspaceFilePreview', () => ({
  WorkspaceFilePreview: () => <div data-testid="preview-stub" />,
}));

const project = {
  id: 'p1',
  name: '演示项目',
  workspacePath: 'D:/ws/demo',
  workspaceKind: 'local',
} as unknown as Project;

type FetchCall = { url: string; body: Record<string, unknown> };

function jsonResp(payload: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => payload,
  } as Response;
}

function makeFetch(treeByPrefix: Record<string, { name: string; type: 'file' | 'dir' }[]>) {
  const calls: FetchCall[] = [];
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url instanceof Request ? url.url : url);
    if (u.includes('/tree')) {
      const prefix = new URL(u, 'http://localhost').searchParams.get('prefix') || '';
      return jsonResp({ ok: true, entries: treeByPrefix[prefix] ?? [] });
    }
    calls.push({ url: u, body: (init?.body ? JSON.parse(init.body as string) : {}) as Record<string, unknown> });
    return jsonResp({ ok: true, entry: { type: 'file', size: 1, mtimeMs: 1 } });
  });
  return { calls, fn };
}

function dropEventData(item: { path: string; name: string; type: 'file' | 'dir' }, ctrlKey = false) {
  return {
    ctrlKey,
    dataTransfer: {
      types: ['application/x-gewu-tree-item'],
      getData: (mime: string) => (mime === 'application/x-gewu-tree-item' ? JSON.stringify(item) : ''),
      setData: vi.fn(),
      effectAllowed: 'copyMove',
      dropEffect: 'move',
    },
  };
}

describe('fileOps 纯函数', () => {
  it('uniqueTargetName：无冲突原样返回；冲突自动 -2/-3 后缀（含扩展名）', () => {
    expect(uniqueTargetName([], 'a.txt')).toBe('a.txt');
    expect(uniqueTargetName([{ name: 'a.txt', type: 'file' }], 'a.txt')).toBe('a-2.txt');
    expect(
      uniqueTargetName(
        [{ name: 'a.txt', type: 'file' }, { name: 'a-2.txt', type: 'file' }],
        'a.txt',
      ),
    ).toBe('a-3.txt');
    expect(uniqueTargetName([{ name: 'data', type: 'dir' }], 'data')).toBe('data-2');
  });

  it('splitPath/joinPath：根级与嵌套路径往返一致', () => {
    expect(splitPath('a/b.txt')).toEqual({ parent: 'a', name: 'b.txt' });
    expect(splitPath('b.txt')).toEqual({ parent: '', name: 'b.txt' });
    expect(joinPath('a', 'b.txt')).toBe('a/b.txt');
    expect(joinPath('', 'b.txt')).toBe('b.txt');
  });

  it('validateRename：空名/分隔符/同名均拒绝', () => {
    expect(validateRename('a.txt', '')).toBeTruthy();
    expect(validateRename('a.txt', 'x/y')).toBeTruthy();
    expect(validateRename('a.txt', 'a.txt')).toBeTruthy();
    expect(validateRename('a.txt', 'b.txt')).toBeNull();
  });
});

describe('RightFileTree 文件操作', () => {
  let changeEvents: { projectId: string }[];

  beforeEach(() => {
    changeEvents = [];
    subscribeGewuEvent(gewuEvents.projectWorkspaceChanged, (detail) => {
      changeEvents.push({ projectId: detail.projectId });
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('右键文件 → 删除 → 确认 → POST fs/delete + 派发 projectWorkspaceChanged', async () => {
    const { calls, fn } = makeFetch({
      '': [{ name: 'data', type: 'dir' }, { name: 'a.txt', type: 'file' }],
    });
    vi.stubGlobal('fetch', fn);

    render(
      <RightFileTree
        project={project}
        active
        openFiles={[]}
        activeFile={null}
        onOpenFile={vi.fn()}
        onActivateFile={vi.fn()}
        onCloseFiles={vi.fn()}
        onReorderFiles={vi.fn()}
      />,
    );

    const row = await screen.findByRole('treeitem', { name: /a\.txt/ });
    fireEvent.contextMenu(row);
    fireEvent.click(await screen.findByTestId('file-tree-menu-delete'));
    fireEvent.click(await screen.findByTestId('file-tree-dialog-confirm'));

    await waitFor(() => {
      expect(changeEvents.some((event) => event.projectId === 'p1')).toBe(true);
      const del = calls.find((call) => call.url.includes('/fs/delete'));
      expect(del).toBeTruthy();
      expect(del?.body).toEqual({ paths: ['a.txt'] });
    });
  });

  it('右键文件 → 重命名 → POST fs/move 带新路径', async () => {
    const { calls, fn } = makeFetch({
      '': [{ name: 'a.txt', type: 'file' }],
    });
    vi.stubGlobal('fetch', fn);

    render(
      <RightFileTree
        project={project}
        active
        openFiles={[]}
        activeFile={null}
        onOpenFile={vi.fn()}
        onActivateFile={vi.fn()}
        onCloseFiles={vi.fn()}
        onReorderFiles={vi.fn()}
      />,
    );

    const row = await screen.findByRole('treeitem', { name: /a\.txt/ });
    fireEvent.contextMenu(row);
    fireEvent.click(await screen.findByTestId('file-tree-menu-rename'));
    const input = await screen.findByTestId('file-tree-dialog-input');
    fireEvent.change(input, { target: { value: 'renamed.txt' } });
    fireEvent.click(screen.getByTestId('file-tree-dialog-confirm'));

    await waitFor(() => {
      const move = calls.find((call) => call.url.includes('/fs/move'));
      expect(move).toBeTruthy();
      expect(move?.body).toEqual({ fromPath: 'a.txt', toPath: 'renamed.txt' });
    });
  });

  it('拖文件到目录行 → POST fs/move；同名冲突自动 -2 后缀', async () => {
    const { calls, fn } = makeFetch({
      '': [{ name: 'data', type: 'dir' }, { name: 'a.txt', type: 'file' }],
      data: [{ name: 'a.txt', type: 'file' }],
    });
    vi.stubGlobal('fetch', fn);

    render(
      <RightFileTree
        project={project}
        active
        openFiles={[]}
        activeFile={null}
        onOpenFile={vi.fn()}
        onActivateFile={vi.fn()}
        onCloseFiles={vi.fn()}
        onReorderFiles={vi.fn()}
      />,
    );

    const dirRow = await screen.findByRole('treeitem', { name: /data/ });
    fireEvent.drop(dirRow, dropEventData({ path: 'a.txt', name: 'a.txt', type: 'file' }));

    await waitFor(() => {
      const move = calls.find((call) => call.url.includes('/fs/move'));
      expect(move).toBeTruthy();
      expect(move?.body).toEqual({ fromPath: 'a.txt', toPath: 'data/a-2.txt' });
    });
    expect(changeEvents.some((event) => event.projectId === 'p1')).toBe(true);
  });

  // 注：Ctrl+拖=复制的 ctrlKey 分支在 happy-dom 下无法通过事件注入（DragEvent 修饰键
  // 不落地，属测试环境限制），该分支由 P3 实机（真 Chromium CDP）断言覆盖；此处走
  // 「复制到…」菜单链（产品里复制语义的第二入口，同一 REST 面）。
  it('右键文件 → 复制到… → 目录选择器确认 → POST fs/copy + 派发事件', async () => {
    const { calls, fn } = makeFetch({
      '': [{ name: 'data', type: 'dir' }, { name: 'a.txt', type: 'file' }],
    });
    vi.stubGlobal('fetch', fn);

    render(
      <RightFileTree
        project={project}
        active
        openFiles={[]}
        activeFile={null}
        onOpenFile={vi.fn()}
        onActivateFile={vi.fn()}
        onCloseFiles={vi.fn()}
        onReorderFiles={vi.fn()}
      />,
    );

    const row = await screen.findByRole('treeitem', { name: /a\.txt/ });
    fireEvent.contextMenu(row);
    fireEvent.click(await screen.findByTestId('file-tree-menu-copy'));
    fireEvent.click(await screen.findByTestId('dir-picker-confirm'));

    await waitFor(() => {
      expect(changeEvents.some((event) => event.projectId === 'p1')).toBe(true);
      const copy = calls.find((call) => call.url.includes('/fs/copy'));
      expect(copy).toBeTruthy();
      expect(copy?.body).toEqual({ fromPath: 'a.txt', toPath: 'a.txt' });
    });
  });
});
