import { beforeEach, describe, expect, it } from 'vitest';
import {
  __resetNotificationCenterForTests,
  clearNotices,
  listNotices,
  markAllNoticesRead,
  pushNotice,
  subscribeNotices,
  unreadNoticeCount,
} from './notification-center';

beforeEach(() => {
  __resetNotificationCenterForTests();
});

describe('notification-center', () => {
  it('pushNotice 置顶并计未读', () => {
    pushNotice({ kind: 'turn_completed', title: '完成', body: 'A' });
    pushNotice({ kind: 'turn_failed', title: '失败', body: 'B' });
    expect(listNotices().map((notice) => notice.title)).toEqual(['失败', '完成']);
    expect(unreadNoticeCount()).toBe(2);
    expect(listNotices()[0].read).toBe(false);
  });

  it('markAllNoticesRead 清零未读并通知订阅者', () => {
    pushNotice({ kind: 'turn_completed', title: '完成', body: 'A' });
    let notified = 0;
    const unsubscribe = subscribeNotices(() => { notified += 1; });
    markAllNoticesRead();
    expect(unreadNoticeCount()).toBe(0);
    expect(notified).toBe(1);
    unsubscribe();
  });

  it('clearNotices 清空', () => {
    pushNotice({ kind: 'approval_required', title: '确认', body: 'C' });
    clearNotices();
    expect(listNotices()).toHaveLength(0);
    expect(unreadNoticeCount()).toBe(0);
  });

  it('最多保留 50 条（新在前）', () => {
    for (let i = 0; i < 55; i++) {
      pushNotice({ kind: 'turn_completed', title: `t${i}`, body: 'x' });
    }
    expect(listNotices()).toHaveLength(50);
    expect(listNotices()[0].title).toBe('t54');
  });

  it('持久化到 localStorage，可被重新读取', () => {
    pushNotice({ kind: 'turn_completed', title: '持久化', body: 'x' });
    const raw = window.localStorage.getItem('petri:notification-center:v1');
    expect(raw).toContain('持久化');
  });
});
