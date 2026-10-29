import React, { useEffect, useState } from 'react';
import { Icon } from '@/components/icons/Icon';
import { petriEvents, dispatchPetriEvent } from '@/lib/events';
import type { ToolJob, Project, Dataset } from '@/lib/project-types';
import type { HarnessWorkflowJobState } from '@/lib/harness-client';
import type { BackendStatus } from '@/lib/electron';
import { resolveAgentCategory } from '@/lib/agentCategories';
import type { AgentTaskTodoItem, KnowledgeCitation } from '@/components/copilot/copilotClient';
import { WorkspaceTodoSection } from './WorkspaceTodoSection';
import { WorkspaceCitationsSection } from './WorkspaceCitationsSection';
import styles from '@/pages/project-workspace.module.css';
import { useRuntimeResourceSnapshot } from '@/hooks/useRuntimeResourceSnapshot';
import type { ConversationLoopState } from '@/components/copilot/conversationRunStore';
import { deriveLoopDisplay, loopDecisionLabel, type LoopSessionSummary } from '@/lib/loop-client';
import type { ConversationSummary } from '@/components/copilot/copilotConversationsClient';
import { listAgentTasks, type AgentTaskOverviewItem } from '@/components/copilot/copilotClient';
import {
  fetchDraftPlansForConversation,
  fetchPlansWithPendingRevision,
} from '@/components/copilot/planApprovals';
import { listBackgroundProcesses } from '@/components/copilot/backgroundProcesses';
import { getBridge } from '@/lib/desktopBridge';
import { getPlatformApiPrefix, getToken } from '@/lib/authClient';
import { formatDate } from '@/lib/format';
import { projectExecutionAxis } from '@/lib/statusProjection';

export interface WorkspaceSummaryCardProps {
  open: boolean;
  /** UI-351 — 'float'：中栏过窄时卡片转悬浮层（compact 样式 + 绝对定位），不再整体消失 */
  visibility: 'hidden' | 'compact' | 'float' | 'expanded';
  width?: number;
  projectName: string;
  /** BLOCK-78 P1：项目本体——workspaceKind/sshHost/g0Baseline/modality/updatedAt 派生运行时投影 */
  project: Project;
  activeJob: ToolJob | null;
  workflow: HarnessWorkflowJobState | null;
  recentJobs: ToolJob[];
  liveJobsPreview: ToolJob[];
  jobStats: { running: number; failed: number; done: number; pending: number };
  backendStatus: BackendStatus;
  /** HLE-C4R: live durable-loop projection for the active conversation (or null). */
  loop?: ConversationLoopState | null;
  loopSummary?: LoopSessionSummary | null;
  /** BLOCK-97 — 当前会话 run 的任务清单快照（task_todo 投影；无清单不渲染该节） */
  todoList?: AgentTaskTodoItem[] | null;
  /** BLOCK-94 / UI-402 — 知识溯源节（本轮注入的知识块清单） */
  citations?: KnowledgeCitation[] | null;
  /** BLOCK-78 P1：会话与数据资产概览（ctx 已有，零新取数） */
  conversations: ConversationSummary[];
  activeConversation: ConversationSummary | null;
  datasets: Dataset[];
  onOpenScheduled: () => void;
  onSelectJob: (id: string) => void;
}

/**
 * Pinned summary card overlaid on the chat / scheduled session frame.
 * Collapsed by default (`open=false`) — caller toggles via `open`.
 *
 * `visibility` controls how much chrome the card shows:
 *   - 'hidden'  → returns null (caller should also not mount it)
 *   - 'compact' → narrower styles
 *   - 'expanded'→ full layout
 *
 * BLOCK-78（项目运行时投影）：定位收敛为「项目 + 当前会话的运行俯瞰」。
 * 新增节一律遵守「无内容不渲染」纪律；会话/数据集/项目信息仅在 expanded
 * 档渲染（compact 三档降级，见 plan §6）。执行侧标注按 project.workspaceKind
 * 路由（ssh → 远程@host，local 带 execution_target_id → 远程执行，否则本机）。
 */
