// BLOCK-255 C4 — 逐消息统计视图模型 + 实时 usage 累加（纯函数）。
import { describe, expect, it } from 'vitest';
import { accumulateMessageUsage, buildMessageStatsView, formatStatsDuration } from './messageStats';
import type { MessageUsage, SimpleMessage } from './types';

function usage(over: Partial<MessageUsage> = {}): MessageUsage {
  return {
    calls: 2,
    promptTokens: 1500,
    completionTokens: 100,
    cacheReadTokens: 700,
    cacheCreationTokens: 50,
    durationMs: 1500,
    models: ['deepseek-chat'],
    ...over,
  };
}

function message(over: Partial<SimpleMessage> = {}): SimpleMessage {
  return {
    role: 'assistant',
    content: 'hello',
    processingDurationMs: 1234,
    toolActivities: [
      { key: 'a', name: 'workspace_read', status: 'success', actionLabel: '读取' },
      { key: 'b', name: 'workspace_write', status: 'success', actionLabel: '写入' },
    ],
    progressUpdates: [
      { iteration: 1, content: 'first' },
      { iteration: 2, content: 'second' },
    ],
    usage: usage(),
    ...over,
  };
}

describe('buildMessageStatsView', () => {
  it('有 usage：展示耗时/工具/迭代/字符/模型/token/cache/调用', () => {
    const view = buildMessageStatsView(message());
    const rows = Object.fromEntries(view.rows.map((row) => [row.label, row.value]));
    expect(view.hasUsage).toBe(true);
    expect(rows['处理耗时']).toBe('1.2s');
    expect(rows['工具步数']).toBe('2 步');
    expect(rows['模型迭代']).toBe('2 轮');
    expect(rows['字符数']).toBe('5 字');
    expect(rows['模型']).toBe('deepseek-chat');
    expect(rows['Token']).toBe('输入 2K · 输出 100');
    expect(rows['缓存']).toBe('读 700 · 写 50');
    expect(rows['调用']).toBe('2 次（有 usage）');
    expect(view.note).toContain('token 为本条回复内模型调用合计');
  });

  it('有未返回 usage 的调用：单列不混写，note 明确', () => {
    const view = buildMessageStatsView(message({ usage: usage({ calls: 2, unmeasuredCalls: 1 }) }));
    const rows = Object.fromEntries(view.rows.map((row) => [row.label, row.value]));
    expect(rows['调用']).toBe('2 次（有 usage） · 1 次未返回 usage');
    expect(view.note).toContain('另有 1 次调用未返回 usage');
  });

  it('无 usage：Token/调用写未记录，其余本地实测字段照常', () => {
    const view = buildMessageStatsView(message({ usage: undefined }));
    const rows = Object.fromEntries(view.rows.map((row) => [row.label, row.value]));
    expect(view.hasUsage).toBe(false);
    expect(rows['Token']).toBe('未记录');
    expect(rows['调用']).toBe('未记录');
    expect(rows['处理耗时']).toBe('1.2s');
    expect(rows['工具步数']).toBe('2 步');
    expect(view.note).toContain('本条未记录 token');
  });

  it('只有未返回 usage 的调用：不写 token，note 说明不可算', () => {
    const view = buildMessageStatsView(message({
      usage: usage({ calls: 0, unmeasuredCalls: 2, promptTokens: 0, completionTokens: 0 }),
    }));
    const rows = Object.fromEntries(view.rows.map((row) => [row.label, row.value]));
    expect(view.hasUsage).toBe(false);
    expect(rows['Token']).toBe('未记录');
    expect(rows['调用']).toBe('0 次（有 usage） · 2 次未返回 usage');
    expect(view.note).toContain('未返回 usage');
  });

  it('结果卡存在时单列数量', () => {
    const view = buildMessageStatsView(message({
      resultNodes: [{ type: 'table' } as never],
    }));
    const rows = Object.fromEntries(view.rows.map((row) => [row.label, row.value]));
    expect(rows['结果卡']).toBe('1 个');
  });
});

describe('accumulateMessageUsage', () => {
  it('空值起步 + 两次调用累加，模型去重', () => {
    const first = accumulateMessageUsage(null, {
      conversationId: 'conv_a', iteration: 1, attempt: 1, model: 'deepseek-chat',
      promptTokens: 100, completionTokens: 10, cacheReadTokens: 20, cacheCreationTokens: 5,
      durationMs: 400, at: '2026-10-25T00:00:00.000Z',
    });
    expect(first.calls).toBe(1);
    expect(first.promptTokens).toBe(100);
    expect(first.models).toEqual(['deepseek-chat']);
    const second = accumulateMessageUsage(first, {
      conversationId: 'conv_a', iteration: 2, attempt: 1, model: 'deepseek-chat',
      promptTokens: 200, completionTokens: 20, cacheReadTokens: 0, cacheCreationTokens: 0,
      durationMs: 600, at: '2026-10-25T00:00:01.000Z',
    });
    expect(second.calls).toBe(2);
    expect(second.promptTokens).toBe(300);
    expect(second.completionTokens).toBe(30);
    expect(second.cacheReadTokens).toBe(20);
    expect(second.cacheCreationTokens).toBe(5);
    expect(second.durationMs).toBe(1000);
    expect(second.models).toEqual(['deepseek-chat']);
  });

  it('负数/NaN 归零，模型名有界', () => {
    let totals = accumulateMessageUsage(null, {
      conversationId: null, iteration: 1, attempt: 1, model: 'm1',
      promptTokens: -1, completionTokens: Number.NaN, cacheReadTokens: -2, cacheCreationTokens: -3,
      durationMs: -4, at: '2026-10-25T00:00:00.000Z',
    });
    for (let i = 2; i <= 8; i += 1) {
      totals = accumulateMessageUsage(totals, {
        conversationId: null, iteration: i, attempt: 1, model: `m${i}`,
        promptTokens: 1, completionTokens: 1, cacheReadTokens: 0, cacheCreationTokens: 0,
        durationMs: 1, at: '2026-10-25T00:00:00.000Z',
      });
    }
    expect(totals.promptTokens).toBe(7);
    expect(totals.completionTokens).toBe(7);
    expect(totals.models.length).toBe(5);
  });
});

describe('formatStatsDuration', () => {
  it('毫秒/秒/分钟三档与不可算', () => {
    expect(formatStatsDuration(0)).toBe('—');
    expect(formatStatsDuration(undefined)).toBe('—');
    expect(formatStatsDuration(250)).toBe('250ms');
    expect(formatStatsDuration(1234)).toBe('1.2s');
    expect(formatStatsDuration(65_000)).toBe('1m 5s');
  });
});
