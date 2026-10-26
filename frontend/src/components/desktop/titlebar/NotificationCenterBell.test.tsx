import React from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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

// ---------- BLOCK-264（C-39）审批通知深定位 ----------

describe('NotificationCenterBell · 审批深定位（BLOCK-264 C-39）', () => {
  it('点击待审批通知派发 approvalCardFocus 事件（带 ackToken）', async () => {
    const dispatched: { name: string; detail: unknown }[] = [];
    const origDispatch = window.dispatchEvent;
    window.dispatchEvent = ((e: Event) => {
      if (e instanceof CustomEvent) dispatched.push({ name: e.type, detail: e.detail });
      return origDispatch.call(window, e);
    }) as typeof window.dispatchEvent;
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
      expect((evt!.detail as { ackToken?: string }).ackToken).toBe('token-abc');
    });
    window.dispatchEvent = origDispatch;
  });

  it('非审批通知不派发深定位事件', async () => {
    const dispatched: { name: string }[] = [];
    const origDispatch = window.dispatchEvent;
    window.dispatchEvent = ((e: Event) => {
      if (e instanceof CustomEvent) dispatched.push({ name: e.type });
      return origDispatch.call(window, e);
    }) as typeof window.dispatchEvent;
    pushNotice({ kind: 'turn_completed', title: '本轮完成', body: '对话已完成', conversationId: 'conv-2', projectId: 'p1' });
    renderBell();
    fireEvent.click(screen.getByTestId('notification-center-bell')); // 展开列表
    const item = await screen.findByText('本轮完成');
    fireEvent.click(item);
    await waitFor(() => expect(dispatched.some((d) => d.name === 'petri:approval-card-focus')).toBe(false));
    window.dispatchEvent = origDispatch;
  });
});