export const WorkspaceSummaryCard = React.memo(function WorkspaceSummaryCard({
  open,
  visibility,
  width,
  projectName,
  project,
  activeJob,
  workflow,
  recentJobs,
  liveJobsPreview,
  jobStats,
  backendStatus,
  loop,
  loopSummary,
  todoList,
  citations,
  conversations,
  activeConversation,
  datasets,
  onOpenScheduled,
  onSelectJob,
}: WorkspaceSummaryCardProps): React.ReactElement | null {
  const { snapshot: resources, error: resourceError } = useRuntimeResourceSnapshot(project?.id ?? null);
  const cardVisible = open && visibility !== 'hidden';
  const pollTick = useSummaryHeartbeat(cardVisible); // BLOCK-161 W4-1：六路轮询共享单节拍
  const agentRows = useProjectAgentOverview(project?.id ?? null, cardVisible, pollTick);
  const terminalSessions = useTerminalSessions(cardVisible, pollTick);
  const attention = useConversationAttention(activeConversation?.id ?? null, project?.id ?? null, cardVisible, pollTick);
  const projectUsage = useProjectUsage(project?.id ?? null, cardVisible, pollTick);
  const projectStorage = useProjectStorage(project?.id ?? null, cardVisible, pollTick);
  const [noticeRefreshKey, setNoticeRefreshKey] = useState(0);
  const noticeUnread = useProjectNoticeUnread(project?.id ?? null, cardVisible, noticeRefreshKey, pollTick);
  if (visibility === 'hidden') return null;

  // HLE-C4R: derive an honest loop display. Completion/blocked come only from
  // the backend loop truth — never inferred here — and blocked/failed/cancelled
  // never render as a green completion.
  const loopDisplay = loop ? deriveLoopDisplay(loop, loop.phase === 'started' || loop.phase === 'resumed' || loop.phase === 'running') : null;

  const currentJob = activeJob || liveJobsPreview[0] || null;
  const currentJobStatus: ToolJob['status'] = workflow?.jobStatus === 'completed'
    ? 'done'
    : workflow?.jobStatus === 'failed'
      ? 'failed'
      : workflow?.jobStatus === 'cancelled'
        ? 'cancelled'
        : workflow?.jobStatus === 'running'
          ? 'running'
          : workflow?.jobStatus === 'pending' || workflow?.jobStatus === 'queued'
            ? 'pending'
            : currentJob?.status || 'pending';
  const runningCount = jobStats.running + jobStats.pending;
  const totalCount = runningCount + jobStats.done + jobStats.failed;
  const historyJobs = (recentJobs.length > 0 ? recentJobs : liveJobsPreview).slice(0, workflow ? 2 : 3);
  const additionalLiveJobs = liveJobsPreview
    .filter((job) => job.id !== currentJob?.id)
    .slice(0, 2);
  const execution = projectExecutionAxis(currentJobStatus);
  const statusLabel = currentJob ? execution?.label || '状态未识别' : '空闲';

  // BLOCK-78 P1 — 失败任务强调：jobStats.failed 是全量计数，最近失败 job 供直达。
  const firstFailedJob = recentJobs.find((job) => job.status === 'failed')
    || liveJobsPreview.find((job) => job.status === 'failed')
    || null;
  // BLOCK-78 P1 — 项目基线预警：blocked / 需迁移 / 执行停用高于「空闲」呈现，
  // 否则执行不了的项目显示「空闲」是误导。
  const baseline = project?.g0Baseline ?? null;
  const baselineBlocked = !!baseline
    && (baseline.compatibilityStatus === 'blocked' || baseline.executionAllowed === false);
  const baselineMigration = baseline?.compatibilityStatus === 'migration_required';
  // BLOCK-78 P1.5：ssh 项目运行环境诚实化——资源快照/R-Py 芯片均为本机真值，
  // 对远程项目一律降级为「指挥席本机」标注，不冒充远程执行机环境。
  const isSshProject = project?.workspaceKind === 'ssh';
  const sshHostName = project?.sshHost || 'SSH';
  // BLOCK-78 P2-①：远程快照 live = 后端已按 projectId 路由到节点真值。
  const remoteLive = resources?.source === 'remote';
  // BLOCK-78 P1 — 执行位置标注按 workspaceKind 路由真值源（plan §5 P1④）。
  const runningAgentCount = agentRows.filter((t) => t.status === 'running').length;
  const failedAgentRows = agentRows.filter((t) => t.status === 'failed');
  const datasetTotalBytes = datasets.reduce((sum, item) => sum + (Number(item.size) || 0), 0);

  if (!open) return null;

  return (
    <aside
      className={`${styles.workspacePinnedSummary} ${
        visibility === 'compact' || visibility === 'float' ? styles.workspacePinnedSummaryCompactMode : ''
      }`}
      style={width ? { width: `${width}px` } : undefined}
      aria-label="项目运行摘要"
    >
      <div className={styles.workspacePinnedSummaryTopBar}>
        <div className={styles.workspacePinnedSummaryTopBarLeft}>
          <div className={styles.workspacePinnedSummaryHeaderText}>
            <div className={styles.workspacePinnedSummaryEyebrow}>项目摘要</div>
            <div className={styles.workspacePinnedSummaryTitleRow}>
              <div className={styles.workspacePinnedSummaryTitle}>{projectName}</div>
              <span
                className={styles.workspacePinnedSummaryStatus}
                data-status={currentJob ? currentJobStatus : 'idle'}
                data-execution-status={currentJob ? execution?.status || 'unknown' : 'idle'}
                title={execution?.detail}
              >
                <span />
                {statusLabel}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className={styles.workspacePinnedSummaryBody}>
        {(baselineBlocked || baselineMigration) && (
          <div
            className={styles.workspaceLoopRecovery}
            role="alert"
            aria-label="项目基线预警"
          >
            <Icon name="flag" size={12} />
            {baselineBlocked
              ? `项目基线受阻：${baseline?.compatibilityReason || '执行已停用'}`
              : '项目基线需要迁移：执行前请先完成基线迁移'}
          </div>
        )}

        {(jobStats.failed > 0
          || failedAgentRows.length > 0
          || attention.pendingPlans > 0
          || attention.abnormalProcesses > 0
          || noticeUnread > 0) && (
          <section className={styles.workspacePinnedSummarySection} aria-label="需要关注">
            <div className={styles.workspacePinnedSummarySectionHeading}>
              <div className={styles.workspacePinnedSummarySectionTitle}>需要关注</div>
              {noticeUnread > 0 && (
                <button
                  type="button"
                  className={styles.workspacePinnedSummaryQueueLabel}
                  data-testid="notices-unread-badge"
                  title="跨会话持久通知：点击全部标记已读"
                  onClick={() => { void markNoticesSeen(project?.id ?? null); setNoticeRefreshKey((k) => k + 1); }}
                >
                  {noticeUnread} 条未读
                </button>
              )}
            </div>
            {attention.pendingPlans > 0 && (
              <div
                className={styles.workspacePinnedSummaryTaskRow}
                title="在会话输入区上方批准或驳回"
              >
                <span className={styles.workspacePinnedSummaryActivityIcon} data-status="running">
                  <Icon name="list-details" size={13} />
                </span>
                <span className={styles.workspacePinnedSummaryActivityText}>
                  <strong>{attention.pendingPlans} 项计划待确认</strong>
                  <small>在会话输入区上方处理</small>
                </span>
              </div>
            )}
            {attention.abnormalProcesses > 0 && (
              <div
                className={styles.workspacePinnedSummaryTaskRow}
                data-status="failed"
                title="在会话的后台进程浮窗查看"
              >
                <span className={styles.workspacePinnedSummaryActivityIcon} data-status="failed">
                  <Icon name="alert-triangle" size={13} />
                </span>
                <span className={styles.workspacePinnedSummaryActivityText}>
                  <strong>{attention.abnormalProcesses} 个后台进程异常退出</strong>
                  <small>在会话的后台进程浮窗查看</small>
                </span>
              </div>
            )}
            {jobStats.failed > 0 && (
              <button
                type="button"
                className={styles.workspacePinnedSummaryTaskRow}
                data-status="failed"
                onClick={() => (firstFailedJob ? onSelectJob(firstFailedJob.id) : onOpenScheduled())}
              >
                <span className={styles.workspacePinnedSummaryActivityIcon} data-status="failed">
                  <Icon name="flag" size={13} />
                </span>
                <span className={styles.workspacePinnedSummaryActivityText}>
                  <strong>{jobStats.failed} 个失败任务</strong>
                  <small>
                    {firstFailedJob
                      ? `最近：${firstFailedJob.name || firstFailedJob.tool_id}`
                      : '点击查看全部分析记录'}
                  </small>
                </span>
                <Icon name="chevron-right" size={13} />
              </button>
            )}
            {failedAgentRows.length > 0 && (
              <button
                type="button"
                className={styles.workspacePinnedSummaryTaskRow}
                data-status="failed"
                onClick={() => openAgentWindow(failedAgentRows[0])}
              >
                <span className={styles.workspacePinnedSummaryActivityIcon} data-status="failed">
                  <Icon name="flag" size={13} />
                </span>
                <span className={styles.workspacePinnedSummaryActivityText}>
                  <strong>{failedAgentRows.length} 个失败智能体</strong>
                  <small>{headText(failedAgentRows[0].taskText, 40)}</small>
                </span>
                <Icon name="chevron-right" size={13} />
              </button>
            )}
          </section>
        )}

        <section className={styles.workspacePinnedSummaryOverview} aria-label="任务概览">
          <div className={styles.workspacePinnedSummarySectionHeading}>
            <div className={styles.workspacePinnedSummarySectionTitle}>任务</div>
            <span className={styles.workspacePinnedSummaryQueueLabel}>
              {runningCount > 0 ? `${runningCount} 项活动` : '无活动'}
            </span>
          </div>
          {currentJob ? (
            <button
              type="button"
              className={styles.workspacePinnedSummaryPrimaryCard}
              onClick={() => onSelectJob(currentJob.id)}
            >
              <span
                className={styles.workspacePinnedSummaryActivityIcon}
                data-status={currentJobStatus}
                data-execution-status={execution?.status || 'unknown'}
              >
                <Icon name={currentJobStatus === 'failed' ? 'flag' : 'terminal'} size={14} />
              </span>
              <span className={styles.workspacePinnedSummaryActivityText}>
                <strong>{currentJob.name || currentJob.tool_id}</strong>
                <small>
                  {statusLabel} · {jobLocationLabel(project, currentJob)} · {formatDate(currentJob.created_at)}
                </small>
              </span>
              <Icon name="chevron-right" size={13} />
            </button>
          ) : (
            <div className={styles.workspacePinnedSummaryPrimaryCard}>
              <span className={styles.workspacePinnedSummaryActivityIcon} data-status="done">
                <Icon name="check" size={14} />
              </span>
              <span className={styles.workspacePinnedSummaryActivityText}>
                <strong>暂无运行任务</strong>
                <small>{emptyTaskHint(datasets, conversations)}</small>
              </span>
            </div>
          )}

          {additionalLiveJobs.map((job) => (
            <button
              key={job.id}
              type="button"
              className={styles.workspacePinnedSummaryTaskRow}
              onClick={() => onSelectJob(job.id)}
            >
              <span className={styles.workspacePinnedSummaryActivityIcon} data-status={job.status}>
                <Icon name="terminal" size={13} />
              </span>
              <span className={styles.workspacePinnedSummaryActivityText}>
                <strong>{job.name || job.tool_id}</strong>
                <small>
                  {job.status === 'running' ? '后台运行中' : '等待执行'} · {jobLocationLabel(project, job)} · {formatDate(job.created_at)}
                </small>
              </span>
              <Icon name="chevron-right" size={13} />
            </button>
          ))}

          <div className={styles.workspacePinnedSummaryMetricGrid}>
            <button type="button" className={styles.workspacePinnedSummaryMetricCard} onClick={onOpenScheduled}>
              <span><Icon name="bar-chart" size={14} /> 分析记录</span>
              <strong>{totalCount}<small> 次</small></strong>
            </button>
            <div className={styles.workspacePinnedSummaryMetricCard}>
              <span><Icon name="terminal" size={14} /> 运行队列</span>
              <strong>{runningCount}<small> 项</small></strong>
            </div>
          </div>
        </section>

        {loop && loopDisplay && (
          <section className={styles.workspacePinnedSummarySection} aria-label="任务循环">
            <div className={styles.workspacePinnedSummarySectionHeading}>
              <div className={styles.workspacePinnedSummarySectionTitle}>任务循环</div>
              <span className={styles.workspaceLoopBadge} data-tone={loopDisplay.tone}>
                {loopDisplay.label}
              </span>
            </div>
            {loop.recoveryRequired && (
              <div className={styles.workspaceLoopRecovery}>
                <Icon name="flag" size={12} /> 任务在中断后需要恢复
              </div>
            )}
            {loop.latestConclusion && (
              <div className={styles.workspaceLoopConclusion}>{loop.latestConclusion}</div>
            )}
            {loopDisplay.attempts > 0 && (
              <div className={styles.workspaceLoopMeta}>
                {loopDisplay.attempts} 轮
                {loop.lastDecision ? ` · 最近决策：${loopDecisionLabel(loop.lastDecision)}` : ''}
              </div>
            )}
            {loopSummary && (
              <div className={styles.workspaceLoopMeta}>
                活动 {loopSummary.activeCount} · 后台 {loopSummary.backgroundCount}
                {' · '}Token {(loopSummary.usage.inputTokens + loopSummary.usage.outputTokens).toLocaleString()}
                {' · '}¥{Number(loopSummary.usage.estimatedCostCny || 0).toFixed(4)}
                {loopSummary.usage.costStatus === 'partial' ? '（部分估算）' : ''}
              </div>
            )}
          </section>
        )}

        {/* BLOCK-97 — 任务清单节：agent todo_write 快照，位于任务循环与任务进度之间 */}
        {todoList && todoList.length > 0 && <WorkspaceTodoSection items={todoList} />}

        {/* BLOCK-94 — 知识溯源节：本轮自动召回注入的知识块，位于任务清单之后 */}
        {citations && citations.length > 0 && <WorkspaceCitationsSection citations={citations} />}

        {workflow && (
          <section className={styles.workspacePinnedSummarySection}>
            <div className={styles.workspacePinnedSummarySectionHeading}>
              <div className={styles.workspacePinnedSummarySectionTitle}>任务进度</div>
              <span className={styles.workspaceWorkflowStateLabel}>
                {workflow.resumeFrom ? workflowStageLabel(workflow.resumeFrom) : '已完成'}
              </span>
            </div>
            <div className={styles.workspaceWorkflowRail} aria-label="Harness 工作流进度">
              {workflow.stages.map((stage) => (
                <span
                  key={stage.id}
                  data-status={stage.status}
                  title={`${workflowStageLabel(stage.id)} · ${workflowStatusLabel(stage.status)}`}
                />
              ))}
            </div>
            {workflow.nextActions?.[0] && (
              <div className={styles.workspaceWorkflowNextAction}>
                {workflow.nextActions[0].label}
              </div>
            )}
          </section>
        )}

        {agentRows.length > 0 && (
          <section className={styles.workspacePinnedSummarySection} aria-label="智能体">
            <div className={styles.workspacePinnedSummarySectionHeading}>
              <div className={styles.workspacePinnedSummarySectionTitle}>智能体</div>
              <span className={styles.workspacePinnedSummaryQueueLabel}>
                {runningAgentCount > 0 ? `${runningAgentCount} 运行中 · ` : ''}{agentRows.length} 个
              </span>
            </div>
            {/* UI-386 — 项目历史智能体图标带（每任务一枚状态色图标，悬停见任务描述，
                点击进右栏「智能体」详情；超出 8 条折进 +N 计数） */}
            <div className={styles.workspacePinnedSummaryAgentStrip}>
              {(() => {
                // UI-387 — 彩色 emoji 无外框；运行状态靠位置表达：运行中组排最前
                //（与历史组之间细分隔线），其后按时间倒序；职能由 emoji 形状区分。
                const running = agentRows.filter((t) => t.status === 'running').slice(0, 8);
                const rest = agentRows.filter((t) => t.status !== 'running').slice(0, Math.max(0, 8 - running.length));
                const chip = (task: AgentTaskOverviewItem) => {
                  // BLOCK-93 P2 — 显式 spawn role 第一优先，文本推断兜底
                  const category = resolveAgentCategory(task.role, task.taskText);
                  // BLOCK-88 P2（D3）— 联邦委托任务：可见角标 + 悬停「来自工程师 X」
                  const fedTag = task.federatedFrom ? ` · 来自${task.federatedFrom}` : '';
                  return (
                    <button
                      key={task.taskId}
                      type="button"
                      className={`${styles.workspacePinnedSummaryAgentChip} ${task.federatedFrom ? styles.workspacePinnedSummaryAgentChipFed : ''}`}
                      data-category={category.key}
                      title={`${headText(task.taskText, 48)} · ${category.label} · ${agentTaskStatusLabel(task.status)}${fedTag}`}
                      aria-label={`智能体 ${headText(task.taskText, 36)}（${agentTaskStatusLabel(task.status)}${fedTag}）`}
                      onClick={() => openAgentWindow(task)}
                    >
                      <span className={styles.workspacePinnedSummaryAgentEmoji} aria-hidden="true">{category.emoji}</span>
                    </button>
                  );
                };
                const hasRunning = running.length > 0;
                const hasRest = rest.length > 0;
                return (
                  <>
                    {running.map(chip)}
                    {hasRunning && hasRest && <span className={styles.workspacePinnedSummaryAgentDivider} aria-hidden="true" />}
                    {rest.map(chip)}
                  </>
                );
              })()}
            </div>
          </section>
        )}

        {historyJobs.length > 0 && (
          <section className={styles.workspacePinnedSummarySection}>
            <div className={styles.workspacePinnedSummarySectionHeading}>
              <div className={styles.workspacePinnedSummarySectionTitle}>最近分析</div>
              <button className="petri-btn petri-btn--ghost petri-btn--sm" type="button" onClick={onOpenScheduled}>查看全部</button>
            </div>
            <div className={styles.workspacePinnedSummaryHistory}>
              {historyJobs.map((job) => {
                const historyStatusLabel =
                  job.status === 'done'
                    ? '已完成'
                    : job.status === 'failed'
                      ? '失败'
                      : job.status === 'running'
                        ? '运行中'
                        : '等待中';
                return (
                  <button
                    key={job.id}
                    type="button"
                    className={styles.workspacePinnedSummaryHistoryItem}
                    onClick={() => onSelectJob(job.id)}
                  >
                    <span
                      className={styles.workspacePinnedSummaryActivityIcon}
                      data-status={job.status}
                    >
                      <Icon name={job.status === 'failed' ? 'flag' : 'terminal'} size={13} />
                    </span>
                    <span className={styles.workspacePinnedSummaryActivityText}>
                      <strong>{job.name || job.tool_id}</strong>
                      <small>{historyStatusLabel} · {formatDate(job.created_at)}</small>
                    </span>
                    <Icon name="chevron-right" size={13} />
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {visibility === 'expanded' && (
          <section className={styles.workspacePinnedSummarySection} aria-label="项目信息">
            <div className={styles.workspacePinnedSummarySectionHeading}>
              <div className={styles.workspacePinnedSummarySectionTitle}>项目</div>
            </div>
            <div className={styles.workspacePinnedSummaryEnvironmentRow}>
              <span className={styles.workspacePinnedSummaryEnvironmentLabel}>
                <Icon name={project?.workspaceKind === 'ssh' ? 'globe' : 'folder'} size={14} /> 位置
              </span>
              <span className={styles.workspaceLoopMeta}>
                {project?.workspaceKind === 'ssh'
                  ? `SSH · ${project.sshHost || '远程'}`
                  : '本地工作区'}
                {project?.modality ? ` · ${modalityLabel(project.modality)}` : ''}
              </span>
            </div>
            <div className={styles.workspacePinnedSummaryEnvironmentRow}>
              <span className={styles.workspacePinnedSummaryEnvironmentLabel}>
                <Icon name="message-circle" size={14} /> 会话
              </span>
              <span className={styles.workspaceLoopMeta}>
                {activeConversation ? headText(activeConversation.title, 18) : '无活动会话'}
                {` · 共 ${conversations.length} 个`}
              </span>
            </div>
            <div className={styles.workspacePinnedSummaryEnvironmentRow}>
              <span className={styles.workspacePinnedSummaryEnvironmentLabel}>
                <Icon name="database" size={14} /> 数据集
              </span>
              <span className={styles.workspaceLoopMeta}>
                {datasets.length > 0
                  ? `${datasets.length} 个 · ${formatBytes(datasetTotalBytes)}`
                  : '暂无数据集'}
              </span>
            </div>
            {/* BLOCK-78 P2-③：结果库占用（done 作业数 + 产物字节；du/遍历
                60s TTL；stale 显观测时间；无产物不渲染）。 */}
            {projectStorage && (projectStorage.jobs > 0 || projectStorage.bytes > 0) && (
              <div className={styles.workspacePinnedSummaryEnvironmentRow}>
                <span className={styles.workspacePinnedSummaryEnvironmentLabel}>
                  <Icon name="database" size={14} /> 结果库
                </span>
                <span
                  className={styles.workspaceLoopMeta}
                  title="已完成分析的产物占用（限深统计，超限部分诚实省略）"
                >
                  {`${formatBytes(projectStorage.bytes)} · ${projectStorage.jobs} 作业${projectStorage.stale ? ` · 观测于 ${formatObservedAt(projectStorage.observedAt)}` : ''}`}
                </span>
              </div>
            )}
            {project?.updatedAt && (
              <div className={styles.workspacePinnedSummaryEnvironmentRow}>
                <span className={styles.workspacePinnedSummaryEnvironmentLabel}>
                  <Icon name="clock" size={14} /> 更新
                </span>
                <span className={styles.workspaceLoopMeta}>{formatDate(project.updatedAt)}</span>
              </div>
            )}
            {/* BLOCK-78 P2-②：项目级累计成本/Token（ai_usage conversation 归因
                项目口径；无调用不渲染，partial 估算诚实标注）。 */}
            {projectUsage && projectUsage.calls > 0 && (
              <div className={styles.workspacePinnedSummaryEnvironmentRow}>
                <span className={styles.workspacePinnedSummaryEnvironmentLabel}>
                  <Icon name="bar-chart" size={14} /> 成本
                </span>
                <span
                  className={styles.workspaceLoopMeta}
                  title="项目累计 AI 用量（会话归因项目口径；成本为已知价格表估算）"
                >
                  {`¥${Number(projectUsage.estimatedCostCny || 0).toFixed(4)} · ${(projectUsage.inputTokens + projectUsage.outputTokens).toLocaleString()} tok${projectUsage.costStatus === 'partial' ? '（部分估算）' : ''}`}
                </span>
              </div>
            )}
          </section>
        )}

        <section className={styles.workspacePinnedSummaryEnvironment}>
          <div className={styles.workspacePinnedSummarySectionHeading}>
            <div className={styles.workspacePinnedSummarySectionTitle}>运行环境</div>
          </div>
          <div className={styles.workspacePinnedSummaryEnvironmentCard}>
            {isSshProject ? (
              <div className={styles.workspacePinnedSummaryEnvironmentRow}>
                <span className={styles.workspacePinnedSummaryEnvironmentLabel}>
                  <Icon name="cpu" size={15} /> 计算后端
                </span>
                <span className={styles.workspaceLoopMeta}>
                  远程执行 · {sshHostName}
                </span>
              </div>
            ) : (
              <div className={styles.workspacePinnedSummaryEnvironmentRow}>
                <span className={styles.workspacePinnedSummaryEnvironmentLabel}>
                  <Icon name="cpu" size={15} /> 计算后端
                </span>
                <span className={styles.workspacePinnedSummaryRuntimes} aria-label="后端运行状态">
                  {/* rRuntime/pyRuntime 可为 null（backend:status 查询失败 = 未知）；
                      状态芯片只做展示，未知按"未就绪"处理，用 === true 归一化。 */}
                  <RuntimeStatusChip
                    label="R"
                    runtimeReady={backendStatus.rRuntime === true}
                    serverUp={backendStatus.rServerUp}
                    downReason={backendStatus.downReason}
                  />
                  <RuntimeStatusChip
                    label="Py"
                    runtimeReady={backendStatus.pyRuntime === true}
                  />
                </span>
              </div>
            )}
            {terminalSessions.length > 0 && (
              <div className={styles.workspacePinnedSummaryEnvironmentRow}>
                <span className={styles.workspacePinnedSummaryEnvironmentLabel}>
                  <Icon name="terminal" size={15} /> 终端
                </span>
                <span className={styles.workspaceLoopMeta} aria-label="终端会话">
                  {terminalSessions.length} 个会话运行中
                </span>
              </div>
            )}
            {/* BLOCK-78 P2-①：资源行按快照 source 驱动——remote（mux 探测远程
                节点真值）显示「资源 · {host}」；ssh 项目探测不可得时诚实降级
                「指挥席本机」（P1.5 语义，仅剩过渡兜底）；local 项目原样。 */}
            <div
              className={styles.workspacePinnedSummaryEnvironmentRow}
              data-state={resources?.state || 'unknown'}
              title={isSshProject && !remoteLive ? '资源读数来自指挥席本机；远程快照暂不可达' : undefined}
            >
              <span className={styles.workspaceResourceSummaryState}>
                <i />
                {remoteLive
                  ? `资源 · ${resources?.host || sshHostName}`
                  : isSshProject
                    ? (resourceError ? `资源 · ${sshHostName}` : '资源 · 指挥席本机')
                    : resources
                      ? resources.state === 'ready' ? '资源正常' : resources.state === 'warning' ? '资源需注意' : '资源不足'
                      : resourceError ? '资源不可用' : '资源检查中'}
              </span>
              {remoteLive ? (
                <span className={styles.workspacePinnedSummaryResourceFacts}>
                  {`内存 ${formatBytes(resources?.memory.availableBytes ?? null)} · 磁盘 ${formatBytes(resources?.disk.availableBytes ?? null)} · ${resources?.cpu.logicalCores ?? '?'} 核${resources?.stale ? ` · 观测于 ${formatObservedAt(resources.observedAt)}` : ''}`}
                </span>
              ) : isSshProject ? (
                <span className={styles.workspacePinnedSummaryResourceFacts}>
                  {resources
                    ? `内存 ${formatBytes(resources.memory.availableBytes)} · 磁盘 ${formatBytes(resources.disk.availableBytes)} · ${resources.cpu.logicalCores} 核（指挥席读数，非 ${sshHostName}）`
                    : `${sshHostName} 远程资源快照待接入`}
                </span>
              ) : (
                resources && (
                  <span className={styles.workspacePinnedSummaryResourceFacts}>
                    内存 {formatBytes(resources.memory.availableBytes)} · 磁盘 {formatBytes(resources.disk.availableBytes)} · {resources.cpu.logicalCores} 核
                  </span>
                )
              )}
            </div>
          </div>
        </section>
      </div>
    </aside>
  );
}); // BLOCK-161 W4-1：React.memo——父级重渲（流式 tick 等）时 props 不变即整卡 bail-out

function openAgentWindow(task: AgentTaskOverviewItem): void {
  // UI-385 — 子智能体详情改由右栏「智能体」tab 承载（独立窗退役）
  try {
    dispatchPetriEvent(petriEvents.agentOpenInRail, { runId: task.taskId });
  } catch {
    /* 事件通道不可用时静默——卡片是只读投影，不承担交互失败语义 */
  }
}

/** BLOCK-161 W4-1 止血：六路轮询共享单节拍——原 6 个独立 setInterval
 * （5s×4/30s×2/60s×1）各驱动各自 setState，每拍全卡重渲 ×6。现单 interval
 * 驱动 tick 计数，各 hook 按自身周期取模（30s=每 6 拍/60s=每 12 拍），
 * 行为等价（首次立即 load 不变）而定时器 6→1。 */
function useSummaryHeartbeat(enabled: boolean, tickMs = 5000): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!enabled) return undefined;
    const timer = window.setInterval(() => setTick((t) => t + 1), tickMs);
    return () => window.clearInterval(timer);
  }, [enabled, tickMs]);
  return tick;
}

/** BLOCK-78 P1⑤：项目内子 agent 俯瞰（复用 listAgentTasks + projectId 过滤，
 *  同 BLOCK-65 语义；无内容返回空数组 → 卡片整节不渲染）。 */
function useProjectAgentOverview(projectId: string | null, enabled: boolean, tick: number): AgentTaskOverviewItem[] {
  const [rows, setRows] = useState<AgentTaskOverviewItem[]>([]);
  useEffect(() => {
    if (!enabled || !projectId) return;
    let alive = true;
    const load = () => {
      listAgentTasks(50)
        .then((tasks) => {
          if (!alive) return;
          // UI-432（BLOCK-109 P4）— 孤儿任务（无 projectId，多为 API 直连调试产物）不再
          // 计入每个项目的智能体图标带：此前 !projectId 兜底使同一批孤儿泄漏进所有项目
          // （用户实测「18 个智能体」= 6 真实 + 12 孤儿）。
          setRows(tasks.filter((t) => t.projectId === projectId));
        })
        .catch(() => {
          if (alive) setRows([]);
        });
    };
    load();
    return () => {
      alive = false;
    };
  }, [enabled, projectId, tick]); // BLOCK-161 W4-1：节拍驱动（5s 档每拍）
  return rows;
}

/** BLOCK-78 P2-②：项目级成本/Token 汇总（/api/ai/usage-project，ai_usage
 *  conversation 归因项目口径的只读聚合）。获取失败按 null 处理 → 行不渲染，
 *  不伪造用量；30s 慢刷新（成本非实时关键面）。 */
interface ProjectUsageSummary {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostCny: number;
  costStatus: 'partial' | 'estimated';
}

function useProjectUsage(projectId: string | null, enabled: boolean, tick: number): ProjectUsageSummary | null {
  const [usage, setUsage] = useState<ProjectUsageSummary | null>(null);
  useEffect(() => {
    if (!enabled || !projectId) return;
    let alive = true;
    const load = async () => {
      try {
        const token = getToken();
        const resp = await fetch(
          `${getPlatformApiPrefix()}/ai/usage-project?projectId=${encodeURIComponent(projectId)}`,
          { headers: token ? { Authorization: `Bearer ${token}` } : undefined }
        );
        const body = (await resp.json().catch(() => null)) as (ProjectUsageSummary & { status?: unknown }) | null;
        if (!alive) return;
        setUsage(body && body.status === 'ok' ? body : null);
      } catch {
        if (alive) setUsage(null);
      }
    };
    void load();
    return () => {
      alive = false;
    };
  }, [enabled, projectId, tick]); // BLOCK-161 W4-1：节拍驱动（30s 档每 6 拍）
  return usage;
}

/** BLOCK-78 P2-③：结果库占用（done 作业数 + 产物字节；后端 60s TTL 合并
 *  缓存，local 遍历限深限文件、ssh 单次 du -sb）。获取失败 null → 行不渲染。 */
interface ProjectStorageSummary {
  jobs: number;
  bytes: number;
  observedAt: string;
  stale?: boolean;
}

function useProjectStorage(projectId: string | null, enabled: boolean, tick: number): ProjectStorageSummary | null {
  const [storage, setStorage] = useState<ProjectStorageSummary | null>(null);
  useEffect(() => {
    if (!enabled || !projectId) return;
    let alive = true;
    const load = async () => {
      try {
        const token = getToken();
        const resp = await fetch(
          `${getPlatformApiPrefix()}/harness/project-storage?projectId=${encodeURIComponent(projectId)}`,
          { headers: token ? { Authorization: `Bearer ${token}` } : undefined }
        );
        const body = (await resp.json().catch(() => null)) as (ProjectStorageSummary & { ok?: unknown }) | null;
        if (!alive) return;
        setStorage(body && body.ok ? body : null);
      } catch {
        if (alive) setStorage(null);
      }
    };
    void load();
    return () => {
      alive = false;
    };
  }, [enabled, projectId, tick]); // BLOCK-161 W4-1：节拍驱动（60s 档每 12 拍）
  return storage;
}

/** BLOCK-78 P2-⑤：跨会话持久通知未读数（失败终态等事件的项目作用域留痕；
 *  重启/切项目后仍可读——这是它与投影型注意信号的本质区别）。30s 慢轮询 +
 *  标记已读后立刷。 */
function useProjectNoticeUnread(projectId: string | null, enabled: boolean, refreshKey: number, tick: number): number {
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    if (!enabled || !projectId) return;
    let alive = true;
    const load = async () => {
      try {
        const token = getToken();
        const resp = await fetch(
          `${getPlatformApiPrefix()}/harness/notices?projectId=${encodeURIComponent(projectId)}&unread=1`,
          { headers: token ? { Authorization: `Bearer ${token}` } : undefined }
        );
        const body = (await resp.json().catch(() => null)) as { ok?: unknown; unread?: unknown } | null;
        if (alive) setUnread(body && body.ok ? Number(body.unread) || 0 : 0);
      } catch {
        if (alive) setUnread(0);
      }
    };
    void load();
    return () => {
      alive = false;
    };
  }, [enabled, projectId, refreshKey, tick]); // BLOCK-161 W4-1：节拍驱动（30s 档每 6 拍；refreshKey 立刷保留）
  return unread;
}

