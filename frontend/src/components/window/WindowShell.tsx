// ============================================================
// WindowShell — BLOCK-59 P1 弹出窗最小 chrome
//
// 独立窗（/window/* 路由）共用的外壳：可拖拽标题区 + 收回 / ×。
// × 永远是降格（minimizeToRail → 主进程 hide，窗口保活，plan §3
// 不可变契约）；收回（returnToDock）销毁 BrowserWindow，内容回主窗。
// 非 Electron 环境（纯浏览器直开路由）诚实降级：只提示，不出按钮。
// ============================================================
import React, { useEffect, useState } from 'react';
import { getBridge } from '@/lib/desktopBridge';
import styles from './window-shell.module.css';

export function WindowShell({
  title,
  subtitle,
  badge = '独立窗 · 只读',
  closeBehavior = 'rail',
  children,
}: {
  title: string;
  subtitle?: string | null;
  badge?: string;
  /** 'rail'（默认）：× = 降格进轨道（不可变契约）；'close'：× = 直接关闭
   *  （无状态单例，如指挥中心，plan §4.1）。close 形态不显示「收回」。 */
  closeBehavior?: 'rail' | 'close';
  children: React.ReactNode;
}): React.ReactElement {
  const [contentId, setContentId] = useState<string | null>(null);
  const [bridgeMissing, setBridgeMissing] = useState(false);
  const [actionError, setActionError] = useState('');

  useEffect(() => {
    const bridge = getBridge('windowManager');
    if (!bridge) {
      setBridgeMissing(true);
      return;
    }
    let cancelled = false;
    bridge
      .self()
      .then((res) => {
        if (cancelled) return;
        if (res.ok && res.contentId) setContentId(res.contentId);
        else setBridgeMissing(true);
      })
      .catch(() => setBridgeMissing(true));
    return () => {
      cancelled = true;
    };
  }, []);

  const handleReturn = async () => {
    if (!contentId) return;
    setActionError('');
    const bridge = getBridge('windowManager');
    const res = await bridge?.returnToDock(contentId);
    if (res && !res.ok) setActionError(res.error || '收回失败');
  };

  const handleDemote = async () => {
    setActionError('');
    if (closeBehavior === 'close') {
      // 无状态单例：× 即真关闭（适配器不拦截 closeBehavior 'close'）
      try { window.close(); } catch {}
      return;
    }
    if (!contentId) return;
    const bridge = getBridge('windowManager');
    const res = await bridge?.minimizeToRail(contentId);
    if (res && !res.ok) setActionError(res.error || '降格失败');
  };

  return (
    <div className={styles.shell}>
      <header className={styles.header} data-drag-region="">
        <div className={styles.titleGroup}>
          <span className={styles.badge}>{badge}</span>
          <strong className={styles.title} title={title}>{title}</strong>
          {subtitle && <span className={styles.subtitle}>{subtitle}</span>}
        </div>
        <div className={styles.actions} data-no-drag-region="">
          {actionError && <span className={styles.actionError}>{actionError}</span>}
          {closeBehavior === 'rail' && contentId && !bridgeMissing && (
            <button
              type="button"
              className={styles.actionBtn}
              onClick={() => void handleReturn()}
              title="收回主窗（独立窗关闭，内容回主窗）"
            >
              收回
            </button>
          )}
          {(!bridgeMissing || closeBehavior === 'close') && (
            <button
              type="button"
              className={`${styles.actionBtn} ${styles.demoteBtn}`}
              onClick={() => void handleDemote()}
              title={closeBehavior === 'close' ? '关闭指挥中心（无状态单例，随开随关）' : '降格到边缘活动轨道（不销毁，可从轨道恢复）'}
              aria-label={closeBehavior === 'close' ? '关闭指挥中心' : '降格到活动轨道'}
            >
              ×
            </button>
          )}
        </div>
      </header>
      {bridgeMissing && (
        <div className={styles.degradedNote} role="note">
          当前环境不支持独立窗管理（仅桌面版可用）；内容以只读视图展示。
        </div>
      )}
      <div className={styles.body}>{children}</div>
    </div>
  );
}
