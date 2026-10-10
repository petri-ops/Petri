import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '@/components/icons/Icon';
import { SshStatusDot } from './SshStatusDot';
import { MobileSyncPanel } from '@/components/desktop/DesktopSettingsPanel/sections/MobileSync';
import { FederationPanel } from '@/components/desktop/DesktopSettingsPanel/sections/Federation';
import type { Project } from '@/lib/project-types';
import { SshCreateInlinePanel } from './LeftSshCreatePanel';
import { listConversations, type ConversationSummary } from '@/components/copilot/copilotConversationsClient';
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
  /** UI-341 加映三：壳层左栏在全局页（Skills/知识空间/后端等）没有当前项目；
      LeftPanel 本身不消费该字段（仅类型占位），故可选。 */
  project?: Project;
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
  handleShowScheduled: () => void;
  /** BLOCK-156 — 插件/Skills 两入口收敛为扩展中心单入口（四货架） */
  handleShowExtensions: () => void;
  handleShowSettings: () => void;
  /** BLOCK-72 / UI-320 — 全局工作台页入口（知识空间/后端为设备级全局能力，非项目关联） */
  handleNavigateToKnowledge: () => void;
  // UI-366 — handleNavigateToBackend 随 /backend 页退役移除
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
  // UI-445 — 会话标题搜索（搜索钮切换；跨项目按标题过滤，点结果直达会话）
  const [convSearchOpen, setConvSearchOpen] = useState(false);
  const [convSearchQuery, setConvSearchQuery] = useState('');

  const handlePanelDrop = async (e: React.DragEvent): Promise<void> => {
    e.preventDefault();
    setDropActive(false);
    const file = e.dataTransfer?.files?.[0];
    if (!file) {
      setDropHint('拖入的不是有效的文件/文件夹');
      return;
    }
    const pathFor = window.petriDesktop?.files?.pathForFile;
    const raw = typeof pathFor === 'function'
      ? pathFor(file)
      : (file as File & { path?: string }).path || null;
    if (!raw) {
      setDropHint('无法读取拖入项的路径');
      return;
    }
    const validate = window.petriDesktop?.files?.validateDirectory;
    if (typeof validate !== 'function') {
      setDropHint('当前运行环境不支持路径校验（请在 Petri 桌面应用中使用）。');
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
      style={{ width: open ? `var(--petri-live-left-width, ${ctx.width}px)` : 0 }}
      aria-hidden={!open}
      data-petri-motion="functional"
    >
      {ctx.columnHeader}
      <div
        className={styles.leftPanelWrap}
        style={dropActive ? { outline: '1px dashed var(--petri-accent)', outlineOffset: '-4px' } : undefined}
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
          convSearchOpen={convSearchOpen}
          onToggleConvSearch={() => {
            setConvSearchOpen((v) => !v);
            setConvSearchQuery('');
          }}
        />
        {convSearchOpen && (
          <div className={styles.convSearchBox}>
            <input
              className={styles.treeRenameInput}
              style={{ width: '100%' }}
              value={convSearchQuery}
              onChange={(e) => setConvSearchQuery(e.target.value)}
              placeholder="搜索会话标题…"
              aria-label="搜索会话标题"
              autoFocus
            />
          </div>
        )}
        {sshCreateOpen && (
          <SshCreateInlinePanel ctx={ctx} onClose={() => setSshCreateOpen(false)} />
        )}
        {convSearchOpen && convSearchQuery.trim() ? (
          <ConversationSearchResults ctx={ctx} query={convSearchQuery.trim()} />
        ) : (
          <ProjectTree ctx={ctx} />
        )}
        {dropHint && (
          <p className={styles.leftCreateError} role="alert" style={{ padding: '0 12px' }}>{dropHint}</p>
        )}
        <LeftSidebarFooter ctx={ctx} />
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

/**
 * UI-354 修订 1（用户裁决：位置在左侧栏最下方）→ BLOCK-85 UI 收敛（用户裁决
 * 「协作节点和手机连接是不是应该合并到一起呢 放到 联邦？」）——底部一行两个
 * 入口：[联邦]（左，手机接入 + 协作成员两区）+ [设置]（最右）。弹层 portal 挂
 * body 防遮挡；设置走既有 handleShowSettings。
 */
function LeftSidebarFooter({ ctx }: { ctx: LeftPanelContext }): React.ReactElement {
  const [federationOpen, setFederationOpen] = useState(false);
  const [federationTab, setFederationTab] = useState<'devices' | 'peers'>('devices');
  return (
    <div className={styles.leftPanelFooter}>
      <div className={styles.leftFooterRow}>
        <button
          type="button"
          className={styles.leftQuickAction}
          onClick={() => setFederationOpen((value) => !value)}
          title="联邦（手机连接 · 协作成员）"
          aria-label="联邦"
          aria-expanded={federationOpen}
          data-testid="sidebar-federation"
        >
          <Icon name="cpu" size={15} />
          <span>联邦</span>
        </button>
        {/* UI-362 — 指挥中心入口已迁入右栏 tab 体系（项目绑定俯瞰，与结果/审阅
            同级；用户裁决「应该像右侧边栏中的结果文件审阅一样」）。UI-361 曾短暂
            落位于此，全局独立窗仍由 Ctrl/Cmd+Shift+C 承载。 */}
        {/* UI-365 — 设置入口独立页化（/settings）：设备级能力不绑项目，
            工作态高亮随 settings 模式退役一并移除 */}
        <button
          type="button"
          className={styles.leftQuickAction}
          onClick={ctx.handleShowSettings}
          title="设置"
          aria-label="设置"
          data-testid="sidebar-settings"
        >
          <Icon name="settings" size={15} />
          <span>设置</span>
        </button>
      </div>
      {federationOpen && createPortal(
        <>
          <button
            type="button"
            className={styles.sidebarMobileOverlay}
            onClick={() => setFederationOpen(false)}
            aria-label="关闭联邦面板"
          />
          <div className={styles.sidebarMobileCard} role="dialog" aria-label="联邦" data-testid="federation-popup">
            <div className={styles.sidebarMobileCardHeader}>
              <strong>联邦</strong>
              <button
                type="button"
                className={styles.leftFooterIconBtn}
                onClick={() => setFederationOpen(false)}
                aria-label="关闭"
              >
                <Icon name="x" size={14} />
              </button>
            </div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
              {([
                ['devices', '我的设备'],
                ['peers', '协作成员'],
              ] as const).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  className={`${styles.leftQuickAction} ${federationTab === key ? styles.leftQuickActionActive : ''}`}
                  style={{ flex: 1, justifyContent: 'center' }}
                  onClick={() => setFederationTab(key)}
                  aria-pressed={federationTab === key}
                  data-testid={`federation-tab-${key}`}
                >
                  {label}
                </button>
              ))}
            </div>
            {federationTab === 'devices' && (
              <div data-testid="federation-section-devices">
                <MobileSyncPanel />
              </div>
            )}
            {federationTab === 'peers' && (
              <div data-testid="federation-section-peers">
                <FederationPanel />
              </div>
            )}
          </div>
        </>,
        document.body,
      )}
    </div>
  );
}