async function markNoticesSeen(projectId: string | null): Promise<void> {
  if (!projectId) return;
  try {
    const token = getToken();
    await fetch(`${getPlatformApiPrefix()}/harness/notices/seen`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ projectId }),
    });
  } catch { /* 已读标记失败不打扰用户 */ }
}

/** BLOCK-78 P2-④：会话级注意信号——待确认计划（draft + 待修订，BLOCK-55 链）
 *  与异常退出后台进程（BLOCK-34 表，failed/orphaned 两态算异常，exited 是
 *  正常终态）。信号源不可得按 0 处理，不伪造告警；零待办返回 0 → 不渲染。
 *  P2-④：listBackgroundProcesses 携带 projectId——后端按项目形态路由
 *  （ssh 项目读节点注册表，local 读本地表）。 */
function useConversationAttention(
  conversationId: string | null,
  projectId: string | null,
  enabled: boolean,
  tick: number
): { pendingPlans: number; abnormalProcesses: number } {
  const [attention, setAttention] = useState({ pendingPlans: 0, abnormalProcesses: 0 });
  useEffect(() => {
    if (!enabled || !conversationId) return;
    let alive = true;
    const load = () => {
      void Promise.all([
        fetchDraftPlansForConversation(conversationId).catch(() => []),
        fetchPlansWithPendingRevision(conversationId).catch(() => []),
        listBackgroundProcesses(conversationId, projectId).catch(() => null),
      ]).then(([drafts, revisions, processes]) => {
        if (!alive) return;
        setAttention({
          pendingPlans: (Array.isArray(drafts) ? drafts.length : 0)
            + (Array.isArray(revisions) ? revisions.length : 0),
          abnormalProcesses: (processes ?? []).filter(
            (p) => p.status === 'failed' || p.status === 'orphaned'
          ).length,
        });
      });
    };
    void load();
    return () => {
      alive = false;
    };
  }, [enabled, conversationId, projectId, tick]); // BLOCK-161 W4-1：节拍驱动（5s 档每拍）
  return attention;
}

