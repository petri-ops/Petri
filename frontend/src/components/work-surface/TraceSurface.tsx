import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '@/components/icons/Icon';
import { StatusBadge } from '@/components/ui/controls/Status';
import { projectExecutionAxis } from '@/lib/statusProjection';
import { formatToolDuration } from '@/components/copilot/toolActivity';
import {
  fetchTrajectory,
  type TrajectoryEvent,
  type TrajectoryGroup,
  type TrajectoryResponse,
} from '@/lib/trajectoryClient';
import buttonStyles from '@/components/ui/controls/button.module.css';
import styles from './TraceSurface.module.css';

const PAGE_LIMIT = 200;
const POLL_MS = 2000;
const MAX_LOADED = 2000;

const GROUPS: ReadonlyArray<{ id: 'all' | TrajectoryGroup; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'tool', label: '工具' },
  { id: 'text', label: '文本' },
  { id: 'reasoning', label: '思考' },
  { id: 'error', label: '错误' },
  { id: 'compaction', label: '压缩' },
  { id: 'user', label: '用户' },
  { id: 'assistant', label: '助手' },
  { id: 'system', label: '系统' },
];

const GROUP_LABEL: Record<TrajectoryGroup, string> = {
  tool: '工具',
  text: '文本',
  reasoning: '思考',
  error: '错误',
  compaction: '压缩',
  user: '用户',
  assistant: '助手',
  system: '系统',
};

function isFailure(event: TrajectoryEvent): boolean {
  return (
    event.group === 'error'
    || event.status === 'error'
    || event.status === 'denied'
    || event.status === 'timeout'
    || event.status === 'cancelled'
  );
}

function formatClock(at: string | null): string {
  if (!at) return '—';
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleTimeString('zh-CN', { hour12: false });
}

