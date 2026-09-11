import React, { useState } from 'react';
import { Icon } from '@/components/icons/Icon';
import type { Project } from '@/lib/project-types';
import { SshCreateInlinePanel } from './LeftSshCreatePanel';
import type { ConversationSummary } from '@/components/copilot/copilotConversationsClient';
import type { WorkspaceMode } from '@/hooks/useWorkspaceRouting';
import { useConversationRun } from '@/components/copilot/conversationRunStore';
import { formatDate, formatRelativeShort } from '@/lib/format';
import styles from '@/pages/project-workspace.module.css';

export interface LeftPanelContext {
  // Layout
  width: number;
  /**
   * BLOCK-62 P1b — 列级 header：渲染为 aside 第一个子元素。aside 交叉轴 stretch
   * → header 宽 = aside 宽 = 栏宽（同一元素派生、同一次 commit → 分隔线物理一体）。
   * 未注入（测试）时零变化。
   */
  columnHeader?: React.ReactNode;

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
    /** UI-282 — 拖拽目录直达创建：路径已由拖拽方校验，直接走创建链 */
    onPickExternal: (path: string) => void | Promise<void>;
  };
  createConversationForProject: (projectId?: string) => void | Promise<void>;
  renameProject: (projectId: string, name: string) => Promise<boolean>;
  renameConversation: (conversationId: string, title: string) => Promise<boolean>;
  archiveProject: (projectId: string) => Promise<boolean>;
  archiveConversation: (conversationId: string) => Promise<boolean>;
  /** Fork an existing conversation and switch to the new one */
  forkConversation: (conversationId: string, title?: string) => Promise<ConversationSummary | null>;

  /** BLOCK-67 加映（UI-325）：ssh 项目「远程连接」——连通性检测 + 诚实反馈（D5 重连入口） */
  sshConnectProject: (project: Project) => void | Promise<void>;
  /** UI-327 向导①：连通性检测（返回远端 $HOME 供路径浏览起点） */
  sshConnectHost: (alias: string) => Promise<{ ok: boolean; home?: string; error?: string; retryable?: boolean }>;
  /** UI-327 向导②：浏览远端目录（仅目录条目） */
  sshListDirs: (alias: string, path: string) => Promise<{ ok: boolean; path?: string; dirs?: Array<{ name: string; path: string }>; error?: string; retryable?: boolean }>;
  /** UI-327 密码模式①：注册主机（一次性装公钥 + 写别名），密码不存储 */
  sshRegisterHost: (p: { ip: string; port: string; username: string; password: string }) => Promise<{ ok: boolean; alias?: string; error?: string }>;
  /** UI-327 向导③：在选定路径创建项目并导航（内部完成 validate + create + navigate） */
  sshCreateAt: (p: { alias: string; remotePath: string }) => Promise<{ ok: boolean; error?: string }>;

  // Workspace routing
  workspaceMode: WorkspaceMode;
  handleShowSearch: () => void;
  handleShowScheduled: () => void;
  handleShowPlugins: () => void;
  handleShowSettings: () => void;
  handleNavigateToSkills: () => void;
  /** BLOCK-72 / UI-320 — 全局工作台页入口（知识空间/后端为设备级全局能力，非项目关联） */
  handleNavigateToKnowledge: () => void;
  handleNavigateToBackend: () => void;
  /** UI-328 — 左栏顶部「新建任务」：回工作台创建页（页内选本地/手输/SSH 路径） */
  handleNavigateToHome: () => void;

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
  /** UI-341 加映二 — 侧栏开关。false 时保持挂载、宽度收到 0（走 .leftCol 的
      width transition 平滑收起），而非卸载——卸载会让开合瞬时跳变。 */
  open?: boolean;
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
export function LeftPanel({ ctx, open = true }: LeftPanelProps): React.ReactElement {
  // BLOCK-53 P1 — 拖拽目录直达创建：drop 到左栏 → validateDirectory 校验 →
  // 打开既有内联创建面板（ctx.createPanel）并回填路径。复用 UI-257 既有确认链，
  // 用户仍需看到完整路径并点「创建项目」，拖拽不绕过任何确认环节。
  const [dropActive, setDropActive] = useState(false);
  const [dropHint, setDropHint] = useState<string | null>(null);
  // UI-327 — 左栏行内 SSH 创建面板（globe 按钮切换；不跳首页）
  const [sshCreateOpen, setSshCreateOpen] = useState(false);

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
      // UI-282 — 校验通过的拖拽路径直接走创建链（UI-304 后无内联面板可回填）
      await ctx.createPanel.onPickExternal(res.data.path);
      setDropHint(null);
    } catch (err) {
      setDropHint(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <aside
      className={`${styles.leftCol}${open ? '' : ` ${styles.leftColCollapsed}`}`}
      style={{ width: open ? `var(--gewu-live-left-width, ${ctx.width}px)` : 0 }}
      aria-hidden={!open}
      data-gewu-motion="functional"
    >
      {ctx.columnHeader}
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
        <ProjectTreeHeader
          ctx={ctx}
          sshCreateOpen={sshCreateOpen}
          onToggleSshCreate={() => setSshCreateOpen((v) => !v)}
        />
        {sshCreateOpen && (
          <SshCreateInlinePanel ctx={ctx} onClose={() => setSshCreateOpen(false)} />
        )}
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

function QuickActions({ ctx }: { ctx: LeftPanelContext }): React.ReactElement {
  const items: Array<{
    key: WorkspaceMode | 'skills' | 'knowledge' | 'backend' | 'newtask';
    mode: WorkspaceMode | null;
    label: string;
    icon: Parameters<typeof Icon>[0]['name'];
    onClick: () => void;
    title: string;
  }> = [
    {
      // UI-335 — 「新建任务」移入工作台分组首位（原 UI-328 左栏顶部悬浮行，用户裁决归组）
      key: 'newtask',
      mode: null,
      label: '新建任务',
      icon: 'plus',
      onClick: ctx.handleNavigateToHome,
      title: '新建任务：在工作台选择项目路径（本地目录 / 手动路径 / SSH 远程）',
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
      key: 'skills',
      mode: null,
      label: 'Skills',
      icon: 'sparkles',
      onClick: ctx.handleNavigateToSkills,
      title: 'Skills',
    },
    {
      key: 'knowledge',
      mode: null,
      label: '知识空间',
      icon: 'brain',
      onClick: ctx.handleNavigateToKnowledge,
      title: '知识空间（全局）',
    },
    {
      key: 'backend',
      mode: null,
      label: '后端',
      icon: 'cpu',
      onClick: ctx.handleNavigateToBackend,
      title: '后端进程（全局）',
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

function ProjectTreeHeader({ ctx, sshCreateOpen, onToggleSshCreate }: { ctx: LeftPanelContext; sshCreateOpen: boolean; onToggleSshCreate: () => void }): React.ReactElement {
  return (
    <>
      <div className={styles.leftPanelHeader}>
        <span className={styles.leftPanelTitle}>项目</span>
        <div className={styles.leftPanelHeaderActions}>
          {/* UI-327 — ssh 创建入口前置到左栏：行内面板，不跳首页 */}
          <button
            className={`${styles.iconBtn} ${sshCreateOpen ? styles.iconBtnInactive : ''}`}
            onClick={onToggleSshCreate}
            title={sshCreateOpen ? '收起 SSH 远程项目创建' : '新建 SSH 远程项目（IP/密码 或 别名）'}
            aria-label={sshCreateOpen ? '收起 SSH 远程项目创建' : '新建 SSH 远程项目'}
            aria-expanded={sshCreateOpen}
          >
            <Icon name="globe" size={14} />
          </button>
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
        {/* BLOCK-67 加映（UI-325）：ssh 项目树图标 = globe（对齐 ZCode 远程项目云标语义） */}
        <Icon name={p.workspaceKind === 'ssh' ? 'globe' : 'folder'} size={14} />
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
        {p.workspaceKind === 'ssh' && (
          <button
            className={styles.projectTreeAddBtn}
            onClick={(e) => {
              e.stopPropagation();
              void ctx.sshConnectProject(p);
            }}
            title={`远程连接 · ${p.sshHost}:${p.remotePath}`}
          >
            <Icon name="refresh" size={12} />
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
          {/* UI-331 — 会话行右侧短式相对时间（图1 形态）；悬停显绝对时间 */}
          <span
            className={styles.convItemTime}
            title={`更新于 ${formatDate(conversation.updated_at)}`}
          >
            {formatRelativeShort(conversation.updated_at)}
          </span>
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


// ============================================================
// UI-327 — 左栏行内 SSH 创建面板（globe 切换；别名 / IP+密码 双模式）
// 表单态本地持有；校验/注册/创建/导航全部走 ctx.sshCreate（单一链路）。
// ============================================================
