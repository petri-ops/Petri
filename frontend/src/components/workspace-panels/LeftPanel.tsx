import React from 'react';
import { Icon } from '@/components/icons/Icon';
import type { Project } from '@/lib/project-types';
import type { ConversationSummary } from '@/components/copilot/copilotConversationsClient';
import type { WorkspaceMode } from '@/hooks/useWorkspaceRouting';
import styles from '@/pages/project-workspace.module.css';

export interface LeftPanelContext {
  // Layout
  width: number;

  // Project + workspace
  project: Project;
  workspacePath?: string;
  compactWorkspacePath: string;

  // Search
  sidebarQuery: string;
  normalizedSidebarQuery: string;
  setSidebarQuery: (q: string) => void;

  // Project tree
  visibleProjects: Project[];
  projectConversations: Record<string, ConversationSummary[]>;
  projectId?: string;
  conversations: ConversationSummary[];
  activeConvId: string | null;
  expandedProjects: Set<string>;
  projectMatchesSidebarQuery: (p: Project) => boolean;
  matchesConversationQuery: (c: ConversationSummary) => boolean;

  // Inline project creator
  creatingProjectInline: boolean;
  newProjectName: string;
  newProjectDesc: string;
  newProjectWorkspacePath: string;
  creatingProject: boolean;
  setCreatingProjectInline: (v: boolean) => void;
  setNewProjectName: (v: string) => void;
  setNewProjectDesc: (v: string) => void;
  setNewProjectWorkspacePath: (v: string) => void;
  openProjectCreator: () => void;
  submitProjectCreator: () => void | Promise<void>;
  chooseWorkspaceDirectory: () => Promise<string | null>;

  // Inline conversation creator
  creatingConversationFor: string | null;
  newConversationTitle: string;
  creatingConversation: boolean;
  setCreatingConversationFor: (id: string | null) => void;
  setNewConversationTitle: (v: string) => void;
  openConversationCreator: (projectId?: string) => void;
  submitConversationCreator: (projectId?: string) => void | Promise<void>;

  // Workspace routing
  workspaceMode: WorkspaceMode;
  handleShowCloud: () => void;
  handleShowSearch: () => void;
  handleShowScheduled: () => void;
  handleShowPlugins: () => void;
  handleShowSettings: () => void;

