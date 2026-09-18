import React from 'react';
import styles from './TestInstanceBadge.module.css';

/**
 * BLOCK-100 / UI-409 — 测试实例悬浮徽标。
 *
 * 身份判定：preload 经 webPreferences.additionalArguments 注入
 * `--gewu-test-instance=1`，biof3Desktop.__testInstance === true 才点亮。
 * 严格 === true：投影 shim（Proxy 属性访问返回 callable proxy）与普通主实例
 * （undefined）都不会误亮。非测试实例渲染 null，零布局占用。
 */
const isTestInstance =
  typeof window !== 'undefined' &&
  (window as { biof3Desktop?: { __testInstance?: unknown } }).biof3Desktop
    ?.__testInstance === true;

export function TestInstanceBadge(): React.ReactElement | null {
  if (!isTestInstance) return null;
  return (
    <div className={styles.badge} role="status" aria-label="测试实例">
      测试实例 · TEST
    </div>
  );
}
