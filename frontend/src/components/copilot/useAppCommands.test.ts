// BLOCK-171 CP-3 — 命令面板真命令源契约（五类源/数量下限/会话预选交接）。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook, act } from '@testing-library/react';

const { listProjectsMock, listConversationsMock, fetchSlashEntriesMock } = vi.hoisted(() => ({
  listProjectsMock: vi.fn(),
  listConversationsMock: vi.fn(),
  fetchSlashEntriesMock: vi.fn(),
}));

vi.mock('./copilotConversationsClient', () => ({
  listConversations: listConversationsMock,
}));
vi.mock('@/lib/project-store', () => ({
  listProjects: listProjectsMock,
}));
vi.mock('./SimpleChat/slashSources', () => ({
  fetchSlashEntries: fetchSlashEntriesMock,
}));

import { useAppCommands } from './useAppCommands';

function makeArgs(enabled = true) {
  return {
    enabled,
    navigate: vi.fn(),
    currentProjectId: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  listProjectsMock.mockResolvedValue([
    { id: 'p1', name: 'PBMC 实战' },
    { id: 'p2', name: ' bulk 主链 ' },
  ]);
  listConversationsMock.mockResolvedValue([
    { id: 'conv1', title: 'DESeq2 差异分析', project_id: 'p1' },
    { id: 'conv2', title: 'GSEA 富集', project_id: 'p2' },
  ]);
  fetchSlashEntriesMock.mockResolvedValue([
    { kind: 'skill', id: 'coding-playbook', label: 'coding-playbook', description: '通用编码手册' },
    { kind: 'skill', id: 'visualize', label: 'visualize', description: '会话内可视化' },
  ]);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('useAppCommands（BLOCK-171 CP-3）', () => {
  it('面板打开时拉取三源并产出 ≥15 条命令（含导航/项目/技能/设置深链四类 action 源）', async () => {
    const { result } = renderHook((props: Parameters<typeof useAppCommands>[0]) => useAppCommands(props), {
      initialProps: makeArgs(true),
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const commands = result.current.commands;
    expect(commands.length).toBeGreaterThanOrEqual(15);
    const ids = commands.map((c) => c.id);
    expect(ids.some((id) => id.startsWith('nav-'))).toBe(true);
    expect(ids.some((id) => id.startsWith('project:'))).toBe(true);
    expect(ids.some((id) => id.startsWith('skill:'))).toBe(true);
    expect(ids.filter((id) => id.startsWith('settings:')).length).toBeGreaterThanOrEqual(5);
    expect(result.current.recentConversations.length).toBe(2);
  });

  it('导航命令 action 调 navigate；设置深链带 ?section=', async () => {
    const args = makeArgs(true);
    const { result } = renderHook((props: Parameters<typeof useAppCommands>[0]) => useAppCommands(props), {
      initialProps: args,
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const nav = commands_action(result.current.commands, 'nav-projects');
    nav();
    expect(args.navigate).toHaveBeenCalledWith('/projects');
    const deep = commands_action(result.current.commands, 'settings:decisions');
    deep();
    expect(args.navigate).toHaveBeenCalledWith('/settings?section=decisions');
  });

  it('selectConversation：写 sessionStorage 预选并跳工作区；无归属会话零动作', async () => {
    const args = makeArgs(true);
    const { result } = renderHook((props: Parameters<typeof useAppCommands>[0]) => useAppCommands(props), {
      initialProps: args,
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    result.current.selectConversation({ id: 'conv1', title: 'DESeq2', project_id: 'p1' } as never);
    expect(JSON.parse(sessionStorage.getItem('petri.conversationPreselect') || '{}')).toEqual({ conversationId: 'conv1' });
    expect(args.navigate).toHaveBeenCalledWith('/project/p1/chat');

    args.navigate.mockClear();
    result.current.selectConversation({ id: 'conv_x', title: '无归属', project_id: null } as never);
    expect(args.navigate).not.toHaveBeenCalled();
  });

  it('enabled=false 不拉取任何数据源', async () => {
    renderHook((props: Parameters<typeof useAppCommands>[0]) => useAppCommands(props), {
      initialProps: makeArgs(false),
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(listProjectsMock).not.toHaveBeenCalled();
    expect(listConversationsMock).not.toHaveBeenCalled();
    expect(fetchSlashEntriesMock).not.toHaveBeenCalled();
  });
});

function commands_action(commands: Array<{ id: string; action: () => void }>, id: string): () => void {
  const found = commands.find((c) => c.id === id);
  if (!found) throw new Error(`command not found: ${id}`);
  return found.action;
}
