import { describe, expect, it } from 'vitest';
import {
  composeTrustStatus,
  projectEvidenceAxis,
  projectExecutionAxis,
} from './statusProjection';

describe('statusProjection (NEXT-02A 三轴状态)', () => {
  it('execution：常见后端状态归一并保留用户可见差异', () => {
    expect(projectExecutionAxis('pending')).toMatchObject({ status: 'waiting', label: '排队中' });
    expect(projectExecutionAxis('running')).toMatchObject({ status: 'running', label: '运行中' });
    expect(projectExecutionAxis('done')).toMatchObject({ status: 'completed', label: '已完成' });
    expect(projectExecutionAxis('success')).toMatchObject({ status: 'completed', label: '已完成' });
    expect(projectExecutionAxis('failed')).toMatchObject({ status: 'failed', label: '失败' });
    expect(projectExecutionAxis('cancelled')).toMatchObject({ status: 'cancelled', label: '已取消' });
    expect(projectExecutionAxis('stopped')).toMatchObject({ status: 'cancelled', label: '已停止' });
    expect(projectExecutionAxis('awaiting_confirmation')).toMatchObject({ status: 'waiting', label: '等待确认' });
    expect(projectExecutionAxis('denied')).toMatchObject({ status: 'failed', label: '已拒绝' });
    expect(projectExecutionAxis('partial')).toMatchObject({ status: 'partial', label: '部分完成' });
  });

  it('execution：未知状态不伪装成成功或等待', () => {
    const unknown = projectExecutionAxis('quantum_pending');
    expect(unknown?.status).toBe('unknown');
    expect(unknown?.raw).toBe('quantum_pending');
    expect(unknown?.label).toContain('未知');
    expect(projectExecutionAxis(null)).toBeNull();
  });

  it('evidence：valid/degraded/blocked/stale 不混入执行成功语义', () => {
    expect(projectEvidenceAxis({ truthStatus: 'valid', hasEvidence: true })).toMatchObject({
      status: 'verified',
      label: '已核验（未篡改）',
    });
    expect(projectEvidenceAxis({ truthStatus: 'degraded', hasEvidence: true })).toMatchObject({
      status: 'unverified',
      label: '需要复核',
    });
    expect(projectEvidenceAxis({ truthStatus: 'blocked', hasEvidence: true })).toMatchObject({
      status: 'unverified',
      label: '结果已阻断',
    });
    expect(projectEvidenceAxis({ truthStatus: 'stale', hasEvidence: true })).toMatchObject({
      status: 'stale',
      label: '证据已过期',
    });
    expect(projectEvidenceAxis({ hasEvidence: true })).toMatchObject({
      status: 'unverified',
      label: '尚未核验',
    });
    expect(projectEvidenceAxis({ hasEvidence: false })).toBeNull();
  });

  it('capability：ready/degraded/unavailable/disabled 独立于任务结果', () => {
    const project = (capability: string | null) => composeTrustStatus({ hasEvidence: false, capability }).capability;
    expect(project('ready')?.status).toBe('ready');
    expect(project('degraded')?.status).toBe('degraded');
    expect(project('unavailable')?.status).toBe('unavailable');
    expect(project('disabled')?.status).toBe('disabled');
    expect(project('nonsense')?.status).toBe('unknown');
    expect(project(null)).toBeNull();
  });

  it('组合态：完成的工作流可以同时保留未核验证据与视觉不可用', () => {
    const composed = composeTrustStatus({
      execution: 'done',
      hasEvidence: true,
      truthStatus: null,
      capability: 'unavailable',
    });
    expect(composed.execution?.status).toBe('completed');
    expect(composed.evidence?.status).toBe('unverified');
    expect(composed.capability?.status).toBe('unavailable');
  });
});