/** BLOCK-78 P1⑥：终端投影——读既有 terminal:listSessions IPC（BLOCK-54），
 *  只读计数；无会话返回空 → 不渲染。零状态上提。 */function useTerminalSessions(
  enabled: boolean,
  tick: number
): Array<{ sessionId: string; pid: number; cwd: string; running: boolean }> {
  const [sessions, setSessions] = useState<Array<{ sessionId: string; pid: number; cwd: string; running: boolean }>>([]);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const load = () => {
      try {
        const bridge = getBridge('terminal');
        void Promise.resolve(bridge?.listSessions?.())
          .then((body) => {
            if (!alive) return;
            setSessions(Array.isArray(body?.sessions) ? body.sessions : []);
          })
          .catch(() => {
            if (alive) setSessions([]);
          });
      } catch {
        if (alive) setSessions([]);
      }
    };
    load();
    return () => {
      alive = false;
    };
  }, [enabled, tick]); // BLOCK-161 W4-1：节拍驱动（5s 档每拍）
  return sessions;
}

/** BLOCK-78 P1④：执行位置标注——ssh 项目一律远程@host；local 项目带
 *  execution_target_id（BLOCK-57 语义）为远程执行，否则本机。 */
function jobLocationLabel(project: Project | null | undefined, job: ToolJob): string {
  if (project?.workspaceKind === 'ssh') return `远程 · ${project.sshHost || 'SSH'}`;
  if (job.execution_target_id) return '远程执行';
  return '本机';
}

