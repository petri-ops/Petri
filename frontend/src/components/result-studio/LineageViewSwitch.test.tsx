/**
 * LineageViewSwitch 组件契约测试（BLOCK-138 P1；独立评审 P2 补口——切换器此前在
 * impact-map 只挂在不渲染它的三个测试上，属假覆盖）。
 *
 * 本文件是既有组件的覆盖回填（非新契约，HK-01 红绿不适用）：断言默认条带形态
 * （LineageStrip 挂载 + aria-pressed 真值）、「画布」互斥换挂 LineageGraph、
 * aria-pressed 随形态翻转、projectId/jobId 原样透传。子组件整件 mock
 * （LineageStrip/LineageGraph 各自 fetch /lineage，数据契约归其自身测试文件）。
 *
 * 2026-10-05 BLOCK-140 R-1 扩展：文件后半「R-1 空态契约」为新契约（HK-01 红绿
 * 适用——当前实现无判空，①②④先红）；切换器自取 /lineage 的数据源
 * fetchResultLineage（resultStudioClient.ts:411，签名 (jobId, projectId)）整件
 * mock（D3：判空以 /lineage 响应为准，网络契约归 resultStudioClient 自身测试）。
 */

import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

// R-1（BLOCK-140）— 切换器自取 /lineage 的判空数据源：fetchResultLineage 整件
// mock（D3：判空以 /lineage 响应为准；请求构造契约归 resultStudioClient 自身测试）。
// 组件按既有签名调用：fetchResultLineage(jobId, projectId)（resultStudioClient.ts:411）。
const lineageClient = vi.hoisted(() => ({
  fetchResultLineage: vi.fn(),
}));

vi.mock('@/components/result-studio/resultStudioClient', (): Record<string, unknown> => ({
  fetchResultLineage: lineageClient.fetchResultLineage,
}));

import { LineageViewSwitch } from './LineageViewSwitch';

// ResultLineageNode 为 resultStudioClient 模块内私有类型（未导出），fixture 按其
// 字段形状（toolJobId/toolId/isCurrent）以普通对象构造。
const lineageNode = (toolJobId: string) => ({ toolJobId, toolId: 'tool-x', isCurrent: false });
const okLineage = (chain: ReturnType<typeof lineageNode>[]) => ({
  ok: true,
  lineage: { chain, downstreamCount: 0 },
});

// 文件级默认响应：链≥2（正常图）——首个 describe 的既有回归用例在 R-1 实现落地后
// （切换器开始自取 /lineage）也能拿到健康数据照常渲染；各用例可按需覆盖。
beforeEach(() => {
  lineageClient.fetchResultLineage.mockResolvedValue(
    okLineage([lineageNode('job0'), lineageNode('job1')]),
  );
});

