import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ResultStudioContextReadiness, ResultStudioInspector } from './ResultStudioSurface';

afterEach(cleanup);

describe('G0-RS-P3 Agent 上下文就绪投影', () => {
  it('没有上下文状态时不渲染任何声明', () => {
    const { container } = render(<ResultStudioContextReadiness context={null} />);
    expect(container.textContent).toBe('');
  });

  it('加载中如实显示读取状态，不预先宣称可用', () => {
    render(<ResultStudioContextReadiness context={{ status: 'loading' }} />);
    const status = screen.getByRole('status');
    expect(status.getAttribute('data-state')).toBe('loading');
    expect(status.textContent).toContain('正在读取');
    expect(status.textContent).not.toContain('已掌握');
  });

  it('后端阻断时展示可行动原因，不宣称 Agent 可以直接改', () => {
    render(
      <ResultStudioContextReadiness
        context={{ status: 'blocked', reason: '归因只能到 Job，缺少可复现的单产物脚本。' }}
      />,
    );
    const status = screen.getByRole('status');
    expect(status.getAttribute('data-state')).toBe('blocked');
    expect(status.textContent).toContain('归因只能到 Job');
    expect(status.textContent).not.toContain('已掌握');
  });

  it('就绪且选择兼容时说明选择会一并交给 Agent', () => {
    render(
      <ResultStudioContextReadiness
        context={{ status: 'ready', selectionUsable: true, selectionCompatibility: 'compatible' }}
      />,
    );
    const status = screen.getByRole('status');
    expect(status.getAttribute('data-state')).toBe('ready');
    expect(status.textContent).toContain('已掌握');
    expect(status.textContent).toContain('当前选择会一并交给 Agent');
  });

  it('选择过期时明确不会交给 Agent 并要求重新选择', () => {
    render(
      <ResultStudioContextReadiness
        context={{ status: 'ready', selectionUsable: false, selectionCompatibility: 'stale' }}
      />,
    );
    const text = screen.getByRole('status').textContent || '';
    expect(text).toContain('已过期');
    expect(text).toContain('请重新选择');
  });

  it('选择不可用时不把行号当身份交给 Agent', () => {
    render(
      <ResultStudioContextReadiness
        context={{ status: 'ready', selectionUsable: false, selectionCompatibility: 'invalid' }}
      />,
    );
    expect(screen.getByRole('status').textContent).toContain('当前选择不可用');
  });

  it('没有选择时如实说明当前没有选择', () => {
    render(
      <ResultStudioContextReadiness
        context={{ status: 'ready', selectionUsable: false, selectionCompatibility: null }}
      />,
    );
    expect(screen.getByRole('status').textContent).toContain('当前没有选择');
  });

  it('Inspector 内联就绪状态且仍不把内部 id 提到主区', () => {
    render(
      <ResultStudioInspector
        artifact={{
          jobId: 'job-1', toolId: 'deseq2', name: 'deg_table.csv', type: 'table',
          label: '差异表达结果', revisionId: 'rev-2', artifactFamilyId: 'family-1',
          entityType: 'gene', selectionDurable: true, selection: null, selectionId: null,
        }}
        jobStatus="done"
        truthStatus="valid"
        onAskAgent={() => undefined}
        context={{ status: 'ready', selectionUsable: false, selectionCompatibility: null }}
      />,
    );
    const status = screen.getByRole('status');
    expect(status.getAttribute('data-state')).toBe('ready');
    // 内部 id 仍然只出现在渐进披露里，不因 P3 新增声明而泄漏到主区。
    const details = screen.getByText('技术详情').closest('details');
    expect(details?.hasAttribute('open')).toBe(false);
    expect(details?.textContent).toContain('rev-2');
    expect(status.textContent).not.toContain('rev-2');
    expect(status.textContent).not.toContain('job-1');
  });
});
