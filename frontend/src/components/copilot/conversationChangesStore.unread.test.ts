// UI-446 — 审阅 tab 未读圆点判定（BLOCK-123 G-01 · 红绿先行：本文件先于实现落盘）。
// 语义：当前会话存在改动记录且存在晚于「已读时间戳」的改动 → 未读（圆点亮）；
// 打开审阅 tab 即 acknowledge（圆点熄灭）；之后的新改动重新点亮。
// 不复活 2026-09-09 被用户裁决移除的聊天区卡片（c0e92dd0）——本判定只服务 tab 圆点。
import { describe, expect, it } from 'vitest';
import {
  acknowledgeConversationChanges,
  getConversationFileChanges,
  hasUnreviewedConversationChanges,
  isConversationUnreviewed,
  recordConversationFileChange,
} from './conversationChangesStore';

describe('conversationChangesStore 未读判定（UI-446）', () => {
  it('纯判定：无改动 → 永不未读', () => {
    expect(hasUnreviewedConversationChanges([], undefined)).toBe(false);
    expect(hasUnreviewedConversationChanges([], 999)).toBe(false);
  });

  it('纯判定：有改动且无已读时间戳 → 未读', () => {
    const changes = [{ path: 'a.js', status: 'modified' as const, lastChangedAt: 100 }];
    expect(hasUnreviewedConversationChanges(changes, undefined)).toBe(true);
    expect(hasUnreviewedConversationChanges(changes, 0)).toBe(true);
  });

  it('纯判定：已读晚于全部改动 → 非未读', () => {
    const changes = [{ path: 'a.js', status: 'modified' as const, lastChangedAt: 100 }];
    expect(hasUnreviewedConversationChanges(changes, 150)).toBe(false);
  });

  it('纯判定：已读之后的新改动 → 重新未读', () => {
    const changes = [
      { path: 'a.js', status: 'modified' as const, lastChangedAt: 100 },
      { path: 'b.js', status: 'created' as const, lastChangedAt: 200 },
    ];
    expect(hasUnreviewedConversationChanges(changes, 150)).toBe(true);
  });

  it('store 集成：record → 未读；acknowledge → 熄灭；再 record → 重新点亮', () => {
    const conversationId = 'conv-ui446-' + Math.random().toString(36).slice(2);
    recordConversationFileChange(conversationId, 'utils.js', 'modified', { tool: 'workspace_replace' });
    const changes = getConversationFileChanges(conversationId);
    expect(changes.length).toBe(1);
    expect(isConversationUnreviewed(conversationId)).toBe(true);

    acknowledgeConversationChanges(conversationId);
    expect(isConversationUnreviewed(conversationId)).toBe(false);

    recordConversationFileChange(conversationId, 'utils.test.js', 'created');
    expect(isConversationUnreviewed(conversationId)).toBe(true);

    acknowledgeConversationChanges(undefined); // 无会话 id：安全 no-op
  });
});
