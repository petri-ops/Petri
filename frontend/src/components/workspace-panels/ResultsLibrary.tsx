import React from 'react';
import { Icon } from '@/components/icons/Icon';
import type { ToolJob } from '@/lib/project-types';
import { formatRelativeTime } from '@/lib/format';
import styles from '@/pages/project-workspace.module.css';

const STATUS_LABELS: Record<ToolJob['status'], string> = {
  pending: '排队中',
  running: '运行中',
  done: '已完成',
  failed: '失败',
  cancelled: '已取消',
};

function jobTitle(job: ToolJob): string {
  return job.name || job.tool_id || job.id;
}

function jobDuration(job: ToolJob): string {
  if (job.status === 'running' || job.status === 'pending') return '进行中';
  if (job.completed_at && job.created_at) {
    const ms = job.completed_at - job.created_at;
    if (ms > 0) {
      const min = Math.floor(ms / 60000);
      const sec = Math.floor((ms % 60000) / 1000);
      return min > 0 ? `耗时 ${min} 分 ${sec} 秒` : `耗时 ${sec} 秒`;
    }
  }
  return '—';
}

export interface ResultsLibraryProps {
  projectId: string | undefined;
  jobs: ToolJob[];
  onOpenJob: (jobId: string) => void;
}

/**
 * UI-148 / T86 — 结果库：已完成（与进行中）分析任务的库式浏览面板，
 * 带元数据（工具名 / 状态 / 起始时间 / 耗时）。作为中心列 result 模式的
 * 默认空态出现：未打开任何具体结果时，用户看到的是整个项目的结果库，
 * 点击任意一项即经 handleOpenResult 打开该结果（切到 result 模式 + 绑定 activeJob）。
 * 仅依赖 props 与 onOpenJob 回调，不持有状态，也不反向依赖 CenterPanel。
 */
export function ResultsLibrary({ projectId, jobs, onOpenJob }: ResultsLibraryProps): React.ReactElement {
  const sorted = React.useMemo(
    () => [...jobs].sort((a, b) => (b.created_at || 0) - (a.created_at || 0)),
    [jobs],
  );

  return (
    <div className={styles.resultsLibrary}>
      <header className={styles.resultsLibraryHeader}>
        <div>
          <strong>结果库</strong>
          <span className={styles.resultsLibraryCount}>{sorted.length} 个分析任务</span>
        </div>
        <Icon name="bar-chart" size={18} />
      </header>
      {sorted.length === 0 ? (
        <div className={styles.resultsLibraryEmpty}>
          这个项目还没有分析结果。从会话中运行分析，结果会出现在这里。
        </div>
      ) : (
        <ul className={styles.resultsLibraryList}>
          {sorted.map((job) => (
            <li key={job.id}>
              <button
                type="button"
                className={styles.resultsLibraryItem}
                onClick={() => onOpenJob(job.id)}
              >
                <span className={styles.resultsLibraryItemMain}>
                  <span className={styles.resultsLibraryItemTitle}>
                    {jobTitle(job)}
                    {job.execution_target_id ? (
                      <span title="此任务在远程执行目标上运行" style={{ marginLeft: 6, fontSize: 11, padding: '0 6px', borderRadius: 999, border: '1px solid currentColor', opacity: 0.75 }}>
                        远程
                      </span>
                    ) : null}
                  </span>
                  <span className={styles.resultsLibraryItemMeta}>
                    {formatRelativeTime(job.created_at)}
                    {' · '}
                    {jobDuration(job)}
                  </span>
                </span>
                <span className={styles.resultsLibraryBadge} data-status={job.status}>
                  {STATUS_LABELS[job.status]}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
