// BLOCK-244 Q1-REM — UserQuestionCard 结构化提问契约。
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { UserQuestionCard } from './UserQuestionCard';

afterEach(cleanup);

describe('UserQuestionCard（BLOCK-244 C19）', () => {
  const base = {
    questionId: 'q_1',
    question: '选择分析目标？',
    options: [
      { id: 'deg', label: '差异表达', description: 'DEG 分析' },
      { id: 'gsea', label: '通路富集' },
    ],
    onSubmit: vi.fn(),
  };

  it('单选：选中选项后提交；未选且无文本时禁用', () => {
    const onSubmit = vi.fn();
    render(<UserQuestionCard {...base} onSubmit={onSubmit} />);
    const submit = screen.getByTestId<HTMLButtonElement>('user-question-submit');
    expect(submit.disabled).toBe(true);
    fireEvent.click(screen.getByTestId('user-question-option-deg'));
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    expect(onSubmit).toHaveBeenCalledWith({ selected: ['deg'], text: '' });
  });

  it('多选 + 自由输入；跳过回传显式文本', () => {
    const onSubmit = vi.fn();
    render(<UserQuestionCard {...base} multiSelect allowFreeText onSubmit={onSubmit} />);
    fireEvent.click(screen.getByTestId('user-question-option-deg'));
    fireEvent.click(screen.getByTestId('user-question-option-gsea'));
    fireEvent.change(screen.getByTestId('user-question-free-text'), { target: { value: '两个都要' } });
    fireEvent.click(screen.getByTestId('user-question-submit'));
    expect(onSubmit).toHaveBeenCalledWith({ selected: ['deg', 'gsea'], text: '两个都要' });

    onSubmit.mockClear();
    fireEvent.click(screen.getByTestId('user-question-skip'));
    expect(onSubmit).toHaveBeenCalledWith({ selected: [], text: '（用户跳过）' });
  });

  it('关闭自由输入后不渲染输入框', () => {
    render(<UserQuestionCard {...base} allowFreeText={false} />);
    expect(screen.queryByTestId('user-question-free-text')).toBeNull();
  });
});
