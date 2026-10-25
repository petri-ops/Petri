import { useEffect, useRef } from 'react';
import { ackReminder, fetchReminders } from '@/lib/automationClient';
import { pushNotice } from '@/lib/notification-center';

/**
 * Q7 I5 — 全局提醒 bridge：轮询未确认 reminder，写入本地通知中心后确认。
 * 只做投递，不依赖系统通知权限；失败静默（下一轮重试）。
 */
export function ScheduleReminderBridge(): null {
  const pushed = useRef(new Set<string>());
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const { reminders } = await fetchReminders();
        for (const reminder of reminders) {
          if (!alive) return;
          if (pushed.current.has(reminder.id)) continue;
          pushed.current.add(reminder.id);
          try {
            pushNotice({
              kind: 'schedule_reminder',
              title: '计划提醒',
              body: reminder.message,
              projectId: reminder.project_id,
            });
            await ackReminder(reminder.id);
          } catch {
            pushed.current.delete(reminder.id);
          }
        }
      } catch {
        /* 后端未就绪/离线：下一轮重试 */
      }
    };
    void tick();
    const timer = window.setInterval(() => { void tick(); }, 30_000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);
  return null;
}
