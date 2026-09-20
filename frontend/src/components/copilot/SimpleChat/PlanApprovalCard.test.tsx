import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { PlanApprovalCard, type PlanApprovalCardPlan } from './PlanApprovalCard';

afterEach(cleanup);

vi.mock('../copilotMarkdown', () => ({
  CopilotMarkdown: ({ text }: { text: string }) => <div data-testid="spec-md">{text}</div>,
}));

const plan: PlanApprovalCardPlan = {
  id: 'plan_abc123',
  title: 'PBMC 分析方案',
  goal: '标准 PBMC 质控到注释',
  specMd: '# 目标\n标准分析',
  steps: [
    { n: 1, title: 'QC 过滤', assignee: 'subagent' },
    { n: 2, title: '聚类注释' },
  ],
};

describe('PlanApprovalCard', () => {
  it('渲染 spec 正文、步骤表与子智能体标记', () => {
    render(<PlanApprovalCard plan={plan} onApprove={() => {}} onDismiss={() => {}} />);
    expect(screen.getByTestId('spec-md').textContent).toContain('标准分析');
    expect(screen.getByText('QC 过滤')).toBeTruthy();
    expect(screen.getByText('子智能体')).toBeTruthy();
  });

  it('三个批准按钮分别派发对应 action', () => {
    const onApprove = vi.fn();
    render(<PlanApprovalCard plan={plan} onApprove={onApprove} onDismiss={() => {}} />);
    fireEvent.click(screen.getByText('批准并执行'));
    expect(onApprove).toHaveBeenCalledWith('execute');
    fireEvent.click(screen.getByText('批准并清上下文执行'));
    expect(onApprove).toHaveBeenCalledWith('execute-fresh');
    fireEvent.click(screen.getByText(/继续讨论/));
    expect(onApprove).toHaveBeenCalledWith('keep-planning');
  });

  it('busy 时按钮禁用，dismiss 回调可用', () => {
    const onApprove = vi.fn();
    const onDismiss = vi.fn();
    render(<PlanApprovalCard plan={plan} busy onApprove={onApprove} onDismiss={onDismiss} />);
    const buttons = screen.getAllByRole('button');
    const approveButtons = buttons.filter((b) => b.textContent?.match(/批准并|继续讨论/));
    for (const b of approveButtons) expect(b.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(/收起批准卡/));
    expect(onDismiss).toHaveBeenCalled();
  });

  it('keep-planning 文案展示子智能体步骤计数', () => {
    render(<PlanApprovalCard plan={plan} onApprove={() => {}} onDismiss={() => {}} />);
    expect(screen.getByText(/含 1 个子智能体步骤/)).toBeTruthy();
  });
});
