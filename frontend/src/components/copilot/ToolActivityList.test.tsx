import { cleanup, fireEvent, render, screen, act } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ToolActivityList } from './ToolActivityList';
import { groupToolActivities } from './toolActivity';
import assert from 'node:assert/strict';
import { gewuEvents } from '@/lib/events';
import type { ToolActivityItem } from './toolActivity';

function activity(
  status: ToolActivityItem['status'],
  overrides: Partial<ToolActivityItem> = {}
): ToolActivityItem {
  return {
    key: `${status}:1`,
    name: 'run_tool',
    status,
    actionLabel: '已运行',
    actionDetail: 'deseq2 --input counts.csv',
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
});

describe('ToolActivityList (UI-271 内联手风琴)', () => {
  it('renders the collapsed summary bar only by default', () => {
    render(<ToolActivityList activities={[activity('success')]} processingDurationMs={3900} />);
    expect(screen.getByText(/已完成 1 项/)).toBeTruthy();
    // UI-271 增补：摘要条显式携带任务耗时
    expect(screen.getByText(/耗时 3.9 s/)).toBeTruthy();
    expect(screen.queryByText('deseq2 --input counts.csv')).toBeNull();
    expect(screen.getByRole('button', { name: '展开执行记录' }).getAttribute('aria-expanded')).toBe('false');
  });

  it('expands inline on click, each row stays collapsed until clicked (UI-272 两级折叠)', () => {
    render(
      <ToolActivityList
        activities={[
          activity('success', {
            key: 's1',
            output: { tail: 'R version 4.4.0\n', truncated: false },
          }),
        ]}
      />
    );
    fireEvent.click(screen.getByText(/已完成 1 项/));
    // 展开手风琴：行头出现命令摘要 + 状态标签，但详情（输出）保持收起
    expect(screen.getByText('deseq2 --input counts.csv')).toBeTruthy();
    expect(screen.getByText('已完成')).toBeTruthy();
    expect(screen.queryByText(/R version 4.4.0/)).toBeNull();

    // 点击该执行行展开详情
    fireEvent.click(screen.getByRole('button', { name: '展开执行详情 已运行' }));
    expect(screen.getByText(/R version 4.4.0/)).toBeTruthy();
    expect(screen.getByText('run_tool')).toBeTruthy();

    // 再次点击收起详情
    fireEvent.click(screen.getByRole('button', { name: '收起执行详情 已运行' }));
    expect(screen.queryByText(/R version 4.4.0/)).toBeNull();

    // 收起整个手风琴
    fireEvent.click(screen.getByText(/已完成 1 项/));
    expect(screen.queryByText('deseq2 --input counts.csv')).toBeNull();
  });

  it('keeps a running group collapsed with a running summary (click-driven, no auto-expand)', () => {
    render(<ToolActivityList activities={[activity('running', { key: 'r1' })]} />);
    expect(screen.getByText(/正在处理 1\/1 项/)).toBeTruthy();
    expect(screen.queryByText('deseq2 --input counts.csv')).toBeNull();
  });

  it('shows per-iteration reasoning rows before the matching tool, collapsed until clicked (UI-272)', () => {
    render(
      <ToolActivityList
        activities={[
          activity('success', { key: 'a1', iteration: 2 }),
          activity('success', { key: 'a2', iteration: 2 }),
        ]}
        reasoningByIteration={{ 1: '第一轮先看目录', 2: '第二轮再改文件' }}
      />
    );
    fireEvent.click(screen.getByText(/已完成 2 项/));
    // 第 2 轮思考段只在该轮首个工具前出现一次，默认收起
    expect(screen.getAllByText('思考 · 第 2 轮').length).toBe(1);
    expect(screen.queryByText('第二轮再改文件')).toBeNull();

    // 展开第 2 轮思考
    fireEvent.click(screen.getByRole('button', { name: '展开思考 第 2 轮' }));
    expect(screen.getByText('第二轮再改文件')).toBeTruthy();

    // 第 1 轮思考没有对应工具，补在末尾，同样默认收起
    expect(screen.getAllByText('思考 · 第 1 轮').length).toBe(1);
    expect(screen.queryByText('第一轮先看目录')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '展开思考 第 1 轮' }));
    expect(screen.getByText('第一轮先看目录')).toBeTruthy();
  });

  it('renders a changeDiff file row like the changes card and jumps to review on click (UI-273)', () => {
    render(
      <ToolActivityList
        activities={[
          activity('success', {
            key: 'w1',
            actionLabel: '已修改',
            actionDetail: 'src/u273.ts',
            changeDiff: {
              added: 3,
              removed: 1,
              truncated: false,
              hunks: [
                {
                  oldStart: 1,
                  newStart: 1,
                  lines: [
                    { type: 'ctx', text: 'alpha' },
                    { type: 'del', text: 'beta' },
                    { type: 'add', text: 'beta2' },
                  ],
                },
              ],
            },
          }),
        ]}
      />
    );
    fireEvent.click(screen.getByText(/已完成 1 项/));
    fireEvent.click(screen.getByRole('button', { name: '展开执行详情 已修改' }));

    // 文件行：路径 + ±统计（与工作区改动卡片同构）
    const fileRow = screen.getByRole('button', { name: /src\/u273\.ts \+3 −1/ });
    expect(fileRow.textContent).toContain('+3');
    expect(fileRow.textContent).toContain('−1');
    expect(fileRow.closest('.sc-tool-changediff')?.querySelector('.sc-tool-changediff-preview')).toBeTruthy();

    // 点击文件行 → 派发 reviewOpenFile 携带路径
    const seen: Array<{ filePath: string }> = [];
    const listener = (e: Event) => {
      seen.push((e as CustomEvent<{ filePath: string }>).detail);
    };
    window.addEventListener(gewuEvents.reviewOpenFile, listener);
    try {
      fireEvent.click(fileRow);
    } finally {
      window.removeEventListener(gewuEvents.reviewOpenFile, listener);
    }
    expect(seen).toEqual([{ filePath: 'src/u273.ts' }]);
  });
});

