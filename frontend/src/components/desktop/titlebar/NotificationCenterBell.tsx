/**
 * NotificationCenterBell — BLOCK-226 标题栏通知中心。
 *
 * 铃铛 + 未读徽章 + 弹层列表；事件由 useTurnNotifications 写入本地 store，
 * 不受系统通知偏好/聚焦/免打扰影响（免打扰只压系统 toast）。
 * 复用标题栏既有的 iconBtn / tabCountBadge / toolMenu 样式，不新增按钮形态。
 */

import React, { useState, useSyncExternalStore } from 'react';
import { Icon } from '@/components/icons/Icon';
import styles from '../TitleBar.module.css';
import {
  clearNotices,
  listNotices,
  markAllNoticesRead,
  subscribeNotices,
  unreadNoticeCount,
  type AppNoticeKind,
} from '@/lib/notification-center';

const KIND_LABELS: Record<AppNoticeKind, string> = {
  turn_completed: '完成',
  turn_failed: '失败',
  approval_required: '待确认',
  schedule_reminder: '提醒',
};

export function NotificationCenterBell(): React.ReactElement {
  const notices = useSyncExternalStore(subscribeNotices, listNotices, listNotices);
  const unread = unreadNoticeCount();
  const [open, setOpen] = useState(false);

  return (
    <div className={styles.toolMenuAnchor}>
      <button
        type="button"
        className={styles.iconBtn}
        onClick={() => setOpen((value) => !value)}
        title={unread > 0 ? `通知中心（${unread} 条未读）` : '通知中心'}
        aria-label={unread > 0 ? `通知中心（${unread} 条未读）` : '通知中心'}
        aria-haspopup="dialog"
        aria-expanded={open}
        data-testid="notification-center-bell"
      >
        <Icon name="bell" size={15} />
        {unread > 0 && (
          <span className={styles.tabCountBadge} data-testid="notification-center-unread">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
      {open && (
        <>
          <button
            type="button"
            className={styles.toolMenuOverlay}
            onClick={() => setOpen(false)}
            aria-label="关闭通知中心"
          />
          <div
            className={`${styles.toolMenu} ${styles.notificationMenu}`}
            role="dialog"
            aria-label="通知中心"
            data-testid="notification-center-panel"
            style={{ width: 340, maxHeight: 380, overflowY: 'auto' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderBottom: '1px solid var(--petri-divider)' }}>
              <strong style={{ flex: 1, color: 'var(--petri-text)' }}>通知中心</strong>
              <button
                type="button"
                className={styles.toolMenuItem}
                onClick={() => markAllNoticesRead()}
                disabled={unread === 0}
                style={{ width: 'auto', padding: '0 6px' }}
              >
                全部已读
              </button>
              <button
                type="button"
                className={styles.toolMenuItem}
                onClick={() => clearNotices()}
                disabled={notices.length === 0}
                style={{ width: 'auto', padding: '0 6px' }}
              >
                清空
              </button>
            </div>
            {notices.length === 0 ? (
              <div style={{ padding: 14, color: 'var(--petri-text-tertiary)', fontSize: 13 }}>
                暂无通知。回合完成、失败或等待确认时会出现在这里。
              </div>
            ) : (
              notices.map((notice) => (
                <div
                  key={notice.id}
                  data-testid="notification-center-item"
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 2,
                    padding: '8px 10px',
                    borderBottom: '1px solid var(--petri-divider)',
                    opacity: notice.read ? 0.65 : 1,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ color: 'var(--petri-text-tertiary)', fontSize: 11 }}>{KIND_LABELS[notice.kind]}</span>
                    <span style={{ color: 'var(--petri-text)', fontSize: 13, flex: 1 }}>{notice.title}</span>
                    {!notice.read && (
                      <span
                        data-testid="notification-center-dot"
                        style={{ width: 6, height: 6, borderRadius: 3, background: 'var(--petri-accent)' }}
                      />
                    )}
                  </div>
                  <span style={{ color: 'var(--petri-text-secondary)', fontSize: 12 }}>{notice.body}</span>
                  <span style={{ color: 'var(--petri-text-tertiary)', fontSize: 11 }}>
                    {new Date(notice.createdAt).toLocaleString()}
                  </span>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
