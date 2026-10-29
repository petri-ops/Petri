import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { StatusBadge } from './Status';
import { projectEvidenceAxis, projectExecutionAxis } from '@/lib/statusProjection';

afterEach(cleanup);

describe('StatusBadge (NEXT-02A)', () => {
  it('执行状态暴露轴、状态与语义 tone', () => {
    render(<StatusBadge projection={projectExecutionAxis('done')} testId="badge" />);
    const badge = screen.getByTestId('badge');
    expect(badge.textContent).toBe('已完成');
    expect(badge.getAttribute('data-axis')).toBe('execution');
    expect(badge.getAttribute('data-status')).toBe('completed');
    expect(badge.getAttribute('data-tone')).toBe('success');
  });

  it('证据状态保留 detail 供悬浮与辅助技术读取', () => {
    render(
      <StatusBadge
        projection={projectEvidenceAxis({ truthStatus: 'valid', hasEvidence: true })}
        testId="badge"
      />
    );
    const badge = screen.getByTestId('badge');
    expect(badge.getAttribute('data-axis')).toBe('evidence');
    expect(badge.getAttribute('data-status')).toBe('verified');
    expect(badge.getAttribute('title')).toContain('不代表科学结论正确');
    expect(badge.getAttribute('aria-label')).toContain('不代表科学结论正确');
  });

  it('无投影时如实显示占位，不伪造成功', () => {
    render(<StatusBadge projection={null} testId="badge" />);
    expect(screen.getByTestId('badge').textContent).toBe('—');
    expect(screen.getByTestId('badge').getAttribute('data-status')).toBe('unknown');
  });
});
