import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentChangesCard } from './AgentChangesCard';
import { biof3Events } from '@/lib/events';

const { getBridgeMock } = vi.hoisted(() => ({
  getBridgeMock: vi.fn(),
}));

vi.mock('@/lib/desktopBridge', () => ({
  getBridge: getBridgeMock,
}));

function makeBridge(files: Array<{ path: string; status: string }>) {
  return {
    status: vi.fn(() =>
      Promise.resolve({
        ok: true,
        data: {
          files: files.map((f) => ({
            path: f.path,
            oldPath: null,
            status: f.status,
            untracked: f.status === '?',
            conflicted: false,
          })),
          totalFiles: files.length,
          hasUntracked: files.some((f) => f.status === '?'),
          hasConflict: false,
        },
      })
    ),
    diff: vi.fn(() =>
      Promise.resolve({
        ok: true,
        data: {
          files: files
            .filter((f) => f.status !== '?')
            .map((f) => ({
              path: f.path,
              oldPath: null,
              binary: false,
              hunks: [
                {
                  oldStart: 1,
                  newStart: 1,
                  lines: [
                    { type: 'ctx', text: 'line1' },
                    { type: 'add', text: 'line2-new' },
                    { type: 'del', text: 'line0-old' },
                  ],
                },
              ],
            })),
          truncated: false,
          summary: { added: files.length, removed: files.length },
        },
      })
    ),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe('AgentChangesCard (BLOCK-28.7)', () => {
  it('renders per-file +N −M rows from status/diff', async () => {
    getBridgeMock.mockReturnValue(
      makeBridge([
        { path: 'src/a.py', status: 'M' },
        { path: 'notes.md', status: '?' },
      ])
    );

    render(<AgentChangesCard />);

    const card = await screen.findByTestId('agent-changes-card');
    expect(card.textContent).toContain('2 个文件');
    expect(card.textContent).toContain('src/a.py');
    expect(card.textContent).toContain('notes.md');
    // src/a.py：+1 −1；notes.md 无 diff（untracked）→ +0 −0 仍列出
    expect(card.textContent).toContain('+1');
    expect(card.textContent).toContain('−1');
  });

  it('hides entirely when the working tree is clean', async () => {
    getBridgeMock.mockReturnValue(makeBridge([]));

    render(<AgentChangesCard />);

    await waitFor(() => {
      expect(getBridgeMock.mock.results.length).toBeGreaterThan(0);
    });
    expect(screen.queryByTestId('agent-changes-card')).toBeNull();
  });

  it('clicking a file row dispatches reviewOpenFile with the path', async () => {
    getBridgeMock.mockReturnValue(makeBridge([{ path: 'src/a.py', status: 'M' }]));

    const seen: Array<{ filePath: string }> = [];
    const listener = (e: Event) => {
      seen.push((e as CustomEvent<{ filePath: string }>).detail);
    };
    window.addEventListener(biof3Events.reviewOpenFile, listener);

    render(<AgentChangesCard />);
    const row = await screen.findByText('src/a.py');
    fireEvent.click(row);

    window.removeEventListener(biof3Events.reviewOpenFile, listener);
    expect(seen).toEqual([{ filePath: 'src/a.py' }]);
  });

  it('agentTaskDone triggers a refresh and reveals the card', async () => {
    getBridgeMock.mockReturnValue(makeBridge([]));

    render(<AgentChangesCard />);
    await waitFor(() => {
      expect(screen.queryByTestId('agent-changes-card')).toBeNull();
    });

    // agent 完成任务 → 工作区出现改动 → 卡片显现
    getBridgeMock.mockReturnValue(makeBridge([{ path: 'gen/out.py', status: 'A' }]));
    window.dispatchEvent(new CustomEvent(biof3Events.agentTaskDone, { detail: { taskId: 't1' } }));

    const card = await screen.findByTestId('agent-changes-card');
    expect(card.textContent).toContain('gen/out.py');
  });
});
