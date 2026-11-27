/** item88 第二波 HK-01：审批请求卡三档（once/task/always）只在任务卡内。 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkbenchApprovalCard } from './WorkbenchApprovalCard';

afterEach(cleanup);

describe('item88 三档审批卡', () => {
  it('HK-01 三档按钮齐全且各自回调，不进主对话', () => {
    const onDecide = vi.fn<(scope: string) => void>();
    render(<WorkbenchApprovalCard taskId="t1" title="允许执行 rm -rf /tmp/x？" onDecide={onDecide} />);
    expect(screen.getByRole('alertdialog')).toBeTruthy();
    const buttons = screen.getAllByTestId('wb-approval-scope');
    expect(buttons.map((b) => b.textContent)).toEqual(['仅此一次', '本任务内', '始终允许']);
    buttons.forEach((b) => fireEvent.click(b));
    expect(onDecide.mock.calls.map((c) => c[0])).toEqual(['once', 'task', 'always']);
  });
});
