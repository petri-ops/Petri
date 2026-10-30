import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ToolActivityDock } from './ToolActivityDock';
import { petriEvents, dispatchPetriEvent } from '@/lib/events';
import {
  __resetSubAgentTaskStoresForTests,
  recordModelSubAgent,
} from './conversationRunStore/subAgentTasks';

// 编排图内部是 @xyflow/react 画布（happy-dom 无布局）；这里只验 dock 的挂载契约。
vi.mock('@/components/workspace-panels/OrchestrationGraph', () => ({
  OrchestrationGraph: () => <div data-testid="orchestration-graph" />,
}));

const { listBackgroundProcesses, fetchProcessLogTail } = vi.hoisted(() => ({
  listBackgroundProcesses: vi.fn(),
  fetchProcessLogTail: vi.fn(),
}));

vi.mock('./backgroundProcesses', () => ({
  listBackgroundProcesses,
  fetchProcessLogTail,
}));

const runningProc = {
  processId: 'bg-1',
  pid: 4321,
  status: 'running' as const,
  command: 'node server.js',
  cwd: '.',
  startedAtIso: new Date().toISOString(),
  durationMs: 5000,
  exitCode: null,
  signal: null,
  logTail: 'listening on 3000\n',
  logTruncated: false,
  logSizeBytes: 18,
};

beforeEach(() => {
  vi.clearAllMocks();
  listBackgroundProcesses.mockResolvedValue([]);
  fetchProcessLogTail.mockResolvedValue({ ...runningProc });
  __resetSubAgentTaskStoresForTests();
});

afterEach(() => {
  cleanup();
});

describe('ToolActivityDock (UI-268 后台进程浮窗)', () => {
  it('renders nothing initially (no auto-pop on conversation open)', () => {
    render(<ToolActivityDock conversationId="conv-1" projectId="p-1" />);
    expect(screen.queryByTestId('tool-activity-dock')).toBeNull();
    expect(screen.queryByText(/后台进程/)).toBeNull();
  });

  it('opens on a matching background-process event and renders command + log tail', async () => {
    listBackgroundProcesses.mockResolvedValue([runningProc]);
    render(<ToolActivityDock conversationId="conv-1" projectId="p-1" />);
    act(() => {
      dispatchPetriEvent(petriEvents.agentBackgroundProcess, {
        processId: 'bg-1',
        conversationId: 'conv-1',
      });
    });
    await waitFor(() => {
      expect(screen.getByTestId('tool-activity-dock')).toBeTruthy();
    });
    await waitFor(() => {
      expect(screen.getByText(/listening on 3000/)).toBeTruthy();
    });
    expect(screen.getByText('node server.js')).toBeTruthy();
    expect(screen.getByText(/运行中/)).toBeTruthy();
    expect(listBackgroundProcesses).toHaveBeenCalledWith('conv-1', 'p-1');
  });

  it('ignores background-process events from other conversations', () => {
    render(<ToolActivityDock conversationId="conv-1" projectId="p-1" />);
    act(() => {
      dispatchPetriEvent(petriEvents.agentBackgroundProcess, {
        processId: 'bg-1',
        conversationId: 'conv-other',
      });
    });
    expect(screen.queryByTestId('tool-activity-dock')).toBeNull();
  });

  it('collapses to a chip and re-expands; stays hidden after close until a new event', async () => {
    listBackgroundProcesses.mockResolvedValue([runningProc]);
    const { rerender } = render(<ToolActivityDock conversationId="conv-1" projectId="p-1" />);
    act(() => {
      dispatchPetriEvent(petriEvents.agentBackgroundProcess, {
        processId: 'bg-1',
        conversationId: 'conv-1',
      });
    });
    await waitFor(() => {
      expect(screen.getByTestId('tool-activity-dock')).toBeTruthy();
    });

    // 折叠为图标钮（UI-268 改造：composer 内联图标，无可见文本）
    fireEvent.click(screen.getByTitle('折叠'));
    expect(screen.queryByTestId('tool-activity-dock')).toBeNull();
    expect(screen.getByTestId('tool-activity-dock-trigger')).toBeTruthy();

    // 折叠态重渲染不强拆
    rerender(<ToolActivityDock conversationId="conv-1" projectId="p-1" />);
    expect(screen.queryByTestId('tool-activity-dock')).toBeNull();
    expect(screen.getByTestId('tool-activity-dock-trigger')).toBeTruthy();

    // 图标钮展开
    fireEvent.click(screen.getByTestId('tool-activity-dock-trigger'));
    expect(screen.getByTestId('tool-activity-dock')).toBeTruthy();

    // 关闭后隐藏，新事件再弹出
    fireEvent.click(screen.getByTitle('关闭'));
    expect(screen.queryByTestId('tool-activity-dock')).toBeNull();
    expect(screen.queryByTestId('tool-activity-dock-trigger')).toBeNull();
    act(() => {
      dispatchPetriEvent(petriEvents.agentBackgroundProcess, {
        processId: 'bg-2',
        conversationId: 'conv-1',
      });
    });
    await waitFor(() => {
      expect(screen.getByTestId('tool-activity-dock')).toBeTruthy();
    });
  });

  it('resets to hidden when the conversation changes', async () => {
    listBackgroundProcesses.mockResolvedValue([runningProc]);
    const { rerender } = render(<ToolActivityDock conversationId="conv-1" projectId="p-1" />);
    act(() => {
      dispatchPetriEvent(petriEvents.agentBackgroundProcess, {
        processId: 'bg-1',
        conversationId: 'conv-1',
      });
    });
    await waitFor(() => {
      expect(screen.getByTestId('tool-activity-dock')).toBeTruthy();
    });
    rerender(<ToolActivityDock conversationId="conv-2" projectId="p-1" />);
    expect(screen.queryByTestId('tool-activity-dock')).toBeNull();
  });

  // UI-301/501 实机前置 — 纯 spawn 流（无后台进程）自动弹出时曾渲染空壳：
  // 0→>0 跳变只清 dismissed，showGraph 仍 false → body 条件一票否决。
  it('纯 spawn 流：自动弹出即渲染编排图，不出现空壳（标题也不再叫后台进程）', async () => {
    render(<ToolActivityDock conversationId="conv-spawn" projectId="p-1" />);
    act(() => {
      recordModelSubAgent('conv-spawn', 'p-1', 'task-child-1', '子任务 A');
    });
    await waitFor(() => {
      expect(screen.getByTestId('tool-activity-dock')).toBeTruthy();
    });
    expect(screen.getByTestId('orchestration-graph')).toBeTruthy();
    expect(screen.getByText('子智能体编排')).toBeTruthy();
    expect(screen.queryByText('后台进程')).toBeNull();
  });
});
