import { useEffect, useMemo } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { useWorkspacePanelsContext } from '@/components/desktop/WorkspacePanelsContext';
import { petriEvents, dispatchPetriEvent } from '@/lib/events';
import type { RightPanelMode } from './rightPanelTabs';
import type { WorkSurfaceDescriptor, WorkSurfaceTab } from '@/lib/workSurface/types';
import { isTabSurface } from '@/lib/workSurface/registry';
// UI-446 — 审阅 tab 未读圆点数据源（当前会话工作区改动索引）
import { useConversationUnreviewedCount, useConversationShortstat } from '@/components/copilot/conversationChangesStore';

// BLOCK-92 Wave B-1 — TitleBar 注册 effect 簇外迁（原 ProjectWorkspace 内联，纯搬运零行为变化）。
// TitleBar 注册 —— 8f3d55a5 曾误删整段（右侧工具菜单「+」/ 标签 pills / 结果
// 选择器随之全部失效），UI-309 从 e689f867 恢复。BLOCK-62 P2：宽度两字段
// （leftPanelWidth/rightPanelWidth）已从 TitleBarState 退役——regular 顶栏是
// 列内 ColumnHeader（宽=aside 宽，同 commit），compact/loading/error 的 fixed
// 条宽度改由本页 props 同树直传，不再每拖拽帧跨树推送 context。

type UpdateTitleBar = ReturnType<typeof useWorkspacePanelsContext>['updateTitleBar'];

interface UseWorkspaceTitleBarOptions {
  updateTitleBar: UpdateTitleBar;
  projectName: string | undefined;
  /** UI-449（C-16）— shortstat 取数需要项目根（badge ±行数权威源）。 */
  projectId?: string;
  titleBarTitle: string;
  rightTab: string;
  rightToolMenuOpen: boolean;
  /** Ordered tab records (core + pack) — labels/identity come from here. */
  tabs: WorkSurfaceTab[];
  /** Registry-declared tab surfaces (excludes result surfaces). */
  surfaces: WorkSurfaceDescriptor[];
  activeJobId: string | null;
  conversationJobs: Array<{ id: string; status?: string; name?: string; tool_id?: string; created_at: number | string }>;
  browserCanGoBack: boolean;
  browserCanGoForward: boolean;
  // UI-309：旧版遗漏——缺失会让顶栏会话选择器持有过期闭包（仅作依赖项）
  conversations: readonly unknown[];
  activeConvId: string | null;
  handleSwitchConversation: unknown;
  handleOpenRightResults: () => void;
  handleSelectTitleBarResult: (jobId: string) => void;
  openRightPanel: (tab: RightPanelMode) => void;
  closeRightPanelTab: (tab: RightPanelMode) => void;
  closeOtherTabs?: (tabId: string) => void;
  closeTabsToRight?: (tabId: string) => void;
  closeAllTabs?: () => void;
  setRightOpen: (open: boolean) => void;
  setRightTab: (tab: RightPanelMode) => void;
  setRightToolMenuOpen: Dispatch<SetStateAction<boolean>>;
}

