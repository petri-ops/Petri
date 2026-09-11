import React, { useEffect, useState } from 'react';
import { getBridge } from '@/lib/desktopBridge';
import { BRAND } from '@/lib/brand';
import { Icon } from '@/components/icons/Icon';
import styles from '../TitleBar.module.css';

/**
 * BLOCK-62 P1a — TitleBar 列体化共享层。
 *
 * 这些纯函数 / 钩子 / 组件从 [TitleBar.tsx](../TitleBar.tsx) 原样提取，供
 * 三处复用：fixed 整条 TitleBar（非列体化路由：home/skills/review/result-studio）
 * 与列级 header 片段（ProjectWorkspace 左/中/右列）。提取是行为保持的：
 * 逻辑与依赖一字不动，只是换了宿主文件，避免 P1b 布局翻转时重复实现。
 */

// 惰性求值（不要提成模块级常量）：模块级常量在 import 时就固化，测试里通过
// vi.stubGlobal 注入 window.biof3Desktop 发生在 import 之后，会导致这两个判定
// 永远为 false、窗口控件根本不渲染，整个测试文件集体失败。
export function getIsMac(): boolean {
  return typeof window !== 'undefined' && window.biof3Desktop?.platform === 'darwin';
}

export function getIsDesktop(): boolean {
  return typeof window !== 'undefined' && window.biof3Desktop?.isDesktop === true;
}

/**
 * UI-348 — 全局独立页判定（/skills /knowledge /backend）：这些页面自带
 * 「返回 + 图标 + 标题」页头，fixed 顶栏不再渲染品牌 chip 与分区分隔线
 * （此前顶栏左区分隔线与壳层左栏宽度错位 24px，叠出「多一条线」的布局冲突）。
 */
export function isStandalonePagePath(pathname: string): boolean {
  return /^\/(skills|knowledge|backend)\/?$/.test(pathname);
}

export function getFallbackTitle(pathname: string): string {
  if (pathname.startsWith('/project/')) return '梳理开发进展';
  if (pathname.startsWith('/tools')) return '分析结果';
  if (pathname.startsWith('/admin')) return '管理';
  return BRAND.APP_NAME;
}

export interface DesktopWindowControls {
  isMaximized: boolean;
  minimize: () => void;
  toggleFullScreen: () => void;
  close: () => void;
  onTitleBarDoubleClick: (event: React.MouseEvent<HTMLElement>) => void;
}

/**
 * 顶栏双击 → 切换全屏。纯函数（不订阅 maximize 状态）：fixed 整条 TitleBar 只需要
 * 这个动作，用完整 useDesktopWindowControls 会和交通灯所在片段各订阅一次
 * onMaximizeChanged（双份查询/订阅）。订阅归交通灯片段（唯一消费者）持有。
 */
export function handleTitleBarDoubleClick(event: React.MouseEvent<HTMLElement>): void {
  const target = event.target as Element | null;
  if (target?.closest?.('button, a, input, select, textarea, [role="button"]')) {
    return;
  }
  const bridge = typeof window !== 'undefined' ? window.biof3Desktop : undefined;
  const desktopWindow = bridge?.isDesktop === true ? bridge.window : undefined;
  desktopWindow?.toggleFullScreen?.();
}

export function useDesktopWindowControls(): DesktopWindowControls {
  const bridge = typeof window !== 'undefined' ? window.biof3Desktop : undefined;
  const desktopWindow = bridge?.isDesktop === true ? bridge.window : undefined;
  const [isMaximized, setIsMaximized] = useState<boolean>(false);

  useEffect(() => {
    if (!desktopWindow) return undefined;

    let active = true;
    let receivedLiveState = false;
    let unsubscribe: (() => void) | undefined;

    try {
      // Subscribe before hydrating from the query. A maximize event can arrive
      // between these operations, and the live event is the newer truth.
      unsubscribe = desktopWindow.onMaximizeChanged?.((value) => {
        receivedLiveState = true;
        if (active) setIsMaximized(value === true);
      });
    } catch {
      // A partially available preload bridge should leave the safe default in
      // place instead of preventing the title bar from rendering.
      unsubscribe = undefined;
    }

    if (desktopWindow.isMaximized) {
      // Promise.resolve().then(...) also catches a bridge that throws before it
      // can return its Promise (for example, an older preload implementation).
      void Promise.resolve()
        .then(() => desktopWindow.isMaximized?.())
        .then((value) => {
          // A live maximize/unmaximize event is newer than the initial query.
          // Never let a late query response overwrite that state.
          if (active && !receivedLiveState) setIsMaximized(value === true);
        })
        .catch(() => {
          // Older or partially available desktop bridges keep the safe default.
        });
    }

    return () => {
      active = false;
      try {
        unsubscribe?.();
      } catch {
        // Cleanup must remain safe even if an older bridge has a fragile
        // unsubscribe implementation.
      }
    };
  }, [desktopWindow?.isMaximized, desktopWindow?.onMaximizeChanged]);

  return {
    isMaximized,
    minimize: () => desktopWindow?.minimize?.(),
    toggleFullScreen: () => desktopWindow?.toggleFullScreen?.(),
    close: () => desktopWindow?.close?.(),
    onTitleBarDoubleClick: (event) => {
      const target = event.target as Element | null;
      if (target?.closest?.('button, a, input, select, textarea, [role="button"]')) {
        return;
      }
      desktopWindow?.toggleFullScreen?.();
    },
  };
}

/**
 * Custom frameless window controls (minimize / maximize-restore / close).
 * Rendered ONLY on non-macOS. Calls the existing `window` IPC bridge that
 * the preload already exposes (`minimize`, `maximize` [toggles], `close`,
 * `isMaximized`).
 */
export function WindowControls(): React.ReactElement {
  const bridge = getBridge('window');
  const [isMaximized, setIsMaximized] = useState<boolean>(false);

  useEffect(() => {
    if (!bridge) return;
    let cancelled = false;
    bridge
      .isMaximized()
      .then((maximized) => {
        if (!cancelled) setIsMaximized(maximized);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [bridge]);

  if (!bridge) return <></>;

  return (
    <div className={styles.windowControls}>
      <button
        type="button"
        className={styles.winBtn}
        onClick={() => bridge.minimize()}
        title="最小化"
        aria-label="最小化"
      >
        <Icon name="minus" size={14} />
      </button>
      <button
        type="button"
        className={styles.winBtn}
        onClick={() => {
          bridge.maximize();
          setIsMaximized((prev) => !prev);
        }}
        title={isMaximized ? '还原' : '最大化'}
        aria-label={isMaximized ? '还原' : '最大化'}
      >
        <Icon name={isMaximized ? 'restore' : 'square'} size={14} />
      </button>
      <button
        type="button"
        className={`${styles.winBtn} ${styles.winBtnClose}`}
        onClick={() => bridge.close()}
        title="关闭"
        aria-label="关闭"
      >
        <Icon name="x" size={14} />
      </button>
    </div>
  );
}
