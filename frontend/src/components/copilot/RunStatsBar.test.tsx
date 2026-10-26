// UI-523 / BLOCK-266 — composer 计量条图标态渲染锚。
// 钉三件事：①条内零常驻数字文字（图标+环），读数承载在各段 title；
// ②不可算一律 `—`（不是 0）；③上下文百分比保留视觉隐藏可访问性读数。
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import React from 'react';
import type { RunUsageDetail } from '@/lib/events';
import { RunStatsBar } from './RunStatsBar';
import type { ConversationUsageSnapshot } from './SimpleChat/hooks/useConversationUsage';

afterEach(cleanup);

function usage(over: Partial<RunUsageDetail> = {}): RunUsageDetail {
  return {
    conversationId: 'conv_1',
    iteration: 3,
    attempt: 1,
    model: 'deepseek-chat',
    promptTokens: 12_000,
    completionTokens: 2520,
    cacheReadTokens: 9000,
    cacheCreationTokens: 0,
    durationMs: 10_000, // 2520 ÷ 10s = 252 tok/s
    at: '2026-10-18T00:00:00.000Z',
    ...over,
  };
}

function conversation(over: Partial<ConversationUsageSnapshot> = {}): ConversationUsageSnapshot {
  return {
    calls: 42,
    inputTokens: 3_000_000,
    outputTokens: 400_000,
    cacheReadTokens: 2_900_000,
    cacheHitRate: 2_900_000 / 3_000_000, // ≈0.9667 → formatPercent → 97%
    ...over,
  } as ConversationUsageSnapshot;
}

const ringStub = <span data-testid="ring-stub" key="ring">◐</span>;

function titlesOf() {
  const run = screen.queryByTestId('run-stats-run');
  const conv = screen.getByTestId('run-stats-conversation');
  const ctx = screen.getByTestId('run-stats-context');
  return {
    run: run ? run.getAttribute('title') || '' : null,
    conv: conv.getAttribute('title') || '',
    ctx: ctx.getAttribute('title') || '',
  };
}

// testing-library 的 screen 在本文件顶层直接引入
import { screen } from '@testing-library/react';

describe('RunStatsBar（UI-523 计量条 · BLOCK-266 图标态）', () => {
  it('图标态：条内不渲染常驻数字文字；读数进 title（本次/会话/上下文三段）', () => {
    render(
      <RunStatsBar
        rounds={3}
        steps={5}
        runUsage={usage()}
        conversationUsage={conversation()}
        contextPct={14}
        contextSlot={ringStub}
      />,
    );
    const bar = screen.getByTestId('run-stats-bar');
    expect(bar.textContent).not.toContain('轮');
    expect(bar.textContent).not.toContain('tok');
    expect(bar.textContent).not.toContain('缓存');

    const t = titlesOf();
    expect(t.run).toContain('3 轮');
    expect(t.run).toContain('5 步');
    expect(t.run).toContain('252');
    expect(t.conv).toContain('3.4M tok');
    expect(t.conv).toContain('97%');
    expect(t.ctx).toContain('14%');
  });

  it('不可算一律「—」进 title：无 usage / 零调用会话', () => {
    render(
      <RunStatsBar
        rounds={1}
        steps={null}
        runUsage={null}
        conversationUsage={conversation({ calls: 0, inputTokens: 0, outputTokens: 0 })}
        contextPct={0}
        contextSlot={ringStub}
      />,
    );
    const t = titlesOf();
    expect(t.run).toContain('—');
    expect(t.conv).toContain('— tok');
  });

  it('零耗时调用不除零：速率 title 显「—」而不是 Infinity', () => {
    render(
      <RunStatsBar
        rounds={1}
        steps={1}
        runUsage={usage({ durationMs: 0 })}
        conversationUsage={conversation()}
        contextPct={5}
        contextSlot={ringStub}
      />,
    );
    const t = titlesOf();
    expect(t.run).toContain('—');
    expect(t.run).not.toContain('Infinity');
  });

  it('本会话尚无运行（历史会话重开）：本次段不渲染（无图标无 title）', () => {
    render(
      <RunStatsBar
        rounds={null}
        steps={null}
        runUsage={null}
        conversationUsage={conversation()}
        contextPct={60}
        contextSlot={ringStub}
      />,
    );
    const t = titlesOf();
    expect(t.run).toBeNull();
    expect(t.conv).toContain('3.4M tok');
    expect(t.ctx).toContain('60%');
  });

  it('上下文百分比保留可访问性读数（视觉隐藏 span）', () => {
    render(
      <RunStatsBar
        rounds={null}
        steps={null}
        runUsage={null}
        conversationUsage={conversation()}
        contextPct={72}
        contextSlot={ringStub}
      />,
    );
    const ctx = screen.getByTestId('run-stats-context');
    expect(ctx.textContent).toContain('72%');
  });

  it('运行中用 accent 语义态标记（仅视觉，不改读数）', () => {
    const { rerender } = render(
      <RunStatsBar rounds={1} steps={2} runUsage={usage()} conversationUsage={conversation()} contextPct={10} contextSlot={ringStub} running />,
    );
    expect(screen.getByTestId('run-stats-bar').getAttribute('data-state')).toBe('running');
    rerender(
      <RunStatsBar rounds={1} steps={2} runUsage={usage()} conversationUsage={conversation()} contextPct={10} contextSlot={ringStub} />,
    );
    expect(screen.getByTestId('run-stats-bar').getAttribute('data-state')).toBe('idle');
  });

  it('运行结束后快照被清（轮/步变 null）仍保留最近一次读数，切会话才归零', () => {
    const { rerender } = render(
      <RunStatsBar rounds={2} steps={4} runUsage={null} conversationUsage={conversation()} contextPct={10} contextSlot={ringStub} conversationId="c1" />,
    );
    rerender(
      <RunStatsBar rounds={null} steps={null} runUsage={null} conversationUsage={conversation()} contextPct={10} contextSlot={ringStub} conversationId="c1" />,
    );
    expect(titlesOf().run).toContain('2 轮');
    rerender(
      <RunStatsBar rounds={null} steps={null} runUsage={null} conversationUsage={conversation()} contextPct={10} contextSlot={ringStub} conversationId="c2" />,
    );
    expect(titlesOf().run).toBeNull();
  });
});
