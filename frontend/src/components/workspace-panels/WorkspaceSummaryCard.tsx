import React from 'react';
import { Icon } from '@/components/icons/Icon';
import type { ToolJob } from '@/lib/project-types';
import type { HarnessWorkflowJobState } from '@/lib/harness-client';
import type { BackendStatus } from '@/lib/electron';
import styles from '@/pages/project-workspace.module.css';

export interface WorkspaceSummaryCardProps {
  open: boolean;
  visibility: 'hidden' | 'compact' | 'expanded';
  width?: number;
  projectName: string;
  activeJob: ToolJob | null;
  workflow: HarnessWorkflowJobState | null;
  recentJobs: ToolJob[];
  liveJobsPreview: ToolJob[];
  jobStats: { running: number; failed: number; done: number; pending: number };
  backendStatus: BackendStatus;
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
 */
export function WorkspaceSummaryCard({
  open,
  visibility,
  width,
  projectName,
  activeJob,
  workflow,
  recentJobs,
  liveJobsPreview,
  jobStats,
  backendStatus,
  onOpenScheduled,
  onSelectJob,
}: WorkspaceSummaryCardProps): React.ReactElement | null {
  if (visibility === 'hidden') return null;

  const currentJob = activeJob || liveJobsPreview[0] || null;
  const currentJobStatus: ToolJob['status'] = workflow?.jobStatus === 'completed'
    ? 'done'
    : workflow?.jobStatus === 'failed' || workflow?.jobStatus === 'cancelled'
      ? 'failed'
      : workflow?.jobStatus === 'running'
        ? 'running'
        : workflow?.jobStatus === 'pending' || workflow?.jobStatus === 'queued'
          ? 'pending'
          : currentJob?.status || 'pending';
  const runningCount = jobStats.running + jobStats.pending;
  const totalCount = runningCount + jobStats.done + jobStats.failed;
  const statusLabel =
    currentJobStatus === 'done'
      ? '已完成'
      : currentJobStatus === 'failed'
        ? '失败'
        : currentJobStatus === 'running'
          ? '运行中'
          : currentJob
            ? '等待中'
            : '空闲';

  if (!open) return null;

  return (
    <aside
      className={`${styles.workspacePinnedSummary} ${
        visibility === 'compact' ? styles.workspacePinnedSummaryCompactMode : ''
      }`}
      style={width ? { width: `${width}px` } : undefined}
      aria-label="会话摘要"
    >
      <div className={styles.workspacePinnedSummaryTopBar}>
        <div className={styles.workspacePinnedSummaryTopBarLeft}>
          <div className={styles.workspacePinnedSummaryHeaderText}>
            <div className={styles.workspacePinnedSummaryEyebrow}>SESSION SUMMARY</div>
            <div className={styles.workspacePinnedSummaryTitleRow}>
              <div className={styles.workspacePinnedSummaryTitle}>{projectName}</div>
              <span
                className={styles.workspacePinnedSummaryStatus}
                data-status={currentJob ? currentJobStatus : 'idle'}
              >
                <span />
                {statusLabel}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className={styles.workspacePinnedSummaryBody}>
        <section className={styles.workspacePinnedSummarySection}>
          <div className={styles.workspacePinnedSummarySectionHeading}>
            <div className={styles.workspacePinnedSummarySectionTitle}>当前活动</div>
            <button type="button" onClick={onOpenScheduled}>分析记录</button>
          </div>
          {currentJob ? (
            <button
              type="button"
              className={styles.workspacePinnedSummaryActivity}
              onClick={() => onSelectJob(currentJob.id)}
            >
              <span
                className={styles.workspacePinnedSummaryActivityIcon}
                data-status={currentJobStatus}
              >
                <Icon name={currentJobStatus === 'failed' ? 'flag' : 'terminal'} size={14} />
              </span>
              <span className={styles.workspacePinnedSummaryActivityText}>
                <strong>{currentJob.name || currentJob.tool_id}</strong>
                <small>{statusLabel} · {formatDate(currentJob.created_at)}</small>
              </span>
              <Icon name="chevron-right" size={13} />
            </button>
          ) : (
            <div className={styles.workspacePinnedSummaryEmpty}>
              <Icon name="check" size={15} />
              当前没有运行中的任务
            </div>
          )}
        </section>

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

        <section className={styles.workspacePinnedSummarySection}>
          <div className={styles.workspacePinnedSummarySectionHeading}>
            <div className={styles.workspacePinnedSummarySectionTitle}>最近分析</div>
            <button type="button" onClick={onOpenScheduled}>查看全部</button>
          </div>
          <div className={styles.workspacePinnedSummaryHistory}>
            {(recentJobs.length > 0 ? recentJobs : liveJobsPreview).slice(0, workflow ? 2 : 3).map((job) => {
              const statusLabel =
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
                    <small>{statusLabel} · {formatDate(job.created_at)}</small>
                  </span>
                  <Icon name="chevron-right" size={13} />
                </button>
              );
            })}
          </div>
        </section>

        <div className={styles.workspacePinnedSummaryFooter}>
          <span className={styles.workspacePinnedSummaryRuntimes} aria-label="后端运行状态">
            <RuntimeStatusChip
              label="R"
              runtimeReady={backendStatus.rRuntime}
              serverUp={backendStatus.rServerUp}
              downReason={backendStatus.downReason}
            />
            <RuntimeStatusChip
              label="Py"
              runtimeReady={backendStatus.pyRuntime}
              serverUp={backendStatus.pyServerUp}
            />
          </span>
          <span>{runningCount} 运行中 · {totalCount} 次</span>
        </div>
      </div>
    </aside>
  );
}

function RuntimeStatusChip({
  label,
  runtimeReady,
  serverUp,
  downReason,
}: {
  label: string;
  runtimeReady: boolean;
  serverUp: boolean;
  downReason?: string | null;
}): React.ReactElement {
  const state = serverUp ? 'online' : runtimeReady ? 'offline' : 'missing';
  const stateLabel = serverUp ? '后端运行中' : runtimeReady ? '后端未启动' : '运行时未安装';
  return (
    <span
      className={styles.workspacePinnedSummaryRuntimeChip}
      data-state={state}
      title={`${label} ${stateLabel}${downReason && !serverUp ? `：${downReason}` : ''}`}
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

// Local copy of formatDate — duplicated from project-workspace.tsx to avoid a
// circular import. The helper is tiny and stable; a future shared utils
// module can hold it once.
function formatDate(ts: string | number): string {
  const d = typeof ts === 'number' ? new Date(ts) : new Date(ts);
  if (isNaN(d.getTime())) return String(ts);
  return d.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
