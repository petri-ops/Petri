import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BackgroundProcessDock } from './BackgroundProcessDock';
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

beforeEach(() => {
  vi.clearAllMocks();
  listBackgroundProcesses.mockResolvedValue([runningProc]);
  fetchProcessLogTail.mockResolvedValue({ ...runningProc });
});

afterEach(() => {
  cleanup();
});

describe('BackgroundProcessDock (BLOCK-34 P3)', () => {
  it('renders nothing until a background-process event arrives', () => {
    render(<BackgroundProcessDock conversationId="conv-1" projectId="p-1" />);
    expect(screen.queryByTestId('background-process-dock')).toBeNull();
  });

  it('auto-opens on a matching event and renders log tail + status', async () => {
    render(<BackgroundProcessDock conversationId="conv-1" projectId="p-1" />);
    act(() => {
      dispatchBioF3Event(biof3Events.agentBackgroundProcess, {
        processId: 'bg-1',
        conversationId: 'conv-1',
      });
    });
    await waitFor(() => {
      expect(screen.getByTestId('background-process-dock')).toBeTruthy();
    });
    await waitFor(() => {
      expect(screen.getByText(/listening on 3000/)).toBeTruthy();
    });
    expect(screen.getByText(/运行中/)).toBeTruthy();
    expect(listBackgroundProcesses).toHaveBeenCalledWith('conv-1', 'p-1');
    expect(fetchProcessLogTail).toHaveBeenCalledWith('bg-1', 'conv-1', 'p-1', 32 * 1024);
  });

  it('ignores events from other conversations', () => {
    render(<BackgroundProcessDock conversationId="conv-1" projectId="p-1" />);
    act(() => {
      dispatchBioF3Event(biof3Events.agentBackgroundProcess, {
        processId: 'bg-1',
        conversationId: 'conv-other',
      });
    });
    expect(screen.queryByTestId('background-process-dock')).toBeNull();
  });

  it('collapses to a chip and re-expands', async () => {
    render(<BackgroundProcessDock conversationId="conv-1" projectId="p-1" />);
    act(() => {
      dispatchBioF3Event(biof3Events.agentBackgroundProcess, {
        processId: 'bg-1',
        conversationId: 'conv-1',
      });
    });
    await waitFor(() => {
      expect(screen.getByTestId('background-process-dock')).toBeTruthy();
    });

    fireEvent.click(screen.getByTitle('折叠'));
    await waitFor(() => {
      expect(screen.queryByTestId('background-process-dock')).toBeNull();
    });
    expect(screen.getByText(/后台进程/)).toBeTruthy();

    fireEvent.click(screen.getByText(/后台进程/));
    await waitFor(() => {
      expect(screen.getByTestId('background-process-dock')).toBeTruthy();
    });
  });

  it('closes on × and does not re-render until a new event', async () => {
    render(<BackgroundProcessDock conversationId="conv-1" projectId="p-1" />);
    act(() => {
      dispatchBioF3Event(biof3Events.agentBackgroundProcess, {
        processId: 'bg-1',
        conversationId: 'conv-1',
      });
    });
    await waitFor(() => {
      expect(screen.getByTestId('background-process-dock')).toBeTruthy();
    });

    fireEvent.click(screen.getByTitle('关闭'));
    await waitFor(() => {
      expect(screen.queryByTestId('background-process-dock')).toBeNull();
    });
    expect(screen.queryByText(/后台进程/)).toBeNull();

    // 新事件重新弹出
    act(() => {
      dispatchBioF3Event(biof3Events.agentBackgroundProcess, {
        processId: 'bg-1',
        conversationId: 'conv-1',
      });
    });
    await waitFor(() => {
      expect(screen.getByTestId('background-process-dock')).toBeTruthy();
    });
  });
});
