import React, { useEffect, useState } from 'react';
import { getBridge } from '@/lib/desktopBridge';
import { BRAND } from '@/lib/brand';
import { Icon } from '@/components/icons/Icon';
import { segmentToMode, type WorkspaceMode } from '@/hooks/useWorkspaceRouting';
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
 * BLOCK-87 — 投影环境（手机/平板浏览器经 gateway 投影访问）。标志由投影垫片
 * 在 <head> 最前同步设置（先于 React 挂载，勿用 window 标志——React 挂载后
 * 读不到）。此形态下桌面窗口控件（最小化/最大化/关闭）是死按钮，一律隐藏。
 */
export function getIsProjection(): boolean {
  return typeof document !== 'undefined'
    && document.documentElement.getAttribute('data-projection') === '1';
}

/**
 * BLOCK-87 L3 — 投影 + 窄屏（≤767px 手机浏览器）：壳层 AppRail 转抽屉浮层，
 * 标题栏左上「展开/收起左侧栏」按钮直接开合（L3-2 用户裁决：撤掉独立 ☰，
 * 左上唯一入口）。jsdom 无 matchMedia 时 fail-closed 回 false（桌面语义）。
 */
export function isProjectionMobile(): boolean {
  try {
    return getIsProjection() && window.matchMedia('(max-width: 767px)').matches;
  } catch {
    return false;
  }
}

/**
 * UI-359/360 — 工作区路由解析（`/project/:id/*` 单一事实源）。
 *
 * 返回 null = 工作区面板不存在的路由：非 project 路由（/、/projects、/skills、
 * /knowledge、/backend）与 `/project/:id/results`（独立 ResultStudio 页）。
 * mode 经 segmentToMode 解析（chat 为默认落地模式，未知段 fail-closed 回 chat），
 * 供顶栏各 zone 按模式裁剪只在对应模式存在的控件（死开关治理）。
 */
export function parseWorkspaceRoute(pathname: string): { mode: WorkspaceMode } | null {
  const path = pathname.replace(/\/+$/, '') || '/';
  const m = path.match(/^\/project\/[^/]+(?:\/(.*))?$/);
  if (!m || m[1] === 'results') return null;
  return { mode: segmentToMode(m[1]) };
}

/**
 * UI-360 — 该工作区模式是否有摘要概览卡消费：摘要卡只在 chat / scheduled
 * 会话布局内渲染（project-workspace `showPinnedSummary` 同口径），顶栏的
 * 「展开摘要概览」开关在其余模式/路由是死开关。
 * UI-365 — modeUsesRightRail 随 settings 模式退役而移除：工作区模式
 * （chat/scheduled/结果族）全部有右栏消费，右栏开合只由路由与用户偏好决定。
 */
export function modeUsesSummaryCard(mode: WorkspaceMode): boolean {
  return mode === 'chat' || mode === 'scheduled';
}

/**
 * UI-348 — 全局独立页判定（/skills /knowledge /backend）：这些页面自带
 * 「返回 + 图标 + 标题」页头，fixed 顶栏不再渲染品牌 chip 与分区分隔线
 * （此前顶栏左区分隔线与壳层左栏宽度错位 24px，叠出「多一条线」的布局冲突）。
 * UI-364 — /plugins 插件商店独立页并入同形态。
 * UI-365 — /settings 设置独立页并入同形态。
 */
export function isStandalonePagePath(pathname: string): boolean {
  return /^\/(skills|knowledge|backend|plugins|settings)\/?$/.test(pathname);
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
export function WindowControls({ divider = true }: { divider?: boolean } = {}): React.ReactElement {
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
    <div className={`${styles.windowControls} ${!divider ? styles.windowControlsNoDivider : ''}`}>
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
