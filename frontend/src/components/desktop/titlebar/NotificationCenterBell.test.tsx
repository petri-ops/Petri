import React from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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

afterEach(cleanup);

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