/** BLOCK-78 P1⑩：空任务态按项目资产状态给下一步指引（有数据没会话 → 发起
 *  对话；没数据 → 先上传；其余保持原话）。 */
function emptyTaskHint(datasets: Dataset[], conversations: ConversationSummary[]): string {
  if (datasets.length === 0) return '还没有数据集——先上传数据，任务从这里开始';
  if (conversations.length === 0) return '发起第一条对话，或从「分析」选择工具开始';
  return '会话任务与后台任务会显示在这里';
}

function modalityLabel(modality: string): string {
  // BLOCK-83 D1：不再内置领域标签表；仅 'general' 有核心语义，其余原样显示。
  return modality === 'general' ? '通用' : modality;
}

function agentTaskStatusLabel(status: string): string {
  return {
    pending: '排队中',
    running: '运行中',
    completed: '已完成',
    failed: '失败',
    cancelled: '已取消',
  }[status] || status;
}

function headText(text: string, max: number): string {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max)}…` : t || '（无描述）';
}

function formatBytes(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '未知';
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(1)} GB`;
  return `${(value / 1024 ** 2).toFixed(0)} MB`;
}

/** stale 读数的观测时间（HH:mm:ss）——诚实呈现「这是历史读数」。 */
function formatObservedAt(observedAt?: string): string {
  const t = observedAt ? new Date(observedAt) : null;
  return t && !Number.isNaN(t.getTime())
    ? t.toLocaleTimeString('zh-CN', { hour12: false })
    : '未知时间';
}

