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
//
// BLOCK-65 P1-a 交互补全（此前只读投影）：
//   - 中断：运行中可见，两步确认 → 既有 cancel REST（级联语义）；
//   - 留言：队列语义诚实标注（task_actions message——运行中不即时注入，
//     续派时作为上下文注入）；
//   - 继续派：终态后可见（followup——沿用父链/模型/权限，成功后自动弹
//    出新 agent 专属窗）。
// 窗口标题带 task 描述前缀（meta 接口，BLOCK-65 P1-b）。
// ============================================================
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { WindowShell } from '@/components/window/WindowShell';
import { getBridge } from '@/lib/desktopBridge';
import {
  subscribeAgentTask,
  cancelAgentTask,
  fetchAgentTaskMeta,
  sendAgentTaskMessage,
  followupAgentTask,
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

function runStateFromStatus(status: string | null | undefined): RunState {
  if (status === 'completed' || status === 'done') return 'done';
  if (status === 'failed') return 'failed';
  if (status === 'cancelled') return 'cancelled';
  return 'running';
}

function headText(text: string, max = 24): string {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max)}…` : t || '';
}

export function AgentWindowPage(): React.ReactElement {
  const params = useParams<{ runId?: string }>();
  const runId = params.runId || '';
  const [runState, setRunState] = useState<RunState>('running');
  const [statusLine, setStatusLine] = useState('事件流连接中…');
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [summary, setSummary] = useState('');
  const [errorText, setErrorText] = useState('');
  const [streamError, setStreamError] = useState('');
  const [titlePrefix, setTitlePrefix] = useState('');
  const [actionNote, setActionNote] = useState('');
  const [actionError, setActionError] = useState('');
  const [interruptArmed, setInterruptArmed] = useState(false);
  const [messageDraft, setMessageDraft] = useState('');
  const [messageSending, setMessageSending] = useState(false);
  const [followupDraft, setFollowupDraft] = useState('');
  const [followupSending, setFollowupSending] = useState(false);

  // 订阅参数经 ref 稳定（避免 effect 重入导致重复订阅）；累积器走 ref，
  // 渲染状态节流提交。
  const summaryRef = useRef('');
  const summaryFlushTimer = useRef<number | null>(null);

  // BLOCK-65 P1-a：meta 拉取——窗口标题带 task 描述 + 权威初始状态
  //（补只读投影时代开窗即终态任务状态不准的问题）。
  useEffect(() => {
    if (!runId) return;
    let alive = true;
    void fetchAgentTaskMeta(runId)
      .then((meta) => {
        if (!alive) return;
        const prefix = headText(meta.taskText);
        if (prefix) setTitlePrefix(prefix);
        setRunState(runStateFromStatus(meta.status));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [runId]);

  // 两步中断的武装态 3s 自动解除
  useEffect(() => {
    if (!interruptArmed) return;
    const timer = window.setTimeout(() => setInterruptArmed(false), 3000);
    return () => window.clearTimeout(timer);
  }, [interruptArmed]);

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

  const handleInterrupt = useCallback(async () => {
    if (!runId || !interruptArmed) return;
    setActionError('');
    setActionNote('');
    setInterruptArmed(false);
    try {
      await cancelAgentTask(runId);
      setActionNote('中断请求已发出：子 agent 将在下一个取消检查点让出（级联覆盖其派生链）。');
      setRunState('cancelled');
      setStatusLine('已请求中断');
    } catch (e) {
      setActionError(e instanceof Error ? e.message : '中断失败');
    }
  }, [runId, interruptArmed]);

  const handleSendMessage = useCallback(async () => {
    const text = messageDraft.trim();
    if (!runId || !text || messageSending) return;
    setMessageSending(true);
    setActionError('');
    setActionNote('');
    try {
      const result = await sendAgentTaskMessage(runId, text);
      setActionNote(result.note);
      setMessageDraft('');
    } catch (e) {
      setActionError(e instanceof Error ? e.message : '留言失败');
    } finally {
      setMessageSending(false);
    }
  }, [runId, messageDraft, messageSending]);

  const handleFollowup = useCallback(async () => {
    const text = followupDraft.trim();
    if (!runId || !text || followupSending) return;
    setFollowupSending(true);
    setActionError('');
    setActionNote('');
    try {
      const result = await followupAgentTask(runId, text);
      setActionNote(`已续派为新子 agent ${result.agentId.slice(0, 8)}（沿用父链/模型/权限），专属窗已自动打开。`);
      setFollowupDraft('');
      const wm = getBridge('windowManager');
      if (wm) void wm.popOut('agent', result.agentId);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : '续派失败');
    } finally {
      setFollowupSending(false);
    }
  }, [runId, followupDraft, followupSending]);

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
        {actionNote && <div className={styles.drillNote} role="status">{actionNote}</div>}
        {actionError && <div className={styles.loadError} role="alert">{actionError}</div>}

        {/* BLOCK-65 P1-a — 交互区（此前只读投影） */}
        <section className={styles.agentSection} data-testid="agent-window-actions">
          <h3 className={styles.agentSectionTitle}>操作</h3>
          <div className={styles.actionBar}>
            {runState === 'running' && (
              interruptArmed ? (
                <button
                  type="button"
                  className={styles.cancelArmBtn}
                  onClick={() => void handleInterrupt()}
                  title="再次点击确认中断（3 秒后自动还原）；级联覆盖该 agent 派生链"
                >
                  确认中断？
                </button>
              ) : (
                <button
                  type="button"
                  className={styles.actionBtn}
                  onClick={() => setInterruptArmed(true)}
                >
                  中断
                </button>
              )
            )}
          </div>
          {runState === 'running' && (
            <div className={styles.composer}>
              <textarea
                className={styles.composerInput}
                value={messageDraft}
                onChange={(e) => setMessageDraft(e.target.value)}
                placeholder="给这个 agent 留言（队列语义：运行中不即时注入，将在「继续派」续派时作为上下文注入）"
                rows={2}
              />
              <button
                type="button"
                className={styles.actionBtn}
                disabled={!messageDraft.trim() || messageSending}
                onClick={() => void handleSendMessage()}
              >
                {messageSending ? '入队中…' : '留言'}
              </button>
            </div>
          )}
          {(runState === 'done' || runState === 'failed' || runState === 'cancelled') && (
            <div className={styles.composer}>
              <textarea
                className={styles.composerInput}
                value={followupDraft}
                onChange={(e) => setFollowupDraft(e.target.value)}
                placeholder="追加新任务（基于前情续派：沿用父链 / 模型 / 权限，成功后自动打开新专属窗）"
                rows={2}
              />
              <button
                type="button"
                className={styles.actionBtn}
                disabled={!followupDraft.trim() || followupSending}
                onClick={() => void handleFollowup()}
              >
                {followupSending ? '续派中…' : '继续派'}
              </button>
            </div>
          )}
        </section>

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
      title={titlePrefix ? `Agent · ${titlePrefix}` : `Agent ${runId ? runId.slice(0, 8) : ''}`}
      badge="Agent 专属窗 · 实时投影 + 交互"
      subtitle={statusLine}
    >
      {body}
    </WindowShell>
  );
}
