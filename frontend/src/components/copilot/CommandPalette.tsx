// ============================================================
// CommandPalette — Spotlight-style command panel (Cmd+K)
// ============================================================

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/icons/Icon';
import type { IconName } from '@/components/icons/Icon';
import { formatRelativeTime } from '@/lib/format';
import { KEYMAP_COMMANDS, formatCombo, matchesCombo } from '@/lib/appKeymap';
import { useKeymapSafe } from '@/lib/appKeymapContext';
import type { ConversationSummary } from '@/components/copilot/copilotConversationsClient';

// ---- Types ----

export interface CommandItem {
  id: string;
  label: string;
  description?: string;
  icon: string;
  shortcut?: string;
  action: () => void;
  category?: 'command' | 'conversation';
}

export interface CommandPaletteResult {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
}

// ---- Icon name mapping ----
const ICON_MAP: Record<string, string> = {
  plus: 'plus',
  trash: 'trash',
  download: 'download',
  settings: 'settings',
  'bar-chart': 'bar-chart',
  'help-circle': 'help-circle',
  'message-circle': 'message-circle',
  search: 'search',
  zap: 'zap',
};

// ---- Commands factory ----
export interface UseCommandPaletteOptions {
  /** Open the project workspace / home page. */
  onNavigateHome?: () => void;
  /** Trigger a new chat conversation. */
  onNewChat?: () => void;
  /** Clear current chat. */
  onClearChat?: () => void;
  /** Export current chat. */
  onExportChat?: () => void;
  /** Open settings. */
  onOpenSettings?: () => void;
  /** Open analytics panel. */
  onOpenAnalytics?: () => void;
  /** Show help. */
  onShowHelp?: () => void;
}

// ---- Shortcuts section ----
// 此前的 `SHORTCUTS` 是一份**硬编码显示清单**（⌘K/⌘N/⌘/），其中 ⌘N 与 ⌘/ 全仓没有对应
// 处理器（`onShowHelp` 还是个从未被使用的死 prop）——面板向用户承诺了两个不存在的快捷键。
// BLOCK-200 P1 起本节由键位注册表派生：**显示的事实与派发的事实同源**，解绑的命令不出现在表里。

// ---- Main component ----

interface CommandPaletteProps {
  /** Whether the palette is open. */
  open: boolean;
  /** Called when the user wants to close the palette. */
  onClose: () => void;
  /** All available commands. */
  commands: CommandItem[];
  /** Recent conversations to show. */
  recentConversations?: ConversationSummary[];
  /** Called when user selects a conversation. */
  onSelectConversation?: (conversation: ConversationSummary) => void;
  /** Max recent conversations to show. */
  maxRecent?: number;
}

