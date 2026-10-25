import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QuitSummaryDialog, type QuitSummaryRequest } from './QuitSummaryDialog';
import { normalizeShellPrefs } from './DesktopShellProvider';

afterEach(cleanup);

const request: QuitSummaryRequest = {
  counts: { toolJobsRunning: 2, approvalsPending: 1 },
  total: 3,
  rows: [
    { key: 'toolJobsRunning', label: '运行中的工具作业', value: 2 },
    { key: 'approvalsPending', label: '等待你的审批', value: 1 },
  ],
};

describe('QuitSummaryDialog', () => {
  it('渲染主进程给出的计数行与三个动作', () => {
    const onDecision = vi.fn();
    render(<QuitSummaryDialog request={request} onDecision={onDecision} />);
    expect(screen.getByTestId('quit-summary-dialog')).not.toBeNull();
    expect(screen.getByText('运行中的工具作业')).not.toBeNull();
    expect(screen.getByText('2')).not.toBeNull();
    expect(screen.getByText('等待你的审批')).not.toBeNull();

    fireEvent.click(screen.getByText('停止并退出'));
    expect(onDecision).toHaveBeenCalledWith('quit');
    fireEvent.click(screen.getByText('最小化到托盘'));
    expect(onDecision).toHaveBeenCalledWith('tray');
    fireEvent.click(screen.getByText('取消'));
    expect(onDecision).toHaveBeenCalledWith('cancel');
  });

  it('无代理明细但仍渲染确认面；request=null 时不渲染', () => {
    const { rerender } = render(
      <QuitSummaryDialog request={{ counts: {}, total: 1, rows: [] }} onDecision={() => {}} />
    );
    expect(screen.getByTestId('quit-summary-dialog')).not.toBeNull();
    expect(screen.queryByTestId('quit-summary-rows')).toBeNull();
    rerender(<QuitSummaryDialog request={null} onDecision={() => {}} />);
    expect(screen.queryByTestId('quit-summary-dialog')).toBeNull();
  });

  it('预览态标注 + 托盘失败错误可见 + Esc 取消', () => {
    const onDecision = vi.fn();
    render(
      <QuitSummaryDialog
        request={{ ...request, preview: true }}
        error="托盘不可用，未能最小化。"
        onDecision={onDecision}
      />
    );
    expect(screen.getByTestId('quit-summary-preview')).not.toBeNull();
    expect(screen.getByTestId('quit-summary-error').textContent).toContain('托盘不可用');
    fireEvent.keyDown(screen.getByTestId('quit-summary-dialog'), { key: 'Escape' });
    expect(onDecision).toHaveBeenCalledWith('cancel');
  });

  it('BLOCK-260 K3 — 逐项查看：可定位项显示查看按钮并回调，无项目不显示死按钮', () => {
    const onOpenItem = vi.fn();
    render(
      <QuitSummaryDialog
        request={{
          ...request,
          items: [
            { kind: 'toolJob', id: 'job_1', label: '运行中的差异分析', projectId: 'p1', conversationId: 'c1' },
            { kind: 'approval', id: 'ap_1', label: '审批：run_tool', projectId: null },
          ],
        }}
        onDecision={() => {}}
        onOpenItem={onOpenItem}
      />
    );
    expect(screen.getByTestId('quit-summary-items')).not.toBeNull();
    expect(screen.getByText('运行中的差异分析')).not.toBeNull();
    fireEvent.click(screen.getByTestId('quit-summary-open-job_1'));
    expect(onOpenItem).toHaveBeenCalledWith(expect.objectContaining({ kind: 'toolJob', id: 'job_1', projectId: 'p1' }));
    expect(screen.queryByTestId('quit-summary-open-ap_1')).toBeNull();
  });
});

describe('normalizeShellPrefs', () => {
  it('缺省语义与注册表一致：closeToTray=false / notifyOnTurnEnd=true / quietHours 空', () => {
    expect(normalizeShellPrefs(null)).toEqual({ closeToTray: false, notifyOnTurnEnd: true, quietHours: '' });
    expect(normalizeShellPrefs({ closeToTray: true, notifyOnTurnEnd: false, quietHours: '22:00-08:00' })).toEqual({
      closeToTray: true,
      notifyOnTurnEnd: false,
      quietHours: '22:00-08:00',
    });
    expect(normalizeShellPrefs({ closeToTray: 'true', notifyOnTurnEnd: 0, quietHours: '25:00' })).toEqual({
      closeToTray: false,
      notifyOnTurnEnd: true,
      quietHours: '',
    });
  });
});
