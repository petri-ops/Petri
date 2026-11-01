import { useEffect, useRef } from 'react';
import { getPlatformApiPrefix, getToken } from '@/lib/authClient';
import { pushNotice } from '@/lib/notification-center';

/**
 * BLOCK-323 放权坡道 — 复盘提醒 bridge（ScheduleReminderBridge 同型）。
 * 轮询未复盘观察数，≥阈值写一条本地通知；quiet by default：按最新观察 id 去重，
 * 同一批观察只提醒一次，复盘后新观察再触发。失败静默（下一轮重试）。
 */
const REVIEW_THRESHOLD = 3;
const POLL_MS = 60_000;

interface ObservationsResponse {
  status: string;
  unreviewed?: Array<{ id: number }>;
  unreviewedCount?: number;
  error?: string;
}

export function PolicyReviewBridge(): null {
  const lastNotifiedMaxId = useRef(0);
  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const token = getToken();
        const response = await fetch(`${getPlatformApiPrefix()}/ai/policy-observations`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        const data = (await response.json()) as unknown as ObservationsResponse;
        if (!alive || !response.ok || data?.status !== 'ok') return;
        const count = Number(data.unreviewedCount) || 0;
        // 不用 Array.isArray 守卫：它会把 ReadonlyArray 收窄成 any[]（unsafe-any 红源）
        const rows = data.unreviewed ?? [];
        if (count < REVIEW_THRESHOLD || rows.length === 0) return;
        const maxId = rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0);
        if (maxId <= lastNotifiedMaxId.current) return;
        lastNotifiedMaxId.current = maxId;
        pushNotice({
          kind: 'review_available',
          title: '放权坡道待复盘',
          body: `有 ${count} 条「本可自动执行」的观察待复盘（设置 → Agent 规则）。`,
        });
      } catch {
        /* 后端未就绪/离线：下一轮重试 */
      }
    };
    void tick();
    const timer = window.setInterval(() => { void tick(); }, POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);
  return null;
}
