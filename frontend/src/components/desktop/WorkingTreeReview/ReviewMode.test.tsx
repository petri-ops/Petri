import { cleanup, render, screen, waitFor } from '@testing-library/react';
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

    const list = screen.getByTestId('rvw-file-list');
    expect(list.textContent).toContain('src/a.py');
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
