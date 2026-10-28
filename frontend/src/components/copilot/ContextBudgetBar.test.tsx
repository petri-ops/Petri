// UI-622 — 上下文用量面板：汇总 + 六类真实构成（系统/工具定义/消息/工具结果/
// 其他系统/输出预留）+ 知识空间子项 + 剩余；旧后端无 breakdown 时回退汇总视图。
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ContextBudgetButton, type TokenBudget } from './ContextBudgetBar';

afterEach(cleanup);

const CIRCUMFERENCE = 2 * Math.PI * ((18 - 2) / 2); // RING_SIZE=18, RING_STROKE=2 → r=8

function budget(over: Partial<TokenBudget> = {}): TokenBudget {
  return {
    contextWindow: 64_000,
    messagesTokensUsed: 28_692,
    messagesKept: 8,
    messagesDropped: 2,
    pct: 45,
    trimmed: true,
    breakdown: {
      systemPrompt: 4_000,
      knowledge: 1_200,
      toolDefinitions: 6_000,
      messages: 8_000,
      toolResults: 2_000,
      otherSystem: 500,
      outputReserve: 8_192,
      total: 28_692,
    },
    ...over,
  };
}

function openPanel() {
  fireEvent.click(screen.getByTitle(/上下文用量/));
}

function ringProgressOffset(): number {
  const circles = document.querySelectorAll('svg circle');
  const progress = circles[1];
  return Number(progress.getAttribute('stroke-dashoffset'));
}

describe('ContextBudgetButton（UI-622 真实构成）', () => {
  it('实时 budget：环按 pct 投影；汇总=已用/窗口/剩余', () => {
    const { container } = render(<ContextBudgetButton budget={budget()} />);
    expect(Math.abs(ringProgressOffset() - CIRCUMFERENCE * (1 - 45 / 100))).toBeLessThan(0.01);
    openPanel();
    const text = container.textContent ?? '';
    expect(text).toContain('45%');
    expect(text).toContain('29K / 64K');
    expect(text).toContain('剩余 35K');
    expect(text).toContain('8 条');
    expect(text).toContain('2 条');
  });

  it('六类构成全部渲染，知识空间作为系统提示词的子项不重复计总', () => {
    const { container } = render(<ContextBudgetButton budget={budget()} />);
    openPanel();
    const text = container.textContent ?? '';
    for (const label of ['系统提示词', '工具定义', '对话消息', '工具结果', '其他系统内容', '输出预留']) {
      expect(text).toContain(label);
    }
    expect(text).toContain('其中知识空间 1K');
    expect(text).toContain('构成（估算）');
    expect(text).toContain('剩余可用');
  });

  it('旧后端无 breakdown：回退汇总视图（消息 tokens + 知识空间行）', () => {
    const legacy = budget({ breakdown: undefined, knowledgeTokens: 2_500 });
    const { container } = render(<ContextBudgetButton budget={legacy} />);
    openPanel();
    const text = container.textContent ?? '';
    expect(text).toContain('消息 tokens');
    expect(text).toContain('知识空间');
    expect(text).not.toContain('构成（估算）');
  });

  it('待机态渲染 0% 空环而非「—」占位（UI-400-5 契约）', () => {
    const { container } = render(<ContextBudgetButton budget={null} />);
    const button = screen.getByTitle(/上下文用量/);
    expect(button.textContent).toBe('');
    expect(Math.abs(ringProgressOffset() - CIRCUMFERENCE)).toBeLessThan(0.01);
    openPanel();
    expect(container.textContent).toContain('待机');
  });

  it('待机回退缓存的 lastBudget 并明示「上次」', () => {
    const { rerender, container } = render(<ContextBudgetButton budget={budget()} />);
    rerender(<ContextBudgetButton budget={null} />);
    openPanel();
    const text = container.textContent ?? '';
    expect(text).toContain('上次');
    expect(text).toContain('45%');
  });

  it('窗口未知时诚实提示配置入口，而不是显示假分母', () => {
    const { container } = render(<ContextBudgetButton budget={null} activeContextWindow={0} />);
    openPanel();
    expect(container.textContent).toContain('模型上下文窗口未知，可在设置中配置');
  });

  it('知识空间仅在存在时单列（零注入不刷噪声）', () => {
    const withKnowledge = render(<ContextBudgetButton budget={budget()} />);
    openPanel();
    expect(withKnowledge.container.textContent).toContain('其中知识空间');
    cleanup();
    const without = render(<ContextBudgetButton budget={budget({
      breakdown: { ...budget().breakdown!, knowledge: 0 },
      knowledgeTokens: 0,
    })} />);
    openPanel();
    expect(without.container.textContent).not.toContain('知识空间');
  });
});
