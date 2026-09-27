import React, { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Icon } from '@/components/icons/Icon';
import { SideChatToggleButton } from './SideChatToggleButton';
import { useWorkspacePanelsContext } from '../WorkspacePanelsContext';
import { BranchTabsWrapper } from '@/components/branch/BranchTabsWrapper';
import styles from '../TitleBar.module.css';
import { getFallbackTitle, isProjectionMobile, isStandalonePagePath, modeUsesSummaryCard, parseWorkspaceRoute } from './shared';

/**
 * BLOCK-62 P1a — TitleBar 中区片段（标题 + 分支 tabs + 结果选择器 + 摘要概览开关）。
 *
 * 容器无关：既被 fixed 整条 [TitleBar.tsx](../TitleBar.tsx) 复用，也被 P1b
 * 列级 header-slot 复用。结果菜单的开合状态内聚在本组件——同一时刻只有一个
 * 宿主（fixed 条或列级片段）渲染它，不存在双份状态。逻辑与提取前一致。
 *
 * UI-334 — 会话选择器（convSelector）整体移除：左栏项目树下已有完整会话
 * 列表（含分支标识），标题栏下拉为重复入口（用户裁决「除掉这部分」）。
 */
export function TitleBarCenterZone(): React.ReactElement {
  const location = useLocation();
  const panels = useWorkspacePanelsContext();
  const {
    title,
    resultItems,
    activeResultId,
    onSelectResult,
  } = panels.titleBar;

  const [resultMenuOpen, setResultMenuOpen] = useState(false);
  const resultTriggerRef = useRef<HTMLButtonElement>(null);
  const resultMenuItemsRef = useRef<Record<string, HTMLButtonElement | null>>({});
  const activeResult = resultItems.find((item) => item.id === activeResultId) || resultItems[0] || null;

  const closeResultMenu = () => {
    setResultMenuOpen(false);
    resultTriggerRef.current?.focus();
  };

  const selectResult = (id: string) => {
    onSelectResult?.(id);
    closeResultMenu();
  };

  useEffect(() => {
    if (resultItems.length < 2 && resultMenuOpen) {
      setResultMenuOpen(false);
    }
  }, [resultItems.length, resultMenuOpen]);

  useEffect(() => {
    if (!resultMenuOpen || resultItems.length < 2 || !activeResult) return;
    resultMenuItemsRef.current[activeResult.id]?.focus();
  }, [activeResult, resultItems, resultMenuOpen]);

  useEffect(() => {
    if (!resultMenuOpen) return undefined;

    const handleResultMenuDocumentKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      closeResultMenu();
    };
    const handleWindowResize = () => setResultMenuOpen(false);

    document.addEventListener('keydown', handleResultMenuDocumentKeyDown);
    window.addEventListener('resize', handleWindowResize);
    return () => {
      document.removeEventListener('keydown', handleResultMenuDocumentKeyDown);
      window.removeEventListener('resize', handleWindowResize);
    };
  }, [resultMenuOpen]);

  const moveResultFocus = (currentIndex: number, offset: number) => {
    if (resultItems.length === 0) return;
    const nextIndex = (currentIndex + offset + resultItems.length) % resultItems.length;
    resultMenuItemsRef.current[resultItems[nextIndex].id]?.focus();
  };

  const handleResultMenuItemKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    itemId: string,
    itemIndex: number,
  ) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveResultFocus(itemIndex, 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveResultFocus(itemIndex, -1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      resultMenuItemsRef.current[resultItems[0].id]?.focus();
    } else if (event.key === 'End') {
      event.preventDefault();
      resultMenuItemsRef.current[resultItems[resultItems.length - 1].id]?.focus();
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      selectResult(itemId);
    }
  };

  // UI-348 — 全局独立页（/skills /knowledge /backend）不渲染品牌 chip 与分区
  // 分隔线：页面自带「返回+标题」页头，顶栏只留可拖拽区与窗口控件。
  if (isStandalonePagePath(location.pathname)) {
    return <div className={`${styles.centerTitle} ${styles.centerTitleBare}`} aria-hidden="true" />;
  }

  // UI-360 — 摘要概览开关只在工作区路由的 chat / scheduled 模式渲染
  // （摘要卡 showPinnedSummary 同口径）；欢迎页 / 独立页与 plugins/settings
  // 等全屏工作面无摘要卡，开关是死开关。
  const summaryToggleAvailable = (() => {
    const ws = parseWorkspaceRoute(location.pathname);
    return !!ws && modeUsesSummaryCard(ws.mode);
  })();

  // UI-448 加映 v13 — 侧聊开关可用性：工作区 chat 模式（面板所在投影层）；
  // scheduled/结果模式面板不在场，开关是死开关。projectId 供运行呼吸灯取侧聊会话。
  const { sideChatToggleAvailable, workspaceProjectId } = (() => {
    const ws = parseWorkspaceRoute(location.pathname);
    return {
      sideChatToggleAvailable: !!ws && ws.mode === 'chat',
      workspaceProjectId: location.pathname.match(/^\/project\/([^/]+)/)?.[1] ?? null,
    };
  })();

  // UI-377 — 中区右缘分隔线只在「右栏真的在场」时渲染（工作区路由 + 右栏开 +
  // 非投影手机）。此前只看全局 rightOpen 偏好：欢迎页/独立页右栏并不在场，
  // 一条悬空分隔线挂在标题区右缘（用户截图指认「灰色分隔线多余」）。
  const rightRailPresent =
    !!parseWorkspaceRoute(location.pathname) && panels.rightOpen && !isProjectionMobile();

  const displayTitle = title || getFallbackTitle(location.pathname);

  return (
    <div className={`${styles.centerTitle} ${!rightRailPresent ? styles.centerTitleNoDivider : ''}`}>
      <div className={styles.centerTitleMain}>
        <Icon name="folder" size={15} />
        <span className={styles.centerTitleText}>{displayTitle}</span>
      </div>
      <BranchTabsWrapper />
      {/* UI-334 — 会话选择器已移除：左栏项目树下即完整会话列表（含分支） */}
      {activeResult && (
        <div className={styles.resultPicker}>
          <button
            type="button"
            className={styles.resultPrimary}
            onClick={() => selectResult(activeResult.id)}
            title={`打开${activeResult.label}`}
          >
            <span>结果 {resultItems.length}</span>
          </button>
          {resultItems.length > 1 && (
            <button
              type="button"
              ref={resultTriggerRef}
              className={styles.resultMenuTrigger}
              onClick={() => setResultMenuOpen((open) => !open)}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  setResultMenuOpen(true);
                }
              }}
              title="展开结果列表"
              aria-label={resultMenuOpen ? '收起结果列表' : '展开结果列表'}
              aria-haspopup="menu"
              aria-expanded={resultMenuOpen}
              aria-controls="titlebar-result-menu"
            >
              <Icon name="chevron-down" size={13} />
            </button>
          )}
          {resultMenuOpen && resultItems.length > 1 && (
            <>
              <button
                type="button"
                className={styles.resultMenuOverlay}
                onClick={closeResultMenu}
                aria-label="关闭结果菜单"
              />
              <div
                id="titlebar-result-menu"
                className={styles.resultMenu}
                role="menu"
                aria-label="结果列表"
              >
                {resultItems.map((item, itemIndex) => {
                  const isActive = item.id === activeResult.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      ref={(node) => {
                        resultMenuItemsRef.current[item.id] = node;
                      }}
                      className={`${styles.resultMenuItem} ${isActive ? styles.resultMenuItemActive : ''}`}
                      role="menuitem"
                      aria-current={isActive ? 'true' : undefined}
                      tabIndex={isActive ? 0 : -1}
                      data-result-id={item.id}
                      onClick={() => selectResult(item.id)}
                      onKeyDown={(event) => handleResultMenuItemKeyDown(event, item.id, itemIndex)}
                    >
                      <span className={styles.resultMenuItemLabel}>{item.label}</span>
                      <span className={styles.resultMenuItemStatus} data-status={item.status}>
                        {item.status}
                      </span>
                      {isActive && <Icon name="check" size={13} />}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}
      {/* UI-360 — 摘要概览开关只在工作区路由的 chat / scheduled 模式渲染
          （摘要卡 showPinnedSummary 同口径）；欢迎页 / 独立页与 plugins/settings
          等全屏工作面无摘要卡，开关是死开关。 */}
      {/* UI-448 加映 v13 — 侧边聊天开关：主会话外延的工作区级控件，
          与摘要概览同排（入口不再浮在中栏右缘遮内容） */}
      {sideChatToggleAvailable && (
        <SideChatToggleButton projectId={workspaceProjectId} />
      )}
      {summaryToggleAvailable && (
        <button
          type="button"
          className={styles.iconBtn}
          onClick={panels.toggleSummary}
          title={panels.summaryOpen ? '收起摘要概览' : '展开摘要概览'}
          aria-label={panels.summaryOpen ? '收起摘要概览' : '展开摘要概览'}
          aria-pressed={panels.summaryOpen}
        >
          <Icon name="list-details" size={15} />
        </button>
      )}
    </div>
  );
}