function QuickActions({ ctx }: { ctx: LeftPanelContext }): React.ReactElement {
  const items: Array<{
    // BLOCK-156 — 'plugins'/'skills' 收敛为 'extensions'（扩展中心四货架）
    key: WorkspaceMode | 'skills' | 'knowledge' | 'backend' | 'newtask' | 'extensions';
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
      // BLOCK-156 — 插件+Skills 两入口收敛为「扩展」单入口：扩展中心四货架
      // （领域插件/领域技能/通用技能/MCP 服务），设备级能力不绑项目。
      key: 'extensions',
      mode: null,
      label: '扩展',
      icon: 'puzzle',
      onClick: ctx.handleShowExtensions,
      title: '扩展中心（领域插件 / 领域技能 / 通用技能 / MCP 服务）',
    },
    {
      key: 'knowledge',
      mode: null,
      label: '知识空间',
      icon: 'brain',
      onClick: ctx.handleNavigateToKnowledge,
      title: '知识空间（全局）',
    },
    // UI-366 — 「后端」入口退役：诊断并入设置「运行时与诊断」分区
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

function ProjectTreeHeader({ ctx, sshCreateOpen, onToggleSshCreate, convSearchOpen, onToggleConvSearch }: { ctx: LeftPanelContext; sshCreateOpen: boolean; onToggleSshCreate: () => void; convSearchOpen: boolean; onToggleConvSearch: () => void }): React.ReactElement {
  return (
    <>
      <div className={styles.leftPanelHeader}>
        <span className={styles.leftPanelTitle}>项目</span>
        <div className={styles.leftPanelHeaderActions}>
          {/* UI-445 — 会话标题搜索开关（跨项目过滤，点结果直达会话） */}
          <button
            className={`${styles.iconBtn} ${convSearchOpen ? styles.iconBtnInactive : ''}`}
            onClick={onToggleConvSearch}
            title={convSearchOpen ? '收起会话搜索' : '搜索会话标题'}
            aria-label={convSearchOpen ? '收起会话搜索' : '搜索会话标题'}
            aria-expanded={convSearchOpen}
          >
            <Icon name="search" size={14} />
          </button>
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

/** UI-445 — 会话标题搜索结果（跨项目；250ms 防抖后全量拉取按标题过滤，上限 50）。 */
function ConversationSearchResults({ ctx, query }: { ctx: LeftPanelContext; query: string }): React.ReactElement {
  const [results, setResults] = useState<ConversationSummary[] | null>(null);
  const projectNameById = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const p of ctx.visibleProjects) map.set(p.id, p.name);
    return map;
  }, [ctx.visibleProjects]);

  React.useEffect(() => {
    let alive = true;
    const timer = setTimeout(() => {
      listConversations('all', undefined, { includeFederated: true })
        .then((all) => {
          if (!alive) return;
          const q = query.toLowerCase();
          setResults(all.filter((c) => c.title.toLowerCase().includes(q)).slice(0, 50));
        })
        .catch(() => { if (alive) setResults([]); });
    }, 250);
    return () => { alive = false; clearTimeout(timer); };
  }, [query]);

  return (
    <div className={styles.projectTreeScroll} data-testid="conv-search-results">
      <ul className={styles.convList}>
        {results === null && <li className={styles.convEmpty}>搜索中…</li>}
        {results !== null && results.length === 0 && <li className={styles.convEmpty}>无匹配会话</li>}
        {results !== null && results.map((c) => (
          <li
            key={c.id}
            className={styles.convItem}
            onClick={() => {
              if (c.project_id) ctx.switchToProject(c.project_id);
              ctx.handleSwitchConversation(c.id);
            }}
            title={c.title}
          >
            <Icon name="message-circle" size={12} />
            <span className={styles.convItemTitle}>{c.title}</span>
            <span className={styles.convEmpty} style={{ marginLeft: 'auto', fontSize: 11 }}>
              {c.project_id ? (projectNameById.get(c.project_id) || '其他项目') : '未绑定项目'}
            </span>
          </li>
        ))}
      </ul>
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
  // BLOCK-88 P2（D3）— 联邦委托会话独立可见：默认视图已由服务端隔离，
  // 此开关显式拉取 origin='federation-delegation' 会话并列出（可清理=既有归档/删除）。
  const [showFedConvs, setShowFedConvs] = React.useState(false);
  const [fedConvs, setFedConvs] = React.useState<ConversationSummary[]>([]);

  React.useEffect(() => setProjectName(p.name), [p.name]);

  React.useEffect(() => {
    if (!showFedConvs || !isExpanded) return;
    let alive = true;
    // 联邦委托会话无项目绑定（delegation 项目绑定=BLOCK-88 P3 待修缺口），
    // 全局拉取后按 origin 过滤，不按 project_id 过滤。
    listConversations('all', undefined, { includeFederated: true })
      .then((all) => {
        if (alive) setFedConvs(all.filter((c) => c.origin === 'federation-delegation'));
      })
      .catch(() => { if (alive) setFedConvs([]); });
    return () => { alive = false; };
  }, [showFedConvs, isExpanded, p.id]);

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
        {/* UI-397 — 远程项目连接呼吸灯（绿在线/黄连接中/红断联，点击手动重试） */}
        {p.workspaceKind === 'ssh' && !editingProject && (
          <span className={styles.projectTreeSshDot} onClick={(e) => e.stopPropagation()}>
            <SshStatusDot projectId={p.id} />
          </span>
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
            void ctx.createConversationForProject(p.id);
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
            setShowFedConvs((v) => !v);
          }}
          title="联邦委托会话（访客工程师）"
          aria-pressed={showFedConvs}
          data-testid="fed-conv-toggle"
        >
          <Icon name="globe" size={12} />
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
      {isExpanded && showFedConvs && (
        <ul className={styles.convList} data-testid="fed-conv-list">
          <li className={styles.convEmpty}>联邦委托会话（{fedConvs.length}）</li>
          {fedConvs.map((c) => (
            <li
              key={c.id}
              className={`${styles.convItem} ${isCurrent && c.id === ctx.activeConvId ? styles.convItemActive : ''}`}
              onClick={() => {
                if (!isCurrent) ctx.switchToProject(p.id);
                ctx.handleSwitchConversation(c.id);
              }}
              title={c.title}
            >
              <span className={styles.fedConvBadge} aria-hidden="true">委</span>
              <span className={styles.convItemTitle}>{c.title}</span>
            </li>
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