describe('ToolActivityList (UI-383 常规只读折叠)', () => {
  it('groupToolActivities：连续只读成功项归并，非常规/迭代变化断开', () => {
    const read = (key: string, iteration?: number): ToolActivityItem => ({
      key,
      name: 'workspace_read',
      status: 'success',
      actionLabel: '已读取',
      actionDetail: 'a.md',
      iteration,
    });
    const failedRead: ToolActivityItem = { ...read('fail'), status: 'error' };
    const exec: ToolActivityItem = { ...read('exec'), name: 'workspace_exec', actionLabel: '已运行' };
    const groups = groupToolActivities([
      read('r1'), read('r2'), read('r3', 2), failedRead, read('r4', 2), exec, read('r5', 2),
    ]);
    assert.equal(groups.filter((g) => g.kind === 'routine').length, 4);
    // r1,r2 同为无迭代 → 一组；r3 带迭代 2 → 断开成新组
    assert.equal(groups[0].items.length, 2);
    assert.equal(groups[1].items[0].iteration, 2);
    assert.equal(groups[2].items[0].status, 'error');
  });

  it('折叠阈值 ≥3：少于 3 项的常规组保持逐条渲染', () => {
    const read = (key: string): ToolActivityItem => ({
      key, name: 'workspace_read', status: 'success', actionLabel: '已读取', actionDetail: 'a.md',
    });
    render(<ToolActivityList activities={[read('a'), read('b')]} />);
    fireEvent.click(screen.getByRole('button', { name: '展开执行记录' }));
    expect(screen.queryByText(/常规读取：/)).toBeNull();
    expect(screen.getAllByText(/a\.md/).length).toBe(2);
  });

  it('≥3 项连续只读折叠为汇总行，点击展开逐条', () => {
    const reads = ['a', 'b', 'c', 'd'].map((key) => ({
      key, name: 'workspace_read', status: 'success' as const, actionLabel: '已读取', actionDetail: `${key}.md`,
    }));
    render(<ToolActivityList activities={reads} />);
    fireEvent.click(screen.getByRole('button', { name: '展开执行记录' }));
    const summary = screen.getByText(/常规读取：读取 4 · 全部成功/);
    expect(summary).toBeTruthy();
    expect(screen.queryByText('a.md')).toBeNull();
    fireEvent.click(summary);
    expect(screen.getByText('a.md')).toBeTruthy();
    expect(screen.getByText('d.md')).toBeTruthy();
  });
});

