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
    fileContent: vi.fn(() => Promise.resolve({ ok: true, data: { content: 'line1\n' } })),
    // BLOCK-29 — 提交历史（默认空实现，历史用例中覆写）
    commitLog: vi.fn(() => Promise.resolve({ ok: true, data: { commits: [], count: 0 } })),
    branchList: vi.fn(() => Promise.resolve({ ok: true, data: { branches: [{ name: 'main', shortSha: 'a1b2c3d', isoDate: '', current: true }], count: 1 } })),
    stashList: vi.fn(() => Promise.resolve({ ok: true, data: { stashes: [], count: 0 } })),
    tagList: vi.fn(() => Promise.resolve({ ok: true, data: { tags: [], count: 0 } })),
    commitDiff: vi.fn(() => Promise.resolve({ ok: true, data: { files: [], truncated: false, summary: { added: 0, removed: 0 } } })),
    commitFileContent: vi.fn(() => Promise.resolve({ ok: true, data: { original: '', modified: '' } })),
    // BLOCK-29.2 — git 工具二期
    discardFile: vi.fn(() => Promise.resolve({ ok: true, data: { discarded: [], deleted: false } })),
    undoLastCommit: vi.fn(() => Promise.resolve({ ok: true, data: { undoneCommit: 'abc' } })),
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

    // 点击提交 → 行内展开详情（UI-231：列表保留不跳转）
    fireEvent.click(screen.getByText('first commit'));
    await screen.findByTestId('rvw-commit-diff-area');
    expect(screen.getByTestId('rvw-history-list')).toBeTruthy();
    await waitFor(() => {
      expect(screen.getAllByText('src/a.py').length).toBeGreaterThan(0);
    });
    expect(commitDiff).toHaveBeenCalledWith({ hash: 'a1b2c3d4e5f6' });
    expect(commitFileContent).toHaveBeenCalledWith({ hash: 'a1b2c3d4e5f6', path: 'src/a.py' });
  });

  it('BLOCK-29.3: commit detail shows full message body and aggregate stats', async () => {
    const commitLog = vi.fn(() =>
      Promise.resolve({
        ok: true,
        data: {
          commits: [
            { sha: 'a1b2c3d4e5f6', shortSha: 'a1b2c3d', author: 'tester', isoDate: '2026-08-30T10:00:00Z', subject: 'with body', message: 'user ruling line\nimpl detail line' },
            { sha: 'b2c3d4e5f6a1', shortSha: 'b2c3d4e', author: 'tester', isoDate: '2026-08-30T09:00:00Z', subject: 'no body', message: '' },
          ],
          count: 2,
        },
      })
    );
    const commitDiff = vi.fn(() =>
      Promise.resolve({
        ok: true,
        data: {
          files: [
            { path: 'src/a.py', oldPath: null, binary: false, hunks: [{ oldStart: 1, newStart: 1, lines: [{ type: 'add', text: 'hello' }] }] },
            { path: 'src/b.py', oldPath: null, binary: false, hunks: [{ oldStart: 1, newStart: 1, lines: [{ type: 'add', text: 'world' }] }] },
          ],
          truncated: false,
          summary: { added: 3, removed: 1 },
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

    fireEvent.click(screen.getByRole('tab', { name: '历史' }));
    fireEvent.click(await screen.findByText('with body'));

    const info = await screen.findByTestId('rvw-commit-info');
    expect(info.textContent).toContain('with body');
    expect(info.textContent).toContain('2 文件');
    expect(info.textContent).toContain('+3');
    expect(info.textContent).toContain('−1');

    // UI-230 — 完整提交说明默认直接展开（无折叠开关）
    const body = screen.getByTestId('rvw-commit-body');
    expect(body.textContent).toContain('user ruling line');
    expect(body.textContent).toContain('impl detail line');
    expect(screen.queryByText('完整提交说明')).toBeNull();

    // 无 body 的提交不渲染说明块
    // UI-231 — 收起『with body』行（再次点行），展开『no body』行
    fireEvent.click(screen.getByRole('button', { name: /with body/ }));
    await waitFor(() => {
      expect(screen.queryByTestId('rvw-commit-info')).toBeNull();
    });
    fireEvent.click(screen.getByRole('button', { name: /no body/ }));
    await waitFor(() => {
      expect(screen.getByTestId('rvw-commit-info').textContent).toContain('no body');
    });
    expect(screen.queryByTestId('rvw-commit-body')).toBeNull();
  });

  it('BLOCK-29.4: commit file fulltext view toggle', async () => {
    const commitLog = vi.fn(() =>
      Promise.resolve({
        ok: true,
        data: {
          commits: [
            { sha: 'a1b2c3d4e5f6', shortSha: 'a1b2c3d', author: 'tester', isoDate: '2026-08-30T10:00:00Z', subject: 'fulltext commit', message: '' },
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
            { path: 'src/new.py', oldPath: null, binary: false, hunks: [{ oldStart: 1, newStart: 1, lines: [{ type: 'add', text: 'new-content-line' }] }] },
          ],
          truncated: false,
          summary: { added: 2, removed: 0 },
        },
      })
    );
    const commitFileContent = vi.fn(({ path }: { path: string }) => {
      if (path === 'src/a.py') {
        return Promise.resolve({ ok: true, data: { original: 'kept\nremoved-line\n', modified: 'kept\nhello\nunique-full-line\n' } });
      }
      return Promise.resolve({ ok: true, data: { original: '', modified: 'new-content-line\n' } });
    });
    getBridgeMock.mockReturnValue(makeBridge({ commitLog, commitDiff, commitFileContent }));

    renderReview();

    await waitFor(() => {
      expect(screen.getByTestId('rvw-review-progress')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('tab', { name: '历史' }));
    fireEvent.click(await screen.findByText('fulltext commit'));
    await screen.findByTestId('rvw-commit-diff-area');
    await waitFor(() => {
      expect(screen.getAllByText('src/a.py').length).toBeGreaterThan(0);
    });

    // 默认 diff 视图：无全文容器
    expect(screen.queryByTestId('rvw-fulltext')).toBeNull();

    // 全文·改动后：提交时点完整全文（含 diff 折叠区之外的行）
    fireEvent.click(screen.getByRole('button', { name: '全文·改动后' }));
    const full = await screen.findByTestId('rvw-fulltext');
    await waitFor(() => {
      expect(full.textContent).toContain('unique-full-line');
    });

    // 全文·改动前：父提交版本（含被删除行）
    fireEvent.click(screen.getByRole('button', { name: '全文·改动前' }));
    await waitFor(() => {
      expect(screen.getByTestId('rvw-fulltext').textContent).toContain('removed-line');
    });

    // 切到新增文件：视图重置回 diff、改动前禁用
    fireEvent.click(screen.getByRole('tab', { name: /new\.py/ }));
    await waitFor(() => {
      expect(screen.queryByTestId('rvw-fulltext')).toBeNull();
    });
    const beforeBtn = screen.getByRole('button', { name: '全文·改动前' });
    expect(beforeBtn).toHaveProperty('disabled', true);

    // 新增文件的全文·改动后
    fireEvent.click(screen.getByRole('button', { name: '全文·改动后' }));
    await waitFor(() => {
      expect(screen.getByTestId('rvw-fulltext').textContent).toContain('new-content-line');
    });
  });

  it('BLOCK-29.5: branch selector reloads history with ref', async () => {
    const commitLog = vi.fn(() =>
      Promise.resolve({
        ok: true,
        data: {
          commits: [
            { sha: 'a1b2c3d4e5f6', shortSha: 'a1b2c3d', author: 'tester', isoDate: '2026-08-30T10:00:00Z', subject: 'branch commit', message: '' },
          ],
          count: 1,
        },
      })
    );
    const branchList = vi.fn(() =>
      Promise.resolve({
        ok: true,
        data: {
          branches: [
            { name: 'main', shortSha: 'a1b2c3d', isoDate: '', current: true },
            { name: 'feature', shortSha: 'b2c3d4e', isoDate: '', current: false },
          ],
          count: 2,
        },
      })
    );
    getBridgeMock.mockReturnValue(makeBridge({ commitLog, branchList }));

    renderReview();

    await waitFor(() => {
      expect(screen.getByTestId('rvw-review-progress')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('tab', { name: '历史' }));
    await screen.findByTestId('rvw-history-list');

    // 选择器渲染默认项 + 分支列表
    const select = screen.getByLabelText('提交历史分支');
    expect(select).toBeTruthy();

    // 切换分支 → commitLog 带 ref 重新加载
    fireEvent.change(select, { target: { value: 'feature' } });
    await waitFor(() => {
      expect(commitLog).toHaveBeenCalledWith(expect.objectContaining({ ref: 'feature' }));
    });
  });

  it('BLOCK-29.5: blame view renders per-line attribution', async () => {
    const commitLog = vi.fn(() =>
      Promise.resolve({
        ok: true,
        data: {
          commits: [
            { sha: 'a1b2c3d4e5f6', shortSha: 'a1b2c3d', author: 'tester', isoDate: '2026-08-30T10:00:00Z', subject: 'blame commit', message: '' },
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
            { path: 'src/a.py', oldPath: null, binary: false, hunks: [{ oldStart: 1, newStart: 1, lines: [{ type: 'ctx', text: 'l1' }, { type: 'ctx', text: 'l2' }] }] },
          ],
          truncated: false,
          summary: { added: 0, removed: 0 },
        },
      })
    );
    const commitFileContent = vi.fn(() =>
      Promise.resolve({ ok: true, data: { original: 'l1\nl2\n', modified: 'l1\nl2\n' } })
    );
    const blame = vi.fn(() =>
      Promise.resolve({
        ok: true,
        data: {
          path: 'src/a.py',
          lines: [
            { line: 1, sha: 'a1b2c3d' },
            { line: 2, sha: 'b2c3d4e' },
          ],
          commits: {
            a1b2c3d: { sha: 'a1b2c3d4e5f6', shortSha: 'a1b2c3d', author: 'alice', isoDate: '2026-08-30T10:00:00Z', subject: 'first' },
            b2c3d4e: { sha: 'b2c3d4e5f6a1', shortSha: 'b2c3d4e', author: 'bob', isoDate: '2026-08-30T11:00:00Z', subject: 'second' },
          },
          truncated: false,
        },
      })
    );
    getBridgeMock.mockReturnValue(makeBridge({ commitLog, commitDiff, commitFileContent, blame }));

    renderReview();

    await waitFor(() => {
      expect(screen.getByTestId('rvw-review-progress')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('tab', { name: '历史' }));
    fireEvent.click(await screen.findByText('blame commit'));
    await screen.findByTestId('rvw-commit-diff-area');
    await waitFor(() => {
      expect(screen.getAllByText('src/a.py').length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getByRole('button', { name: 'blame' }));
    const grid = await screen.findByTestId('rvw-blame');
    await waitFor(() => {
      expect(grid.textContent).toContain('alice');
    });
    expect(grid.textContent).toContain('a1b2c3d');
    expect(grid.textContent).toContain('bob');
    expect(grid.textContent).toContain('l1');
    expect(grid.textContent).toContain('l2');
    expect(blame).toHaveBeenCalledWith({ path: 'src/a.py', ref: 'a1b2c3d4e5f6' });
  });

  it('BLOCK-29.5: compare mode loads range diff between two commits', async () => {
    const commitLog = vi.fn(() =>
      Promise.resolve({
        ok: true,
        data: {
          commits: [
            { sha: 'a1b2c3d4e5f6', shortSha: 'a1b2c3d', author: 'tester', isoDate: '2026-08-30T12:00:00Z', subject: 'newer commit', message: '' },
            { sha: 'b2c3d4e5f6a1', shortSha: 'b2c3d4e', author: 'tester', isoDate: '2026-08-30T11:00:00Z', subject: 'older commit', message: '' },
          ],
          count: 2,
        },
      })
    );
    const commitDiff = vi.fn(() =>
      Promise.resolve({
        ok: true,
        data: {
          files: [
            { path: 'src/r.py', oldPath: null, binary: false, hunks: [{ oldStart: 1, newStart: 1, lines: [{ type: 'add', text: 'r1' }] }] },
          ],
          truncated: false,
          summary: { added: 1, removed: 0 },
        },
      })
    );
    const commitFileContent = vi.fn(() =>
      Promise.resolve({ ok: true, data: { original: 'old\n', modified: 'new\n' } })
    );
    getBridgeMock.mockReturnValue(makeBridge({ commitLog, commitDiff, commitFileContent }));

    renderReview();

    await waitFor(() => {
      expect(screen.getByTestId('rvw-review-progress')).toBeTruthy();
    });

    fireEvent.click(screen.getByRole('tab', { name: '历史' }));
    await screen.findByTestId('rvw-history-list');

    // 进入对比模式 → 点选基准 → 点选目标
    fireEvent.click(screen.getByRole('button', { name: '对比' }));
    expect(screen.getByText('对比模式：点选基准提交')).toBeTruthy();
    fireEvent.click(await screen.findByText('older commit'));
    expect(screen.getByText(/已选基准 b2c3d4e/)).toBeTruthy();
    fireEvent.click(await screen.findByText('newer commit'));

    await screen.findByTestId('rvw-compare-info');
    expect(commitDiff).toHaveBeenCalledWith({ fromRef: 'b2c3d4e5f6a1', toRef: 'a1b2c3d4e5f6' });
    expect(screen.getByTestId('rvw-compare-info').textContent).toContain('对比 b2c3d4e..a1b2c3d');
    expect(screen.getByTestId('rvw-compare-info').textContent).toContain('1 文件');
  });

  it('BLOCK-29.5: stash list, tag optgroup and untracked preview', async () => {
    const stashList = vi.fn(() =>
      Promise.resolve({
        ok: true,
        data: { stashes: [{ ref: 'stash@{0}', shortSha: 'a1b2c3d', isoDate: '2026-08-30T10:00:00Z', subject: 'WIP on main' }], count: 1 },
      })
    );
    const tagList = vi.fn(() =>
      Promise.resolve({
        ok: true,
        data: { tags: [{ name: 'v229-demo', shortSha: 'b2c3d4e', isoDate: '2026-08-30T10:00:00Z' }], count: 1 },
      })
    );
    const fileContent = vi.fn(() =>
      Promise.resolve({ ok: true, data: { content: '# hello untracked\n', encoding: 'utf-8', size: 19 } })
    );
    getBridgeMock.mockReturnValue(makeBridge({ stashList, tagList, fileContent }));

    renderReview();

    await waitFor(() => {
      expect(screen.getByTestId('rvw-review-progress')).toBeTruthy();
    });

    // 历史 tab：stash 列表 + 标签分组
    fireEvent.click(screen.getByRole('tab', { name: '历史' }));
    const list = await screen.findByTestId('rvw-history-list');
    await waitFor(() => {
      expect(screen.getByTestId('rvw-stash-list')).toBeTruthy();
    });
    expect(screen.getByTestId('rvw-stash-list').textContent).toContain('WIP on main');
    expect(stashList).toHaveBeenCalled();
    const select = screen.getByLabelText('提交历史分支') as HTMLSelectElement;
    const optgroup = select.querySelector('optgroup');
    expect(optgroup).toBeTruthy();
    expect(optgroup?.getAttribute('label')).toBe('标签');
    expect(list).toBeTruthy();
  });

  it('BLOCK-29.1: dock accordion rows expand inline diff on click', async () => {
    getBridgeMock.mockReturnValue(makeBridge());

    render(
      <MemoryRouter initialEntries={['/project/p1/results']}>
        <ReviewMode variant="dock" onClose={vi.fn()} />
      </MemoryRouter>
    );

    const list = await screen.findByTestId('rvw-file-list');
    expect(list.textContent).toContain('a.py');

    // 当前选中文件（首个 diff 文件）默认展开
    const row = screen.getByTitle('src/a.py');
    expect(row.getAttribute('aria-expanded')).toBe('true');
    await waitFor(() => {
      expect(document.querySelector('.rvw-acc-diff')).not.toBeNull();
    });

    // 点击收起
    fireEvent.click(row);
    expect(row.getAttribute('aria-expanded')).toBe('false');
    expect(document.querySelector('.rvw-acc-diff')).toBeNull();

    // 再次点击展开
    fireEvent.click(row);
    expect(row.getAttribute('aria-expanded')).toBe('true');
    await waitFor(() => {
      expect(document.querySelector('.rvw-acc-diff')).not.toBeNull();
    });
  });

  it('BLOCK-29.2: row discard/file-history actions and history head tools', async () => {
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
    const discardFile = vi.fn(() => Promise.resolve({ ok: true, data: { discarded: ['src/a.py'], deleted: false } }));
    const undoLastCommit = vi.fn(() => Promise.resolve({ ok: true, data: { undoneCommit: 'a1b2c3d4e5f6' } }));
    getBridgeMock.mockReturnValue(makeBridge({ commitLog, discardFile, undoLastCommit }));
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    // 行内操作按钮仅存在于 dock 手风琴
    render(
      <MemoryRouter initialEntries={['/project/p1/results']}>
        <ReviewMode variant="dock" onClose={vi.fn()} />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('rvw-review-progress')).toBeTruthy();
    });

    // 1) 行内「放弃更改」→ confirm 后调用 discardFile
    fireEvent.click(screen.getByLabelText('放弃对 a.py 的更改'));
    await waitFor(() => {
      expect(discardFile).toHaveBeenCalledWith({ path: 'src/a.py' });
    });
    expect(confirmSpy).toHaveBeenCalled();

    // 2) 行内「历史」→ 按文件过滤加载
    fireEvent.click(screen.getByLabelText('查看 a.py 的历史提交'));
    await waitFor(() => {
      expect(commitLog).toHaveBeenCalledWith(expect.objectContaining({ file: 'src/a.py' }));
    });
    const filter = await screen.findByText(/文件: src\/a\.py/);
    expect(filter).toBeTruthy();

    // 3) 清除过滤 → file: null
    fireEvent.click(screen.getByLabelText('清除文件过滤'));
    await waitFor(() => {
      expect(commitLog).toHaveBeenCalledWith(expect.objectContaining({ file: null }));
    });

    // 4) 撤销上次提交 → confirm 后调用 undoLastCommit
    fireEvent.click(screen.getByText('撤销上次提交'));
    await waitFor(() => {
      expect(undoLastCommit).toHaveBeenCalled();
    });
    confirmSpy.mockRestore();
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
