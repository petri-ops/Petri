import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { NotificationCenterBell } from './NotificationCenterBell';
import {
  __resetNotificationCenterForTests,
  getNoticePrefs,
  listNotices,
  pushNotice,
  unreadNoticeCount,
} from '@/lib/notification-center';

beforeEach(() => {
  __resetNotificationCenterForTests();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function LocationProbe(): React.ReactElement {
  const location = useLocation();
  return <span data-testid="location-probe">{location.pathname}</span>;
}

function renderBell(initial = '/'): void {
  render(
    <MemoryRouter initialEntries={[initial]}>
      <NotificationCenterBell />
      <LocationProbe />
    </MemoryRouter>,
  );
}

describe('NotificationCenterBell', () => {
  it('空态：无徽章，打开显示空提示', () => {
    renderBell();
    expect(screen.queryByTestId('notification-center-unread')).toBeNull();
    fireEvent.click(screen.getByTestId('notification-center-bell'));
    expect(screen.getByTestId('notification-center-panel').textContent).toContain('暂无通知');
  });

  it('有未读：徽章计数 + 列表行 + 全部已读清零', () => {
    pushNotice({ kind: 'turn_completed', title: '完成', body: 'A' });
    pushNotice({ kind: 'approval_required', title: '确认', body: 'B' });
    renderBell();
    expect(screen.getByTestId('notification-center-unread').textContent).toBe('2');
    fireEvent.click(screen.getByTestId('notification-center-bell'));
    expect(screen.getAllByTestId('notification-center-item')).toHaveLength(2);
    expect(screen.getAllByTestId('notification-center-dot')).toHaveLength(2);

    fireEvent.click(screen.getByText('全部已读'));
    expect(screen.queryByTestId('notification-center-unread')).toBeNull();
    expect(screen.queryAllByTestId('notification-center-dot')).toHaveLength(0);
    expect(unreadNoticeCount()).toBe(0);
  });

  it('清空移除全部行', () => {
    pushNotice({ kind: 'turn_failed', title: '失败', body: 'C' });
    renderBell();
    fireEvent.click(screen.getByTestId('notification-center-bell'));
    fireEvent.click(screen.getByText('清空'));
    expect(listNotices()).toHaveLength(0);
    expect(screen.getByTestId('notification-center-panel').textContent).toContain('暂无通知');
  });

  it('UI-625 — 通知行=类型标签+标题+正文+相对时间，弹层不再复用 toolMenu（不再压叠）', () => {
    pushNotice({ kind: 'turn_completed', title: '对话已完成', body: '这段正文比较长，用于验证两行截断与行内布局不再互相覆盖。' });
    renderBell();
    fireEvent.click(screen.getByTestId('notification-center-bell'));
    const panel = screen.getByTestId('notification-center-panel');
    expect(panel.className).not.toContain('toolMenu');
    const item = screen.getByTestId('notification-center-item');
    expect(item.getAttribute('data-kind')).toBe('turn_completed');
    expect(item.getAttribute('data-read')).toBe('false');
    expect(item.textContent).toContain('完成');
    expect(item.textContent).toContain('对话已完成');
    expect(item.textContent).toContain('刚刚');
    expect(panel.textContent).toContain('1 未读');
  });

  it('UI-625 — 相对时间五档：刚刚 / N 分钟前 / 今天 HH:mm / 昨天 HH:mm / M/D HH:mm（不再甩绝对时间戳）', () => {
    vi.useFakeTimers();
    // 由旧到新写入（pushNotice 头插 = 列表新→旧），最后一次推进作为渲染时刻。
    vi.setSystemTime(new Date(2026, 9, 20, 9, 0, 0));
    pushNotice({ kind: 'schedule_reminder', title: '更早的提醒', body: 'A' });
    vi.setSystemTime(new Date(2026, 9, 27, 18, 0, 0));
    pushNotice({ kind: 'turn_failed', title: '昨天的失败', body: 'B' });
    vi.setSystemTime(new Date(2026, 9, 28, 8, 0, 0));
    pushNotice({ kind: 'approval_required', title: '今早待确认', body: 'C' });
    vi.setSystemTime(new Date(2026, 9, 28, 11, 55, 0));
    pushNotice({ kind: 'turn_completed', title: '几分钟前完成', body: 'D' });
    vi.setSystemTime(new Date(2026, 9, 28, 11, 59, 40));
    pushNotice({ kind: 'turn_completed', title: '刚刚完成', body: 'E' });
    vi.setSystemTime(new Date(2026, 9, 28, 12, 0, 0));

    renderBell();
    fireEvent.click(screen.getByTestId('notification-center-bell'));
    const items = screen.getAllByTestId('notification-center-item');
    expect(items).toHaveLength(5);
    expect(items[0].textContent).toContain('刚刚');
    expect(items[1].textContent).toContain('5 分钟前');
    expect(items[2].textContent).toContain('今天 08:00');
    expect(items[3].textContent).toContain('昨天 18:00');
    expect(items[4].textContent).toContain('10/20 09:00');
    // 绝对时间戳（含年份/秒）回归即为「乱」的来源，任何一行都不该出现。
    expect(items.some((item) => /2026|\d{2}:\d{2}:\d{2}/.test(item.textContent || ''))).toBe(false);
  });

  it('BLOCK-259 K4 — 点击通知跳转并置为已读；提醒进计划看板', () => {
    pushNotice({
      kind: 'turn_completed',
      title: '完成',
      body: 'A',
      projectId: 'p1',
      conversationId: 'c1',
    });
    pushNotice({ kind: 'schedule_reminder', title: '提醒', body: 'B', projectId: 'p2' });
    renderBell();
    fireEvent.click(screen.getByTestId('notification-center-bell'));

    const first = screen.getAllByTestId('notification-center-item')[1];
    fireEvent.click(first);
    expect(screen.getByTestId('location-probe').textContent).toBe('/project/p1/chat');
    expect(listNotices().find((notice) => notice.title === '完成')?.read).toBe(true);

    fireEvent.click(screen.getByTestId('notification-center-bell'));
    fireEvent.click(screen.getAllByTestId('notification-center-item')[0]);
    expect(screen.getByTestId('location-probe').textContent).toBe('/project/p2/scheduled');
  });

  it('BLOCK-259 K4 — 类型开关关闭后该类通知不再入列', () => {
    renderBell();
    fireEvent.click(screen.getByTestId('notification-center-bell'));
    const checkbox = screen.getByTestId('notice-pref-turn_completed');
    expect((checkbox as HTMLInputElement).checked).toBe(true);
    fireEvent.click(checkbox);
    expect((checkbox as HTMLInputElement).checked).toBe(false);
    expect(getNoticePrefs().kinds.turn_completed).toBe(false);

    expect(pushNotice({ kind: 'turn_completed', title: '完成', body: 'A' })).toBeNull();
    expect(listNotices()).toHaveLength(0);
    expect(unreadNoticeCount()).toBe(0);
  });
});

// ---------- BLOCK-264（C-39）审批通知深定位 ----------

describe('NotificationCenterBell · 审批深定位（BLOCK-264 C-39）', () => {
  it('点击待审批通知派发 approvalCardFocus 事件（带 ackToken）', async () => {
    const dispatched: { name: string; detail: unknown }[] = [];
    const origDispatch = window.dispatchEvent.bind(window);
    window.dispatchEvent = ((e: Event) => {
      if (e instanceof CustomEvent) dispatched.push({ name: e.type, detail: e.detail });
      return Reflect.apply(origDispatch, window, [e]);
    });
    pushNotice({
      kind: 'approval_required',
      title: '需要确认',
      body: '工具 x 正在等待授权',
      conversationId: 'conv-1',
      projectId: 'p1',
      ackToken: 'token-abc',
    });
    renderBell();
    fireEvent.click(screen.getByTestId('notification-center-bell')); // 展开列表
    const item = await screen.findByText(/工具 x 正在等待授权/);
    fireEvent.click(item);
    await waitFor(() => {
      const evt = dispatched.find((d) => d.name === 'petri:approval-card-focus');
      expect(evt).toBeTruthy();
      const detail = (evt && evt.detail) as { ackToken?: string } | undefined;
      expect(detail && detail.ackToken).toBe('token-abc');
    });
    window.dispatchEvent = origDispatch;
  });

  it('非审批通知不派发深定位事件', async () => {
    const dispatched: { name: string }[] = [];
    const origDispatch = window.dispatchEvent.bind(window);
    window.dispatchEvent = ((e: Event) => {
      if (e instanceof CustomEvent) dispatched.push({ name: e.type });
      return Reflect.apply(origDispatch, window, [e]);
    });
    pushNotice({ kind: 'turn_completed', title: '本轮完成', body: '对话已完成', conversationId: 'conv-2', projectId: 'p1' });
    renderBell();
    fireEvent.click(screen.getByTestId('notification-center-bell')); // 展开列表
    const item = await screen.findByText('本轮完成');
    fireEvent.click(item);
    await waitFor(() => expect(dispatched.some((d) => d.name === 'petri:approval-card-focus')).toBe(false));
    window.dispatchEvent = origDispatch;
  });
});