describe('BLOCK-108 P3 Qoder 行形态（时间线模式 collapseWhenSettled）', () => {
  const execActivity = (overrides: Partial<ToolActivityItem> = {}): ToolActivityItem => ({
    key: 'exec-1',
    name: 'workspace_exec',
    status: 'success',
    actionLabel: '已运行',
    command: 'npm run docs:reconcile 2>&1 | tail -60',
    actionDetail: 'npm run docs:reconcile',
    output: { tail: 'zero manual review candidates\n', truncated: false },
    durationMs: 1200,
    ...overrides,
  });

  it('Q2 计数式簇头：完成态「执行工具 N 次」+ 需注意计数；运行态带秒表字样', () => {
    const { rerender } = render(
      <ToolActivityList
        activities={[activity('success', { key: 'a' }), execActivity({ key: 'e' })]}
        collapseWhenSettled
      />
    );
    expect(screen.getByText(/执行工具 2 次/)).toBeTruthy();
    expect(screen.queryByText(/已完成 \d+ 项/)).toBeNull();

    rerender(
      <ToolActivityList
        activities={[
          activity('success', { key: 'a' }),
          activity('error', { key: 'b' }),
        ]}
        collapseWhenSettled
      />
    );
    expect(screen.getByText(/执行工具 2 次 · 1 项需注意/)).toBeTruthy();

    rerender(<ToolActivityList activities={[activity('running', { key: 'r' })]} collapseWhenSettled showRunningStopwatch />);
    expect(screen.getByText(/正在执行工具 1\/1 项/)).toBeTruthy();
  });

  it('Q3 统一单行：exec 行默认折叠（无终端块），无 routine 二级折叠', () => {
    const reads = ['a', 'b', 'c'].map((key) => activity('success', {
      key,
      name: 'workspace_read',
      actionLabel: '已读取',
      actionDetail: `${key}.md`,
    }));
    render(
      <ToolActivityList
        activities={[...reads, execActivity()]}
        collapseWhenSettled
      />
    );
    fireEvent.click(screen.getByText(/执行工具 4 次/));
    // exec 也只是单行：命令预览在，输出块不在
    expect(screen.getByText('终端命令 已运行')).toBeTruthy();
    expect(screen.getAllByText('npm run docs:reconcile 2>&1 | tail -60').length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByTestId('tool-term-output')).toBeNull();
    // 无 routine 二级折叠：3 条读取逐条单行
    expect(screen.queryByText(/常规读取：/)).toBeNull();
    expect(screen.getByText('a.md')).toBeTruthy();
    expect(screen.getByText('c.md')).toBeTruthy();
  });

  it('Q4 点击展开：exec 行展开出命令+输出，再点击收起', () => {
    render(<ToolActivityList activities={[execActivity()]} collapseWhenSettled />);
    fireEvent.click(screen.getByText(/执行工具 1 次/));
    fireEvent.click(screen.getByTestId('qoder-row-head'));
    expect(screen.getByTestId('tool-term-output')).toBeTruthy();
    expect(screen.getByTestId('tool-term-output').textContent).toContain('zero manual review candidates');
    fireEvent.click(screen.getByTestId('qoder-row-head'));
    expect(screen.queryByTestId('tool-term-output')).toBeNull();
  });

  it('Q5 思考入簇：「已思考」单行置顶，折叠预览 + 点击展开全文', () => {
    render(
      <ToolActivityList
        activities={[execActivity()]}
        reasoningByIteration={{ 2: '先确认登记行再改文档\n第二行细节' }}
        collapseWhenSettled
      />
    );
    fireEvent.click(screen.getByText(/执行工具 1 次/));
    expect(screen.getByText('已思考')).toBeTruthy();
    expect(screen.getByText('先确认登记行再改文档')).toBeTruthy();
    expect(screen.queryByText('第二行细节')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '展开 已思考' }));
    expect(screen.getByText(/第二行细节/)).toBeTruthy();
  });
});

describe('BLOCK-107 P2c 运行中秒表（showRunningStopwatch）', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('启用时按墙钟累计，且转终态后不再挂计时器', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-20T12:00:00Z'));
    const { rerender } = render(
      <ToolActivityList activities={[activity('running')]} showRunningStopwatch />,
    );
    expect(screen.getByText(/正在处理 1\/1 项/).textContent).not.toMatch(/已运行/);
    act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.getByText(/正在处理 1\/1 项/).textContent).toMatch(/已运行 1\.0 s/);
    act(() => { vi.advanceTimersByTime(1500); });
    // 读数由 1 秒 interval 落点写入：推进 2.5 s 时最后一次 tick 在 2000 ms
    expect(screen.getByText(/正在处理 1\/1 项/).textContent).toMatch(/已运行 2\.0 s/);

    // 终态：秒表消失，改显既有活动耗时，且 interval 已卸载（再推进不重渲染）
    rerender(<ToolActivityList activities={[activity('success', { durationMs: 4200 })]} showRunningStopwatch />);
    expect(screen.queryByText(/已运行 \d/)).toBeNull();
    expect(screen.getByText(/耗时 4\.2 s/)).toBeTruthy();
    act(() => { vi.advanceTimersByTime(5000); });
    expect(screen.getByText(/耗时 4\.2 s/)).toBeTruthy();
  });

  it('默认不启用：既有摘要文本零变化（不挂计时器）', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-20T12:00:00Z'));
    render(<ToolActivityList activities={[activity('running')]} />);
    act(() => { vi.advanceTimersByTime(5000); });
    const text = screen.getByText(/正在处理 1\/1 项/).textContent || '';
    expect(text).not.toMatch(/已运行/);
  });
});
