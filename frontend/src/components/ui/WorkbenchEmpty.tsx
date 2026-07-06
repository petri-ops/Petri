// ============================================================
// WorkbenchEmpty — 工作台类页面统一空状态
//
// 用于 /tools、/single-cell、/spatial 等深色工作台页面。
// 浅色卡片库页面（Skills/算法/FigCode）不用这个——它们有自己的空状态。
//
// 视觉：居中 + 标题 + 描述 + 可选按钮 + 可选提示
// 配色：和 sc-empty 一致（#9ca3af / #475569），不引入新色值
// ============================================================

import React from 'react';
import styles from './WorkbenchEmpty.module.css';

interface WorkbenchEmptyProps {
  title?: string;
  desc: string;
  primaryLabel?: string;
  onPrimary?: () => void;
  hint?: React.ReactNode;
  loading?: boolean;
}

export function WorkbenchEmpty({
  title,
  desc,
  primaryLabel,
  onPrimary,
  hint,
  loading,
}: WorkbenchEmptyProps): React.ReactElement {
  if (loading) {
    return (
      <div className={styles.empty}>
        <div className={styles.desc}>加载中...</div>
      </div>
    );
  }

  return (
    <div className={styles.empty}>
      {title && <div className={styles.title}>{title}</div>}
      <div className={styles.desc}>{desc}</div>
      {primaryLabel && onPrimary && (
        <div className={styles.actions}>
          <button className="sc-btn sc-btn-primary" onClick={onPrimary}>
            {primaryLabel}
          </button>
        </div>
      )}
      {hint && <div className={styles.hint}>{hint}</div>}
    </div>
  );
}
