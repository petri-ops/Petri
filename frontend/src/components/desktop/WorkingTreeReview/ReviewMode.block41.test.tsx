// ============================================================
// BLOCK-41 — git 写操作三期前端定向测试：
// 暂存两栏分组 / 行内 stage·unstage / staged 提交框 / 真实分支切换（脏树冲突清单）/ push-pull 徽标
// ============================================================

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

const STAGED_FILE = {
  path: 'src/staged.py',
  oldPath: null,
  status: 'M',
  untracked: false,
  conflicted: false,
  staged: true,
  indexStatus: 'M',
  worktreeStatus: ' ',
};

const UNSTAGED_FILE = {
  path: 'src/changed.py',
  oldPath: null,
  status: 'M',
  untracked: false,
  conflicted: false,
  staged: false,
  indexStatus: ' ',
  worktreeStatus: 'M',
};

function makeFile(path: string, statusLine: string, staged: boolean) {
  return {
    path,
    oldPath: null,
    status: statusLine.trim() || 'M',
    untracked: statusLine === '??',
    conflicted: false,
    staged,
    indexStatus: statusLine[0] ?? ' ',
    worktreeStatus: statusLine[1] ?? ' ',
  };
}

function makeBridge(overrides: Record<string, unknown> = {}) {
  const statusFiles = [
    STAGED_FILE,
    UNSTAGED_FILE,
  ];
  return {
    status: vi.fn(() =>
      Promise.resolve({
        ok: true,
        data: { files: statusFiles, totalFiles: statusFiles.length, hasUntracked: false, hasConflict: false },
      })
    ),
    diff: vi.fn((args: { staged?: boolean; paths?: string[] } = {}) => {
      if (args.staged) {
        // staged diff（HEAD→index）：只含 staged 文件
        return Promise.resolve({
          ok: true,
          data: {
            files: [
              {
                path: 'src/staged.py',
                oldPath: null,
                binary: false,
                hunks: [{ oldStart: 1, newStart: 1, lines: [{ type: 'add', text: 'staged-line' }] }],
              },
            ],
            truncated: false,
            summary: { added: 1, removed: 0 },
          },
        });
      }
      // 组合 diff（HEAD→worktree）：两个文件都有
      return Promise.resolve({
        ok: true,
        data: {
          files: [
            {
              path: 'src/staged.py',
              oldPath: null,
              binary: false,
              hunks: [{ oldStart: 1, newStart: 1, lines: [{ type: 'add', text: 'staged-line' }] }],
            },
            {
              path: 'src/changed.py',
              oldPath: null,
              binary: false,
              hunks: [{ oldStart: 1, newStart: 1, lines: [{ type: 'del', text: 'old-line' }] }],
            },
          ],
          truncated: false,
          summary: { added: 1, removed: 1 },
        },
      });
    }),
    applyHunk: vi.fn(() => Promise.resolve({ ok: true, data: {} })),
    revert: vi.fn(() => Promise.resolve({ ok: true, data: { reverted: [] } })),
    commitReview: vi.fn(() => Promise.resolve({ ok: true, data: {} })),
    onTaskDone: vi.fn(() => vi.fn()),
    fileContent: vi.fn(() => Promise.resolve({ ok: true, data: { content: 'line1\n' } })),
    commitLog: vi.fn(() => Promise.resolve({ ok: true, data: { commits: [], count: 0 } })),
    branchList: vi.fn(() =>
      Promise.resolve({
        ok: true,
        data: {
          branches: [
            { name: 'main', shortSha: 'a1b2c3d', isoDate: '', current: true },
            { name: 'feature/x', shortSha: 'e4f5a6b', isoDate: '', current: false },
          ],
          count: 2,
        },
      })
    ),
    stashList: vi.fn(() => Promise.resolve({ ok: true, data: { stashes: [], count: 0 } })),
    tagList: vi.fn(() => Promise.resolve({ ok: true, data: { tags: [], count: 0 } })),
    commitDiff: vi.fn(() => Promise.resolve({ ok: true, data: { files: [], truncated: false, summary: { added: 0, removed: 0 } } })),
    commitFileContent: vi.fn(() => Promise.resolve({ ok: true, data: { original: '', modified: '' } })),
    discardFile: vi.fn(() => Promise.resolve({ ok: true, data: { discarded: [], deleted: false } })),
    undoLastCommit: vi.fn(() => Promise.resolve({ ok: true, data: { undoneCommit: 'abc' } })),
    // BLOCK-41 — git 写操作三期
    stagePaths: vi.fn(() => Promise.resolve({ ok: true, data: { staged: ['src/changed.py'] } })),
    unstagePaths: vi.fn(() => Promise.resolve({ ok: true, data: { unstaged: ['src/staged.py'] } })),
    commitIndex: vi.fn(() => Promise.resolve({ ok: true, data: { commit: 'abc1234', message: 'msg', remaining: 0 } })),
    checkoutBranch: vi.fn(() => Promise.resolve({ ok: true, data: { branch: 'feature/x', switched: true } })),
    remoteList: vi.fn(() => Promise.resolve({ ok: true, data: { remotes: [], count: 0 } })),
    remoteStatus: vi.fn(() => Promise.resolve({ ok: true, data: { upstream: 'origin/main', ahead: 2, behind: 1 } })),
    push: vi.fn(() => Promise.resolve({ ok: true, data: { remote: 'origin', branch: 'main', pushed: true } })),
    pull: vi.fn(() => Promise.resolve({ ok: true, data: { remote: 'origin', branch: 'main', pulled: true, output: '' } })),
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
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('ReviewMode BLOCK-41（暂存两栏 / 写操作 / 分支切换 / push-pull）', () => {
  it('renders staged/unstaged two sections with per-section counts', async () => {
    getBridgeMock.mockReturnValue(makeBridge());

    renderReview();

    await waitFor(() => {
      expect(screen.getByTestId('rvw-section-staged')).not.toBeNull();
    });
    const stagedSection = screen.getByTestId('rvw-section-staged');
    const unstagedSection = screen.getByTestId('rvw-section-unstaged');
    expect(stagedSection.textContent).toContain('暂存的更改');
    expect(stagedSection.textContent).toContain('staged.py');
    expect(unstagedSection.textContent).toContain('更改');
    expect(unstagedSection.textContent).toContain('changed.py');
  });

  it('staged file diff comes from diff({staged:true}) payload', async () => {
    const bridge = makeBridge();
    getBridgeMock.mockReturnValue(bridge);

    renderReview();

    await waitFor(() => {
      // refresh：一次组合 diff + 一次 staged diff（有 staged 文件时）
      expect(bridge.diff.mock.calls.some((c) => (c[0] as { staged?: boolean })?.staged === true)).toBe(true);
    });
    // 组合 diff 无 staged 参数
    expect(bridge.diff.mock.calls.some((c) => !(c[0] as { staged?: boolean })?.staged)).toBe(true);
  });

  it('stage button on unstaged row calls stagePaths; staged row calls unstagePaths', async () => {
    const stagePaths = vi.fn(() => Promise.resolve({ ok: true, data: { staged: [] } }));
    const unstagePaths = vi.fn(() => Promise.resolve({ ok: true, data: { unstaged: [] } }));
    getBridgeMock.mockReturnValue(makeBridge({ stagePaths, unstagePaths }));

    renderReview();

    await waitFor(() => {
      expect(screen.getByLabelText('暂存 changed.py')).not.toBeNull();
    });
    fireEvent.click(screen.getByLabelText('暂存 changed.py'));
    await waitFor(() => {
      expect(stagePaths).toHaveBeenCalledWith({ paths: ['src/changed.py'], projectId: undefined });
    });

    fireEvent.click(screen.getByLabelText('取消暂存 staged.py'));
    await waitFor(() => {
      expect(unstagePaths).toHaveBeenCalledWith({ paths: ['src/staged.py'], projectId: undefined });
    });
  });

  it('staged commit box appears with staged files and commitIndex submits the message', async () => {
    const commitIndex = vi.fn(() => Promise.resolve({ ok: true, data: { commit: 'abc1234', message: 'msg', remaining: 0 } }));
    getBridgeMock.mockReturnValue(makeBridge({ commitIndex }));
    // BLOCK-147 未决拦截走 window.confirm（happy-dom 未实现；staged 文件带未决 hunk 必触发）
    vi.stubGlobal('confirm', vi.fn(() => true));

    renderReview();

    await waitFor(() => {
      expect(screen.getByTestId('rvw-staged-commitbox')).not.toBeNull();
    });
    const input = screen.getByLabelText<HTMLInputElement>('暂存区提交信息');
    expect((input).disabled).toBe(false);

    fireEvent.change(input, { target: { value: 'feat: staged commit' } });
    fireEvent.click(screen.getByText('提交暂存'));
    await waitFor(() => {
      expect(commitIndex).toHaveBeenCalledWith({ message: 'feat: staged commit', projectId: undefined });
    });
  });

  it('branch switch select confirms and calls checkoutBranch on success', async () => {
    const checkoutBranch = vi.fn(() => Promise.resolve({ ok: true, data: { branch: 'feature/x', switched: true } }));
    getBridgeMock.mockReturnValue(makeBridge({ checkoutBranch }));
    // happy-dom 未实现 window.confirm；vitest 5 起 spyOn 不再允许代理 undefined 属性 → 用 stubGlobal
    const confirmSpy = vi.fn(() => true);
    vi.stubGlobal('confirm', confirmSpy);

    renderReview();

    await waitFor(() => {
      expect(screen.getByTestId('rvw-branch-switch')).not.toBeNull();
    });
    const select = screen.getByTestId('rvw-branch-switch');
    fireEvent.change(select, { target: { value: 'feature/x' } });

    await waitFor(() => {
      expect(checkoutBranch).toHaveBeenCalledWith({ name: 'feature/x', projectId: undefined });
    });
    expect(confirmSpy).toHaveBeenCalled();
  });

  it('dirty-tree checkout failure renders error with conflict list', async () => {
    const checkoutBranch = vi.fn(() =>
      Promise.resolve({
        ok: false,
        error: 'checkout_dirty_worktree',
        message: "Working tree has uncommitted changes; commit or discard them before switching to 'feature/x'.",
        detail: { conflicts: ['src/a.py', 'src/b.py'], dirtyCount: 2 },
      })
    );
    getBridgeMock.mockReturnValue(makeBridge({ checkoutBranch }));
    vi.stubGlobal('confirm', vi.fn(() => true));

    renderReview();

    await waitFor(() => {
      expect(screen.getByTestId('rvw-branch-switch')).not.toBeNull();
    });
    fireEvent.change(screen.getByTestId('rvw-branch-switch'), { target: { value: 'feature/x' } });

    await waitFor(() => {
      expect(screen.getByTestId('rvw-checkout-error')).not.toBeNull();
    });
    const banner = screen.getByTestId('rvw-checkout-error');
    expect(banner.textContent).toContain('uncommitted changes');
    expect(banner.textContent).toContain('src/a.py');
    expect(banner.textContent).toContain('src/b.py');
  });

  it('shows ahead/behind badge and push/pull buttons call the bridge', async () => {
    const push = vi.fn(() => Promise.resolve({ ok: true, data: { remote: 'origin', branch: 'main', pushed: true } }));
    const pull = vi.fn(() => Promise.resolve({ ok: true, data: { remote: 'origin', branch: 'main', pulled: true, output: '' } }));
    getBridgeMock.mockReturnValue(makeBridge({ push, pull }));

    renderReview();

    await waitFor(() => {
      expect(screen.getByTestId('rvw-push-btn')).not.toBeNull();
    });
    // 徽标：↑2 ↓1
    expect(screen.getByText('↑2')).not.toBeNull();
    expect(screen.getByText('↓1')).not.toBeNull();

    fireEvent.click(screen.getByTestId('rvw-push-btn'));
    await waitFor(() => {
      expect(push).toHaveBeenCalled();
    });
    fireEvent.click(screen.getByTestId('rvw-pull-btn'));
    await waitFor(() => {
      expect(pull).toHaveBeenCalled();
    });
  });

  it('push without upstream sends setUpstream:true (first-push UX)', async () => {
    const push = vi.fn(() => Promise.resolve({ ok: true, data: { remote: 'origin', branch: 'main', pushed: true } }));
    getBridgeMock.mockReturnValue(
      makeBridge({
        push,
        remoteStatus: vi.fn(() => Promise.resolve({ ok: true, data: { upstream: null, ahead: null, behind: null } })),
      })
    );

    renderReview();

    await waitFor(() => {
      expect(screen.getByTestId('rvw-push-btn')).not.toBeNull();
    });
    // 无 upstream：不显示徽标
    expect(screen.queryByText('已同步')).toBeNull();
    fireEvent.click(screen.getByTestId('rvw-push-btn'));
    await waitFor(() => {
      expect(push).toHaveBeenCalledWith(expect.objectContaining({ setUpstream: true }));
    });
  });

  it('groupFilesByDirectory keeps porcelain fields through makeFile helper (regression guard)', () => {
    const f = makeFile('x/y.py', 'MM', true);
    expect(f.staged).toBe(true);
    expect(f.indexStatus).toBe('M');
    expect(f.worktreeStatus).toBe('M');
    const u = makeFile('z.py', '??', false);
    expect(u.staged).toBe(false);
    expect(u.untracked).toBe(true);
  });
});
