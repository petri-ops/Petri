import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ToolActivityDock, type ToolActivityDockGroup } from './ToolActivityDock';
import type { ToolActivityItem } from './toolActivity';
import { biof3Events, dispatchBioF3Event } from '@/lib/events';

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

function activity(
  status: ToolActivityItem['status'],
  name = 'run_tool'
): ToolActivityItem {
  return {
    key: `${name}:${status}`,
    name,
    status,
    actionLabel: '已运行',
    actionDetail: 'deseq2',
  };
}

function group(
  id: string,
  label: string,
  statuses: ToolActivityItem['status'][]
): ToolActivityDockGroup {
  return {
    id,
    label,
    activities: statuses.map((status, index) => ({
      ...activity(status),
      key: `${id}:${index}:${status}`,
    })),
    processingDurationMs: 3900,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  listBackgroundProcesses.mockResolvedValue([]);
  fetchProcessLogTail.mockResolvedValue({ ...runningProc });
});

afterEach(() => {
  cleanup();
});

describe('ToolActivityDock (BLOCK-36)', () => {
  it('renders nothing initially even with history groups (no auto-pop on conversation open)', () => {
    render(
      <ToolActivityDock
        conversationId="conv-1"
        projectId="p-1"
        groups={[group('g-1', '10:00', ['success'])]}
      />
    );
    expect(screen.queryByTestId('tool-activity-dock')).toBeNull();
    expect(screen.queryByText(/执行记录/)).toBeNull();
  });

  it('opens via focusRequest at the requested group tab and renders details', async () => {
    const { rerender } = render(
      <ToolActivityDock
        conversationId="conv-1"
        projectId="p-1"
        groups={[group('g-1', '10:00', ['success']), group('g-2', '10:05', ['error'])]}
        focusRequest={null}
      />
    );
    rerender(
      <ToolActivityDock
        conversationId="conv-1"
        projectId="p-1"
        groups={[group('g-1', '10:00', ['success']), group('g-2', '10:05', ['error'])]}
        focusRequest={{ groupId: 'g-2', nonce: 1 }}
      />
    );
    await waitFor(() => {
      expect(screen.getByTestId('tool-activity-dock')).toBeTruthy();
    });
    expect(screen.getByText(/失败/)).toBeTruthy();
    // g-1（success）的详情行未渲染：精确匹配「已完成」状态标签应不存在
    expect(screen.queryByText('已完成')).toBeNull();
    expect(screen.getByText('10:00')).toBeTruthy();
    expect(screen.getByText('10:05')).toBeTruthy();
  });

  it('auto-pops when a tool becomes running and keeps the window after completion', async () => {
    const { rerender } = render(
      <ToolActivityDock
        conversationId="conv-1"
        projectId="p-1"
        groups={[group('g-1', '10:00', ['success'])]}
      />
    );
    expect(screen.queryByTestId('tool-activity-dock')).toBeNull();

    rerender(
      <ToolActivityDock
        conversationId="conv-1"
        projectId="p-1"
        groups={[group('g-1', '10:00', ['success']), group('g-2', '10:01', ['running'])]}
      />
    );
    await waitFor(() => {
      expect(screen.getByTestId('tool-activity-dock')).toBeTruthy();
    });
    expect(screen.getByText(/正在处理/)).toBeTruthy();

    // 完成后窗口保留，可回看记录
    rerender(
      <ToolActivityDock
        conversationId="conv-1"
        projectId="p-1"
        groups={[group('g-1', '10:00', ['success']), group('g-2', '10:01', ['success'])]}
      />
    );
    expect(screen.getByTestId('tool-activity-dock')).toBeTruthy();
    expect(screen.getAllByText(/已完成/).length).toBeGreaterThan(0);
  });

  it('does not re-pop on repeated renders while already running', async () => {
    const groups = [group('g-1', '10:00', ['running'])];
    const { rerender } = render(
      <ToolActivityDock conversationId="conv-1" projectId="p-1" groups={groups} />
    );
    await waitFor(() => {
      expect(screen.getByTestId('tool-activity-dock')).toBeTruthy();
    });
    fireEvent.click(screen.getByTitle('折叠'));
    expect(screen.queryByTestId('tool-activity-dock')).toBeNull();
    expect(screen.getByText(/执行记录/)).toBeTruthy();

    // 运行中重渲染不强行展开折叠态
    rerender(
      <ToolActivityDock conversationId="conv-1" projectId="p-1" groups={[...groups]} />
    );
    expect(screen.queryByTestId('tool-activity-dock')).toBeNull();
    expect(screen.getByText(/执行记录/)).toBeTruthy();
  });

  it('stays hidden after close (×) until a new run starts', async () => {
    const { rerender } = render(
      <ToolActivityDock conversationId="conv-1" projectId="p-1" groups={[group('g-1', '10:00', ['running'])]} />
    );
    await waitFor(() => {
      expect(screen.getByTestId('tool-activity-dock')).toBeTruthy();
    });
    fireEvent.click(screen.getByTitle('关闭'));
    expect(screen.queryByTestId('tool-activity-dock')).toBeNull();
    expect(screen.queryByText(/执行记录/)).toBeNull();

    // 新运行 re-pop
    rerender(
      <ToolActivityDock conversationId="conv-1" projectId="p-1" groups={[group('g-2', '10:02', ['running'])]} />
    );
    await waitFor(() => {
      expect(screen.getByTestId('tool-activity-dock')).toBeTruthy();
    });
  });

  it('resets to hidden when the conversation changes', async () => {
    const { rerender } = render(
      <ToolActivityDock conversationId="conv-1" projectId="p-1" groups={[group('g-1', '10:00', ['success'])]} />
    );
    rerender(
      <ToolActivityDock
        conversationId="conv-1"
        projectId="p-1"
        groups={[group('g-1', '10:00', ['success'])]}
        focusRequest={{ groupId: 'g-1', nonce: 1 }}
      />
    );
    await waitFor(() => {
      expect(screen.getByTestId('tool-activity-dock')).toBeTruthy();
    });
    rerender(
      <ToolActivityDock
        conversationId="conv-2"
        projectId="p-1"
        groups={[group('g-1', '10:00', ['success'])]}
        focusRequest={{ groupId: 'g-1', nonce: 1 }}
      />
    );
    expect(screen.queryByTestId('tool-activity-dock')).toBeNull();
  });

  it('opens the background-process tab on a matching event and renders log tail', async () => {
    listBackgroundProcesses.mockResolvedValue([runningProc]);
    render(
      <ToolActivityDock conversationId="conv-1" projectId="p-1" groups={[group('g-1', '10:00', ['success'])]} />
    );
    act(() => {
      dispatchBioF3Event(biof3Events.agentBackgroundProcess, {
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
    expect(screen.getByText(/运行中/)).toBeTruthy();
    expect(listBackgroundProcesses).toHaveBeenCalledWith('conv-1', 'p-1');
  });

  it('ignores background-process events from other conversations', () => {
    render(
      <ToolActivityDock conversationId="conv-1" projectId="p-1" groups={[group('g-1', '10:00', ['success'])]} />
    );
    act(() => {
      dispatchBioF3Event(biof3Events.agentBackgroundProcess, {
        processId: 'bg-1',
        conversationId: 'conv-other',
      });
    });
    expect(screen.queryByTestId('tool-activity-dock')).toBeNull();
  });

  it('shows a processes tab when the backend reports processes', async () => {
    listBackgroundProcesses.mockResolvedValue([runningProc]);
    render(
      <ToolActivityDock
        conversationId="conv-1"
        projectId="p-1"
        groups={[group('g-1', '10:00', ['success'])]}
        focusRequest={{ groupId: 'g-1', nonce: 2 }}
      />
    );
    await waitFor(() => {
      expect(screen.getByTestId('tool-activity-dock')).toBeTruthy();
    });
    await waitFor(() => {
      expect(screen.getByText('后台进程')).toBeTruthy();
    });
    fireEvent.click(screen.getByText('后台进程'));
    await waitFor(() => {
      expect(screen.getByText(/listening on 3000/)).toBeTruthy();
    });
  });
});
