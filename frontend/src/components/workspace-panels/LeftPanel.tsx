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
  /** UI-257 — 内联创建项目面板：路径可粘贴/可编辑，绕过系统目录面板限制 */
  createPanel: {
    open: boolean;
    path: string;
    error: string;
    onOpen: () => void;
    onClose: () => void;
    onPathChange: (path: string) => void;
    onConfirm: () => void | Promise<void>;
  };
  createConversationForProject: (projectId?: string) => void | Promise<void>;
  /** UI-258 — 更改当前项目工作目录（路径可粘贴/可编辑） */
  workspaceEdit: {
    open: boolean;
    path: string;
    error: string;
    saving: boolean;
    onOpen: () => void;
    onClose: () => void;
    onPathChange: (path: string) => void;
    onSave: () => void | Promise<void>;
  };
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
  return (
    <aside className={styles.leftCol} style={{ width: ctx.width }}>
      <div className={styles.leftPanelWrap}>
        <QuickActions ctx={ctx} />
        <ProjectTreeHeader ctx={ctx} />
        <ProjectTree ctx={ctx} />
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
        className="biof3-btn biof3-btn--ghost biof3-btn--sm"
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
            onClick={ctx.createPanel.onOpen}
            title="新建项目（选择或粘贴工作目录）"
            aria-expanded={ctx.createPanel.open}
            disabled={ctx.creatingProject}
          >
            <Icon name="plus" size={16} />
          </button>
        </div>
      </div>
      {/* UI-257 — 内联创建面板：路径可粘贴/可编辑（macOS 面板禁用「打开」时的兜底） */}
      {ctx.createPanel.open && (
        <div className={styles.leftCreatePanel} data-testid="left-create-panel">
          <div className={styles.leftCreateRow}>
            <input
              className={styles.leftCreateInput}
              type="text"
              value={ctx.createPanel.path}
              onChange={(e) => ctx.createPanel.onPathChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void ctx.createPanel.onConfirm();
                if (e.key === 'Escape') ctx.createPanel.onClose();
              }}
              placeholder="/Users/you/path/to/project"
              autoFocus
              aria-label="项目工作目录完整路径"
            />
          </div>
          {ctx.createPanel.error && (
            <p className={styles.leftCreateError} role="alert">{ctx.createPanel.error}</p>
          )}
          <div className={styles.leftCreateActions}>
            <button
              type="button"
              className="biof3-btn biof3-btn--sm"
              onClick={() => void ctx.createPanel.onConfirm()}
              disabled={ctx.creatingProject || !ctx.createPanel.path.trim()}
              title="校验路径并以目录名创建项目"
            >
              {ctx.creatingProject ? '创建中…' : '创建项目'}
            </button>
            <BrowseFolderButton
              initialPath={ctx.createPanel.path}
              onPick={ctx.createPanel.onPathChange}
              disabled={ctx.creatingProject}
            />
            <button
              type="button"
              className="biof3-btn biof3-btn--ghost biof3-btn--sm"
              onClick={ctx.createPanel.onClose}
              disabled={ctx.creatingProject}
            >
              取消
            </button>
          </div>
        </div>
      )}
      {/* UI-258 — 更改当前项目工作目录：路径可粘贴/可编辑 */}
      {ctx.workspaceEdit.open && (
        <div className={styles.leftCreatePanel} data-testid="left-ws-edit-panel">
          <div className={styles.leftCreateRow}>
            <input
              className={styles.leftCreateInput}
              type="text"
              value={ctx.workspaceEdit.path}
              onChange={(e) => ctx.workspaceEdit.onPathChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void ctx.workspaceEdit.onSave();
                if (e.key === 'Escape') ctx.workspaceEdit.onClose();
              }}
              placeholder="/Users/you/path/to/project"
              autoFocus
              aria-label="当前项目工作目录完整路径"
            />
          </div>
          {ctx.workspaceEdit.error && (
            <p className={styles.leftCreateError} role="alert">{ctx.workspaceEdit.error}</p>
          )}
          <div className={styles.leftCreateActions}>
            <button
              type="button"
              className="biof3-btn biof3-btn--sm"
              onClick={() => void ctx.workspaceEdit.onSave()}
              disabled={ctx.workspaceEdit.saving || !ctx.workspaceEdit.path.trim()}
              title="校验路径并保存为当前项目的工作目录"
            >
              {ctx.workspaceEdit.saving ? '保存中…' : '保存'}
            </button>
            <BrowseFolderButton
              initialPath={ctx.workspaceEdit.path}
              onPick={ctx.workspaceEdit.onPathChange}
              disabled={ctx.workspaceEdit.saving}
            />
            <button
              type="button"
              className="biof3-btn biof3-btn--ghost biof3-btn--sm"
              onClick={ctx.workspaceEdit.onClose}
              disabled={ctx.workspaceEdit.saving}
            >
              取消
            </button>
          </div>
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

function ProjectNode({
  project: p,
  ctx,
  isCurrent,
  isExpanded,
  conversations: convs,
}: {
  project: Project;
  ctx: LeftPanelContext;
  isCurrent: boolean;
  isExpanded: boolean;
  conversations: ConversationSummary[];
}): React.ReactElement {
  const [editingProject, setEditingProject] = React.useState(false);
  const [projectName, setProjectName] = React.useState(p.name);

  React.useEffect(() => setProjectName(p.name), [p.name]);

  const finishProjectRename = async () => {
    const name = projectName.trim();
    if (!name || name === p.name) {
      setProjectName(p.name);
      setEditingProject(false);
      return;
    }
    const ok = await ctx.renameProject(p.id, name);
    if (!ok) setProjectName(p.name);
    setEditingProject(false);
  };

  return (
    <div className={styles.projectTreeNode}>
      <div
        className={`${styles.projectTreeRow} ${isCurrent ? styles.projectTreeRowActive : ''}`}
        onClick={() => {
          if (!isCurrent) ctx.switchToProject(p.id);
          ctx.toggleProjectExpand(p.id);
        }}
      >
        <Icon name={isExpanded ? 'chevron-down' : 'chevron-right'} size={12} />
        <Icon name="folder" size={14} />
        {editingProject ? (
          <input
            className={styles.treeRenameInput}
            value={projectName}
            onChange={(event) => setProjectName(event.target.value)}
            onClick={(event) => event.stopPropagation()}
            onBlur={() => void finishProjectRename()}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void finishProjectRename();
              if (event.key === 'Escape') {
                setProjectName(p.name);
                setEditingProject(false);
              }
            }}
            autoFocus
          />
        ) : (
          <button
            type="button"
            className={styles.projectTreeName}
            onDoubleClick={(event) => {
              event.stopPropagation();
              setEditingProject(true);
            }}
            title="双击重命名项目"
          >
            {p.name}
          </button>
        )}
        <button
          className={styles.projectTreeAddBtn}
          onClick={(e) => {
            e.stopPropagation();
            ctx.createConversationForProject(p.id);
          }}
          title="创建新对话"
          disabled={ctx.creatingConversation}
        >
          <Icon name="plus" size={12} />
        </button>
        <button
          className={styles.projectTreeAddBtn}
          onClick={(event) => {
            event.stopPropagation();
            void ctx.archiveProject(p.id);
          }}
          title="移入回收站"
        >
          <Icon name="trash" size={12} />
        </button>
        {isCurrent && (
          <button
            className={styles.projectTreeAddBtn}
            onClick={(e) => {
              e.stopPropagation();
              ctx.workspaceEdit.onOpen();
            }}
            title="更改项目工作目录（可粘贴完整路径）"
          >
            <Icon name="settings" size={12} />
          </button>
        )}
      </div>
      {isExpanded && (
        <ul className={styles.convList}>
          {convs.length === 0 && <li className={styles.convEmpty}>暂无对话</li>}
          {convs.map((c) => (
            <ConversationItem key={c.id} conversation={c} projectId={p.id} ctx={ctx} isCurrent={isCurrent} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ConversationItem({ conversation, projectId, ctx, isCurrent }: {
  conversation: ConversationSummary;
  projectId: string;
  ctx: LeftPanelContext;
  isCurrent: boolean;
}): React.ReactElement {
  const [editing, setEditing] = React.useState(false);
  const [title, setTitle] = React.useState(conversation.title);
  const conversationRun = useConversationRun(conversation.id);
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
