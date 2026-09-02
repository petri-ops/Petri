import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { ToolActivityList } from './ToolActivityList';
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
});
