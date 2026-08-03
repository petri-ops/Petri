import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildResultArtifactPickerGroups } from '@/lib/result-artifact-display';
import type { ResultArtifactNavSection } from '@/lib/result-manifest';
import { CompactResultNavigator } from './CompactResultNavigator';

afterEach(cleanup);

const primarySections: ResultArtifactNavSection[] = [
  {
    id: 'plots',
    label: '图表',
    artifactNames: ['volcano.png', 'volcano.svg', 'heatmap.png'],
    artifacts: [
      { name: 'volcano.png', label: '火山图' },
      { name: 'volcano.svg', label: '火山图' },
      { name: 'heatmap.png', label: '热图' },
    ],
    kind: 'plot',
  },
];

const relatedSections: ResultArtifactNavSection[] = [
  {
    id: 'data',
    label: '数据',
    artifactNames: ['counts.csv'],
    artifacts: [{ name: 'counts.csv', label: '表达矩阵' }],
    kind: 'data',
  },
];

describe('CompactResultNavigator', () => {
  it('combines result identity, trust and workspace actions in one toolbar', () => {
    const onBack = vi.fn();
    const onAskAgent = vi.fn();
    const onModeChange = vi.fn();
    render(
      <CompactResultNavigator
        groups={buildResultArtifactPickerGroups(primarySections)}
        selectedArtifactName="volcano.svg"
        selectedArtifactLabel="火山图"
        selectedKindLabel="图表"
        selectedIcon="svg"
        relatedSections={relatedSections}
        truth={{ tone: 'valid', label: '可信结果' }}
        availabilityStatus="unavailable"
        canProjectSource
        canReviewVersions
        onBack={onBack}
        onAskAgent={onAskAgent}
        onModeChange={onModeChange}
        onSelectArtifact={() => undefined}
      />,
    );

    expect(screen.queryByText('当前结果')).toBeNull();
    expect(screen.getByText('可信结果')).toBeTruthy();
    expect(screen.getByText('文件不可用')).toBeTruthy();
    expect((screen.getByLabelText('切换当前结果') as HTMLSelectElement).value).toBe('volcano.png');
    fireEvent.click(screen.getByRole('button', { name: '返回对话' }));
    fireEvent.click(screen.getByRole('button', { name: '询问 Agent' }));
    fireEvent.click(screen.getByRole('button', { name: '代码' }));
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onAskAgent).toHaveBeenCalledTimes(1);
    expect(onModeChange).toHaveBeenCalledWith('code');
    expect(screen.queryByText('Honeycomb')).toBeNull();
    expect(screen.queryByText('二级导航')).toBeNull();
  });

  it('selects the primary artifact through the existing single selection callback', () => {
    const onSelectArtifact = vi.fn();
    render(
      <CompactResultNavigator
        groups={buildResultArtifactPickerGroups(primarySections)}
        selectedArtifactName="volcano.png"
        selectedArtifactLabel="火山图"
        selectedKindLabel="图表"
        selectedIcon="svg"
        relatedSections={relatedSections}
        onSelectArtifact={onSelectArtifact}
      />,
    );

    fireEvent.change(screen.getByLabelText('切换当前结果'), {
      target: { value: 'heatmap.png' },
    });
    expect(onSelectArtifact).toHaveBeenCalledWith('heatmap.png', 'plots');
  });

  it('keeps related files in secondary actions and closes the menu after selection', () => {
    const onSelectArtifact = vi.fn();
    render(
      <CompactResultNavigator
        groups={buildResultArtifactPickerGroups(primarySections)}
        selectedArtifactName="volcano.png"
        selectedArtifactLabel="火山图"
        selectedKindLabel="图表"
        selectedIcon="svg"
        relatedSections={relatedSections}
        secondaryActions={<button type="button">导出 SVG</button>}
        onSelectArtifact={onSelectArtifact}
      />,
    );

    const summary = screen.getByLabelText('更多结果操作');
    fireEvent.click(summary);
    expect(screen.getByText('相关文件 · 1')).toBeTruthy();
    expect(screen.getByText('导出 SVG')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '表达矩阵' }));
    expect(onSelectArtifact).toHaveBeenCalledWith('counts.csv', 'data');
    expect((summary.parentElement as HTMLDetailsElement).open).toBe(false);
  });
});
