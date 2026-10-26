// ============================================================
// BLOCK-147 — 审阅正确性批定向测试
//
// #1 hunk 决策键内容寻址：refresh 重解析 diff 后被拒 hunk 消失，
//    索引键会错位挂到未审 hunk——本文件先复现错位场景（红），
//    内容寻址（hunk 头 oldStart + 行内容指纹）落地后决策必须落在
//    内容匹配的 hunk 上（绿）。
// #2 未决 hunk 计数真实可见 + 提交确认拦截（见下方 describe）。
// #3 焦点 hunk 视觉反馈（ReviewMode 集成层；组件层见 CodeMirrorDiffView.test.tsx）。
// ============================================================

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ReviewMode } from './ReviewMode';

const { getBridgeMock } = vi.hoisted(() => ({
  getBridgeMock: vi.fn(),
}));

vi.mock('../../../lib/desktopBridge', () => ({
  getBridge: getBridgeMock,
}));

// 同一文件两个 hunk：A 在前（将被拒）、B 在后（幸存者）。
// B 的 oldStart 锚定 HEAD 行号——A 被拒回退后 B 的 oldStart 不变，
// 但 newStart 因 A 的回退而前移（refresh 后 diff 的真实形态）。
const HUNK_A = {
  oldStart: 10,
  newStart: 12,
  lines: [
    { type: 'ctx', text: 'keep-line' },
    { type: 'add', text: 'A-new-line' },
  ],
};
const HUNK_B = {
  oldStart: 40,
  newStart: 45,
  lines: [
    { type: 'ctx', text: 'hold-line' },
    { type: 'del', text: 'B-old-line' },
  ],
};
const HUNK_B_AFTER_A_REJECTED = { ...HUNK_B, newStart: 44 };

