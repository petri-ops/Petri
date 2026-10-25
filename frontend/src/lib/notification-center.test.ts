import { beforeEach, describe, expect, it } from 'vitest';
import {
  __resetNotificationCenterForTests,
  clearNotices,
  getNoticePrefs,
  listNotices,
  markAllNoticesRead,
  markNoticeRead,
  noticeTarget,
  pushNotice,
  setNoticePrefs,
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

  it('接受 Q7 schedule_reminder 类型并持久化', () => {
    pushNotice({ kind: 'schedule_reminder', title: '计划提醒', body: '记得看质控', projectId: 'proj_1' });
    expect(listNotices()[0].kind).toBe('schedule_reminder');
    expect(window.localStorage.getItem('petri:notification-center:v1')).toContain('schedule_reminder');
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

  it('BLOCK-259 K4 — 类型开关：关闭的类型不入历史；重新开启恢复', () => {
    setNoticePrefs({ kinds: { turn_completed: false } });
    expect(pushNotice({ kind: 'turn_completed', title: '完成', body: 'A' })).toBeNull();
    expect(listNotices()).toHaveLength(0);

    expect(pushNotice({ kind: 'turn_failed', title: '失败', body: 'B' })).not.toBeNull();
    expect(listNotices()).toHaveLength(1);

    setNoticePrefs({ kinds: { turn_completed: true } });
    expect(pushNotice({ kind: 'turn_completed', title: '完成', body: 'C' })).not.toBeNull();
    expect(listNotices()).toHaveLength(2);
    expect(getNoticePrefs().kinds.turn_completed).toBe(true);
    expect(window.localStorage.getItem('petri:notification-center:prefs:v1')).toContain('turn_completed');
  });

  it('BLOCK-259 K4 — 单条已读与点击去向', () => {
    const notice = pushNotice({
      kind: 'approval_required',
      title: '确认',
      body: 'B',
      projectId: 'p1',
      conversationId: 'c1',
    });
    expect(notice).not.toBeNull();
    markNoticeRead(notice!.id);
    expect(listNotices()[0].read).toBe(true);
    expect(noticeTarget(notice!)).toEqual({ projectId: 'p1', mode: 'chat', conversationId: 'c1' });

    const reminder = pushNotice({ kind: 'schedule_reminder', title: '提醒', body: 'R', projectId: 'p2' });
    expect(noticeTarget(reminder!)).toEqual({ projectId: 'p2', mode: 'scheduled' });
    expect(noticeTarget({ ...reminder!, projectId: undefined })).toBeNull();
  });
});
