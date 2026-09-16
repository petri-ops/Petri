// ============================================================
// SubAgentsBar — BLOCK-49 加映二：会话内子 agent 活动条。
//
// 数据源：conversationRunStore 的 subTaskRuns（用户 runInBackground +
// 模型 spawn_agent 双源登记；child_finished 终态落账）。
// 行内操作：中断（运行中，stopSubAgentTask 走既有 cancel REST）+
// 详情（UI-385：右栏「智能体」tab 承载，独立窗退役）。
//
// UI-385（原 BLOCK-65 窗口机制退役）：
//   - 自动唤起：新运行中子 agent → 派发 agentOpenInRail，右栏「智能体」
//     tab 自动切换（模块级 Set 保证每 task 只切一次）。
//   - P2-c② 俯瞰面板：SubAgentsBar 升格——「全部俯瞰」展开区只读
//     /api/ai/agent/tasks（用户维度、跨会话、tasks 表投影，零第二真相），
//     5s 轮询，行点击切右栏详情。
// ============================================================
import React, { useEffect, useState } from 'react';
import { Icon } from '@/components/icons/Icon';
import {
  loadHistoricalSubAgentTasks,
  stopSubAgentTask,
  useSubAgentTasksForConversation,
  type ConversationRunSnapshot,
} from '@/components/copilot/conversationRunStore';
import { listAgentTasks, type AgentTaskOverviewItem } from '@/components/copilot/copilotClient';
import { gewuEvents, dispatchGewuEvent } from '@/lib/events';
import styles from './sub-agents-bar.module.css';

const STATUS_LABEL: Record<ConversationRunSnapshot['status'], string> = {
  running: '运行中',
  done: '已完成',
  error: '失败',
  stopped: '已停止',
};

// BLOCK-65 P2-c：俯瞰面板状态标签（后端 status：running/pending/completed/failed/cancelled）
const OVERVIEW_STATUS_LABEL: Record<string, string> = {
  pending: '排队中',
  running: '运行中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
};

// UI-385：每 task 只自动切一次右栏详情（模块级，跨 SubAgentsBar 重挂载保持）
const autoOpened = new Set<string>();

function head(text: string): string {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  return t.length > 56 ? `${t.slice(0, 56)}…` : t || '（无描述）';
}

function convShort(id: string | null): string {
  if (!id) return '';
  return id.startsWith('conv_') ? id.slice(5, 13) : id.slice(0, 8);
}

