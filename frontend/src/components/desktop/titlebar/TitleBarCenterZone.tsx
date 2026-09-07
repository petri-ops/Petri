import React, { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Icon } from '@/components/icons/Icon';
import { useWorkspacePanelsContext } from '../WorkspacePanelsContext';
import { BranchTabsWrapper } from '@/components/branch/BranchTabsWrapper';
import styles from '../TitleBar.module.css';
import { getFallbackTitle } from './shared';

/**
 * BLOCK-62 P1a — TitleBar 中区片段（标题 + 分支 tabs + 会话选择器 + 结果选择器
 * + 摘要概览开关）。
 *
 * 容器无关：既被 fixed 整条 [TitleBar.tsx](../TitleBar.tsx) 复用，也被 P1b
 * 列级 header-slot 复用。结果菜单 / 会话下拉的开合状态内聚在本组件——同一时刻
 * 只有一个宿主（fixed 条或列级片段）渲染它，不存在双份状态。逻辑与提取前一致。
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

  const conversations = panels.titleBar.conversations || [];
  const activeConvId = panels.titleBar.activeConvId;
  const onSelectConversation = panels.titleBar.onSelectConversation;

  const [convDropdownOpen, setConvDropdownOpen] = useState(false);
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

  const displayTitle = title || getFallbackTitle(location.pathname);

  return (
    <div className={`${styles.centerTitle} ${!panels.rightOpen ? styles.centerTitleNoDivider : ''}`}>
      <div className={styles.centerTitleMain}>
        <Icon name="folder" size={15} />
        <span className={styles.centerTitleText}>{displayTitle}</span>
      </div>
      <BranchTabsWrapper />
      {/* Conversation selector — between branch tabs and result picker */}
      {conversations.length > 0 && (
        <div className={styles.convSelector}>
          <button
            type="button"
            className={styles.convSelectorBtn}
            onClick={() => setConvDropdownOpen((o) => !o)}
            title="切换会话"
            aria-label="切换会话"
            aria-expanded={convDropdownOpen}
          >
            <Icon name="message-circle" size={13} />
            <span className={styles.convSelectorText}>
              {conversations.find((c) => c.id === activeConvId)?.title?.slice(0, 12) ||
                conversations[0]?.title?.slice(0, 12) ||
                '会话'}
            </span>
            <Icon name={convDropdownOpen ? 'chevron-up' : 'chevron-down'} size={11} />
          </button>
          {convDropdownOpen && (
            <>
              <button
                type="button"
                className={styles.convSelectorOverlay}
                onClick={() => setConvDropdownOpen(false)}
                aria-label="关闭会话列表"
              />
              <div className={styles.convSelectorDropdown}>
                {conversations.map((conv) => (
                  <button
                    key={conv.id}
                    type="button"
                    className={styles.convSelectorItem}
                    onClick={() => {
                      onSelectConversation?.(conv.id);
                      setConvDropdownOpen(false);
                    }}
                  >
                    <Icon name={conv.parent_id ? 'git-branch' : 'message-circle'} size={12} />
                    <span>{conv.title || '无标题会话'}</span>
                    {conv.parent_id && (
                      <span className={styles.convSelectorBadge}>分支</span>
                    )}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
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
    </div>
  );
}
