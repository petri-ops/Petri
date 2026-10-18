// UI-523 — composer 运行计量条渲染锚。
// 钉三件事：①五个读数的格式与范围限定词；②不可算一律 `—`（不是 0）；
// ③窄态降级只留数字，环由外部注入（单一实例）。
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
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
    inputTokens: 5_000_000,
    outputTokens: 1_400_000,
    cacheReadTokens: 4_900_000,
    cacheHitRate: 0.98,
    latencyMs: 60_000,
    tokensPerSecond: 23.3,
    ...over,
  };
}

describe('RunStatsBar（UI-523 计量条）', () => {
  it('宽态：本次（轮/步/速率）+ 会话（总量/缓存）+ 上下文五段齐全', () => {
    const { container, getByTestId } = render(
      <RunStatsBar
        rounds={3}
        steps={57}
        runUsage={usage()}
        conversationUsage={conversation()}
        contextPct={14}
        contextSlot={<span data-testid="ring-slot" />}
      />,
    );
    const text = container.textContent ?? '';
    expect(text).toContain('本次');
    expect(text).toContain('3 轮');
    expect(text).toContain('57 步');
    expect(text).toContain('252 tok/s');
    expect(text).toContain('会话');
    expect(text).toContain('6.4M tok');
    expect(text).toContain('缓存命中 98%');
    expect(text).toContain('14%');
    expect(getByTestId('ring-slot')).toBeTruthy();
    expect(getByTestId('run-stats-bar').getAttribute('data-state')).toBe('idle');
  });

  it('不可算一律「—」：无 usage 实测 / 零调用会话 / 零耗时', () => {
    const { container } = render(
      <RunStatsBar
        rounds={1}
        steps={2}
        runUsage={null}
        conversationUsage={conversation({ calls: 0, inputTokens: 0, outputTokens: 0, cacheHitRate: 0 })}
        contextPct={null}
      />,
    );
    const text = container.textContent ?? '';
    expect(text).toContain('— tok');
    expect(text).toContain('缓存命中 —');
    expect(text).toContain('—'); // 速率也是 —
    expect(text).toContain('0%'); // 上下文无 budget 与环一致显 0%
    expect(text).not.toContain('0 tok');
  });

  it('零耗时调用不除零：速率显「—」而不是 Infinity', () => {
    const { container } = render(
      <RunStatsBar rounds={1} steps={1} runUsage={usage({ durationMs: 0 })} conversationUsage={null} contextPct={5} />,
    );
    expect(container.textContent).not.toContain('Infinity');
    expect(container.textContent).toContain('—');
  });

  it('本会话尚无运行（历史会话重开）：本次段不渲染，只留会话与上下文', () => {
    const { queryByTestId, container } = render(
      <RunStatsBar rounds={null} steps={null} runUsage={null} conversationUsage={conversation()} contextPct={42} />,
    );
    expect(queryByTestId('run-stats-run')).toBeNull();
    expect(container.textContent).toContain('6.4M tok');
    expect(container.textContent).toContain('42%');
  });

  it('窄态降级：收起范围标签与缓存段，保留 步/速率/总量', () => {
    const { container } = render(
      <RunStatsBar
        rounds={3}
        steps={57}
        runUsage={usage()}
        conversationUsage={conversation()}
        contextPct={14}
        narrow
      />,
    );
    const text = container.textContent ?? '';
    expect(text).not.toContain('本次');
    expect(text).not.toContain('会话');
    expect(text).not.toContain('缓存命中');
    expect(text).toContain('57 步');
    expect(text).toContain('252 tok/s');
    expect(text).toContain('6.4M tok');
  });

  it('大数走 B 阶梯、缓存率四舍五入到整数百分比', () => {
    const { container } = render(
      <RunStatsBar
        rounds={1}
        steps={1}
        runUsage={usage()}
        conversationUsage={conversation({ inputTokens: 1_000_000_000, outputTokens: 200_000_000, cacheHitRate: 0.9765 })}
        contextPct={1}
      />,
    );
    expect(container.textContent).toContain('1.2B tok');
    expect(container.textContent).toContain('缓存命中 98%');
  });

  it('运行中用 accent 语义态标记（仅视觉，不改读数）', () => {
    const { getByTestId } = render(
      <RunStatsBar rounds={1} steps={1} runUsage={usage()} conversationUsage={conversation()} contextPct={3} running />,
    );
    expect(getByTestId('run-stats-bar').getAttribute('data-state')).toBe('running');
  });

  it('运行结束后快照被清（轮/步变 null）仍保留最近一次读数，切会话才归零', () => {
    const { container, rerender } = render(
      <RunStatsBar conversationId="conv_1" rounds={2} steps={7} runUsage={usage()} conversationUsage={conversation()} contextPct={20} />,
    );
    expect(container.textContent).toContain('2 轮');
    expect(container.textContent).toContain('7 步');

    // useConversationResume 对账后 run 快照被清除：rounds/steps 传 null
    rerender(
      <RunStatsBar conversationId="conv_1" rounds={null} steps={null} runUsage={usage()} conversationUsage={conversation()} contextPct={20} />,
    );
    expect(container.textContent).toContain('2 轮');
    expect(container.textContent).toContain('7 步');

    // 切会话：上一会话的「最近一次运行」不得带过去
    rerender(
      <RunStatsBar conversationId="conv_2" rounds={null} steps={null} runUsage={null} conversationUsage={null} contextPct={null} />,
    );
    expect(container.textContent).not.toContain('2 轮');
    expect(container.textContent).not.toContain('7 步');
  });
});
