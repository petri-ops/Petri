/**
 * LineageViewSwitch 组件契约测试（BLOCK-138 P1；独立评审 P2 补口——切换器此前在
 * impact-map 只挂在不渲染它的三个测试上，属假覆盖）。
 *
 * 本文件是既有组件的覆盖回填（非新契约，HK-01 红绿不适用）：断言默认条带形态
 * （LineageStrip 挂载 + aria-pressed 真值）、「画布」互斥换挂 LineageGraph、
 * aria-pressed 随形态翻转、projectId/jobId 原样透传。子组件整件 mock
 * （LineageStrip/LineageGraph 各自 fetch /lineage，数据契约归其自身测试文件）。
 */

import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted<{ strip: number; graph: number; lastProps: Record<string, unknown> }>(
  () => ({ strip: 0, graph: 0, lastProps: {} }),
);

vi.mock('./LineageStrip', (): Record<string, unknown> => ({
  LineageStrip: (props: Record<string, unknown>) => {
    calls.strip += 1;
    calls.lastProps = props;
    return <div data-testid="lineage-strip-stub" />;
  },
}));

vi.mock('./LineageGraph', (): Record<string, unknown> => ({
  LineageGraph: (props: Record<string, unknown>) => {
    calls.graph += 1;
    calls.lastProps = props;
    return <div data-testid="lineage-graph-stub" />;
  },
}));

import { LineageViewSwitch } from './LineageViewSwitch';

describe('LineageViewSwitch', () => {
  afterEach(() => {
    cleanup();
    calls.strip = 0;
    calls.graph = 0;
  });

  it('默认条带形态：LineageStrip 挂载、画布不挂载、aria-pressed 真值、props 原样透传', () => {
    render(<LineageViewSwitch projectId="p1" jobId="job1" />);
    expect(screen.getByTestId('lineage-strip-stub')).toBeTruthy();
    expect(screen.queryByTestId('lineage-graph-stub')).toBeNull();
    const stripBtn = screen.getByRole('button', { name: '条带' });
    const graphBtn = screen.getByRole('button', { name: '画布' });
    expect(stripBtn.getAttribute('aria-pressed')).toBe('true');
    expect(graphBtn.getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('group', { name: '血缘形态' })).toBeTruthy();
    expect(calls.lastProps.projectId).toBe('p1');
    expect(calls.lastProps.jobId).toBe('job1');
  });

  it('点「画布」互斥换挂 LineageGraph 且 aria-pressed 翻转', () => {
    render(<LineageViewSwitch projectId="p1" jobId="job1" />);
    fireEvent.click(screen.getByRole('button', { name: '画布' }));
    expect(screen.getByTestId('lineage-graph-stub')).toBeTruthy();
    expect(screen.queryByTestId('lineage-strip-stub')).toBeNull();
    expect(screen.getByRole('button', { name: '条带' }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('button', { name: '画布' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('切回「条带」恢复默认形态；projectId=null 原样透传（诚实自隐归子组件）', () => {
    render(<LineageViewSwitch projectId={null} jobId="job1" />);
    fireEvent.click(screen.getByRole('button', { name: '画布' }));
    expect(screen.getByTestId('lineage-graph-stub')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '条带' }));
    expect(screen.getByTestId('lineage-strip-stub')).toBeTruthy();
    expect(screen.queryByTestId('lineage-graph-stub')).toBeNull();
    expect(calls.lastProps.projectId).toBeNull();
  });
});
