/**
 * OverviewPage — item 88 第三波：项目总览独立一级入口（/overview）。
 *
 * 总览指挥面从右栏 14+ 过挤的 tab 体系升为一级导航目的地（AppRail「项目总览」进入，
 * 右栏原 tab 保留为短入口）。数据：wb_goals/wb_tasks 五态投影（按项目）+ 会话子代理
 * 快照（有激活会话时）。复用 WorkbenchOverviewSurface（与右栏短入口同一投影实现）。
 */

import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '@/components/icons/Icon';
import { WorkbenchOverviewSurface } from '@/components/work-surface/WorkbenchOverviewSurface';
import { useSubAgentTasksForConversation } from '@/components/copilot/conversationRunStore';
import { useAppRail } from '@/components/desktop/AppRailContext';
import type { OrchestrationTask } from '@/components/workspace-panels/OrchestrationGraph';
import styles from './global-page.module.css';

export default function OverviewPage(): React.ReactElement {
  const navigate = useNavigate();
  const rail = useAppRail();
  const handleReturnBack = React.useCallback(() => {
    if (window.history.length > 1) window.history.back();
    else void navigate('/');
  }, [navigate]);

  const projectId = rail.currentProjectId ?? null;
  const conversationId = rail.activeConvId;
  // 会话子代理快照仅在有激活会话时投影（独立入口无会话时只出 wb 目标树——诚实空态由 Surface 承担）
  const loopTasks: OrchestrationTask[] = useSubAgentTasksForConversation(conversationId).map((run) => ({
    taskId: run.taskId,
    parentTaskId: run.parentTaskId,
    status: run.status,
    userContent: run.userContent,
  }));

  return (
    <div className={styles.page} data-testid="overview-page">
      <header className={styles.header}>
        <button
          type="button"
          className={styles.backBtn}
          onClick={handleReturnBack}
          title="返回"
          aria-label="返回"
        >
          <Icon name="arrow-left" size={16} />
          <span>返回</span>
        </button>
        <div className={styles.pageIcon}>
          <Icon name="layers" size={20} />
        </div>
        <div className={styles.titleWrap}>
          <span className={styles.title}>项目总览</span>
          <span className={styles.subtitle}>
            工作台指挥面 · 目标树 / 协作图 / 执行轨迹{projectId ? ` · 项目 ${projectId}` : '（未打开项目）'}
          </span>
        </div>
      </header>
      <div className={styles.body}>
        <WorkbenchOverviewSurface
          tasks={loopTasks}
          rootTaskId={conversationId || null}
          conversationId={conversationId || null}
          projectId={projectId}
        />
      </div>
    </div>
  );
}