export function useWorkspaceTitleBar(options: UseWorkspaceTitleBarOptions): void {
  const {
    updateTitleBar,
    projectName,
    projectId,
    titleBarTitle,
    rightTab,
    rightToolMenuOpen,
    tabs,
    surfaces,
    activeJobId,
    conversationJobs,
    browserCanGoBack,
    browserCanGoForward,
    conversations,
    activeConvId,
    handleSwitchConversation,
    handleOpenRightResults,
    handleSelectTitleBarResult,
    openRightPanel,
    closeRightPanelTab,
    closeOtherTabs,
    closeTabsToRight,
    closeAllTabs,
    setRightOpen,
    setRightTab,
    setRightToolMenuOpen,
  } = options;

  // UI-446 v4 — 审阅 tab 计数徽章：当前会话未审工作区改动文件数（激活审阅 tab 即归零）
  const reviewCount = useConversationUnreviewedCount(activeConvId);
  // UI-449（C-16）— ±行数（权威源=git shortstat；有未审改动才拉，TTL 节流）
  const reviewStat = useConversationShortstat(activeConvId, projectId ?? null, reviewCount > 0);

  const titleBarTabs = useMemo(
    () =>
      tabs
        .filter((tab) => tab.surfaceId !== 'home')
        .map((tab) => {
          const descriptor = surfaces.find((candidate) => candidate.id === tab.surfaceId);
          return {
            id: tab.id,
            label: tab.title || descriptor?.title || tab.surfaceId,
            icon: descriptor?.icon || 'folder',
            closable: descriptor?.closeable !== false,
            reviewCount: tab.surfaceId === 'review' ? reviewCount : undefined,
            reviewStat:
              tab.surfaceId === 'review' && reviewStat
                ? { added: reviewStat.tracked.added, removed: reviewStat.tracked.removed }
                : undefined,
          };
        }),
    [tabs, surfaces, reviewCount, reviewStat]
  );
  const toolSurfaceItems = useMemo(
    () => surfaces.filter((surface) => surface.id !== 'home' && isTabSurface(surface)),
    [surfaces]
  );
  const titleBarResultItems = useMemo(() => conversationJobs.map((job) => {
    const status = job.status === 'done'
      ? '完成'
      : job.status === 'failed'
        ? '失败'
        : job.status === 'running'
          ? '运行中'
          : '排队中';
    return {
      id: job.id,
      label: job.name || job.tool_id || '分析结果',
      status: `${status} · ${new Date(job.created_at).toLocaleTimeString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })}`,
    };
  }), [conversationJobs]);

  // 标题栏是壳层共享状态：复位只放在**卸载**（effect cleanup 每次重跑都会 setState；
  // 与依赖抖动叠加会形成 "Maximum update depth" 环——BLOCK-250 实机抓真）。
  useEffect(() => () => {
    updateTitleBar({
      title: 'Petri',
      tabs: [],
      activeTabId: null,
      reviewCount: 0,
      reviewStat: null,
      onSelectTab: null,
      onCloseTab: null,
      onCloseOtherTabs: null,
      onCloseTabsToRight: null,
      onCloseAllTabs: null,
      onMoreAction: null,
      toolMenuOpen: false,
      toolMenuItems: [],
      onSelectToolItem: null,
      resultItems: [],
      activeResultId: null,
      onSelectResult: null,
      canGoBack: false,
      canGoForward: false,
      onGoBack: null,
      onGoForward: null,
    });
  }, [updateTitleBar]);

  useEffect(() => {
    updateTitleBar({
      title: titleBarTitle,
      tabs: titleBarTabs,
      activeTabId: rightTab === 'home' ? null : rightTab,
      // UI-446 v4 — 审阅 tab 未打开时计数挂「+」按钮（当前会话有未看工作区改动）
      reviewCount,
      reviewStat: reviewStat ? { added: reviewStat.tracked.added, removed: reviewStat.tracked.removed } : null,
      onSelectTab: (tabId) => {
        if (tabId === 'results') {
          handleOpenRightResults();
          return;
        }
        setRightTab(tabId as RightPanelMode);
        setRightToolMenuOpen(false);
        setRightOpen(true);
      },
      onCloseTab: (tabId) => closeRightPanelTab(tabId as RightPanelMode),
      onCloseOtherTabs: closeOtherTabs ? (tabId) => closeOtherTabs(tabId) : null,
      onCloseTabsToRight: closeTabsToRight ? (tabId) => closeTabsToRight(tabId) : null,
      onCloseAllTabs: closeAllTabs ? () => closeAllTabs() : null,
      onMoreAction: () => setRightToolMenuOpen((value) => !value),
      toolMenuOpen: rightToolMenuOpen,
      toolMenuItems: toolSurfaceItems.map((surface) => ({
        id: surface.id,
        label: surface.title,
        icon: surface.icon,
        isOpen: tabs.some((tab) => tab.surfaceId === surface.id),
      })),
      onSelectToolItem: (surfaceId) => {
        if (surfaceId === 'results') {
          handleOpenRightResults();
          setRightToolMenuOpen(false);
          return;
        }
        openRightPanel(surfaceId as RightPanelMode);
        setRightToolMenuOpen(false);
      },
      resultItems: titleBarResultItems,
      activeResultId: conversationJobs.some((job) => job.id === activeJobId) ? activeJobId : null,
      onSelectResult: handleSelectTitleBarResult,
      canGoBack: rightTab === 'browser' && browserCanGoBack,
      canGoForward: rightTab === 'browser' && browserCanGoForward,
      onGoBack:
        rightTab === 'browser' && browserCanGoBack
          ? () => dispatchPetriEvent(petriEvents.browserBack)
          : null,
      onGoForward:
        rightTab === 'browser' && browserCanGoForward
          ? () => dispatchPetriEvent(petriEvents.browserForward)
          : null,
    });
  }, [
    activeJobId,
    closeRightPanelTab,
    closeOtherTabs,
    closeTabsToRight,
    closeAllTabs,
    browserCanGoBack,
    browserCanGoForward,
    openRightPanel,
    tabs,
    surfaces,
    toolSurfaceItems,
    projectName,
    titleBarTitle,
    rightTab,
    handleOpenRightResults,
    handleSelectTitleBarResult,
    rightToolMenuOpen,
    setRightOpen,
    setRightToolMenuOpen,
    setRightTab,
    titleBarTabs,
    titleBarResultItems,
    updateTitleBar,
    // UI-449（C-16）— 缺失会让 ±行数徽章闭包过期
    projectId,
    reviewStat,
    // UI-309：旧版遗漏——缺失会让顶栏会话选择器持有过期闭包
    conversations,
    activeConvId,
    handleSwitchConversation,
  ]);
}
