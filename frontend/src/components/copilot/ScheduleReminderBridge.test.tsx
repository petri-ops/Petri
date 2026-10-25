// BLOCK-256 Q7 — 提醒 bridge：未确认 reminder → 通知中心 → ack。
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';

const api = vi.hoisted(() => ({
  fetchReminders: vi.fn(),
  ackReminder: vi.fn(),
}));
vi.mock('@/lib/automationClient', () => api);

import { ScheduleReminderBridge } from './ScheduleReminderBridge';
import { __resetNotificationCenterForTests, listNotices } from '@/lib/notification-center';

beforeEach(() => {
  vi.clearAllMocks();
  __resetNotificationCenterForTests();
  api.fetchReminders.mockResolvedValue({
    ok: true,
    reminders: [{
      id: 'rem_1',
      schedule_id: 'sch_1',
      project_id: 'proj_1',
      message: '记得看质控',
      due_at: '2026-10-25T09:00:00.000Z',
      acknowledged_at: null,
    }],
  });
  api.ackReminder.mockResolvedValue({ ok: true });
});
afterEach(cleanup);

describe('ScheduleReminderBridge', () => {
  it('把未确认提醒写入通知中心并确认', async () => {
    render(<ScheduleReminderBridge />);
    await waitFor(() => expect(api.ackReminder).toHaveBeenCalledWith('rem_1'));
    expect(listNotices()).toHaveLength(1);
    expect(listNotices()[0].kind).toBe('schedule_reminder');
    expect(listNotices()[0].body).toBe('记得看质控');
  });
});
