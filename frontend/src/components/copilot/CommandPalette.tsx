// ============================================================
// CommandPalette — Spotlight-style command panel (Cmd+K)
// ============================================================

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/icons/Icon';
import type { IconName } from '@/components/icons/Icon';
import { formatRelativeTime } from '@/lib/format';
import type { ConversationSummary } from '@/components/copilot/copilotConversationsClient';
import './simple-chat.css';

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

export function useCommands(options: UseCommandPaletteOptions): CommandItem[] {
  const {
    onNavigateHome,
    onNewChat,
    onClearChat,
    onExportChat,
    onOpenSettings,
    onOpenAnalytics,
    onShowHelp,
  } = options;

  return [
    {
      id: 'new-chat',
      label: '新建对话',
      description: '开始一个新的对话',
      icon: 'plus',
      shortcut: '⌘N',
      action: () => {
        onNewChat?.();
      },
      category: 'command',
    },
    {
      id: 'clear-chat',
      label: '清空当前对话',
      description: '清除当前对话历史',
      icon: 'trash',
      action: () => {
        onClearChat?.();
      },
      category: 'command',
    },
    {
      id: 'export-chat',
      label: '导出对话',
      description: '导出当前对话为 Markdown',
      icon: 'download',
      action: () => {
        onExportChat?.();
      },
      category: 'command',
    },
    {
      id: 'open-settings',
      label: '打开设置',
      description: '打开应用设置面板',
      icon: 'settings',
      action: () => {
        onOpenSettings?.();
      },
      category: 'command',
    },
    {
      id: 'open-analytics',
      label: '打开分析面板',
      description: '打开数据分析面板',
      icon: 'bar-chart',
      action: () => {
        onOpenAnalytics?.();
      },
      category: 'command',
    },
    {
      id: 'show-help',
      label: '显示帮助',
      description: '显示快捷键和帮助信息',
      icon: 'help-circle',
      shortcut: '⌘/',
      action: () => {
        onShowHelp?.();
      },
      category: 'command',
    },
    {
      id: 'go-home',
      label: '返回首页',
      description: '返回项目工作区首页',
      icon: 'zap',
      action: () => {
        onNavigateHome?.();
      },
      category: 'command',
    },
  ];
}

// ---- Shortcuts section ----
interface ShortcutItem {
  keys: string;
  label: string;
}

const SHORTCUTS: ShortcutItem[] = [
  { keys: '⌘K', label: '命令面板' },
  { keys: '⌘N', label: '新建对话' },
  { keys: '⌘/', label: '显示帮助' },
];

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

  // Reset state when opening
  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIndex(0);
      // Focus input after render
      requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
    }
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
          shortcut: cmd.shortcut,
          action: cmd.action,
        });
      });
    }

    // Shortcuts section (only when no query)
    if (!q && items.length > 0) {
      items.push({ type: 'header', label: '快捷键' });
      SHORTCUTS.forEach((s) => {
        items.push({
          type: 'shortcut',
          id: s.keys,
          label: s.label,
          icon: 'key',
          shortcut: s.keys,
        });
      });
    }

    return items;
  }, [query, commands, recentConversations, maxRecent, onSelectConversation]);

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

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex((prev) =>
            prev < displayItems.length - 1 ? prev + 1 : prev
          );
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex((prev) => (prev > 0 ? prev - 1 : prev));
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
    [displayItems.length, executeSelected, onClose]
  );

  if (!open) return null;

  let currentIdx = -1;

  return (
    <div className="cp-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label="命令面板">
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
        <div className="cp-results" ref={listRef}>
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

  // Global Cmd+K handler
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [toggle]);

  return { isOpen, open, close, toggle };
}