export function CommandPalette({
  open,
  onClose,
  commands,
  recentConversations = [],
  onSelectConversation,
  maxRecent = 5,
}: CommandPaletteProps): React.ReactElement | null {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const { bindings } = useKeymapSafe();

  // Reset state when opening
  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIndex(0);
      // L6-1（蓝图 L-62/BLOCK-410）：保存/还原外部焦点——关闭时归还触发元素
      const prevFocus = document.activeElement as HTMLElement | null;
      // Focus input after render
      requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
      return () => {
        prevFocus?.focus?.();
      };
    }
    return undefined;
  }, [open]);

  // Build flat list of all items with category headers
  const displayItems = React.useMemo(() => {
    const items: Array<{
      type: 'header' | 'command' | 'conversation' | 'shortcut';
      id?: string;
      label?: string;
      description?: string;
      icon?: string;
      shortcut?: string;
      action?: () => void;
      conversation?: ConversationSummary;
    }> = [];

    const q = query.trim().toLowerCase();

    // Filter recent conversations
    const filteredConversations = recentConversations
      .filter((conv) => {
        if (!q) return true;
        return conv.title?.toLowerCase().includes(q);
      })
      .slice(0, maxRecent);

    // Filter commands
    const filteredCommands = commands.filter((cmd) => {
      if (!q) return true;
      return (
        cmd.label.toLowerCase().includes(q) ||
        cmd.description?.toLowerCase().includes(q) ||
        cmd.id.toLowerCase().includes(q)
      );
    });

    // Recent conversations section
    if (filteredConversations.length > 0) {
      items.push({ type: 'header', label: '最近会话' });
      filteredConversations.forEach((conv) => {
        items.push({
          type: 'conversation',
          id: conv.id,
          label: conv.title || '未命名会话',
          icon: 'message-circle',
          conversation: conv,
          action: () => {
            onSelectConversation?.(conv);
          },
        });
      });
    }

    // Commands section
    if (filteredCommands.length > 0) {
      items.push({ type: 'header', label: '命令' });
      filteredCommands.forEach((cmd) => {
        items.push({
          type: 'command',
          id: cmd.id,
          label: cmd.label,
          description: cmd.description,
          icon: cmd.icon,
          // 徽章读**生效键位**（与派发同源）；非可绑定命令仍可用调用方给的文本
          shortcut: formatCombo(bindings[cmd.id]) || cmd.shortcut,
          action: cmd.action,
        });
      });
    }

    // Shortcuts section (only when no query)——由键位注册表派生，不再抄一份显示清单
    if (!q && items.length > 0) {
      const rows = KEYMAP_COMMANDS
        .map((command) => ({ id: command.id, label: command.label, keys: formatCombo(bindings[command.id]) }))
        .filter((row) => row.keys);
      if (rows.length > 0) {
        items.push({ type: 'header', label: '快捷键' });
        rows.forEach((row) => {
          items.push({ type: 'shortcut', id: row.id, label: row.label, icon: 'key', shortcut: row.keys });
        });
      }
    }

    return items;
  }, [query, commands, recentConversations, maxRecent, onSelectConversation, bindings]);

  // Reset selection when items change
  useEffect(() => {
    setSelectedIndex(0);
  }, [displayItems]);

  // Scroll selected item into view
  useEffect(() => {
    if (!listRef.current) return;
    const selectedEl = listRef.current.querySelector(
      `[data-idx="${selectedIndex}"]`
    );
    if (selectedEl) {
      selectedEl.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  const executeSelected = useCallback(() => {
    const item = displayItems[selectedIndex];
    if (item?.action) {
      item.action();
      onClose();
    }
  }, [displayItems, selectedIndex, onClose]);

  // L6-1（蓝图 L-62）：方向键跳过分组 header——可选中项=非 header 条目
  const nextSelectable = useCallback(
    (from: number, dir: 1 | -1): number => {
      let i = from;
      for (let step = 0; step < displayItems.length; step += 1) {
        i += dir;
        if (i < 0 || i >= displayItems.length) return from;
        // eslint-disable-next-line security/detect-object-injection -- 本模块自有清单项类型判定（displayItems 为内置投影，非外部输入）
        if (displayItems[i].type !== 'header') return i;
      }
      return from;
    },
    [displayItems]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex((prev) => (prev < displayItems.length - 1 ? nextSelectable(prev, 1) : prev));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex((prev) => (prev > 0 ? nextSelectable(prev, -1) : prev));
          break;
        case 'Tab':
          // L6-1：Tab 循环 输入↔列表（面板内两焦点停靠点；无第三方停靠面）
          e.preventDefault();
          if (document.activeElement === inputRef.current) {
            listRef.current?.focus();
          } else {
            inputRef.current?.focus();
          }
          break;
        case 'Enter':
          e.preventDefault();
          executeSelected();
          break;
        case 'Escape':
          e.preventDefault();
          onClose();
          break;
        default:
          break;
      }
    },
    [displayItems, displayItems.length, executeSelected, nextSelectable, onClose]
  );

  if (!open) return null;

  let currentIdx = -1;

  // L6-1：活动项 id 提前计算（简单标识符——aria 属性位无法行内豁免）
  const activeItem = displayItems[selectedIndex];
  const activeOptionId = activeItem && activeItem.type !== 'header' ? `cp-opt-${activeItem.id}` : null;

  return (
    <div className="cp-overlay" data-petri-layer="modal" onClick={onClose} role="dialog" aria-modal="true" aria-label="命令面板">
      <div
        className="cp-panel"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Search input */}
        <div className="cp-search">
          <Icon name="search" size={16} className="cp-search-icon" />
          <input
            ref={inputRef}
            type="text"
            className="cp-search-input"
            placeholder="搜索命令、会话..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="搜索"
            role="combobox"
            aria-expanded="true"
            aria-controls="cp-results-listbox"
            aria-activedescendant={activeOptionId ?? undefined}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
          />
          {query && (
            <button
              className="cp-search-clear"
              onClick={() => setQuery('')}
              aria-label="清除搜索"
              type="button"
            >
              <Icon name="x" size={14} />
            </button>
          )}
        </div>

        {/* Results list */}
        <div className="cp-results" ref={listRef} id="cp-results-listbox" role="listbox" aria-label="命令列表" tabIndex={-1}>
          {displayItems.length === 0 && (
            <div className="cp-empty">没有找到匹配项</div>
          )}
          {displayItems.map((item, _idx) => {
            if (item.type === 'header') {
              currentIdx++;
              return (
                <div
                  key={`header-${item.label}`}
                  className="cp-section-header"
                  data-idx={currentIdx}
                >
                  {item.label}
                </div>
              );
            }

            currentIdx++;
            const idx = currentIdx;
            const isSelected = idx === selectedIndex;
            const iconName = (ICON_MAP[item.icon!] || item.icon!) as IconName;

            return (
              <div
                key={item.id}
                id={`cp-opt-${item.id}`}
                className={`cp-item ${isSelected ? 'cp-item-selected' : ''}`}
                data-idx={idx}
                onClick={() => {
                  if (item.action) {
                    item.action();
                    onClose();
                  }
                }}
                onMouseEnter={() => setSelectedIndex(idx)}
                role="option"
                aria-selected={isSelected}
              >
                <span className="cp-item-icon">
                  <Icon name={iconName} size={15} />
                </span>
                <span className="cp-item-content">
                  <span className="cp-item-label">{item.label}</span>
                  {item.description && (
                    <span className="cp-item-desc">{item.description}</span>
                  )}
                  {item.type === 'conversation' && item.conversation && (
                    <span className="cp-item-meta">
                      {formatRelativeTime(item.conversation.updated_at || item.conversation.created_at)}
                    </span>
                  )}
                </span>
                {item.shortcut && (
                  <span className="cp-item-shortcut">{item.shortcut}</span>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div className="cp-footer">
          <span className="cp-footer-hint">
            <kbd>↑↓</kbd> 导航
          </span>
          <span className="cp-footer-hint">
            <kbd>Enter</kbd> 执行
          </span>
          <span className="cp-footer-hint">
            <kbd>Esc</kbd> 关闭
          </span>
        </div>
      </div>
    </div>
  );
}

// ---- Hook for managing palette state ----

export interface UseCommandPaletteReturn {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
}

export function useCommandPalette(): UseCommandPaletteReturn {
  const [isOpen, setIsOpen] = useState(false);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const toggle = useCallback(() => setIsOpen((prev) => !prev), []);

  // 面板开合键读**键位注册表**（此前此处写死 `e.key === 'k'`，与徽章文本是两份真相：
  // 用户在设置页改了键，这里不会跟着变）。BLOCK-200 P1。
  const { bindings } = useKeymapSafe();
  const toggleCombo = bindings['palette.toggle'];

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.repeat) return; // 长按连发不该反复开合
      if (matchesCombo(toggleCombo, e)) {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [toggle, toggleCombo]);

  return { isOpen, open, close, toggle };
}
