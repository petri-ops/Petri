// ============================================================
// ResultCard — reusable card container for copilot result
// payloads (tool outputs, file refs, analysis summaries).
//
// This component is the visual shell that ResultCardRenderer
// (and any future direct consumer) wraps around a payload.
// It owns the chrome (header / meta / actions / dismiss) and
// delegates content rendering to its children.
// ============================================================

import type { ReactNode } from 'react';
import styles from './ResultCard.module.css';

export type CardVariant = 'default' | 'success' | 'warning' | 'error' | 'info';

export interface ResultCardProps {
  /** Main title shown in the header. */
  title: string;
  /** Optional secondary line under the title. */
  subtitle?: string;
  /** Semantic variant controlling border + tint. */
  variant?: CardVariant;
  /** Optional glyph or short label shown before the title. */
  icon?: string;
  /** Optional meta line (e.g. "12 结果 · 用时 1.2s"). */
  meta?: string;
  /** Body content (rendered via the registry or directly). */
  children?: ReactNode;
  /** Action row (buttons, links). */
  actions?: ReactNode;
  /** When true, render a close button in the header. */
  dismissible?: boolean;
  /** Fired when the close button is clicked. */
  onDismiss?: () => void;
  /** Forwarded for testing hooks. */
  'data-testid'?: string;
}

export function ResultCard(props: ResultCardProps) {
  const {
    title,
    subtitle,
    variant = 'default',
    icon,
    meta,
    children,
    actions,
    dismissible,
    onDismiss,
    'data-testid': testId,
  } = props;

  return (
    <article
      className={`${styles.card} ${styles[`variant-${variant}`] ?? ''}`}
      data-testid={testId}
      data-variant={variant}
    >
      <header className={styles.header}>
        {icon !== undefined && icon !== '' && (
          <span className={styles.icon} aria-hidden>
            {icon}
          </span>
        )}
        <div className={styles.heading}>
          <h3 className={styles.title}>{title}</h3>
          {subtitle !== undefined && subtitle !== '' && (
            <p className={styles.subtitle}>{subtitle}</p>
          )}
        </div>
        {dismissible && (
          <button
            type="button"
            aria-label="关闭"
            className={styles.dismiss}
            onClick={onDismiss}
          >
            ×
          </button>
        )}
      </header>
      {meta !== undefined && meta !== '' && (
        <div className={styles.meta}>{meta}</div>
      )}
      {children !== undefined && children !== null && (
        <div className={styles.body}>{children}</div>
      )}
      {actions !== undefined && actions !== null && (
        <footer className={styles.actions}>{actions}</footer>
      )}
    </article>
  );
}