export function SubAgentsBar({
  conversationId,
  projectId,
}: {
  conversationId: string | null | undefined;
  /** BLOCK-65 修正：俯瞰面板按项目隔离（仅展示本项目会话派生的 agent） */
  projectId?: string | null;
}): React.ReactElement | null {
  const tasks = useSubAgentTasksForConversation(conversationId);
  const [open, setOpen] = useState(false);
  const [overviewOpen, setOverviewOpen] = useState(false);
  const [overview, setOverview] = useState<AgentTaskOverviewItem[] | null>(null);
  const [overviewError, setOverviewError] = useState('');

  // BLOCK-65 修正：会话打开时回填历史子 agent（含终态）——否则刷新后
  // store 为空，活动条与俯瞰入口在本会话永久不可见
  useEffect(() => {
    if (!conversationId) return;
    void loadHistoricalSubAgentTasks(conversationId);
  }, [conversationId]);

  // UI-385 自动唤起：新运行中任务 → 右栏「智能体」tab 自动切换（不再弹独立窗）
  useEffect(() => {
    for (const t of tasks) {
      if (t.status !== 'running') continue;
      const id = t.taskId || '';
      if (!id || autoOpened.has(id)) continue;
      autoOpened.add(id);
      dispatchGewuEvent(gewuEvents.agentOpenInRail, { runId: id });
    }
  }, [tasks]);

  const openDetail = (taskId: string) => {
    dispatchGewuEvent(gewuEvents.agentOpenInRail, { runId: taskId });
  };

  // P2-c② 俯瞰面板：展开时 5s 轮询（只读投影）
  useEffect(() => {
    if (!overviewOpen) return;
    let alive = true;
    const load = () => {
      void listAgentTasks(50)
        .then((rows) => {
          if (!alive) return;
          setOverview(rows);
          setOverviewError('');
        })
        .catch((e: unknown) => {
          if (!alive) return;
          setOverviewError(e instanceof Error ? e.message : '俯瞰列表获取失败');
        });
    };
    load();
    const timer = window.setInterval(load, 5000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [overviewOpen]);

  if (!conversationId) return null;
  const running = tasks.filter((t) => t.status === 'running').length;
  // BLOCK-65 修正：没用子智能体就不渲染活动条（空态视觉噪声回归——
  // 「全部俯瞰」入口仅在已有子 agent 活动的会话内提供）
  if (tasks.length === 0) return null;

  // BLOCK-65 修正：俯瞰按项目隔离——仅展示当前项目会话派生的 agent
  const overviewRows = (overview || [])
    .filter((t) => !projectId || !t.projectId || t.projectId === projectId)
    .sort((a, b) => {
      const aActive = a.status === 'running' || a.status === 'pending' ? 0 : 1;
      const bActive = b.status === 'running' || b.status === 'pending' ? 0 : 1;
      if (aActive !== bActive) return aActive - bActive;
      return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
    });

  return (
    <div className={styles.bar}>
      {/* UI-316 — 单行细条：bot 图标（独立智能体标识）+ 计数 + 俯瞰入口 */}
      <div className={styles.slim}>
        <span className={styles.agentIcon} aria-hidden="true">
          <Icon name="bot" size={13} />
        </span>
        <button
          type="button"
          className={styles.summary}
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          title="子智能体列表"
        >
          <span>
            子智能体 {running > 0 ? `${running} 运行中 · ` : ''}{tasks.length} 个
          </span>
          <Icon name={open ? 'chevron-down' : 'chevron-right'} size={12} />
        </button>
        <button
          type="button"
          className={styles.summary}
          onClick={() => setOverviewOpen((v) => !v)}
          aria-expanded={overviewOpen}
          title="全部智能体俯瞰（跨会话 · 只读投影）"
          data-testid="subagents-overview-toggle"
        >
          <span>全部俯瞰</span>
          <Icon name={overviewOpen ? 'chevron-down' : 'chevron-right'} size={12} />
        </button>
      </div>
      {open && (
        <div className={styles.list}>
          {tasks.map((task) => (
            <div key={task.taskId} className={styles.row} data-status={task.status}>
              <span className={styles.rowDot} data-status={task.status} />
              <span className={styles.rowText} title={task.userContent}>
                {head(task.userContent)}
              </span>
              <span className={styles.rowStatus} data-status={task.status}>
                {STATUS_LABEL[task.status]}
              </span>
              <button
                type="button"
                className={styles.rowBtn}
                onClick={() => openDetail(task.taskId || '')}
                title="在右侧栏「智能体」面板查看详情（实时工作流 + 摘要）"
                aria-label="打开详情"
              >
                <Icon name="eye" size={12} />
              </button>
              {task.status === 'running' && (
                <button
                  type="button"
                  className={`${styles.rowBtn} ${styles.rowBtnDanger}`}
                  onClick={() => stopSubAgentTask(task.taskId || '')}
                  title="中断该子 agent（在下一个取消检查点让出）"
                  aria-label="中断子 agent"
                >
                  <Icon name="x" size={12} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {overviewOpen && (
        <div className={styles.list} data-testid="subagents-overview">
          {overviewError && <div className={styles.overviewNote} role="alert">俯瞰列表获取失败：{overviewError}</div>}
          {!overviewError && overview === null && <div className={styles.overviewNote}>加载中…</div>}
          {!overviewError && overview !== null && overviewRows.length === 0 && (
            <div className={styles.overviewNote}>
              {projectId ? '当前项目暂无子 agent 记录（其他项目的 agent 不在此显示）。' : '还没有任何子 agent 记录。'}
            </div>
          )}
          {overviewRows.map((task) => (
            <div
              key={task.taskId}
              className={styles.row}
              data-status={task.status === 'running' ? 'running' : task.status === 'completed' ? 'done' : task.status === 'failed' ? 'error' : 'stopped'}
            >
              <span
                className={styles.rowDot}
                data-status={task.status === 'running' ? 'running' : task.status === 'completed' ? 'done' : task.status === 'failed' ? 'error' : 'stopped'}
              />
              <span className={styles.rowText} title={task.taskText}>
                {head(task.taskText)}
              </span>
              {task.conversationId && (
                <span className={styles.rowConv} title={`会话 ${task.conversationId}`}>
                  @{convShort(task.conversationId)}
                </span>
              )}
              <span className={styles.rowStatus} data-status={task.status === 'completed' ? 'done' : task.status === 'failed' ? 'error' : task.status === 'running' ? 'running' : 'stopped'}>
                {OVERVIEW_STATUS_LABEL[task.status] || task.status}
              </span>
              <button
                type="button"
                className={styles.rowBtn}
                onClick={() => openDetail(task.taskId)}
                title="在右侧栏「智能体」面板查看详情"
                aria-label="打开详情"
              >
                <Icon name="eye" size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
