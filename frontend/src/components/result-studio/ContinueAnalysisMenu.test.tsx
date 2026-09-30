import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import type { CopilotAskDetail } from '@/lib/events';
import { gewuEvents } from '@/lib/events';
import type { ResultArtifactNavSection } from '@/lib/result-manifest';
import { buildResultArtifactPickerGroups } from '@/lib/result-artifact-display';
import { CompactResultNavigator } from './CompactResultNavigator';
import { ContinueAnalysisMenu } from './ContinueAnalysisMenu';

// BLOCK-83 D7：菜单目录驱动后，测试用中性工具名 mock 目录（两件带文件输入，
// 一件无文件输入用于「无候选不渲染」断言）。
vi.mock('@/lib/tool-catalog', () => ({
  useToolCatalog: () => ({
    tools: [
      { id: 'alpha-analysis', title: 'Alpha 分析', inputs: [{ id: 'input_csv', type: 'file', required: true }], comingSoon: false },
      { id: 'beta-enrichment', title: 'Beta 富集', inputs: [{ id: 'genes_csv', type: 'file', required: true }], comingSoon: false },
      { id: 'gamma-view', title: 'Gamma 查看', inputs: [], comingSoon: false },
    ],
    loading: false,
    error: null,
    reload: () => undefined,
  }),
  findCatalogTool: () => null,
}));

afterEach(cleanup);

/** 从 dispatchEvent spy 调用里过滤出 copilot-ask 事件（剔除 click 冒泡等噪音）。 */
function copilotAskEventsFrom(
  spy: MockInstance<typeof window.dispatchEvent>,
): Array<CustomEvent<CopilotAskDetail>> {
  return spy.mock.calls
    .map(([event]) => event)
    .filter(
      (event): event is CustomEvent<CopilotAskDetail> =>
        event instanceof CustomEvent && event.type === gewuEvents.copilotAsk,
    );
}

describe('ContinueAnalysisMenu', () => {
  it('目录驱动：带文件输入的已装分析都成为菜单项', () => {
    render(
      <ContinueAnalysisMenu jobId="job-123" artifactName="deg_table.csv" artifactKind="table" />,
    );
    fireEvent.click(screen.getByLabelText('继续分析'));
    expect(screen.getByRole('button', { name: 'Alpha 分析' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Beta 富集' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Gamma 查看' })).toBeNull();
  });

  it('点击菜单项派发 copilot-ask，prompt 含 jobId/artifactName/tool 三要素', () => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
    render(
      <ContinueAnalysisMenu jobId="job-123" artifactName="deg_table.csv" artifactKind="table" />,
    );
    fireEvent.click(screen.getByLabelText('继续分析'));
    fireEvent.click(screen.getByRole('button', { name: 'Alpha 分析' }));

    const events = copilotAskEventsFrom(dispatchSpy);
    expect(events).toHaveLength(1);
    const prompt = events[0].detail.prompt;
    expect(prompt).toContain('job-123');
    expect(prompt).toContain('deg_table.csv');
    expect(prompt).toContain('Alpha 分析');
    dispatchSpy.mockRestore();
  });

});

describe('CompactResultNavigator 继续分析入口', () => {
  const sections: ResultArtifactNavSection[] = [
    {
      id: 'tables',
      label: '表格',
      artifactNames: ['deg_table.csv'],
      artifacts: [{ name: 'deg_table.csv', label: 'DEG 表' }],
      kind: 'table',
    },
  ];

  function mountNavigator(overrides: Partial<Parameters<typeof CompactResultNavigator>[0]> = {}) {
    return render(
      <CompactResultNavigator
        groups={buildResultArtifactPickerGroups(sections)}
        selectedArtifactName="deg_table.csv"
        selectedArtifactLabel="DEG 表"
        selectedKindLabel="表格"
        selectedIcon="table"
        relatedSections={[]}
        onSelectArtifact={() => undefined}
        {...overrides}
      />,
    );
  }

  it('传入 jobId 与 artifactKind 时 actions 区出现「继续分析」入口', () => {
    mountNavigator({ jobId: 'job-123', artifactKind: 'table' });
    expect(screen.getByLabelText('继续分析')).toBeTruthy();
  });

  it('未传 jobId 时不出现「继续分析」入口', () => {
    mountNavigator();
    expect(screen.queryByLabelText('继续分析')).toBeNull();
  });
});
