// UI-404 — AgentRunPanel 分区折叠与父会话标注组件测试
// fetch/meta/SSE 全 mock（不发真实网络）。
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentRunPanel } from './AgentRunPanel';

const { subscribeMock, metaMock } = vi.hoisted(() => ({
  subscribeMock: vi.fn(),
  metaMock: vi.fn(),
}));

vi.mock('@/components/copilot/copilotClient', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/components/copilot/copilotClient')>();
  return {
    ...original,
    subscribeAgentTask: subscribeMock,
    fetchAgentTaskMeta: metaMock,
    cancelAgentTask: vi.fn(),
    sendAgentTaskMessage: vi.fn(),
    followupAgentTask: vi.fn(),
  };
});

function metaPayload(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    taskId: 'task-1',
    status: 'completed',
    taskText: '请写一首关于秋天的四行短诗。（标记 1788681338458-C）',
    conversationId: 'conv_1',
    conversationTitle: '会话甲',
    ...overrides,
  };
}

beforeEach(() => {
  subscribeMock.mockReset();
  subscribeMock.mockResolvedValue(() => {});
  metaMock.mockReset();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('UI-404 AgentRunPanel 分区折叠', () => {
  it('终态任务：操作与实时工作流默认收起，时间线标题带调用计数；头部展示任务全文与父会话', async () => {
    metaMock.mockResolvedValue(metaPayload());
    render(<AgentRunPanel runId="task-1" />);
    await waitFor(() => expect(screen.getByTestId('agent-parent-conversation')).toBeTruthy());
    // 头部：任务全文（不截断）+ 父会话标注
    expect(screen.getByTitle(/请写一首关于秋天的四行短诗/).textContent).toContain('标记 1788681338458-C');
    expect(screen.getByTestId('agent-parent-conversation').textContent).toContain('父会话：会话甲');
    // 默认收起：aria-expanded=false，内容不可见
    const toggles = screen.getAllByRole('button', { name: /操作|实时工作流/ });
    expect(toggles.length).toBe(2);
    for (const t of toggles) expect(t.getAttribute('aria-expanded')).toBe('false');
    // 时间线收起态标题仍带计数摘要
    expect(screen.getByTestId('agent-timeline-title').textContent).toContain('0 次调用');
    // 中断按钮（运行中才渲染）不存在 → 操作内容确已收起
    expect(screen.queryByRole('button', { name: '中断' })).toBeNull();
    expect(screen.queryByText(/给这个 agent 留言/)).toBeNull();
  });

  it('终态任务点击标题展开操作区（内容可见，含继续派）', async () => {
    metaMock.mockResolvedValue(metaPayload());
    render(<AgentRunPanel runId="task-1" />);
    await waitFor(() => expect(screen.getByTestId('agent-parent-conversation')).toBeTruthy());
    const actionsToggle = screen.getAllByRole('button', { name: /操作/ })[0];
    fireEvent.click(actionsToggle);
    await waitFor(() => expect(actionsToggle.getAttribute('aria-expanded')).toBe('true'));
    expect(screen.getByPlaceholderText(/追加新任务（基于前情续派/)).toBeTruthy();
  });

  it('运行中任务：操作与实时工作流默认展开', async () => {
    metaMock.mockResolvedValue(metaPayload({ status: 'running' }));
    render(<AgentRunPanel runId="task-1" />);
    await waitFor(() => expect(screen.getByRole('button', { name: /中断/ })).toBeTruthy());
    const toggles = screen.getAllByRole('button', { name: /操作|实时工作流/ });
    for (const t of toggles) expect(t.getAttribute('aria-expanded')).toBe('true');
  });

  it('时间线计数：失败/被拒调用计入「异常」摘要', async () => {
    metaMock.mockResolvedValue(metaPayload());
    subscribeMock.mockImplementation((_taskId: string, handlers: Record<string, (e: unknown) => void>) => {
      handlers.onToolCall?.({ name: 'workspace_exec', callId: 'c1' });
      handlers.onToolResult?.({ name: 'workspace_exec', callId: 'c1', toolResult: { callId: 'c1', tool: 'workspace_exec', status: 'denied', durationMs: 100 } });
      handlers.onToolCall?.({ name: 'read_page', callId: 'c2' });
      handlers.onToolResult?.({ name: 'read_page', callId: 'c2', toolResult: { callId: 'c2', tool: 'read_page', status: 'success', durationMs: 50 } });
      return Promise.resolve(() => {});
    });
    render(<AgentRunPanel runId="task-1" />);
    await waitFor(() => {
      expect(screen.getByTestId('agent-timeline-title').textContent).toContain('2 次调用 · 1 异常');
    });
  });

  it('UI-431 P3 同构呈现：事件折叠为段模型，面板渲染与主窗同套 Qoder 时间线', async () => {
    metaMock.mockResolvedValue(metaPayload());
    subscribeMock.mockImplementation((_taskId: string, handlers: Record<string, (e: unknown) => void>) => {
      handlers.onIter?.(1);
      handlers.onAgentProgress?.({ iteration: 1, content: '先列出目录结构' });
      handlers.onReasoning?.('先看一眼目录');
      handlers.onToolCall?.({ name: 'workspace_list', callId: 'c1', iteration: 1 });
      handlers.onToolResult?.({ name: 'workspace_list', callId: 'c1', toolResult: { callId: 'c1', tool: 'workspace_list', status: 'success', durationMs: 12 } });
      return Promise.resolve(() => {});
    });
    render(<AgentRunPanel runId="task-1" />);
    await waitFor(() => {
      expect(screen.getByTestId('agent-timeline-title').textContent).toContain('1 次调用');
    });
    fireEvent.click(screen.getByRole('button', { name: /实时工作流/ }));
    // Qoder 形态三件套：合并簇头（计数式）+ 过渡叙述（状态行同文案，故用 getAll）+ 簇体
    // UI-437 v2 — 无簇头摘要；事件以 Qoder 单行呈现
    expect(document.querySelectorAll('.sc-tool-qoder-row').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/先列出目录结构/).length).toBeGreaterThanOrEqual(1);
    // UI-437 — 完成簇行默认常驻可见，无需点击簇头展开；思考行只留标签，点行看正文
    expect(screen.getByTestId('qoder-cluster-body')).toBeTruthy();
    expect(screen.getByText('已思考')).toBeTruthy();
    expect(screen.queryByText(/先看一眼目录/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '展开 已思考' }));
    expect(screen.getByText(/先看一眼目录/)).toBeTruthy();
  });
});