function RuntimeStatusChip({
  label,
  runtimeReady,
  serverUp,
  downReason,
}: {
  label: string;
  runtimeReady: boolean;
  /** 独立 HTTP 后端进程是否在线；Python 执行已并入 petri-server（BLOCK-30），
   *  Py chip 不传该 prop，仅展示运行时安装状态。 */
  serverUp?: boolean;
  downReason?: string | null;
}): React.ReactElement {
  const hasServer = serverUp !== undefined;
  const state = !hasServer
    ? runtimeReady ? 'online' : 'missing'
    : serverUp ? 'online' : runtimeReady ? 'offline' : 'missing';
  const stateLabel = !hasServer
    ? runtimeReady ? '运行时就绪' : '运行时未安装'
    : serverUp ? '后端运行中' : runtimeReady ? '后端未启动' : '运行时未安装';
  return (
    <span
      className={styles.workspacePinnedSummaryRuntimeChip}
      data-state={state}
      title={`${label} ${stateLabel}${downReason && serverUp === false ? `：${downReason}` : ''}`}
    >
      <i />
      {label}
    </span>
  );
}

function workflowStageLabel(stage: string): string {
  return {
    inspect: '检查',
    infer: '识别',
    select: '选择',
    repair: '修复',
    confirm: '确认',
    run: '运行',
    verify: '校验',
    report: '报告',
  }[stage] || stage;
}

function workflowStatusLabel(status: string): string {
  return {
    pending: '等待中',
    in_progress: '进行中',
    completed: '已完成',
    needs_review: '需检查',
    blocked: '已阻塞',
    failed: '失败',
    cancelled: '已取消',
  }[status] || status;
}
