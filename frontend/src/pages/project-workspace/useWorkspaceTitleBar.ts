import { useEffect, useMemo } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { useWorkspacePanelsContext } from '@/components/desktop/WorkspacePanelsContext';
import { gewuEvents, dispatchGewuEvent } from '@/lib/events';
import { RIGHT_PANEL_ITEMS, type RightPanelMode } from './rightPanelTabs';

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
  titleBarTitle: string;
  rightTab: RightPanelMode;
  rightToolMenuOpen: boolean;
  openRightTabs: RightPanelMode[];
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
  setRightOpen: (open: boolean) => void;
  setRightTab: (tab: RightPanelMode) => void;
  setRightToolMenuOpen: Dispatch<SetStateAction<boolean>>;
}

export function useWorkspaceTitleBar(options: UseWorkspaceTitleBarOptions): void {
  const {
    updateTitleBar,
    projectName,
    titleBarTitle,
    rightTab,
    rightToolMenuOpen,
    openRightTabs,
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
    setRightOpen,
    setRightTab,
    setRightToolMenuOpen,
  } = options;

  const titleBarTabs = useMemo(
    () =>
      openRightTabs
        .filter((tab) => tab !== 'home')
        .map((tab) => {
          const item = RIGHT_PANEL_ITEMS.find((candidate) => candidate.id === tab);
          return {
            id: tab,
            label: item?.label || tab,
            icon: item?.icon || 'folder',
            closable: true,
          };
        }),
    [openRightTabs]
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

  useEffect(() => {
    updateTitleBar({
      title: titleBarTitle,
      tabs: titleBarTabs,
      activeTabId: rightTab === 'home' ? null : rightTab,
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
      onMoreAction: () => setRightToolMenuOpen((value) => !value),
      toolMenuOpen: rightToolMenuOpen,
      toolMenuItems: RIGHT_PANEL_ITEMS.map((item) => ({
        id: item.id,
        label: item.label,
        icon: item.icon,
        isOpen: openRightTabs.includes(item.id),
      })),
      onSelectToolItem: (tabId) => {
        if (tabId === 'results') {
          handleOpenRightResults();
          setRightToolMenuOpen(false);
          return;
        }
        openRightPanel(tabId as RightPanelMode);
        setRightToolMenuOpen(false);
      },
      resultItems: titleBarResultItems,
      activeResultId: conversationJobs.some((job) => job.id === activeJobId) ? activeJobId : null,
      onSelectResult: handleSelectTitleBarResult,
      canGoBack: rightTab === 'browser' && browserCanGoBack,
      canGoForward: rightTab === 'browser' && browserCanGoForward,
      onGoBack:
        rightTab === 'browser' && browserCanGoBack
          ? () => dispatchGewuEvent(gewuEvents.browserBack)
          : null,
      onGoForward:
        rightTab === 'browser' && browserCanGoForward
          ? () => dispatchGewuEvent(gewuEvents.browserForward)
          : null,
    });
    return () => {
      updateTitleBar({
        title: 'Gewu',
        tabs: [],
        activeTabId: null,
        onSelectTab: null,
        onCloseTab: null,
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
    };
  }, [
    activeJobId,
    closeRightPanelTab,
    browserCanGoBack,
    browserCanGoForward,
    openRightPanel,
    openRightTabs,
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
    // UI-309：旧版遗漏——缺失会让顶栏会话选择器持有过期闭包
    conversations,
    activeConvId,
    handleSwitchConversation,
  ]);
}
