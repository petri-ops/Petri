// UI-397 — SSH 连接呼吸灯：绿=连接（呼吸动画） 黄=连接中（快闪） 红=断联（常亮）。
// 点击灯 = 手动立即重试。状态源 useSshHeartbeat（模块级单例轮询，多挂载点共享）。
import React from 'react';
import { useSshHeartbeat, sshHeartbeatRetry, type SshLinkStatus } from '@/hooks/useSshHeartbeat';
import styles from './SshStatusDot.module.css';

const LABEL: Record<SshLinkStatus, string> = {
  alive: '远程连接正常',
  connecting: '连接中…',
  dead: '连接断开（点击重试，自动恢复）',
};

export function SshStatusDot({
  projectId,
  withLabel = false,
}: {
  projectId: string;
  /** true = 带文字标签（文件树工具条）；false = 仅小圆点（左栏项目行）。 */
  withLabel?: boolean;
}): React.ReactElement {
  const { status, ms } = useSshHeartbeat(projectId, true);
  const title = `${LABEL[status]}${status === 'alive' && ms != null ? ` · ${ms}ms` : ''}（30s 自动探活）`;
  return (
    <button
      type="button"
      className={`${styles.dotBtn}${withLabel ? ` ${styles.withLabel}` : ''}`}
      title={title}
      aria-label={`远程连接状态：${LABEL[status]}`}
      onClick={() => sshHeartbeatRetry(projectId)}
    >
      <span className={`${styles.dot} ${styles[status]}`} aria-hidden="true" />
      {withLabel && (
        <span className={styles.label}>
          {status === 'alive' ? '已连接' : status === 'connecting' ? '连接中' : '已断开'}
        </span>
      )}
    </button>
  );
}
