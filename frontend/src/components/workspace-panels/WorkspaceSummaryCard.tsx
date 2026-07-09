import React from 'react';
import { Icon } from '@/components/icons/Icon';
import type { ToolJob } from '@/lib/project-types';
import type { ActiveArtifact } from '@/pages/project-workspace';
import styles from '@/pages/project-workspace.module.css';

export interface WorkspaceSummaryCardProps {
  open: boolean;
  visibility: 'hidden' | 'compact' | 'expanded';
  width: number;
  height: number;
  projectName: string;
  projectModality?: string;
  compactWorkspacePath: string;
  activeJob: ToolJob | null;
  activeArtifact: ActiveArtifact | null;
  backendSummary: {
    readyLabel: string;
    serviceItems: { key: string; label: string; status: string }[];
  };
  liveJobsPreview: ToolJob[];
  jobStats: { running: number; failed: number; done: number; pending: number };
  onResize: (event: React.MouseEvent) => void;
  onOpenScheduled: () => void;
  onSelectJob: (id: string) => void;
  onOpenWorkspace: () => void;
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
  height,
  projectName,
  projectModality,
  compactWorkspacePath,
  activeJob,
  activeArtifact,
  backendSummary,
  liveJobsPreview,
  jobStats,
  onResize,
  onOpenScheduled,
  onSelectJob,
  onOpenWorkspace,
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
      style={{ width: `${width}px`, height: `${height}px` }}
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
          <div className={styles.workspacePinnedSummarySectionTitle}>上下文</div>
          <button
            type="button"
            className={styles.workspacePinnedSummaryContext}
            onClick={onOpenWorkspace}
            title={compactWorkspacePath}
          >
            <Icon name="folder" size={14} />
            <span>
              <strong>{projectModality || 'BioF3 项目'}</strong>
              <small>{compactWorkspacePath || '未设置工作目录'}</small>
            </span>
            <Icon name="chevron-right" size={13} />
          </button>
        </section>

        <section className={styles.workspacePinnedSummarySection}>
          <div className={styles.workspacePinnedSummarySectionHeading}>
            <div className={styles.workspacePinnedSummarySectionTitle}>当前活动</div>
            <button type="button" onClick={onOpenScheduled}>查看全部</button>
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
          <div className={styles.workspacePinnedSummarySectionTitle}>正在查看</div>
          {activeArtifact ? (
            <button
              type="button"
              className={styles.workspacePinnedSummarySource}
              onClick={() => onSelectJob(activeArtifact.jobId)}
            >
              <Icon name="pin" size={15} />
              <span className={styles.workspacePinnedSummarySourceLabel}>
                {activeArtifact.label || activeArtifact.name}
              </span>
              <span className={styles.workspacePinnedSummarySourceValue}>
                {activeArtifact.type}
              </span>
            </button>
          ) : (
            <div className={styles.workspacePinnedSummarySourceEmpty}>尚未打开结果或文件</div>
          )}
        </section>

        <div className={styles.workspacePinnedSummaryFooter}>
          <span title={backendSummary.serviceItems.map((item) => `${item.label}: ${item.status}`).join(' · ')}>
            <i data-ready={backendSummary.readyLabel.includes('已就绪')} />
            {backendSummary.readyLabel}
          </span>
          <span>{runningCount} 运行中</span>
          <span>{totalCount} 次运行</span>
        </div>
        <button
          type="button"
          className={styles.workspacePinnedSummaryResizeHandle}
          onPointerDown={onResize}
          title="拖拽调整摘要卡大小"
          aria-label="拖拽调整摘要卡大小"
        />
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