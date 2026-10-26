/**
 * NotificationCenterBell — BLOCK-226 标题栏通知中心。
 *
 * 铃铛 + 未读徽章 + 弹层列表；事件由 useTurnNotifications 写入本地 store，
 * 不受系统通知偏好/聚焦/免打扰影响（免打扰只压系统 toast）。
 * 复用标题栏既有的 iconBtn / tabCountBadge / toolMenu 样式，不新增按钮形态。
 */

import React, { useState, useSyncExternalStore } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '@/components/icons/Icon';
import { useAppRailOptional } from '@/components/desktop/AppRailContext';
import styles from '../TitleBar.module.css';
import {
  clearNotices,
  getNoticePrefs,
  listNotices,
  markAllNoticesRead,
  markNoticeRead,
  noticeTarget,
  setNoticePrefs,
  subscribeNoticePrefs,
  subscribeNotices,
  unreadNoticeCount,
  type AppNotice,
  type AppNoticeKind,
} from '@/lib/notification-center';
import { dispatchPetriEvent, petriEvents } from '@/lib/events'; // BLOCK-264（C-39）

const KIND_LABELS: Record<AppNoticeKind, string> = {
  turn_completed: '完成',
  turn_failed: '失败',
  approval_required: '待确认',
  schedule_reminder: '提醒',
};

const PREF_ITEMS: Array<{ kind: AppNoticeKind; label: string }> = [
  { kind: 'turn_completed', label: '完成' },
  { kind: 'turn_failed', label: '失败' },
  { kind: 'approval_required', label: '待确认' },
  { kind: 'schedule_reminder', label: '提醒' },
];

export function NotificationCenterBell(): React.ReactElement {
  const notices = useSyncExternalStore(subscribeNotices, listNotices, listNotices);
  const prefs = useSyncExternalStore(subscribeNoticePrefs, getNoticePrefs, getNoticePrefs);
  const unread = unreadNoticeCount();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const appRail = useAppRailOptional();

  const openNotice = (notice: AppNotice) => {
    const target = noticeTarget(notice);
    markNoticeRead(notice.id);
    setOpen(false);
    if (!target) return;
    if (target.conversationId) appRail?.setActiveConvId(target.conversationId);
    void navigate(`/project/${target.projectId}/${target.mode}`);
    // BLOCK-264（C-39）— 待审批通知深定位：到位后滚动到待决审批卡
    if (notice.kind === 'approval_required' && notice.ackToken) {
      dispatchPetriEvent(petriEvents.approvalCardFocus, { conversationId: notice.conversationId, ackToken: notice.ackToken });
    }
  };

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
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: '6px 10px', borderBottom: '1px solid var(--petri-divider)' }} data-testid="notification-center-prefs">
              <span style={{ color: 'var(--petri-text-tertiary)', fontSize: 11 }}>接收</span>
              {PREF_ITEMS.map((item) => (
                <label key={item.kind} style={{ display: 'flex', alignItems: 'center', gap: 3, color: 'var(--petri-text-secondary)', fontSize: 12 }}>
                  <input
                    type="checkbox"
                    checked={prefs.kinds[item.kind]}
                    onChange={(event) => setNoticePrefs({ kinds: { [item.kind]: event.target.checked } })}
                    data-testid={`notice-pref-${item.kind}`}
                  />
                  {item.label}
                </label>
              ))}
              <label style={{ display: 'flex', alignItems: 'center', gap: 3, color: 'var(--petri-text-secondary)', fontSize: 12 }}>
                <input
                  type="checkbox"
                  checked={prefs.sound}
                  onChange={(event) => setNoticePrefs({ sound: event.target.checked })}
                  data-testid="notice-pref-sound"
                />
                声音
              </label>
            </div>
            {notices.length === 0 ? (
              <div style={{ padding: 14, color: 'var(--petri-text-tertiary)', fontSize: 13 }}>
                暂无通知。回合完成、失败或等待确认时会出现在这里。
              </div>
            ) : (
              notices.map((notice) => {
                const target = noticeTarget(notice);
                return (
                  <button
                    key={notice.id}
                    type="button"
                    onClick={() => openNotice(notice)}
                    disabled={!target}
                    data-testid="notification-center-item"
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 2,
                      padding: '8px 10px',
                      borderBottom: '1px solid var(--petri-divider)',
                      borderTop: 'none',
                      borderLeft: 'none',
                      borderRight: 'none',
                      width: '100%',
                      textAlign: 'left',
                      background: 'transparent',
                      color: 'inherit',
                      cursor: target ? 'pointer' : 'default',
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
                      {target ? ' · 点击打开' : ''}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </>
      )}
    </div>
  );
}
