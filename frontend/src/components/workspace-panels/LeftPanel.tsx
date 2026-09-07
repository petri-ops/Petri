import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '@/components/icons/Icon';
import { FolderPicker } from '@/components/desktop/FolderPicker';
import type { Project } from '@/lib/project-types';
import type { ConversationSummary } from '@/components/copilot/copilotConversationsClient';
import type { WorkspaceMode } from '@/hooks/useWorkspaceRouting';
import { useConversationRun } from '@/components/copilot/conversationRunStore';
import styles from '@/pages/project-workspace.module.css';

export interface LeftPanelContext {
  // Layout
  width: number;

  // Project + workspace
  project: Project;
  workspacePath?: string;
  compactWorkspacePath: string;

  // Project tree
  visibleProjects: Project[];
  projectConversations: Record<string, ConversationSummary[]>;
  projectId?: string;
  conversations: ConversationSummary[];
  activeConvId: string | null;
  expandedProjects: Set<string>;

  // One-click creators
  creatingProject: boolean;
  creatingConversation: boolean;
  /** UI-304 简化版 — 点 + 直接弹原生面板创建，无需面板 UI */
  createPanel: {
    open: boolean; // 保持为 false
    error: string; // 仅用于显示错误
    onOpen: () => void | Promise<void>;
  };
  createConversationForProject: (projectId?: string) => void | Promise<void>;
  renameProject: (projectId: string, name: string) => Promise<boolean>;
  renameConversation: (conversationId: string, title: string) => Promise<boolean>;
  archiveProject: (projectId: string) => Promise<boolean>;
  archiveConversation: (conversationId: string) => Promise<boolean>;
  /** Fork an existing conversation and switch to the new one */
  forkConversation: (conversationId: string, title?: string) => Promise<ConversationSummary | null>;

  // Workspace routing
  workspaceMode: WorkspaceMode;
  handleShowSearch: () => void;
  handleShowScheduled: () => void;
  handleShowPlugins: () => void;
  handleShowSettings: () => void;
  handleNavigateToSkills: () => void;

  // Project / conversation switching
  switchToProject: (id: string) => void;
  handleSwitchConversation: (id: string) => void;
  toggleProjectExpand: (id: string) => void;
  handleOpenWorkspacePath: () => void | Promise<void>;

  // Desktop mode: hide conversations in sidebar (use TitleBar selector instead)
  showConversations?: boolean;
}

export interface LeftPanelProps {
  ctx: LeftPanelContext;
}

/**
 * Left column — project list + conversations. Pure renderer: all state and
 * handlers live in the parent (ProjectWorkspace) and are passed via `ctx`.
 *
 * Layout:
 *   ┌─ leftQuickActions ────────────┐
 *   │  Workspace eyebrow           │
 *   │  Project title + new btn     │
 *   │  Workspace path row          │
 *   │  Mode quick-actions          │
 *   ├─ projectTreeScroll ──────────┤
 *   │  Project tree (recursive)    │
 *   │  Each project → conversations│
 *   └──────────────────────────────┘
 */
