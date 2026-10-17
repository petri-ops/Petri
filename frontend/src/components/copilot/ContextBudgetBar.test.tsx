// BLOCK-195 P2 — 预算环前端 DOM 锚（总纲 §2 D4 的界面面）。
// 现状核实：ContextBudgetBar.tsx 早已投影真实数值（UI-400-5 裁决把待机「—」换成 0% 空环），
// 但整个组件**零测试**——后端 token_budget 事件有钉（test/block109-p0-baseline / block163-token-budget），
// 渲染层一直是空白。本测把这些行为钉成可复跑锚点，不改任何产品行为（断言只读，不加 testid）。
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ContextBudgetButton, type TokenBudget } from './ContextBudgetBar';

afterEach(cleanup);

const CIRCUMFERENCE = 2 * Math.PI * ((18 - 2) / 2); // RING_SIZE=18, RING_STROKE=2 → r=8

function budget(over: Partial<TokenBudget> = {}): TokenBudget {
  return {
    contextWindow: 32_000,
    messagesTokensUsed: 12_000,
    messagesKept: 8,
    messagesDropped: 2,
    pct: 42,
    trimmed: true,
    categories: { systemInstructions: 4_000, messages: 12_000, tools: 6_000, other: 1_000 },
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

describe('ContextBudgetButton（BLOCK-195 D4 渲染层锚）', () => {
  it('实时 budget：环按 pct 投影，面板给出真实 token 数与窗口', () => {
    const { container } = render(<ContextBudgetButton budget={budget()} />);
    expect(Math.abs(ringProgressOffset() - CIRCUMFERENCE * (1 - 42 / 100))).toBeLessThan(0.01);
    openPanel();
    const text = container.textContent ?? '';
    expect(text).toContain('42%');
    expect(text).toContain('12K / 24K'); // 消息 tokens / (窗口-8192 预留)
    expect(text).toContain('32K'); // 上下文窗口
    expect(text).toContain('8 条'); // 保留消息
    expect(text).toContain('2 条'); // 已压缩（messagesDropped>0 才出现）
  });

  it('用量分布四段在 categories 在场时渲染（预算构成可审计，不是只给一个百分比）', () => {
    const { container } = render(<ContextBudgetButton budget={budget()} />);
    openPanel();
    const text = container.textContent ?? '';
    for (const label of ['系统指令', '消息内容', '工具调用', '其他']) expect(text).toContain(label);
    expect(text).toContain('用量分布');
  });

  it('待机态渲染 0% 空环而非「—」占位（UI-400-5 用户裁决钉为契约）', () => {
    const { container } = render(<ContextBudgetButton budget={null} />);
    const button = screen.getByTitle(/上下文用量/);
    expect(button.textContent).toBe(''); // 钮内只有 SVG 环，无文字占位
    expect(Math.abs(ringProgressOffset() - CIRCUMFERENCE)).toBeLessThan(0.01); // 空环=0%
    openPanel();
    expect(container.textContent).toContain('待机');
  });

  it('待机时回退缓存的 lastBudget 并明示「上次」（不得静默显示旧数为当前数）', () => {
    const { rerender, container } = render(<ContextBudgetButton budget={budget()} />);
    rerender(<ContextBudgetButton budget={null} />);
    openPanel();
    const text = container.textContent ?? '';
    expect(text).toContain('上次');
    expect(text).toContain('42%'); // 显示的是缓存值，且带「上次」限定词
  });

  it('窗口未知时诚实提示配置入口，而不是显示假分母', () => {
    const { container } = render(<ContextBudgetButton budget={null} activeContextWindow={0} />);
    openPanel();
    expect(container.textContent).toContain('模型上下文窗口未知，可在设置中配置');
  });

  it('知识注入 token 仅在存在时单列（BLOCK-69 注入面透明，零注入不刷噪声）', () => {
    const withKnowledge = render(<ContextBudgetButton budget={budget({ knowledgeTokens: 2_500 })} />);
    openPanel();
    expect(withKnowledge.container.textContent).toContain('知识空间');
    cleanup();
    const without = render(<ContextBudgetButton budget={budget({ knowledgeTokens: 0 })} />);
    openPanel();
    expect(without.container.textContent).not.toContain('知识空间');
  });
});
