import React from 'react';
import { Icon } from '@/components/icons/Icon';
import styles from '@/pages/project-workspace.module.css';

// Center column shell for `scheduled` workspace mode.
// Extracted from project-workspace.tsx (T85 增量2, UI-144) to slim the
// 5000-line God component and cut the CenterPanel -> project-workspace
// circular import for this panel. Pure presentational: it owns no state and
// only reports "return to chat" back via the `onBackToChat` callback.
export function ScheduledWorkspacePanel({
  onBackToChat,
}: {
  onBackToChat: () => void;
}): React.ReactElement {
  return (
    <div className={styles.scheduledWorkspace}>
      <div className={styles.scheduledWorkspaceHeader}>
        <button className={styles.scheduledWorkspaceBack} onClick={onBackToChat}>
          <Icon name="message-circle" size={14} />
          <span>返回对话</span>
        </button>
      </div>
      <div className={styles.scheduledWorkspaceBody}>
        <div className={styles.scheduledEmptyState}>
          <div className={styles.scheduledEmptyIcon}>
            <Icon name="calendar" size={28} />
          </div>
          <h2 className={styles.scheduledEmptyTitle}>定时分析</h2>
          <p className={styles.scheduledEmptyDesc}>
            按计划自动重跑分析的功能即将推出。你可以先返回对话，手动触发一次分析。
          </p>
          <button className={styles.scheduledEmptyBack} onClick={onBackToChat}>
            <Icon name="message-circle" size={14} />
            <span>返回对话</span>
          </button>
        </div>
      </div>
    </div>
  );
}
