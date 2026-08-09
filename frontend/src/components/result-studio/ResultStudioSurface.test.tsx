import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ResultStudioCanvas,
  ResultStudioContextBar,
  ResultStudioInspector,
} from './ResultStudioSurface';
import { beginResultSurfaceMeasure, RESULT_SURFACE_PERFORMANCE_MARKS } from './resultSurface';

afterEach(cleanup);

describe('G0-RS-P1 Result Studio surface', () => {
  it('renders the result as the primary labelled canvas', () => {
    beginResultSurfaceMeasure(RESULT_SURFACE_PERFORMANCE_MARKS.openStart);
    render(
      <ResultStudioCanvas mode="result" contextBar={<div>上下文</div>}>
        <div>火山图主体</div>
      </ResultStudioCanvas>,
    );
    const canvas = screen.getByRole('region', { name: '结果主画布' });
    expect(canvas.getAttribute('data-mode')).toBe('result');
    expect(Number.isFinite(Number(canvas.getAttribute('data-first-visible-ms')))).toBe(true);
    expect(screen.getByText('火山图主体')).toBeTruthy();
  });

  it('keeps the Agent Composer inside the same result-focus region after the body', () => {
    render(
      <ResultStudioCanvas mode="result" composer={<div>结果编辑 Composer</div>}>
        <div>结果主体</div>
      </ResultStudioCanvas>,
    );
    const region = screen.getByRole('region', { name: '结果主画布' });
    expect(region.textContent).toContain('结果主体');
    expect(region.textContent).toContain('结果编辑 Composer');
    const children = [...region.children];
    expect(children.at(-1)?.textContent).toContain('结果编辑 Composer');
  });

  it('exposes real Code, Compare and History canvas modes when their capabilities exist', () => {
    const { rerender } = render(<ResultStudioCanvas mode="compare"><div>变更审查</div></ResultStudioCanvas>);
    expect(screen.getByRole('region', { name: '结果主画布' }).getAttribute('data-mode')).toBe('compare');
    rerender(<ResultStudioCanvas mode="history"><div>版本历史</div></ResultStudioCanvas>);
    expect(screen.getByRole('region', { name: '结果主画布' }).getAttribute('data-mode')).toBe('history');
    rerender(<ResultStudioCanvas mode="code" canProjectSource><div>精确代码</div></ResultStudioCanvas>);
    expect(screen.getByRole('region', { name: '结果主画布' }).getAttribute('data-mode')).toBe('code');
  });

  it('keeps the context bar compact and exposes its two core actions', () => {
    const onBack = vi.fn();
    const onAsk = vi.fn();
    render(
      <ResultStudioContextBar
        title="差异表达火山图"
        trust={{ tone: 'valid', label: '可信结果' }}
        conclusion="处理组出现明确上调基因集合。"
        revisionLabel="当前 v2"
        selectionLabel="未选择对象"
        onBack={onBack}
        onAskAgent={onAsk}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '返回对话' }));
    fireEvent.click(screen.getByRole('button', { name: '询问 Agent' }));
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onAsk).toHaveBeenCalledTimes(1);
    expect(screen.getByText('处理组出现明确上调基因集合。')).toBeTruthy();
  });

  it('makes Result, Code, Change Review and History reachable when source exists', () => {
    const onModeChange = vi.fn();
    render(
      <ResultStudioContextBar
        title="差异表达火山图"
        trust={{ tone: 'valid', label: '可信结果' }}
        conclusion="已验证"
        revisionLabel="当前 v2"
        selectionLabel="未选择对象"
        onBack={() => undefined}
        onAskAgent={() => undefined}
        activeMode="result"
        canReviewVersions
        canProjectSource
        onModeChange={onModeChange}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '审查修改' }));
    fireEvent.click(screen.getByRole('button', { name: '版本历史' }));
    fireEvent.click(screen.getByRole('button', { name: '代码' }));
    expect(onModeChange).toHaveBeenNthCalledWith(1, 'compare');
    expect(onModeChange).toHaveBeenNthCalledWith(2, 'history');
    expect(onModeChange).toHaveBeenNthCalledWith(3, 'code');
  });

  it('keeps technical identifiers inside progressive disclosure', () => {
    render(
      <ResultStudioInspector
        artifact={{
          jobId: 'job-1', toolId: 'deseq2', name: 'deg.csv', type: 'table',
          label: '差异表达结果', revisionId: 'rev-2', artifactFamilyId: 'family-1',
          entityType: 'gene', selectionDurable: true, selection: null,
        }}
        jobStatus="done"
        truthStatus="valid"
        onAskAgent={() => undefined}
      />,
    );
    expect(screen.getByText('当前结果')).toBeTruthy();
    const summary = screen.getByText('技术详情');
    const details = summary.closest('details');
    expect(details?.hasAttribute('open')).toBe(false);
    expect(details?.textContent).toContain('family-1');
    expect(details?.textContent).toContain('job-1');
  });

  it('shows file availability separately from scientific validation', () => {
    const onAsk = vi.fn();
    render(
      <>
        <ResultStudioContextBar
          title="差异表达火山图"
          trust={{ tone: 'valid', label: '可信结果' }}
          availabilityStatus="unavailable"
          conclusion="科学校验记录仍保留，但当前产物文件不可读取。"
          revisionLabel="当前 v2"
          selectionLabel="未选择对象"
          onBack={() => undefined}
          onAskAgent={() => undefined}
        />
        <ResultStudioInspector
          artifact={{
            jobId: 'job-1', toolId: 'volcano-plot', name: 'volcano.png', type: 'image',
            label: '差异表达火山图', revisionId: 'rev-2', artifactFamilyId: 'family-1',
            availabilityStatus: 'unavailable', availabilityReason: 'artifact_truth_unavailable',
          }}
          jobStatus="done"
          truthStatus="valid"
          onAskAgent={onAsk}
        />
      </>,
    );

    expect(screen.getAllByText('可信结果')).toHaveLength(2);
    expect(screen.getAllByText('文件不可用')).toHaveLength(2);
    expect(screen.queryByText('打开原文件')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /检查并恢复文件/ }));
    expect(onAsk).toHaveBeenCalledWith(expect.stringContaining('不要覆盖原始数据'));
  });
});