describe('LineageViewSwitch', () => {
  afterEach(() => {
    cleanup();
    calls.strip = 0;
    calls.graph = 0;
  });

  it('默认条带形态：LineageStrip 挂载、画布不挂载、aria-pressed 真值、props 原样透传', async () => {
    render(<LineageViewSwitch projectId="p1" jobId="job1" />);
    // R-1 起切换器自取 /lineage（文件级默认响应=链≥2）：等取数落地再断言形态
    await waitFor(() => expect(screen.getByTestId('lineage-strip-stub')).toBeTruthy());
    expect(screen.queryByTestId('lineage-graph-stub')).toBeNull();
    const stripBtn = screen.getByRole('button', { name: '条带' });
    const graphBtn = screen.getByRole('button', { name: '画布' });
    expect(stripBtn.getAttribute('aria-pressed')).toBe('true');
    expect(graphBtn.getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('group', { name: '血缘形态' })).toBeTruthy();
    expect(calls.lastProps.projectId).toBe('p1');
    expect(calls.lastProps.jobId).toBe('job1');
  });

  it('点「画布」互斥换挂 LineageGraph 且 aria-pressed 翻转', async () => {
    render(<LineageViewSwitch projectId="p1" jobId="job1" />);
    await waitFor(() => expect(screen.getByRole('button', { name: '画布' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '画布' }));
    expect(screen.getByTestId('lineage-graph-stub')).toBeTruthy();
    expect(screen.queryByTestId('lineage-strip-stub')).toBeNull();
    expect(screen.getByRole('button', { name: '条带' }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('button', { name: '画布' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('切回「条带」恢复默认形态；projectId=null 原样透传（诚实自隐归子组件）', async () => {
    render(<LineageViewSwitch projectId={null} jobId="job1" />);
    await waitFor(() => expect(screen.getByRole('button', { name: '画布' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '画布' }));
    expect(screen.getByTestId('lineage-graph-stub')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '条带' }));
    expect(screen.getByTestId('lineage-strip-stub')).toBeTruthy();
    expect(screen.queryByTestId('lineage-graph-stub')).toBeNull();
    expect(calls.lastProps.projectId).toBeNull();
  });
});

/**
 * R-1 空态契约（BLOCK-140，plan §2 R-1 + §5 D3）——切换器自取 /lineage：
 * lineage=null（无图）或 chain<2（单节点链）时整组不渲染（无切换钮无 wrapper，
 * 不再只依赖子组件自隐这单层保险）；加载中渲染 null（避免瞬态闪现）；
 * chain≥2 维持现状（切换钮组+默认条带）。HK-01 红绿先行：当前实现无判空，
 * ①②④先红，实现转绿。
 */
describe('LineageViewSwitch R-1 空态契约（BLOCK-140）', () => {
  afterEach(() => {
    cleanup();
    lineageClient.fetchResultLineage.mockReset();
  });

  it('①lineage=null（无图）：整组不渲染（无切换钮无 wrapper），判空取数走 fetchResultLineage(jobId, projectId)', async () => {
    lineageClient.fetchResultLineage.mockResolvedValue({ ok: true, lineage: null });
    const { container } = render(<LineageViewSwitch projectId="p1" jobId="job1" />);
    // 终态：无图 → 整组（含 wrapper）都不渲染
    await waitFor(() => expect(container.firstChild).toBeNull());
    expect(screen.queryByRole('group', { name: '血缘形态' })).toBeNull();
    expect(screen.queryByRole('button', { name: '条带' })).toBeNull();
    expect(screen.queryByRole('button', { name: '画布' })).toBeNull();
    // D3 接线面：判空数据源=真实客户端签名 (jobId, projectId)
    expect(lineageClient.fetchResultLineage).toHaveBeenCalledWith('job1', 'p1');
  });

  it('②chain.length<2（单节点链）：整组不渲染', async () => {
    lineageClient.fetchResultLineage.mockResolvedValue(okLineage([lineageNode('job1')]));
    const { container } = render(<LineageViewSwitch projectId="p1" jobId="job1" />);
    await waitFor(() => expect(container.firstChild).toBeNull());
    expect(screen.queryByRole('group', { name: '血缘形态' })).toBeNull();
    expect(screen.queryByRole('button', { name: '条带' })).toBeNull();
    expect(screen.queryByRole('button', { name: '画布' })).toBeNull();
    expect(lineageClient.fetchResultLineage).toHaveBeenCalledWith('job1', 'p1');
  });

  it('③chain≥2：切换钮组在场 + 默认条带形态（现状行为回归）', async () => {
    render(<LineageViewSwitch projectId="p1" jobId="job1" />);
    // 文件级默认响应即链≥2；组与默认条带形态在场
    await waitFor(() => expect(screen.getByRole('group', { name: '血缘形态' })).toBeTruthy());
    expect(screen.getByRole('button', { name: '条带' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '画布' })).toBeTruthy();
    expect(screen.getByTestId('lineage-strip-stub')).toBeTruthy();
    expect(screen.queryByTestId('lineage-graph-stub')).toBeNull();
  });

  it('④加载中：渲染 null（避免瞬态闪现）', () => {
    lineageClient.fetchResultLineage.mockReturnValue(new Promise(() => {}));
    const { container } = render(<LineageViewSwitch projectId="p1" jobId="job1" />);
    // 加载窗口内即不可见：无闪现（同步断言，不等取数）
    expect(container.firstChild).toBeNull();
    expect(screen.queryByRole('group', { name: '血缘形态' })).toBeNull();
    expect(screen.queryByRole('button', { name: '条带' })).toBeNull();
  });
});

describe('LineageViewSwitch P1 钉住入口透传（BLOCK-140 第二刀，HK-01 先红）', () => {
  afterEach(() => {
    cleanup();
    lineageClient.fetchResultLineage.mockReset();
  });

  it('onPinArtifact 原样透传：条带形态在场即带回调，切「画布」后仍带（两形态同源）', async () => {
    const onPinArtifact = vi.fn();
    render(<LineageViewSwitch projectId="p1" jobId="job1" onPinArtifact={onPinArtifact} />);
    await waitFor(() => expect(calls.lastProps.onPinArtifact).toBe(onPinArtifact));
    fireEvent.click(screen.getByRole('button', { name: '画布' }));
    expect(screen.getByTestId('lineage-graph-stub')).toBeTruthy();
    expect(calls.lastProps.onPinArtifact).toBe(onPinArtifact);
  });
});
