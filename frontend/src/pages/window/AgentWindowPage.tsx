// ============================================================
// AgentWindowPage — BLOCK-59 P4 agent 详情窗（/window/agent/:runId）。
//
// 衔接已收口的 BLOCK-49 spawn 链路：runId = 子 agent 任务 id（tasks.id，
// spawn_agent/wait_agent/list_agents 结果携带的 agentId，活动行「详情窗」
// 入口弹出）。**零第二真相**：数据全部来自 /api/ai/agent/task/:taskId
// 既有 SSE（task_events 回放 + 实时推送，复用 copilotClient
// subscribeAgentTask——与主窗同一订阅路径）；SSE 从 seq 0 全量回放，
// delta 累积即终态摘要（与 wait_agent 摘要同源），时间线展示实时工作流
// （tool_call / tool_result / agent_status / agent_progress）。
// ============================================================
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { WindowShell } from '@/components/window/WindowShell';
import {
  subscribeAgentTask,
  type ToolCallEvent,
  type ToolResultEvent,
} from '@/components/copilot/copilotClient';
import styles from './command-center.module.css';
import shellStyles from '@/components/window/window-shell.module.css';

interface TimelineEntry {
  key: string;
  name: string;
  status: 'running' | 'success' | 'error' | 'denied';
  durationMs?: number;
}

const MAX_TIMELINE = 200;
const MAX_SUMMARY_CHARS = 8000;

type RunState = 'running' | 'done' | 'failed' | 'cancelled';

const STATE_LABEL: Record<RunState, string> = {
  running: '运行中',
  done: '已完成',
  failed: '失败',
  cancelled: '已取消',
};

export function AgentWindowPage(): React.ReactElement {
  const params = useParams<{ runId?: string }>();
  const runId = params.runId || '';
  const [runState, setRunState] = useState<RunState>('running');
  const [statusLine, setStatusLine] = useState('事件流连接中…');
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [summary, setSummary] = useState('');
  const [errorText, setErrorText] = useState('');
  const [streamError, setStreamError] = useState('');

  // 订阅参数经 ref 稳定（避免 effect 重入导致重复订阅）；累积器走 ref，
  // 渲染状态节流提交。
  const summaryRef = useRef('');
  const summaryFlushTimer = useRef<number | null>(null);

  useEffect(() => {
    if (!runId) return;
    let cancelled = false;
    const flushSummary = () => {
      if (summaryFlushTimer.current != null) return;
      summaryFlushTimer.current = window.setTimeout(() => {
        summaryFlushTimer.current = null;
        setSummary(summaryRef.current.slice(0, MAX_SUMMARY_CHARS));
      }, 200);
    };

    const upsertTimeline = (entry: TimelineEntry) => {
      setTimeline((prev) => {
        const index = prev.findIndex((item) => item.key === entry.key);
        if (index >= 0) {
          const next = prev.slice();
          next[index] = { ...next[index], ...entry };
          return next;
        }
        const next = [...prev, entry];
        return next.length > MAX_TIMELINE ? next.slice(next.length - MAX_TIMELINE) : next;
      });
    };

    subscribeAgentTask(runId, {
      messages: [],
      onDelta: (delta: string) => {
        if (cancelled || !delta) return;
        summaryRef.current += delta;
        flushSummary();
      },
      onAgentStatus: (info: { phase: string; message: string }) => {
        if (cancelled) return;
        setStatusLine(info.message || info.phase || statusLine);
      },
      onAgentProgress: (info: { iteration: number; content: string }) => {
        if (cancelled) return;
        setStatusLine(info.content.slice(0, 160));
      },
      onToolCall: (event: ToolCallEvent) => {
        if (cancelled) return;
        upsertTimeline({
          key: event.callId || `${event.name}:${event.traceId || 'legacy'}`,
          name: event.name,
          status: 'running',
        });
      },
      onToolResult: (event: ToolResultEvent) => {
        if (cancelled) return;
        const result = event.toolResult;
        upsertTimeline({
          key: result?.callId || event.name,
          name: result?.tool || event.name,
          status: result?.status === 'error' || result?.status === 'denied' ? result.status : 'success',
          durationMs: result?.durationMs,
        });
      },
      onDone: () => {
        if (cancelled) return;
        setRunState('done');
        setStatusLine('任务完成');
      },
      onError: (err: Error) => {
        if (cancelled) return;
        setRunState('failed');
        setErrorText(err.message || '任务失败');
      },
    }).catch((e: unknown) => {
      if (cancelled) return;
      // 终态已由 onDone/onError 表达；此处仅覆盖流本身断开等异常
      setStreamError(e instanceof Error ? e.message : '事件流连接失败');
    });

    return () => {
      cancelled = true;
      if (summaryFlushTimer.current != null) {
        window.clearTimeout(summaryFlushTimer.current);
        setSummary(summaryRef.current.slice(0, MAX_SUMMARY_CHARS));
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  const timelineView = useMemo(() => timeline.slice(-MAX_TIMELINE), [timeline]);

  const body = (() => {
    if (!runId) {
      return <div className={styles.empty}>窗口键不合法：期望 /window/agent/:runId。</div>;
    }
    return (
      <div className={styles.agentBody}>
        <div className={styles.agentStatusRow}>
          <span className={shellStyles.statusChip} data-status={runState === 'running' ? 'running' : runState === 'failed' ? 'failed' : 'done'}>
            {STATE_LABEL[runState]}
          </span>
          <span className={styles.agentStatusLine}>{statusLine}</span>
        </div>
        {streamError && <div className={styles.loadError} role="alert">事件流断开：{streamError}</div>}
        {errorText && <div className={styles.loadError} role="alert">{errorText}</div>}
        <section className={styles.agentSection}>
          <h3 className={styles.agentSectionTitle}>实时工作流（工具调用时间线）</h3>
          {timelineView.length === 0 ? (
            <div className={styles.empty}>暂无工具调用记录。</div>
          ) : (
            <ul className={styles.timeline}>
              {timelineView.map((item) => (
                <li key={item.key} className={styles.timelineRow} data-status={item.status}>
                  <span className={styles.timelineDot} data-status={item.status} />
                  <code className={styles.timelineName}>{item.name}</code>
                  <span className={styles.timelineStatus}>
                    {item.status === 'running'
                      ? '运行中'
                      : item.status === 'error'
                        ? '失败'
                        : item.status === 'denied'
                          ? '已拒绝'
                          : '完成'}
                    {typeof item.durationMs === 'number' ? ` · ${(item.durationMs / 1000).toFixed(1)}s` : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className={styles.agentSection}>
          <h3 className={styles.agentSectionTitle}>终态摘要（与父会话同源）</h3>
          {summary ? (
            <pre className={styles.agentSummary}>{summary}</pre>
          ) : (
            <div className={styles.empty}>{runState === 'running' ? '等待模型输出…' : '该任务没有文本输出。'}</div>
          )}
        </section>
      </div>
    );
  })();

  return (
    <WindowShell
      title={`Agent ${runId ? runId.slice(0, 8) : ''}`}
      badge="Agent 详情 · 只读投影"
      subtitle={statusLine}
    >
      {body}
    </WindowShell>
  );
}
