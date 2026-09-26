// UI-449（C-16）— shortstat 桥缓存与 ±行数格式化契约（红绿先行：先于实现落盘）。
// 权威源=后端 git shortstat（不前端数行）；20s TTL 节流；桥失败回落上次缓存/null 不抛。
import { beforeEach, describe, expect, it, vi } from 'vitest';

const workingTreeShortstat = vi.fn();
vi.mock('@/lib/desktopBridge', () => ({
  getBridge: () => ({ workingTreeShortstat }),
}));
import {
  formatShortstatBadge,
  refreshConversationShortstat,
  __resetShortstatCacheForTest,
} from './conversationChangesStore';

describe('conversationChangesStore shortstat（UI-449 / C-16）', () => {
  beforeEach(() => {
    workingTreeShortstat.mockReset();
    __resetShortstatCacheForTest();
  });

  it('fetch 经桥并缓存：同会话第二次调用不发新请求', async () => {
    workingTreeShortstat.mockResolvedValue({
      ok: true,
      data: { tracked: { files: 2, added: 5, removed: 1 }, untrackedFiles: 1, empty: false },
    });
    const first = await refreshConversationShortstat('conv-a', 'p1');
    const second = await refreshConversationShortstat('conv-a', 'p1');
    expect(workingTreeShortstat).toHaveBeenCalledTimes(1);
    expect(first?.tracked.added).toBe(5);
    expect(second?.tracked.added).toBe(5);
  });

  it('桥失败 → 返回 null 不抛；缓存已有值时回落旧值', async () => {
    workingTreeShortstat.mockResolvedValueOnce({
      ok: true,
      data: { tracked: { files: 1, added: 2, removed: 0 }, untrackedFiles: 0, empty: false },
    });
    await refreshConversationShortstat('conv-b', 'p1');
    workingTreeShortstat.mockRejectedValueOnce(new Error('bridge down'));
    const fallback = await refreshConversationShortstat('conv-b', 'p1', { force: true });
    expect(fallback?.tracked.added).toBe(2);
    workingTreeShortstat.mockReset();
    workingTreeShortstat.mockRejectedValue(new Error('bridge down'));
    const none = await refreshConversationShortstat('conv-c', 'p1', { force: true });
    expect(none).toBeNull();
  });

  it('formatShortstatBadge：有 stat → 「N·+A−D」；无 stat → 纯计数', () => {
    expect(formatShortstatBadge(3, { added: 5, removed: 1 })).toBe('3·+5−1');
    expect(formatShortstatBadge(3, null)).toBe('3');
    expect(formatShortstatBadge(0, null)).toBe('');
  });
});
