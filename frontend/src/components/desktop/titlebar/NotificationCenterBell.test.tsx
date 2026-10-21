import React from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NotificationCenterBell } from './NotificationCenterBell';
import {
  __resetNotificationCenterForTests,
  listNotices,
  pushNotice,
  unreadNoticeCount,
} from '@/lib/notification-center';

beforeEach(() => {
  __resetNotificationCenterForTests();
});

afterEach(cleanup);

describe('NotificationCenterBell', () => {
  it('空态：无徽章，打开显示空提示', () => {
    render(<NotificationCenterBell />);
    expect(screen.queryByTestId('notification-center-unread')).toBeNull();
    fireEvent.click(screen.getByTestId('notification-center-bell'));
    expect(screen.getByTestId('notification-center-panel').textContent).toContain('暂无通知');
  });

  it('有未读：徽章计数 + 列表行 + 全部已读清零', () => {
    pushNotice({ kind: 'turn_completed', title: '完成', body: 'A' });
    pushNotice({ kind: 'approval_required', title: '确认', body: 'B' });
    render(<NotificationCenterBell />);
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
    render(<NotificationCenterBell />);
    fireEvent.click(screen.getByTestId('notification-center-bell'));
    fireEvent.click(screen.getByText('清空'));
    expect(listNotices()).toHaveLength(0);
    expect(screen.getByTestId('notification-center-panel').textContent).toContain('暂无通知');
  });
});
