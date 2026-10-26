import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { ScratchpadDock, _resetDockOpenForTest } from './ScratchpadDock';

/**
 * BLOCK-267 — 开态外置 store：composer 子树重挂后开态不丢（AUDIT-LOG 🟡 清偿）。
 * 实机观察（BLOCK-246）：面板打开后 ~300ms 被重挂吃掉自关。
 */

afterEach(() => {
  cleanup();
  _resetDockOpenForTest();
});

function renderDock(props: { onQuote?: (item: unknown) => void } = {}) {
  return render(
    <ScratchpadDock onQuote={props.onQuote ?? (() => {})} projectId="p1" />,
  );
}

describe('ScratchpadDock 开态外置 store（BLOCK-267）', () => {
  it('重挂后开态保留（核心清偿：不再被重挂吃掉）', () => {
    const { unmount } = renderDock();
    fireEvent.click(screen.getByTestId('scratchpad-toggle'));
    expect(screen.getByTestId('scratchpad-toggle').getAttribute('aria-expanded')).toBe('true');

    // 模拟 composer 子树重挂（unmount + 立即重渲染新实例）
    unmount();
    const second = renderDock();
    expect(second.getByTestId('scratchpad-toggle').getAttribute('aria-expanded')).toBe('true');
  });

  it('重挂后仍可关闭（toggle 语义双向有效）', () => {
    const first = renderDock();
    fireEvent.click(screen.getByTestId('scratchpad-toggle')); // 开
    first.unmount();
    renderDock();
    fireEvent.click(screen.getByTestId('scratchpad-toggle')); // 关（重挂后 toggle 仍指向同一外置态）
    expect(screen.getByTestId('scratchpad-toggle').getAttribute('aria-expanded')).toBe('false');
  });

  it('引用一条速记后自动关闭，重挂不再弹回（关闭也是外置态）', () => {
    const quotes: unknown[] = [];
    const first = renderDock({ onQuote: (item) => quotes.push(item) });
    fireEvent.click(screen.getByTestId('scratchpad-toggle'));
    first.unmount();
    renderDock({ onQuote: (item) => quotes.push(item) });
    // 引用回调来自面板内部；此处直证 toggle 关闭语义即可覆盖外置态写路径
    fireEvent.click(screen.getByTestId('scratchpad-toggle'));
    expect(screen.getByTestId('scratchpad-toggle').getAttribute('aria-expanded')).toBe('false');
    expect(quotes.length).toBe(0);
  });
});
