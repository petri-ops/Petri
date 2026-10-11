// BLOCK-166 P2 — follow-up 宿主判定纯函数（规格 §8：只读/过期/非当前会话明确拒绝）。
import { describe, expect, it } from 'vitest';
import { resolveGenUiFollowUp } from './followUp';

const OK_CONV = 'conv-1';

function base(overrides: Record<string, unknown> = {}) {
  return {
    request: { prompt: '把阈值改成 80', messageConversationId: OK_CONV },
    currentConversationId: OK_CONV,
    inputAvailable: true,
    ...overrides,
  };
}

describe('resolveGenUiFollowUp', () => {
  it('合法追问通过并归一化 trim + 默认标题', () => {
    const v = resolveGenUiFollowUp(base({ request: { prompt: '  把阈值改成 80  ', messageConversationId: OK_CONV } }));
    expect(v.ok).toBe(true);
    expect(v.prompt).toBe('把阈值改成 80');
    expect(v.title).toBe('可视化追问');
  });

  it('title 覆盖默认标题', () => {
    const v = resolveGenUiFollowUp(base({ request: { prompt: 'p', title: '图表确认', messageConversationId: OK_CONV } }));
    expect(v.ok).toBe(true);
    expect(v.title).toBe('图表确认');
  });

  it('空/纯空白/非字符串 prompt 拒绝', () => {
    expect(resolveGenUiFollowUp(base({ request: { prompt: '', messageConversationId: OK_CONV } }) as never).ok).toBe(false);
    expect(resolveGenUiFollowUp(base({ request: { prompt: '   ', messageConversationId: OK_CONV } }) as never).ok).toBe(false);
    expect(resolveGenUiFollowUp(base({ request: { prompt: 42, messageConversationId: OK_CONV } }) as never).ok).toBe(false);
    expect(resolveGenUiFollowUp(base({ request: { prompt: undefined, messageConversationId: OK_CONV } }) as never).ok).toBe(false);
  });

  it('超长 prompt / title 拒绝', () => {
    expect(resolveGenUiFollowUp(base({ request: { prompt: 'x'.repeat(8001), messageConversationId: OK_CONV } }) as never).ok).toBe(false);
    expect(resolveGenUiFollowUp(base({ request: { prompt: 'p', title: 't'.repeat(251), messageConversationId: OK_CONV } }) as never).ok).toBe(false);
  });

  it('非当前会话 / 无当前会话（过期绑定）拒绝', () => {
    const stale = resolveGenUiFollowUp(base({ currentConversationId: 'conv-2' }));
    expect(stale.ok).toBe(false);
    expect(stale.reason).toContain('非当前会话');
    expect(resolveGenUiFollowUp(base({ currentConversationId: null }) as never).ok).toBe(false);
  });

  it('输入绑定缺席（只读）拒绝', () => {
    const v = resolveGenUiFollowUp(base({ inputAvailable: false }));
    expect(v.ok).toBe(false);
    expect(v.reason).toContain('只读');
  });
});
