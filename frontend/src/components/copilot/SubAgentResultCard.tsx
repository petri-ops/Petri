import React, { useMemo, useState } from 'react';
import { Icon } from '@/components/icons/Icon';
import { dispatchGewuEvent, gewuEvents } from '@/lib/events';
import styles from './SubAgentResultCard.module.css';

/**
 * UI-408 — 子智能体终态结果内联卡（借鉴 ZCode「结果即消息」呈现层）。
 *
 * 父会话流内直接呈现子智能体交的作业：状态 + 已工作时长 + 任务需求 + 终态
 * 摘要（可展开）+「查看详情」跳右栏智能体面板（agentOpenInRail，长任务运营
 * 面不丢失——留言/续派/派生链仍在）。
 *
 * 数据源 = 服务端真相轮询（/api/ai/agent/tasks?conversationId= 投影，含
 * summaryHead）——确定性覆盖「父会话先结束、子任务后完成」「页面刷新」等
 * 全部时序；不再依赖易丢失的即时通知与内存快照。
 */

export interface SubAgentCardData {
  taskId: string;
  taskText: string;
  status: string;
  createdAt?: string | null;
  finishedAt?: string | null;
  summaryHead?: string | null;
}

const STATUS_LABEL: Record<string, string> = {
  completed: '已完成',
  done: '已完成',
  failed: '失败',
  error: '失败',
  cancelled: '已取消',
  stopped: '已取消',
  running: '运行中',
};

function formatDuration(ms: number): string {
  const sec = Math.max(1, Math.round(ms / 1000));
  if (sec < 90) return `${sec} 秒`;
  return `${Math.round(sec / 60)} 分钟`;
}

const SUMMARY_PREVIEW_CHARS = 120;

function useDurationLabel(createdAt?: string | null, finishedAt?: string | null): string | null {
  return useMemo(() => {
    const start = createdAt ? Date.parse(createdAt) : NaN;
    const end = finishedAt ? Date.parse(finishedAt) : NaN;
    if (Number.isNaN(start)) return null;
    return formatDuration((Number.isNaN(end) ? Date.now() : end) - start);
  }, [createdAt, finishedAt]);
}

export function SubAgentResultCard({ data }: { data: SubAgentCardData }): React.ReactElement {
  const [expanded, setExpanded] = useState(false);

  const statusLabel = STATUS_LABEL[data.status] || data.status;
  const summary = data.summaryHead || '';
  const summaryPreview = summary.length > SUMMARY_PREVIEW_CHARS
    ? `${summary.slice(0, SUMMARY_PREVIEW_CHARS)}…`
    : summary;
  const durationLabel = useDurationLabel(data.createdAt, data.finishedAt);

  return (
    <div className={styles.card} data-testid="subagent-result-card" data-status={data.status}>
      <div className={styles.headRow}>
        <span className={styles.statusChip} data-status={data.status}>{statusLabel}</span>
        {durationLabel && <span className={styles.duration}>已工作 {durationLabel}</span>}
        <button
          type="button"
          className={styles.expandBtn}
          aria-expanded={expanded}
          title={expanded ? '收起' : '展开全文'}
          onClick={() => setExpanded((v) => !v)}
        >
          <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={13} />
        </button>
      </div>
      <div className={styles.section}>
        <span className={styles.sectionLabel}>需求</span>
        <div className={styles.text}>{data.taskText || `Agent ${data.taskId.slice(0, 8)}`}</div>
      </div>
      <div className={styles.section}>
        <span className={styles.sectionLabel}>终态摘要（与父会话同源）</span>
        {summary ? (
          <div className={`${styles.text} ${expanded ? '' : styles.clamp}`}>
            {expanded ? summary : summaryPreview}
          </div>
        ) : (
          <div className={styles.text}>（无文本输出）</div>
        )}
      </div>
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.detailBtn}
          onClick={() => dispatchGewuEvent(gewuEvents.agentOpenInRail, { runId: data.taskId })}
          data-testid="subagent-card-detail"
        >
          查看详情
        </button>
      </div>
    </div>
  );
}

export default SubAgentResultCard;
