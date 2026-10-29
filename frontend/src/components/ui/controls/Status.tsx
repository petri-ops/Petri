import type { ReactNode } from 'react';
import type { AxisProjection } from '@/lib/statusProjection';
import styles from './status.module.css';

/** BLOCK-167 W4 — 空/载/错三件套单源（宪章 §6）。新状态一律用这三件，禁止再手写形态。 */

/** NEXT-02A — 执行/证据/能力三轴徽标；状态语义只从 statusProjection 消费。 */
export function StatusBadge<TStatus extends string>({
  projection,
  className,
  testId,
}: {
  projection: AxisProjection<TStatus> | null;
  className?: string;
  testId?: string;
}): React.ReactElement {
  const label = projection?.label || '—';
  const detail = projection?.detail;
  return (
    <span
      className={`${styles.statusBadge}${className ? ` ${className}` : ''}`}
      data-testid={testId}
      data-axis={projection?.axis || 'none'}
      data-status={projection?.status || 'unknown'}
      data-tone={projection?.tone || 'neutral'}
      title={detail}
      aria-label={detail ? `${label}：${detail}` : label}
    >
      {label}
    </span>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  actions,
}: {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}): React.ReactElement {
  return (
    <div className={styles.wrapper}>
      {icon ? <div className={styles.icon}>{icon}</div> : null}
      <div className={styles.title}>{title}</div>
      {description ? <p className={styles.description}>{description}</p> : null}
      {actions ? <div className={styles.actions}>{actions}</div> : null}
    </div>
  );
}

export function ErrorNotice({
  message,
  onRetry,
  retryLabel = '重试',
}: {
  message: ReactNode;
  onRetry?: () => void;
  retryLabel?: string;
}): React.ReactElement {
  return (
    <div className={styles.errorNotice} role="alert">
      <span className={styles.errorMsg}>{message}</span>
      {onRetry ? (
        <button type="button" className={styles.retryBtn} onClick={onRetry}>
          {retryLabel}
        </button>
      ) : null}
    </div>
  );
}

export function LoadingBlock({ label = '加载中…' }: { label?: string }): React.ReactElement {
  return (
    <div className={styles.loading} role="status">
      <span className={styles.spinner} aria-hidden />
      <span>{label}</span>
    </div>
  );
}