function makeBridge(overrides: Record<string, unknown> = {}) {
  return {
    status: vi.fn(() =>
      Promise.resolve({
        ok: true,
        data: {
          files: [
            {
              path: 'src/a.py',
              oldPath: null,
              status: 'M',
              untracked: false,
              conflicted: false,
              staged: false,
              indexStatus: ' ',
              worktreeStatus: 'M',
            },
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
              hunks: [HUNK_A, HUNK_B],
            },
          ],
          truncated: false,
          summary: { added: 1, removed: 1 },
        },
      })
    ),
    applyHunk: vi.fn(() => Promise.resolve({ ok: true, data: {} })),
    revert: vi.fn(() => Promise.resolve({ ok: true, data: { reverted: [] } })),
    commitReview: vi.fn(() =>
      Promise.resolve({
        ok: true,
        data: {
          commit: 'abc1234def',
          files: ['src/a.py'],
          message: 'msg',
          rejectedFiles: [],
          stats: { acceptedFiles: 1, rejectedFiles: 0, totalWorkingTree: 0 },
        },
      })
    ),
    onTaskDone: vi.fn(() => vi.fn()),
    fileContent: vi.fn(() => Promise.resolve({ ok: true, data: { content: 'line1\nline2\n' } })),
    commitLog: vi.fn(() => Promise.resolve({ ok: true, data: { commits: [], count: 0 } })),
    branchList: vi.fn(() =>
      Promise.resolve({
        ok: true,
        data: { branches: [{ name: 'main', shortSha: 'a1b2c3d', isoDate: '', current: true }], count: 1 },
      })
    ),
    stashList: vi.fn(() => Promise.resolve({ ok: true, data: { stashes: [], count: 0 } })),
    tagList: vi.fn(() => Promise.resolve({ ok: true, data: { tags: [], count: 0 } })),
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

describe('BLOCK-147 #1 — hunk 决策键内容寻址（refresh 后决策不错位）', () => {
  it('被拒 hunk 消失后，幸存 hunk 不得继承「已拒绝」决策', async () => {
    // 状态化 diff mock：reject 落盘（backend 回退 working tree）后，
    // refresh 重解析时 A 消失、仅剩 B（newStart 前移）。
    let rejectApplied = false;
    const bridge = makeBridge({
      diff: vi.fn(() =>
        Promise.resolve({
          ok: true,
          data: {
            files: [
              {
                path: 'src/a.py',
                oldPath: null,
                binary: false,
                hunks: rejectApplied ? [HUNK_B_AFTER_A_REJECTED] : [HUNK_A, HUNK_B],
              },
            ],
            truncated: false,
            summary: { added: 1, removed: 1 },
          },
        })
      ),
    });
    getBridgeMock.mockReturnValue(bridge);

    renderReview();
    await waitFor(() => {
      expect(screen.getByTestId('rvw-review-progress').textContent).toContain('0/1 已审');
    });

    // 聚焦 hunk 0（A）按 R 拒绝：applyHunk 走 reject 路径回退 working tree
    fireEvent.keyDown(window, { key: 'r' });
    await waitFor(() => {
      expect(bridge.applyHunk).toHaveBeenCalled();
    });
    // 拒绝决策已入账（提交条统计可见）
    await waitFor(() => {
      expect(screen.getByTestId('rvw-commitbox').textContent).toContain('拒绝 1');
    });

    // A 的回退已生效 → refresh（task-done / 手动刷新 / stagePaths 同路径重解析 diff）
    rejectApplied = true;
    fireEvent.click(screen.getByLabelText('刷新'));
    await act(async () => {}); // 冲刷 refresh 微任务链（并发下 1s 默认超时可不够）

    // 断言决策落在正确 hunk：幸存的 B（现为 index 0）未被审过，
    // 不得继承 A 的「已拒绝」——索引键（file#0）在此场景即错位。
    await waitFor(() => {
      expect(document.querySelectorAll('.wt-diff-marker.is-rejected').length).toBe(0);
    }, { timeout: 5000 });
    // 文件级已审进度同样不得误报
    await waitFor(() => {
      expect(screen.getByTestId('rvw-review-progress').textContent).toContain('0/1 已审');
    }, { timeout: 5000 });
  });

  it('幸存 hunk 的悬浮控件不显示「已拒绝」态，accept 后决策挂在自身内容上', async () => {
    let rejectApplied = false;
    const bridge = makeBridge({
      diff: vi.fn(() =>
        Promise.resolve({
          ok: true,
          data: {
            files: [
              {
                path: 'src/a.py',
                oldPath: null,
                binary: false,
                hunks: rejectApplied ? [HUNK_B_AFTER_A_REJECTED] : [HUNK_A, HUNK_B],
              },
            ],
            truncated: false,
            summary: { added: 1, removed: 1 },
          },
        })
      ),
    });
    getBridgeMock.mockReturnValue(bridge);

    renderReview();
    await waitFor(() => {
      expect(screen.getByTestId('rvw-review-progress').textContent).toContain('0/1 已审');
    });

    fireEvent.keyDown(window, { key: 'r' });
    await waitFor(() => {
      expect(screen.getByTestId('rvw-commitbox').textContent).toContain('拒绝 1');
    });

    rejectApplied = true;
    fireEvent.click(screen.getByLabelText('刷新'));
    await act(async () => {}); // 冲刷 refresh 微任务链（并发下 1s 默认超时可不够）

    // B 幸存：其 hunk 控件应仍是可决策的「接受/拒绝」按钮，而非「已拒绝」标签
    await waitFor(() => {
      const control = document.querySelector('.wt-hunk-controls[data-hunk-control="0"]');
      expect(control).not.toBeNull();
      expect(control?.classList.contains('is-rejected')).toBe(false);
      expect(control?.querySelector('[data-hunk-accept="0"]')).not.toBeNull();
    });
  });
});

describe('BLOCK-147 #2 — 未决 hunk 可见 + 提交拦截', () => {
  it('部分决策后未决计数真实可见，提交确认被拦截（取消则不提交）', async () => {
    const commitReview = vi.fn(() =>
      Promise.resolve({ ok: true, data: { commit: 'abc1234', files: ['src/a.py'] } })
    );
    const bridge = makeBridge({ commitReview });
    getBridgeMock.mockReturnValue(bridge);

    renderReview();
    await waitFor(() => {
      expect(screen.getByTestId('rvw-review-progress').textContent).toContain('0/1 已审');
    });

    // 2 个 hunk 只决 1 个：接受 hunk 0，hunk 1 未决
    fireEvent.keyDown(window, { key: 'a' });
    const box = await screen.findByTestId('rvw-commitbox');
    // 未决计数必须真实展示（旧实现 pendingCount 恒 0）
    await waitFor(() => {
      expect(box.textContent).toContain('待定 1');
    });

    // ⌘+Enter 提交：有未决 → 先拦截确认；happy-dom 无 window.confirm，stub 之
    const confirmSpy = vi.fn((_message: string) => false);
    vi.stubGlobal('confirm', confirmSpy);
    const input = screen.getByLabelText('提交信息');
    fireEvent.change(input, { target: { value: 'partial review' } });
    fireEvent.keyDown(input, { key: 'Enter', metaKey: true });

    await waitFor(() => {
      expect(confirmSpy).toHaveBeenCalled();
    });
    // 拦截文案列出未决文件与条数
    expect(String(confirmSpy.mock.calls[0][0])).toContain('src/a.py');
    // 用户取消 → 不提交
    await waitFor(() => {
      expect(commitReview).not.toHaveBeenCalled();
    });
  });

  it('拦截后显式确认继续 → 提交放行', async () => {
    const commitReview = vi.fn(() =>
      Promise.resolve({
        ok: true,
        data: {
          commit: 'abc1234def',
          files: ['src/a.py'],
          message: 'msg',
          rejectedFiles: [],
          stats: { acceptedFiles: 1, rejectedFiles: 0, totalWorkingTree: 0 },
        },
      })
    );
    const bridge = makeBridge({ commitReview });
    getBridgeMock.mockReturnValue(bridge);

    renderReview();
    await waitFor(() => {
      expect(screen.getByTestId('rvw-review-progress').textContent).toContain('0/1 已审');
    });

    fireEvent.keyDown(window, { key: 'a' });
    await screen.findByTestId('rvw-commitbox');

    vi.stubGlobal('confirm', vi.fn(() => true));
    const input = screen.getByLabelText('提交信息');
    fireEvent.change(input, { target: { value: 'explicit proceed' } });
    fireEvent.keyDown(input, { key: 'Enter', metaKey: true });

    await waitFor(() => {
      expect(commitReview).toHaveBeenCalledTimes(1);
    });
  });

  it('全部 hunk 已决时提交不弹拦截', async () => {
    const commitReview = vi.fn(() =>
      Promise.resolve({
        ok: true,
        data: {
          commit: 'abc1234def',
          files: ['src/a.py'],
          message: 'msg',
          rejectedFiles: [],
          stats: { acceptedFiles: 2, rejectedFiles: 0, totalWorkingTree: 0 },
        },
      })
    );
    const bridge = makeBridge({ commitReview });
    getBridgeMock.mockReturnValue(bridge);

    renderReview();
    await waitFor(() => {
      expect(screen.getByTestId('rvw-review-progress').textContent).toContain('0/1 已审');
    });

    // 接受 hunk 0 → ↓ 聚焦 hunk 1 → 接受：全部已决
    fireEvent.keyDown(window, { key: 'a' });
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    fireEvent.keyDown(window, { key: 'a' });
    await waitFor(() => {
      expect(screen.getByTestId('rvw-review-progress').textContent).toContain('1/1 已审');
    });

    const confirmSpy = vi.fn(() => true);
    vi.stubGlobal('confirm', confirmSpy);
    const input = screen.getByLabelText('提交信息');
    fireEvent.change(input, { target: { value: 'all decided' } });
    fireEvent.keyDown(input, { key: 'Enter', metaKey: true });

    await waitFor(() => {
      expect(commitReview).toHaveBeenCalledTimes(1);
    });
    expect(confirmSpy).not.toHaveBeenCalled();
  });
});

describe('BLOCK-147 #3 — 键盘焦点视觉反馈（↑↓/j/k 联动滚动 + 高亮）', () => {
  it('↑↓ 切换焦点 hunk 时主区 diff 高亮随焦点迁移', async () => {
    getBridgeMock.mockReturnValue(makeBridge());

    renderReview();
    await waitFor(() => {
      expect(screen.getByTestId('rvw-review-progress').textContent).toContain('0/1 已审');
    });

    // 初始焦点 hunk 0：其控件持续高亮
    await waitFor(() => {
      expect(
        document.querySelector('.wt-hunk-controls[data-hunk-control="0"]')?.classList.contains('is-focused')
      ).toBe(true);
    });

    // ↓ 焦点切到 hunk 1：高亮随焦点迁移（A/R 将打在可见的焦点上）
    fireEvent.keyDown(window, { key: 'ArrowDown' });
    await waitFor(() => {
      expect(
        document.querySelector('.wt-hunk-controls[data-hunk-control="1"]')?.classList.contains('is-focused')
      ).toBe(true);
    });
    expect(
      document.querySelector('.wt-hunk-controls[data-hunk-control="0"]')?.classList.contains('is-focused')
    ).toBe(false);

    // k 回到 hunk 0
    fireEvent.keyDown(window, { key: 'k' });
    await waitFor(() => {
      expect(
        document.querySelector('.wt-hunk-controls[data-hunk-control="0"]')?.classList.contains('is-focused')
      ).toBe(true);
    });
  });
});
