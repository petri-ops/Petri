import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ReviewMode } from './ReviewMode';

const { getBridgeMock } = vi.hoisted(() => ({
  getBridgeMock: vi.fn(),
}));

vi.mock('../../../lib/desktopBridge', () => ({
  getBridge: getBridgeMock,
}));

function makeBridge(overrides: Record<string, unknown> = {}) {
  return {
    status: vi.fn(() =>
      Promise.resolve({
        ok: true,
        data: {
          files: [
            { path: 'src/a.py', oldPath: null, status: 'M', untracked: false, conflicted: false },
          ],
          totalFiles: 1,
          hasUntracked: false,
          hasConflict: false,
        },
      })
    ),
    diff: vi.fn(() =>
      Promise.resolve({
        ok: true,
        data: {
          files: [
            {
              path: 'src/a.py',
              oldPath: null,
              binary: false,
              hunks: [
                {
                  oldStart: 1,
                  newStart: 1,
                  lines: [
                    { type: 'ctx', text: 'line1' },
                    { type: 'add', text: 'line2-new' },
                  ],
                },
              ],
            },
          ],
          truncated: false,
          summary: { added: 1, removed: 0 },
        },
      })
    ),
    applyHunk: vi.fn(() => Promise.resolve({ ok: true, data: {} })),
    revert: vi.fn(() => Promise.resolve({ ok: true, data: { reverted: [] } })),
    commitReview: vi.fn(() => Promise.resolve({ ok: true, data: {} })),
    onTaskDone: vi.fn(() => vi.fn()),
    ...overrides,
  };
}

function renderReview() {
  return render(
    <MemoryRouter initialEntries={['/review']}>
      <ReviewMode />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe('ReviewMode (BLOCK-28 main-area review mode)', () => {
  it('renders the main-area skeleton with summary stats and file list', async () => {
    getBridgeMock.mockReturnValue(makeBridge());

    renderReview();

    expect(screen.getByRole('region', { name: 'code review mode' })).not.toBeNull();
    expect(screen.getByText('Code Review')).not.toBeNull();

    await waitFor(() => {
      expect(screen.getByTestId('rvw-summary-stats').textContent).toContain('1 file(s)');
    });
    expect(screen.getByTestId('rvw-summary-stats').textContent).toContain('+1');
    expect(screen.getByTestId('rvw-summary-stats').textContent).toContain('−0');
    expect(screen.getByTestId('rvw-review-progress').textContent).toContain('0/1 reviewed');

    const list = screen.getByTestId('rvw-file-list');
    // 目录分组：组头 src + 文件行 a.py（basename）+ 每文件 +N −M
    expect(list.textContent).toContain('src');
    expect(list.textContent).toContain('a.py');
    expect(list.textContent).toContain('+1');
  });

  it('marks a file reviewed (dimmed + progress) once all its hunks are decided', async () => {
    const applyHunk = vi.fn(() => Promise.resolve({ ok: true, data: {} }));
    getBridgeMock.mockReturnValue(makeBridge({ applyHunk }));

    const { container } = renderReview();

    // 等首个文件自动选中
    await waitFor(() => {
      expect(screen.getByTestId('rvw-review-progress').textContent).toContain('0/1 reviewed');
    });

    // A 键 accept 当前 hunk（键盘流与旧抽屉一致）
    fireEvent.keyDown(window, { key: 'a' });

    await waitFor(() => {
      expect(screen.getByTestId('rvw-review-progress').textContent).toContain('1/1 reviewed');
    });
    expect(container.querySelector('.rvw-file-reviewed')).not.toBeNull();
    expect(container.querySelector('.rvw-reviewed-mark')).not.toBeNull();
    expect(applyHunk).toHaveBeenCalledTimes(1);
  });

  it('commits from the inline commit box via Cmd+Enter (P4, UI-207)', async () => {
    const applyHunk = vi.fn(() => Promise.resolve({ ok: true, data: {} }));
    const commitReview = vi.fn(() =>
      Promise.resolve({
        ok: true,
        data: {
          commit: 'abc1234def',
          files: ['src/a.py'],
          message: 'msg',
          rejectedFiles: [],
          stats: { acceptedFiles: 1, rejectedFiles: 0, totalWorkingTree: 1 },
        },
      })
    );
    getBridgeMock.mockReturnValue(makeBridge({ applyHunk, commitReview }));

    renderReview();

    await waitFor(() => {
      expect(screen.getByTestId('rvw-review-progress').textContent).toContain('0/1 reviewed');
    });

    // A 键 accept 当前 hunk
    fireEvent.keyDown(window, { key: 'a' });
    await waitFor(() => {
      expect(screen.getByTestId('rvw-review-progress').textContent).toContain('1/1 reviewed');
    });

    // 输入 message + ⌘+Enter
    const input = screen.getByLabelText('Commit message') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'test commit message' } });
    fireEvent.keyDown(input, { key: 'Enter', metaKey: true });

    await waitFor(() => {
      expect(commitReview).toHaveBeenCalledWith(
        { decisions: { 'src/a.py#0': 'accept' }, message: 'test commit message' },
      );
    });
    // 面板内轻提示替代独立对话框
    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toContain('abc1234');
    });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('shows the empty state when the working tree is clean', async () => {
    getBridgeMock.mockReturnValue(
      makeBridge({
        status: vi.fn(() =>
          Promise.resolve({
            ok: true,
            data: { files: [], totalFiles: 0, hasUntracked: false, hasConflict: false },
          })
        ),
        diff: vi.fn(() =>
          Promise.resolve({
            ok: true,
            data: { files: [], truncated: false, summary: { added: 0, removed: 0 } },
          })
        ),
      })
    );

    renderReview();

    await waitFor(() => {
      expect(screen.getByText('No working tree changes.')).not.toBeNull();
    });
  });

  it('shows the select-file hint when no diff files exist but status has entries', async () => {
    // status 有文件但 diff 未覆盖（如纯 untracked）：右栏出现引导文案
    getBridgeMock.mockReturnValue(
      makeBridge({
        diff: vi.fn(() =>
          Promise.resolve({
            ok: true,
            data: { files: [], truncated: false, summary: { added: 0, removed: 0 } },
          })
        ),
      })
    );

    renderReview();

    await waitFor(() => {
      expect(
        screen.getByText('Select a file on the left to review its diff.')
      ).not.toBeNull();
    });
  });
});
