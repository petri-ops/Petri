import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
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
    // BLOCK-29 — 提交历史（默认空实现，历史用例中覆写）
    commitLog: vi.fn(() => Promise.resolve({ ok: true, data: { commits: [], count: 0 } })),
    commitDiff: vi.fn(() => Promise.resolve({ ok: true, data: { files: [], truncated: false, summary: { added: 0, removed: 0 } } })),
    commitFileContent: vi.fn(() => Promise.resolve({ ok: true, data: { original: '', modified: '' } })),
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

    expect(screen.getByRole('region', { name: '审阅面板' })).not.toBeNull();
    expect(screen.getByText('审阅')).not.toBeNull();

    await waitFor(() => {
      expect(screen.getByTestId('rvw-summary-stats').textContent).toContain('1 个文件');
    });
    expect(screen.getByTestId('rvw-summary-stats').textContent).toContain('+1');
    expect(screen.getByTestId('rvw-summary-stats').textContent).toContain('−0');
    expect(screen.getByTestId('rvw-review-progress').textContent).toContain('0/1 已审');

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
      expect(screen.getByTestId('rvw-review-progress').textContent).toContain('0/1 已审');
    });

    // A 键 accept 当前 hunk（键盘流与旧抽屉一致）
    fireEvent.keyDown(window, { key: 'a' });

    await waitFor(() => {
      expect(screen.getByTestId('rvw-review-progress').textContent).toContain('1/1 已审');
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
      expect(screen.getByTestId('rvw-review-progress').textContent).toContain('0/1 已审');
    });

    // A 键 accept 当前 hunk
    fireEvent.keyDown(window, { key: 'a' });
    await waitFor(() => {
      expect(screen.getByTestId('rvw-review-progress').textContent).toContain('1/1 已审');
    });

    // 输入 message + ⌘+Enter
    const input = screen.getByLabelText('提交信息') as HTMLTextAreaElement;
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

  it('BLOCK-28.9: commit bar hidden without decisions, appears after accept', async () => {
    getBridgeMock.mockReturnValue(makeBridge());

    renderReview();

    await waitFor(() => {
      expect(screen.getByTestId('rvw-review-progress').textContent).toContain('0/1 已审');
    });
    // 无决策 → 底部提交条（含输入框）整体隐藏
    expect(screen.queryByTestId('rvw-commitbox')).toBeNull();

    // A 键 accept 当前 hunk → 提交条出现且含决策摘要
    fireEvent.keyDown(window, { key: 'a' });
    const box = await screen.findByTestId('rvw-commitbox');
    expect(box.textContent).toContain('接受 1');
    expect(screen.getByLabelText('提交信息').tagName).toBe('INPUT');
  });

  it('BLOCK-29: history view lists commits and opens a commit diff', async () => {
    const commitLog = vi.fn(() =>
      Promise.resolve({
        ok: true,
        data: {
          commits: [
            { sha: 'a1b2c3d4e5f6', shortSha: 'a1b2c3d', author: 'tester', isoDate: '2026-08-30T10:00:00Z', subject: 'first commit' },
          ],
          count: 1,
        },
      })
    );
    const commitDiff = vi.fn(() =>
      Promise.resolve({
        ok: true,
        data: {
          files: [
            { path: 'src/a.py', oldPath: null, binary: false, hunks: [{ oldStart: 1, newStart: 1, lines: [{ type: 'add', text: 'hello' }] }] },
          ],
          truncated: false,
          summary: { added: 1, removed: 0 },
        },
      })
    );
    const commitFileContent = vi.fn(() =>
      Promise.resolve({ ok: true, data: { original: 'old\n', modified: 'old\nhello\n' } })
    );
    getBridgeMock.mockReturnValue(makeBridge({ commitLog, commitDiff, commitFileContent }));

    renderReview();

    await waitFor(() => {
      expect(screen.getByTestId('rvw-review-progress')).toBeTruthy();
    });

    // 切到历史分区 → 提交列表
    fireEvent.click(screen.getByRole('tab', { name: '历史' }));
    const list = await screen.findByTestId('rvw-history-list');
    expect(list.textContent).toContain('first commit');
    expect(list.textContent).toContain('a1b2c3d');
    expect(commitLog).toHaveBeenCalled();

    // 点击提交 → 打开该提交 diff（文件条 + 只读视图）
    fireEvent.click(screen.getByText('first commit'));
    await screen.findByTestId('rvw-commit-diff-area');
    await waitFor(() => {
      expect(screen.getAllByText('src/a.py').length).toBeGreaterThan(0);
    });
    expect(commitDiff).toHaveBeenCalledWith({ hash: 'a1b2c3d4e5f6' });
    expect(commitFileContent).toHaveBeenCalledWith({ hash: 'a1b2c3d4e5f6', path: 'src/a.py' });
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
      expect(screen.getByText('暂无工作区改动。')).not.toBeNull();
    });
  });

  it('shows the graphical empty state when no diff files exist but status has entries', async () => {
    // status 有文件但 diff 未覆盖（如纯 untracked）：右栏出现图形化空态
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

    const { container } = renderReview();

    await waitFor(() => {
      expect(container.querySelector('.rvw-empty-state')).not.toBeNull();
    });
    expect(container.querySelector('.rvw-empty-title')?.textContent).toBe('审阅');
  });

  it('BLOCK-28.4: exit button calls onClose in dock variant', async () => {
    getBridgeMock.mockReturnValue(makeBridge());
    const onClose = vi.fn();

    render(
      <MemoryRouter initialEntries={['/project/p1/results']}>
        <ReviewMode variant="dock" onClose={onClose} />
      </MemoryRouter>
    );

    const exitBtn = await screen.findByTestId('rvw-exit-button');
    expect(exitBtn.getAttribute('title')).toBe('关闭审阅面板 (Esc)');
    fireEvent.click(exitBtn);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('BLOCK-28.4: exit button navigates back in mode variant', async () => {
    getBridgeMock.mockReturnValue(makeBridge());
    // jsdom 的 window.history.length 恒为 1，stub 成 >1 才能走 navigate(-1) 分支
    const lengthSpy = vi.spyOn(window.history, 'length', 'get').mockReturnValue(3);
    let pathname = '';
    const LocationProbe = () => {
      const loc = useLocation();
      pathname = loc.pathname;
      return null;
    };

    render(
      <MemoryRouter initialEntries={['/project/p1/results', '/review']} initialIndex={1}>
        <LocationProbe />
        <ReviewMode />
      </MemoryRouter>
    );

    const exitBtn = await screen.findByTestId('rvw-exit-button');
    expect(pathname).toBe('/review');
    fireEvent.click(exitBtn);

    // mode 形态无 onClose，退出走历史回退（navigate(-1)）
    await waitFor(() => {
      expect(pathname).toBe('/project/p1/results');
    });
    lengthSpy.mockRestore();
  });
});