function formatDuration(data: TrajectoryResponse | null): string {
  const task = data?.task;
  if (!task) return '—';
  if (task.status === 'running') return '进行中';
  if (!task.createdAt || !task.finishedAt) return '未记录';
  const start = new Date(task.createdAt).getTime();
  const end = new Date(task.finishedAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return '未记录';
  return formatToolDuration(end - start) || '未记录';
}

function mergeEvents(previous: TrajectoryEvent[], next: TrajectoryEvent[]): TrajectoryEvent[] {
  if (next.length === 0) return previous;
  const seen = new Set(previous.map((event) => event.seq));
  const added = next.filter((event) => !seen.has(event.seq));
  return added.length === 0 ? previous : [...previous, ...added];
}

interface FeedState {
  data: TrajectoryResponse | null;
  loading: boolean;
  error: string | null;
}

export function TraceSurface({
  conversationId,
  onOpenIo,
}: {
  conversationId: string | null;
  onOpenIo?: () => void;
}): React.ReactElement {
  const [state, setState] = useState<FeedState>({ data: null, loading: false, error: null });
  const [group, setGroup] = useState<'all' | TrajectoryGroup>('all');
  const [follow, setFollow] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  const [focusSeq, setFocusSeq] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const nextAfterSeqRef = useRef(0);

  useEffect(() => {
    if (!conversationId) {
      setState({ data: null, loading: false, error: null });
      return undefined;
    }
    let cancelled = false;
    const controller = new AbortController();
    setState((prev) => ({ ...prev, loading: true, error: null }));
    void fetchTrajectory({ conversationId, limit: PAGE_LIMIT, signal: controller.signal })
      .then((data) => {
        if (cancelled) return;
        nextAfterSeqRef.current = data.nextAfterSeq;
        setState({ data, loading: false, error: null });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState({ data: null, loading: false, error: error instanceof Error ? error.message : 'trajectory_failed' });
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [conversationId, reloadTick]);

  const running = state.data?.task?.status === 'running';

  useEffect(() => {
    if (!conversationId || !running) return undefined;
    let cancelled = false;
    const timer = setInterval(() => {
      void fetchTrajectory({ conversationId, afterSeq: nextAfterSeqRef.current, limit: PAGE_LIMIT })
        .then((next) => {
          if (cancelled) return;
          nextAfterSeqRef.current = next.nextAfterSeq;
          setState((prev) => {
            if (!prev.data) return prev;
            const events = mergeEvents(prev.data.events, next.events);
            return {
              data: {
                ...prev.data,
                events: events.slice(-MAX_LOADED),
                task: next.task ?? prev.data.task,
                stats: next.stats ?? prev.data.stats,
                nextAfterSeq: next.nextAfterSeq,
                availability: next.availability === 'no_events' ? prev.data.availability : next.availability,
              },
              loading: false,
              error: null,
            };
          });
        })
        .catch(() => {
          /* 轮询失败不覆盖已有数据：下一轮继续；状态由任务终态收口 */
        });
    }, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [conversationId, running]);

  const events = state.data?.events ?? [];
  const failureCount = useMemo(() => events.filter(isFailure).length, [events]);
  const counts = useMemo(() => {
    const next: Record<string, number> = { all: events.length };
    for (const event of events) next[event.group] = (next[event.group] || 0) + 1;
    // 「错误」是失败镜头：包含 group=error 与 status 非 success 的工具行（两者都算失败）。
    next.error = failureCount;
    return next;
  }, [events, failureCount]);
  const filtered = useMemo(() => {
    if (group === 'all') return events;
    if (group === 'error') return events.filter(isFailure);
    return events.filter((event) => event.group === group);
  }, [events, group]);

  useEffect(() => {
    if (!follow) return;
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [follow, filtered.length]);

  const handleScroll = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    setFollow(el.scrollHeight - el.scrollTop - el.clientHeight < 48);
  }, []);

  const loadOlder = useCallback(async () => {
    const data = state.data;
    if (!data || !data.hasMoreOlder || !data.oldestSeq) return;
    setLoadingOlder(true);
    try {
      const older = await fetchTrajectory({ conversationId, beforeSeq: data.oldestSeq, limit: PAGE_LIMIT });
      setState((prev) => {
        if (!prev.data) return { data: older, loading: false, error: null };
        const merged = [...older.events, ...prev.data.events];
        return {
          data: {
            ...prev.data,
            events: merged.slice(-MAX_LOADED),
            hasMoreOlder: older.hasMoreOlder,
            oldestSeq: merged[0]?.seq ?? prev.data.oldestSeq,
          },
          loading: false,
          error: null,
        };
      });
    } catch (error) {
      setState((prev) => ({ ...prev, error: error instanceof Error ? error.message : 'load_older_failed' }));
    } finally {
      setLoadingOlder(false);
    }
  }, [conversationId, state.data]);

  const locateFailure = useCallback(() => {
    const last = [...events].reverse().find(isFailure);
    if (!last) return;
    setGroup('error');
    setFocusSeq(last.seq);
  }, [events]);

  useEffect(() => {
    if (focusSeq == null) return;
    const el = listRef.current?.querySelector(`[data-seq="${focusSeq}"]`);
    if (el && typeof (el as HTMLElement).scrollIntoView === 'function') {
      (el as HTMLElement).scrollIntoView({ block: 'center' });
    }
    setFollow(false);
    setFocusSeq(null);
  }, [focusSeq, filtered.length]);

  const jumpToLatest = useCallback(() => {
    setFollow(true);
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  const data = state.data;
  const stats = data?.stats ?? null;
  const taskStatus = projectExecutionAxis(data?.task?.status);
  const dataState = !conversationId
    ? 'no-conversation'
    : state.error && !data
      ? 'error'
      : state.loading && !data
        ? 'loading'
        : data && data.availability !== 'available'
          ? data.availability
          : 'ready';

  return (
    <div className={styles.panel} data-testid="trace-surface" data-state={dataState}>
      <div className={styles.header}>
        <span className={styles.title}>
          <Icon name="layers" size={15} />
          <strong>执行轨迹</strong>
        </span>
        <StatusBadge projection={taskStatus} testId="trace-task-state" />
        <button
          type="button"
          className={`${buttonStyles.ghost} ${styles.headerAction}`}
          data-testid="trace-refresh"
          onClick={() => setReloadTick((value) => value + 1)}
        >
          刷新
        </button>
        {onOpenIo ? (
          <button type="button" className={buttonStyles.ghost} data-testid="trace-open-io" onClick={onOpenIo}>
            模型 I/O
          </button>
        ) : null}
      </div>

      {!conversationId && (
        <p className={styles.empty} data-testid="trace-empty" data-reason="no-conversation">
          打开一个会话后，这里显示它的执行轨迹（事件级）。
        </p>
      )}

      {conversationId && state.loading && !data && (
        <p className={styles.empty} data-testid="trace-empty" data-reason="loading">加载执行轨迹…</p>
      )}

      {conversationId && state.error && !data && (
        <div className={styles.errorBox} data-testid="trace-empty" data-reason="error">
          <p>执行轨迹没能加载：{state.error}</p>
          <button type="button" className={buttonStyles.ghost} onClick={() => setReloadTick((value) => value + 1)}>
            重试
          </button>
        </div>
      )}

      {data && data.availability === 'no_task' && (
        <p className={styles.empty} data-testid="trace-empty" data-reason="no_task">
          该会话还没有执行记录。
        </p>
      )}

      {data && data.availability === 'no_events' && (
        <p className={styles.empty} data-testid="trace-empty" data-reason="no_events">
          任务存在，但没有任何已记录事件（可能由旧版本产生，或事件已按保留策略清理）。
        </p>
      )}

      {data && data.availability === 'available' && (
        <>
          <div className={styles.stats} data-testid="trace-stats">
            <span>事件 {stats ? stats.events : '—'}</span>
            <span>工具 {stats ? stats.toolCalls : '—'}</span>
            <span>失败 {stats ? stats.toolFailures : '—'}</span>
            <span>tokens {stats ? `${stats.promptTokens}+${stats.completionTokens}` : '—'}</span>
            <span>用时 {formatDuration(data)}</span>
          </div>
          <p className={styles.note} data-testid="trace-recorded-note">
            只显示已记录事件（单页 {PAGE_LIMIT} 条 · 上限 500）· 未上报的耗时显示 — · 文本为终态合并快照
          </p>

          <div className={styles.chips} role="group" aria-label="轨迹筛选">
            {GROUPS.map((item) => {
              const count = counts[item.id] || 0;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`${styles.chip} ${group === item.id ? styles.chipActive : ''}`}
                  aria-pressed={group === item.id}
                  data-testid={`trace-filter-${item.id}`}
                  onClick={() => setGroup(item.id)}
                >
                  {item.label} {count}
                </button>
              );
            })}
            {failureCount > 0 && (
              <button type="button" className={buttonStyles.danger} data-testid="trace-locate-failure" onClick={locateFailure}>
                定位最近失败（{failureCount}）
              </button>
            )}
          </div>

          <div className={styles.listHeader}>
            {data.hasMoreOlder ? (
              <button
                type="button"
                className={buttonStyles.ghost}
                data-testid="trace-load-older"
                disabled={loadingOlder}
                onClick={() => void loadOlder()}
              >
                {loadingOlder ? '加载中…' : '加载更早事件'}
              </button>
            ) : (
              <span className={styles.note}>已到最早一条记录</span>
            )}
            {!follow ? (
              <button type="button" className={buttonStyles.ghost} data-testid="trace-follow-latest" onClick={jumpToLatest}>
                回到最新
              </button>
            ) : null}
          </div>

          <div className={styles.list} ref={listRef} onScroll={handleScroll} data-testid="trace-events">
            {filtered.map((event) => (
              <div
                key={event.seq}
                className={`${styles.event} ${isFailure(event) ? styles.eventFailure : ''}`}
                data-testid="trace-event"
                data-seq={event.seq}
                data-group={event.group}
                data-status={event.status || undefined}
                title={event.detail || undefined}
              >
                <span className={styles.clock}>{formatClock(event.at)}</span>
                <span className={styles.badge} data-group={event.group}>{GROUP_LABEL[event.group]}</span>
                <span className={styles.summary}>{event.summary}</span>
                {typeof event.durationMs === 'number' && (
                  <span className={styles.duration}>{formatToolDuration(event.durationMs) ?? '0 ms'}</span>
                )}
              </div>
            ))}
            {filtered.length === 0 && (
              <p className={styles.emptyInline} data-testid="trace-filter-empty">该筛选下没有事件。</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
