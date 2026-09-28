import React from 'react';
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { gewuEvents, dispatchGewuEvent } from '@/lib/events';
import type { Project } from '@/lib/project-types';
import type { ActiveWorkspaceFile } from './types';

// UI-399 回归 — 切换文件不得触发整树重拉。
// 根因历史：refreshFiles 闭包捕获 activeFile?.path → 切文件改其身份 →
// 初始加载 effect 重跑（setLoading(true) 闪屏 + 整树重拉 + refreshVersion++
// 令所有已展开目录重新 loadDir）——ssh 项目下每次点开文件都是 N 个目录的网络往返。

const treeCalls: string[] = [];

globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (url.includes('/tree')) {
    treeCalls.push(url);
    return new Response(JSON.stringify({
      ok: true,
      entries: [
        { name: 'a.txt', type: 'file', path: 'a.txt', size: 10, modifiedAt: 1700000000000 },
        { name: 'src', type: 'dir', path: 'src' },
      ],
      total: 2,
      truncated: false,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
  return new Response(JSON.stringify({ ok: true }), { status: 200 });
});

vi.mock('@/lib/desktopBridge', () => ({ getBridge: () => null }));
vi.mock('./WorkspaceFilePreview', () => ({ WorkspaceFilePreview: () => <div>preview</div> }));
vi.mock('./FileTreeList', () => ({ FileTreeList: () => <div>tree-rows</div> }));

import { RightFileTree } from './RightFileTree';

function makeProject(): Project {
  return {
    id: 'p_ssh1',
    name: 'ssh 项目',
    createdAt: '2026-09-17T00:00:00Z',
    updatedAt: '2026-09-17T00:00:00Z',
    workspaceKind: 'ssh',
    sshHost: 'wsl',
    workspacePath: '/home/devah/proj',
  };
}

function makeFile(name: string): ActiveWorkspaceFile {
  return {
    name,
    path: `src/${name}`,
    url: `http://mock/workspaces/p_ssh1/file?path=src/${name}`,
  };
}

function renderTree(activeFile: ActiveWorkspaceFile | null) {
  return render(
    <RightFileTree
      project={makeProject()}
      active
      openFiles={activeFile ? [activeFile] : []}
      activeFile={activeFile}
      onOpenFile={() => {}}
      onActivateFile={() => {}}
      onCloseFiles={() => {}}
      onReorderFiles={() => {}}
      onRenameFile={() => {}}
    />
  );
}

afterEach(() => {
  cleanup();
  treeCalls.length = 0;
  vi.clearAllMocks();
});

describe('RightFileTree 刷新触发面 (UI-399)', () => {
  it('切换活动文件不触发树请求；projectWorkspaceChanged 才触发', async () => {
    // 挂载即两次根拉取（初始加载 effect + 面板激活 effect，既有行为，幂等无害）
    const view = renderTree(null);
    await waitFor(() => expect(treeCalls.length).toBe(2), { timeout: 2000 });

    // 点击文件 A：树请求计数不得增长（旧行为会 +2：根分页 + 签名目录）
    view.rerender(
      <RightFileTree
        project={makeProject()}
        active
        openFiles={[makeFile('a.txt')]}
        activeFile={makeFile('a.txt')}
        onOpenFile={() => {}}
        onActivateFile={() => {}}
        onCloseFiles={() => {}}
        onReorderFiles={() => {}}
        onRenameFile={() => {}}
      />
    );
    await new Promise((r) => setTimeout(r, 60));
    expect(treeCalls.length).toBe(2);

    // 切到文件 B：同样不刷新
    view.rerender(
      <RightFileTree
        project={makeProject()}
        active
        openFiles={[makeFile('a.txt'), makeFile('b.txt')]}
        activeFile={makeFile('b.txt')}
        onOpenFile={() => {}}
        onActivateFile={() => {}}
        onCloseFiles={() => {}}
        onReorderFiles={() => {}}
        onRenameFile={() => {}}
      />
    );
    await new Promise((r) => setTimeout(r, 60));
    expect(treeCalls.length).toBe(2);

    // agent 写档广播：树刷新恢复（根分页 + 活动文件签名目录 = 2 次）
    dispatchGewuEvent(gewuEvents.projectWorkspaceChanged, { projectId: 'p_ssh1', source: 'agent' });
    await waitFor(() => expect(treeCalls.length).toBe(4), { timeout: 2000 });
    expect(treeCalls[2]).toContain('prefix=');
    expect(treeCalls[3]).toContain('prefix=src');
  });
});