export function LeftPanel({ ctx }: LeftPanelProps): React.ReactElement {
  // BLOCK-53 P1 — 拖拽目录直达创建：drop 到左栏 → validateDirectory 校验 →
  // 打开既有内联创建面板（ctx.createPanel）并回填路径。复用 UI-257 既有确认链，
  // 用户仍需看到完整路径并点「创建项目」，拖拽不绕过任何确认环节。
  const [dropActive, setDropActive] = useState(false);
  const [dropHint, setDropHint] = useState<string | null>(null);

  const handlePanelDrop = async (e: React.DragEvent): Promise<void> => {
    e.preventDefault();
    setDropActive(false);
    const file = e.dataTransfer?.files?.[0];
    if (!file) {
      setDropHint('拖入的不是有效的文件/文件夹');
      return;
    }
    const pathFor = window.biof3Desktop?.files?.pathForFile;
    const raw = typeof pathFor === 'function'
      ? pathFor(file)
      : (file as File & { path?: string }).path || null;
    if (!raw) {
      setDropHint('无法读取拖入项的路径');
      return;
    }
    const validate = window.biof3Desktop?.files?.validateDirectory;
    if (typeof validate !== 'function') {
      setDropHint('当前运行环境不支持路径校验（请在 Gewu 桌面应用中使用）。');
      return;
    }
    try {
      const res = await validate(raw);
      if (!res.ok || !res.data?.path) {
        setDropHint(res.error || '拖入的路径校验失败');
        return;
      }
      // UI-304 — 直达确认态（fallback 到 onOpen+onPathChange 兼容旧 ctx）
      if (typeof ctx.createPanel.onPickExternal === 'function') {
        ctx.createPanel.onPickExternal(res.data.path);
      } else {
        ctx.createPanel.onOpen();
        ctx.createPanel.onPathChange(res.data.path);
      }
      setDropHint(null);
    } catch (err) {
      setDropHint(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <aside className={styles.leftCol} style={{ width: ctx.width }}>
      <div
        className={styles.leftPanelWrap}
        style={dropActive ? { outline: '1px dashed var(--gewu-accent)', outlineOffset: '-4px' } : undefined}
        onDragOver={(e) => {
          e.preventDefault();
          if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
          setDropActive(true);
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropActive(false);
        }}
        onDrop={(e) => void handlePanelDrop(e)}
      >
        <QuickActions ctx={ctx} />
        <ProjectTreeHeader ctx={ctx} />
        <ProjectTree ctx={ctx} />
        {dropHint && (
          <p className={styles.leftCreateError} role="alert" style={{ padding: '0 12px' }}>{dropHint}</p>
        )}
        <div className={styles.leftPanelFooter}>
          <button
            type="button"
            className={`${styles.leftQuickAction} ${ctx.workspaceMode === 'settings' ? styles.leftQuickActionActive : ''}`}
            onClick={ctx.handleShowSettings}
            title="设置"
            aria-current={ctx.workspaceMode === 'settings' ? 'page' : undefined}
          >
            <Icon name="settings" size={15} />
            <span>设置</span>
          </button>
        </div>
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

/** UI-259 — 应用内「选择文件夹」按钮：展开 FolderPicker，选中路径写回输入框 */
function BrowseFolderButton({
  initialPath,
  onPick,
  label = '选择文件夹…',
  disabled,
}: {
  initialPath: string;
  onPick: (path: string) => void;
  label?: string;
  disabled?: boolean;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [browseFrom, setBrowseFrom] = useState('');
  return (
    <>
      <button
        type="button"
        className="gewu-btn gewu-btn--ghost gewu-btn--sm"
        onClick={() => {
          if (!open) setBrowseFrom(initialPath || '');
          setOpen((o) => !o);
        }}
        aria-expanded={open}
        disabled={disabled}
      >
        {label}
      </button>
      {open && (
        <div className={styles.leftCreatePickerWrap}>
          <FolderPicker
            initialPath={browseFrom}
            onPick={(picked) => {
              onPick(picked);
              setOpen(false);
            }}
            onCancel={() => setOpen(false)}
          />
        </div>
      )}
    </>
  );
}

function QuickActions({ ctx }: { ctx: LeftPanelContext }): React.ReactElement {
  const items: Array<{
    key: WorkspaceMode | 'skills';
    mode: WorkspaceMode | null;
    label: string;
    icon: Parameters<typeof Icon>[0]['name'];
    onClick: () => void;
    title: string;
  }> = [
    {
      key: 'search',
      mode: 'search',
      label: '搜索',
      icon: 'search',
      onClick: ctx.handleShowSearch,
      title: '搜索项目',
    },
    {
      key: 'plugins',
      mode: 'plugins',
      label: '插件',
      icon: 'puzzle',
      onClick: ctx.handleShowPlugins,
      title: '插件',
    },
    {
      key: 'skills',
      mode: null,
      label: 'Skills',
      icon: 'sparkles',
      onClick: ctx.handleNavigateToSkills,
      title: 'Skills',
    },
  ];

  return (
    <div className={styles.leftQuickActions}>
      <div className={styles.leftQuickSectionLabel}>工作台</div>
      {items.map((item) => {
        const isActive = Boolean(item.mode) && ctx.workspaceMode === item.mode;
        return (
          <button
            key={item.key}
            type="button"
            className={`${styles.leftQuickAction} ${isActive ? styles.leftQuickActionActive : ''}`}
            onClick={item.onClick}
            title={item.title}
            aria-current={isActive ? 'page' : undefined}
          >
            <Icon name={item.icon} size={15} />
            <span>{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function ProjectTreeHeader({ ctx }: { ctx: LeftPanelContext }): React.ReactElement {
  return (
    <>
      <div className={styles.leftPanelHeader}>
        <span className={styles.leftPanelTitle}>项目</span>
        <div className={styles.leftPanelHeaderActions}>
          {/* UI-258 — 返回工作台（项目列表 + 常驻创建入口） */}
          <Link to="/" className={styles.iconBtn} title="返回工作台" aria-label="返回工作台">
            <Icon name="home" size={15} />
          </Link>
          <button
            className={styles.iconBtn}
            onClick={() => void ctx.createPanel.onOpen()}
            title="新建项目（选择工作目录）"
            aria-expanded={ctx.createPanel.open}
            disabled={ctx.creatingProject}
          >
            <Icon name="plus" size={16} />
          </button>
        </div>
      </div>
      {/* UI-304 简化版 — 错误提示（如果有）*/}
      {ctx.createPanel.error && (
        <div className={styles.leftCreatePanel} data-testid="left-create-panel">
          <p className={styles.leftCreateError} role="alert">{ctx.createPanel.error}</p>
        </div>
      )}
    </>
  );
}

function ProjectTree({ ctx }: { ctx: LeftPanelContext }): React.ReactElement {
  return (
    <div className={styles.projectTreeScroll}>
      {ctx.visibleProjects.map((p) => (
        <ProjectNode
          key={p.id}
          project={p}
          ctx={ctx}
          isCurrent={p.id === ctx.projectId}
          isExpanded={ctx.expandedProjects.has(p.id)}
          conversations={
            p.id === ctx.projectId
              ? ctx.conversations
              : (ctx.projectConversations[p.id] || [])
          }
        />
      ))}
    </div>
  );
}

function ConversationItem({
  conversation,
  projectId,
  ctx,
  isCurrent,
}: {
  conversation: ConversationSummary;
  projectId: string;
  ctx: LeftPanelContext;
  isCurrent: boolean;
}): React.ReactElement {
  const conversationRun = useConversationRun(conversation.id);
  const [editing, setEditing] = React.useState(false);
  const [title, setTitle] = React.useState(conversation.title);

  const isRunning = conversationRun?.status === 'running';
  const hasBranch = Boolean(conversation.parent_id);

  React.useEffect(() => setTitle(conversation.title), [conversation.title]);

  const finishRename = async () => {
    const nextTitle = title.trim();
    if (!nextTitle || nextTitle === conversation.title) {
      setTitle(conversation.title);
      setEditing(false);
      return;
    }
    const ok = await ctx.renameConversation(conversation.id, nextTitle);
    if (!ok) setTitle(conversation.title);
    setEditing(false);
  };

  return (
    <li
      className={`${styles.convItem} ${isCurrent && conversation.id === ctx.activeConvId ? styles.convItemActive : ''} ${hasBranch ? styles.convItemBranch : ''}`}
      onClick={() => {
        if (!isCurrent) ctx.switchToProject(projectId);
        ctx.handleSwitchConversation(conversation.id);
      }}
    >
      {isRunning ? (
        <span className={styles.convRunningDot} title="正在后台处理" aria-label="正在后台处理" />
      ) : hasBranch ? (
        <span className={styles.convBranchIndicator} title={`分支自 ${conversation.parent_id}`} aria-label="分支对话">⤴</span>
      ) : (
        <Icon name="message-circle" size={12} />
      )}
      {editing ? (
        <input
          className={styles.treeRenameInput}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onClick={(event) => event.stopPropagation()}
          onBlur={() => void finishRename()}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void finishRename();
            if (event.key === 'Escape') {
              setTitle(conversation.title);
              setEditing(false);
            }
          }}
          autoFocus
        />
      ) : (
        <button
          type="button"
          className={styles.convItemTitle}
          onDoubleClick={(event) => {
            event.stopPropagation();
            setEditing(true);
          }}
          title="双击重命名对话"
        >
          {conversation.title}
        </button>
      )}
      {!editing && (
        <>
          <button
            type="button"
            className={styles.convItemForkBtn}
            onClick={(event) => {
              event.stopPropagation();
              void ctx.forkConversation(conversation.id);
            }}
            title="创建分支"
          >
            <Icon name="git-branch" size={11} />
          </button>
          <button
            type="button"
            className={styles.convItemTrashBtn}
            onClick={(event) => {
              event.stopPropagation();
              void ctx.archiveConversation(conversation.id);
            }}
            title={isRunning ? '会话正在后台处理，完成后可移入回收站' : '移入回收站'}
            disabled={isRunning}
          >
            <Icon name="trash" size={11} />
          </button>
        </>
      )}
    </li>
  );
}