  // Project / conversation switching
  switchToProject: (id: string) => void;
  handleSwitchConversation: (id: string) => void;
  toggleProjectExpand: (id: string) => void;
  handleOpenWorkspacePath: () => void | Promise<void>;
  handleChangeWorkspacePath: () => void | Promise<void>;
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
 *   │  Search box                  │
 *   │  Mode quick-actions (8)      │
 *   ├─ projectTreeScroll ──────────┤
 *   │  Inline project creator      │
 *   │  Project tree (recursive)    │
 *   │  Each project → conversations│
 *   └──────────────────────────────┘
 */
export function LeftPanel({ ctx }: LeftPanelProps): React.ReactElement {
  return (
    <aside className={styles.leftCol} style={{ width: ctx.width }}>
      <div className={styles.leftPanelWrap}>
        <SidebarSearch ctx={ctx} />
        <QuickActions ctx={ctx} />
        <ProjectTreeHeader ctx={ctx} />
        <ProjectTree ctx={ctx} />
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

function SidebarSearch({ ctx }: { ctx: LeftPanelContext }): React.ReactElement {
  return (
    <label className={styles.leftSidebarSearchWrap} title="搜索项目或对话">
      <Icon name="search" size={14} />
      <input
        className={styles.leftSidebarSearch}
        value={ctx.sidebarQuery}
        onChange={(event) => ctx.setSidebarQuery(event.target.value)}
        placeholder="搜索项目或对话"
      />
      {ctx.sidebarQuery && (
        <button
          type="button"
          className={styles.leftSidebarSearchClear}
          onClick={() => ctx.setSidebarQuery('')}
          aria-label="清空搜索"
        >
          <Icon name="x" size={12} />
        </button>
      )}
    </label>
  );
}

function QuickActions({ ctx }: { ctx: LeftPanelContext }): React.ReactElement {
  const items: Array<{
    key: WorkspaceMode | 'newConv';
    mode: WorkspaceMode | null;
    label: string;
    icon: Parameters<typeof Icon>[0]['name'];
    onClick: () => void;
    title: string;
  }> = [
    {
      key: 'cloud',
      mode: 'cloud',
      label: '云平台',
      icon: 'layout-grid',
      onClick: ctx.handleShowCloud,
      title: '云平台',
    },
    {
      key: 'newConv',
      mode: 'chat',
      label: '新对话',
      icon: 'plus',
      onClick: () => ctx.openConversationCreator(),
      title: '新对话',
    },
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
      key: 'settings',
      mode: 'settings',
      label: '设置',
      icon: 'settings',
      onClick: ctx.handleShowSettings,
      title: '设置',
    },
  ];

  return (
    <div className={styles.leftQuickActions}>
      <div className={styles.leftQuickSectionLabel}>工作台</div>
      {items.map((item) => (
        <button
          key={item.key}
          className={`${styles.leftQuickAction} ${item.mode && ctx.workspaceMode === item.mode ? styles.leftQuickActionActive : ''}`}
          onClick={item.onClick}
          title={item.title}
        >
          <Icon name={item.icon} size={15} />
          <span>{item.label}</span>
        </button>
      ))}
    </div>
  );
}

function ProjectTreeHeader({ ctx }: { ctx: LeftPanelContext }): React.ReactElement {
  return (
    <div className={styles.leftPanelHeader}>
      <span className={styles.leftPanelTitle}>项目</span>
      <button className={styles.iconBtn} onClick={ctx.openProjectCreator} title="新建项目">
        <Icon name="plus" size={16} />
      </button>
    </div>
  );
}

function ProjectTree({ ctx }: { ctx: LeftPanelContext }): React.ReactElement {
  return (
    <div className={styles.projectTreeScroll}>
      {ctx.normalizedSidebarQuery && ctx.visibleProjects.length === 0 && (
        <div className={styles.sidebarEmptyState}>没有匹配的项目或对话</div>
      )}
      {ctx.creatingProjectInline && <InlineProjectCreator ctx={ctx} />}
      {ctx.visibleProjects.map((p) => (
        <ProjectNode
          key={p.id}
          project={p}
          ctx={ctx}
          isCurrent={p.id === ctx.projectId}
          isExpanded={ctx.normalizedSidebarQuery ? true : ctx.expandedProjects.has(p.id)}
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
  const filteredConvs =
    ctx.normalizedSidebarQuery && !ctx.projectMatchesSidebarQuery(p)
      ? convs.filter(ctx.matchesConversationQuery)
      : convs;

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
        <span className={styles.projectTreeName}>{p.name}</span>
        <button
          className={styles.projectTreeAddBtn}
          onClick={(e) => {
            e.stopPropagation();
            ctx.openConversationCreator(p.id);
          }}
          title="新建对话"
        >
          <Icon name="plus" size={12} />
        </button>
        {isCurrent && (
          <button
            className={styles.projectTreeAddBtn}
            onClick={(e) => {
              e.stopPropagation();
              ctx.handleChangeWorkspacePath();
            }}
            title="更改项目工作目录"
          >
            <Icon name="settings" size={12} />
          </button>
        )}
      </div>
      {isExpanded && (
        <ul className={styles.convList}>
          {ctx.creatingConversationFor === p.id && (
            <InlineConversationCreator projectId={p.id} ctx={ctx} />
          )}
          {filteredConvs.length === 0 && <li className={styles.convEmpty}>暂无对话</li>}
          {filteredConvs.map((c) => (
            <li
              key={c.id}
              className={`${styles.convItem} ${isCurrent && c.id === ctx.activeConvId ? styles.convItemActive : ''}`}
              onClick={() => {
                if (!isCurrent) ctx.switchToProject(p.id);
                ctx.handleSwitchConversation(c.id);
              }}
              title={c.title}
            >
              <Icon name="message-circle" size={12} />
              <span className={styles.convItemTitle}>{c.title}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function InlineProjectCreator({ ctx }: { ctx: LeftPanelContext }): React.ReactElement {
  return (
    <div className={styles.inlineCreateCard}>
      <input
        className={styles.inlineCreateInput}
        placeholder="项目名称"
        value={ctx.newProjectName}
        onChange={(event) => ctx.setNewProjectName(event.target.value)}
        autoFocus
      />
      <div className={styles.inlineCreatePathRow}>
        <button
          type="button"
          className={styles.inlineCreatePathBtn}
          onClick={async () => {
            const selected = await ctx.chooseWorkspaceDirectory();
            if (selected) ctx.setNewProjectWorkspacePath(selected);
          }}
        >
          选择工作目录
        </button>
        <span
          className={styles.inlineCreatePathValue}
          title={ctx.newProjectWorkspacePath || '未选择'}
        >
          {ctx.newProjectWorkspacePath || '未选择工作目录'}
        </span>
      </div>
      <textarea
        className={styles.inlineCreateTextarea}
        placeholder="项目描述（可选）"
        value={ctx.newProjectDesc}
        onChange={(event) => ctx.setNewProjectDesc(event.target.value)}
        rows={3}
      />
      <div className={styles.inlineCreateActions}>
        <button
          className={styles.inlineCreateBtn}
          onClick={() => {
            ctx.setCreatingProjectInline(false);
            ctx.setNewProjectName('');
            ctx.setNewProjectDesc('');
          }}
          disabled={ctx.creatingProject}
        >
          取消
        </button>
        <button
          className={`${styles.inlineCreateBtn} ${styles.inlineCreateBtnPrimary}`}
          onClick={ctx.submitProjectCreator}
          disabled={ctx.creatingProject || !ctx.newProjectName.trim()}
        >
          {ctx.creatingProject ? '创建中…' : '创建项目'}
        </button>
      </div>
    </div>
  );
}

function InlineConversationCreator({
  projectId,
  ctx,
}: {
  projectId: string;
  ctx: LeftPanelContext;
}): React.ReactElement {
  return (
    <li className={styles.convCreateItem}>
      <input
        className={styles.convCreateInput}
        placeholder="对话标题（可选）"
        value={ctx.newConversationTitle}
        onChange={(event) => ctx.setNewConversationTitle(event.target.value)}
        autoFocus
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            ctx.submitConversationCreator(projectId);
          }
          if (event.key === 'Escape') {
            ctx.setCreatingConversationFor(null);
            ctx.setNewConversationTitle('');
          }
        }}
      />
      <div className={styles.convCreateActions}>
        <button
          className={styles.convCreateBtn}
          onClick={() => {
            ctx.setCreatingConversationFor(null);
            ctx.setNewConversationTitle('');
          }}
          disabled={ctx.creatingConversation}
        >
          取消
        </button>
        <button
          className={`${styles.convCreateBtn} ${styles.convCreateBtnPrimary}`}
          onClick={() => ctx.submitConversationCreator(projectId)}
          disabled={ctx.creatingConversation}
        >
          {ctx.creatingConversation ? '创建中…' : '创建'}
        </button>
      </div>
    </li>
  );
}
