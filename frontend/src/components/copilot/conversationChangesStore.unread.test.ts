// UI-446 v4 — 审阅 tab 计数徽章判定（红绿先行升格：dot → 未审文件数计数）。
// 语义：当前会话存在晚于「已读时间戳」的改动 → 未审（计数=N）；打开审阅 tab 即
// acknowledge（归零）；之后的新改动重新累计。
// 不复活 2026-09-09 被用户裁决移除的聊天区卡片（c0e92dd0）——计数只服务右栏入口徽章。
import { describe, expect, it } from 'vitest';
import {
  acknowledgeConversationChanges,
  countUnreviewedConversationChanges,
  getConversationFileChanges,
  getConversationUnreviewedCount,
  recordConversationFileChange,
} from './conversationChangesStore';

describe('conversationChangesStore 未审计数（UI-446 v4）', () => {
  it('纯计数：无改动 → 0', () => {
    expect(countUnreviewedConversationChanges([], undefined)).toBe(0);
    expect(countUnreviewedConversationChanges([], 999)).toBe(0);
  });

  it('纯计数：无已读 → 全部未审；已读晚于部分 → 只计新改动', () => {
    const changes = [
      { path: 'a.js', status: 'modified' as const, lastChangedAt: 100 },
      { path: 'b.js', status: 'created' as const, lastChangedAt: 200 },
    ];
    expect(countUnreviewedConversationChanges(changes, undefined)).toBe(2);
    expect(countUnreviewedConversationChanges(changes, 0)).toBe(2);
    expect(countUnreviewedConversationChanges(changes, 150)).toBe(1);
    expect(countUnreviewedConversationChanges(changes, 300)).toBe(0);
  });

  it('store 集成：record → 计数；acknowledge → 归零；再 record → 重新累计', () => {
    const conversationId = 'conv-ui446v4-' + Math.random().toString(36).slice(2);
    recordConversationFileChange(conversationId, 'utils.js', 'modified', { tool: 'workspace_replace' });
    expect(getConversationUnreviewedCount(conversationId)).toBe(1);

    acknowledgeConversationChanges(conversationId);
    expect(getConversationUnreviewedCount(conversationId)).toBe(0);

    recordConversationFileChange(conversationId, 'utils.test.js', 'created');
    expect(getConversationUnreviewedCount(conversationId)).toBe(1);

    acknowledgeConversationChanges(undefined); // 无会话 id：安全 no-op
  });
});
