/**
 * AppRail — UI-341 加映三（档 2）：应用级左栏。由 App 壳层渲染，因此
 * Skills / 知识空间 / 后端 / 新建任务 / 项目管理 等页面跳转时**左栏常驻**，
 * 不再随工作区路由一起消失。
 *
 * 数据与动作全部来自 AppRailContext（单一真相）；工作区专属副作用通过
 * adapter 适配槽回接（见 AppRailContext 顶部注释）。右栏与终端不上提。
 */
import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { LeftPanel, type LeftPanelContext } from '@/components/workspace-panels/LeftPanel';
import { ColumnHeader } from '@/components/desktop/titlebar/ColumnizedTitleBar';
import { useAppRail } from '@/components/desktop/AppRailContext';
import { segmentToMode } from '@/hooks/useWorkspaceRouting';
import { useWorkspaceLayout } from '@/hooks/useWorkspaceLayout';
import { trackResizeGlow } from '@/lib/resize-glow';
import styles from '@/pages/project-workspace.module.css';

/** 从路由段推导当前工作区模式（壳层与工作区同一套 URL 语义）。 */
function modeFromPath(pathname: string): LeftPanelContext['workspaceMode'] {
  const m = pathname.replace(/\/+$/, '').match(/^\/project\/[^/]+\/(.+)$/);
  if (!m) return 'chat';
  return segmentToMode(m[1]);
}

export function AppRail(): React.ReactElement {
  const navigate = useNavigate();
  const location = useLocation();
  const rail = useAppRail();
  const { leftOpen, compactLayout } = useWorkspaceLayout();

  const {
    allProjects,
    currentProjectId,
    currentProject,
    expandedProjects,
    toggleProjectExpand,
    conversations,
    activeConvId,
    projectConversations,
    creatingProject,
    creatingConversation,
    createError,
    leftWidth,
    startColumnResize,
    switchToProject,
    switchConversation,
    createConversationForProject,
    openCreatePanel,
    createProjectFromPath,
    renameProjectInTree,
    renameConversationInTree,
    archiveProjectFromTree,
    archiveConversationFromTree,
    forkConversationInTree,
    sshConnectProject,
    sshConnectHost,
    sshListDirs,
    sshRegisterHost,
    sshCreateAt,
    openWorkspaceMode,
  } = rail;

  const workspaceMode = modeFromPath(location.pathname);

  /** 「新建任务」＝新建会话（用户裁决语义：新建项目交给项目区 + 与内联创建面板）。 */
  const handleNewTask = React.useCallback(() => {
    if (currentProjectId) {
      void createConversationForProject(currentProjectId);
      return;
    }
    void navigate('/');
  }, [createConversationForProject, currentProjectId, navigate]);

  const ctx: LeftPanelContext = {
    width: leftWidth,
    columnHeader: compactLayout ? undefined : <ColumnHeader side="left" />,
    project: currentProject ?? undefined,
    workspacePath: currentProject?.workspacePath,
    compactWorkspacePath: '',
    visibleProjects: allProjects,
    projectConversations,
    projectId: currentProjectId ?? undefined,
    conversations,
    activeConvId,
    expandedProjects,
    creatingProject,
    creatingConversation,
    createPanel: {
      open: false,
      error: createError,
      onOpen: openCreatePanel,
      onPickExternal: createProjectFromPath,
    },
    createConversationForProject,
    renameProject: renameProjectInTree,
    renameConversation: renameConversationInTree,
    archiveProject: archiveProjectFromTree,
    archiveConversation: archiveConversationFromTree,
    forkConversation: forkConversationInTree,
    sshConnectProject,
    sshConnectHost,
    sshListDirs,
    sshRegisterHost,
    sshCreateAt,
    workspaceMode,
    handleShowScheduled: () => openWorkspaceMode('scheduled'),
    // UI-364/365 — 插件与设置独立页化：设备级能力不绑项目，不再经工作区模式
    // （原 openWorkspaceMode 会隐式激活当前项目）
    // BLOCK-156 — 插件/Skills 两入口收敛为扩展中心单入口（/extensions 四货架）
    handleShowExtensions: () => void navigate('/extensions'),
    handleShowSettings: () => void navigate('/settings'),
    handleNavigateToKnowledge: () => void navigate('/knowledge'),
    // UI-366 — 后端页退役：诊断并入设置「运行时与诊断」分区，一级入口移除
    handleNavigateToHome: handleNewTask,
    switchToProject,
    handleSwitchConversation: switchConversation,
    toggleProjectExpand,
    handleOpenWorkspacePath: () => {
      if (currentProjectId) void navigate(`/project/${currentProjectId}`);
    },
  };

  return (
    <>
      <LeftPanel ctx={ctx} open={leftOpen} />
      {leftOpen && (
        <div
          className={styles.resizeHandleV}
          onMouseDown={startColumnResize('left')}
          onPointerMove={trackResizeGlow}
        />
      )}
    </>
  );
}
