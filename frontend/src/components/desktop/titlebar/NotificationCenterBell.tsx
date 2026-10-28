/**
 * NotificationCenterBell — BLOCK-226 标题栏通知中心。
 *
 * 铃铛 + 未读徽章 + 弹层列表；事件由 useTurnNotifications 写入本地 store，
 * 不受系统通知偏好/聚焦/免打扰影响（免打扰只压系统 toast）。
 * UI-625 — 弹层不再复用通用 toolMenu（其直系 button 固定 32px 高，会把
 * 多行通知压叠、把未读圆点拉成长条）：独立 panel + 行式布局。
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

/** UI-625 — 相对时间：刚刚 / N 分钟前 / 今天 HH:mm / 昨天 HH:mm / M/D HH:mm。 */
function formatNoticeTime(iso: string, now = Date.now()): string {
  const time = new Date(iso).getTime();
  if (!Number.isFinite(time)) return '';
  const diff = now - time;
  if (diff >= 0 && diff < 60_000) return '刚刚';
  if (diff >= 0 && diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  const date = new Date(time);
  const today = new Date(now);
  const hhmm = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  if (date.toDateString() === today.toDateString()) return `今天 ${hhmm}`;
  const yesterday = new Date(now - 86_400_000);
  if (date.toDateString() === yesterday.toDateString()) return `昨天 ${hhmm}`;
  return `${date.getMonth() + 1}/${date.getDate()} ${hhmm}`;
}

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
            className={styles.noticePanel}
            role="dialog"
            aria-label="通知中心"
            data-testid="notification-center-panel"
          >
            <header className={styles.noticeHeader}>
              <span className={styles.noticeTitle}>通知中心</span>
              {unread > 0 && <span className={styles.noticeUnread}>{unread} 未读</span>}
              <span className={styles.noticeHeaderActions}>
                <button
                  type="button"
                  className={styles.noticeAction}
                  onClick={() => markAllNoticesRead()}
                  disabled={unread === 0}
                >
                  全部已读
                </button>
                <button
                  type="button"
                  className={styles.noticeAction}
                  onClick={() => clearNotices()}
                  disabled={notices.length === 0}
                >
                  清空
                </button>
              </span>
            </header>
            <div className={styles.noticePrefs} data-testid="notification-center-prefs">
              <span className={styles.noticePrefsLabel}>接收</span>
              <div className={styles.noticePrefsItems}>
                {PREF_ITEMS.map((item) => (
                  <label key={item.kind} className={styles.noticePref}>
                    <input
                      type="checkbox"
                      checked={prefs.kinds[item.kind]}
                      onChange={(event) => setNoticePrefs({ kinds: { [item.kind]: event.target.checked } })}
                      data-testid={`notice-pref-${item.kind}`}
                    />
                    <span>{item.label}</span>
                  </label>
                ))}
                <span className={styles.noticePrefsDivider} aria-hidden="true" />
                <label className={styles.noticePref}>
                  <input
                    type="checkbox"
                    checked={prefs.sound}
                    onChange={(event) => setNoticePrefs({ sound: event.target.checked })}
                    data-testid="notice-pref-sound"
                  />
                  <span>声音</span>
                </label>
              </div>
            </div>
            {notices.length === 0 ? (
              <div className={styles.noticeEmpty}>
                <Icon name="bell" size={18} />
                <span>暂无通知。回合完成、失败或等待确认时会出现在这里。</span>
              </div>
            ) : (
              <div className={styles.noticeList}>
                {notices.map((notice) => {
                  const target = noticeTarget(notice);
                  return (
                    <button
                      key={notice.id}
                      type="button"
                      onClick={() => openNotice(notice)}
                      disabled={!target}
                      data-testid="notification-center-item"
                      data-kind={notice.kind}
                      data-read={notice.read ? 'true' : 'false'}
                      className={`${styles.noticeItem}${notice.read ? ` ${styles.noticeItemRead}` : ''}`}
                    >
                      <span className={styles.noticeKind} data-kind={notice.kind}>
                        {KIND_LABELS[notice.kind]}
                      </span>
                      <span className={styles.noticeMain}>
                        <span className={styles.noticeItemTitle}>{notice.title}</span>
                        <span className={styles.noticeBody} title={notice.body}>{notice.body}</span>
                        <span className={styles.noticeMeta}>
                          {formatNoticeTime(notice.createdAt)}
                          {target ? ' · 点击打开' : ''}
                        </span>
                      </span>
                      {!notice.read && (
                        <span
                          data-testid="notification-center-dot"
                          className={styles.noticeDot}
                          aria-label="未读"
                        />
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
