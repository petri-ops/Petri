import React from 'react';
import { Icon } from '@/components/icons/Icon';
import type { ToolJob } from '@/lib/project-types';
import styles from '@/pages/project-workspace.module.css';

export interface WorkspaceSummaryCardProps {
  open: boolean;
  visibility: 'hidden' | 'compact' | 'expanded';
  width?: number;
  projectName: string;
  activeJob: ToolJob | null;
  recentJobs: ToolJob[];
  backendSummary: {
    serviceItems: { key: string; label: string; status: string }[];
  };
  liveJobsPreview: ToolJob[];
  jobStats: { running: number; failed: number; done: number; pending: number };
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
  recentJobs,
  backendSummary,
  liveJobsPreview,
  jobStats,
  onOpenScheduled,
  onSelectJob,
}: WorkspaceSummaryCardProps): React.ReactElement | null {
  if (visibility === 'hidden') return null;

  const currentJob = activeJob || liveJobsPreview[0] || null;
  const runningCount = jobStats.running + jobStats.pending;
  const totalCount = runningCount + jobStats.done + jobStats.failed;
  const statusLabel =
    currentJob?.status === 'done'
      ? '已完成'
      : currentJob?.status === 'failed'
        ? '失败'
        : currentJob?.status === 'running'
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
                data-status={currentJob?.status || 'idle'}
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
                data-status={currentJob.status}
              >
                <Icon name={currentJob.status === 'failed' ? 'flag' : 'terminal'} size={14} />
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

        <section className={styles.workspacePinnedSummarySection}>
          <div className={styles.workspacePinnedSummarySectionHeading}>
            <div className={styles.workspacePinnedSummarySectionTitle}>最近分析</div>
            <button type="button" onClick={onOpenScheduled}>查看全部</button>
          </div>
          <div className={styles.workspacePinnedSummaryHistory}>
            {(recentJobs.length > 0 ? recentJobs : liveJobsPreview).slice(0, 3).map((job) => {
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
          {backendSummary.serviceItems.map((item) => (
            <span
              key={item.key}
              title={`${item.label}: ${item.status === 'runtime' ? '已就绪' : '未安装'}`}
            >
              <i data-ready={item.status === 'runtime'} />
              {item.label} {item.status === 'runtime' ? '已就绪' : '未安装'}
            </span>
          ))}
          <span>{runningCount} 运行中</span>
          <span>{totalCount} 次运行</span>
        </div>
      </div>
    </aside>
  );
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
