import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchProcessLogTail,
  listBackgroundProcesses,
  type BackgroundProcessStatus,
  type BackgroundProcessView,
} from './backgroundProcesses';
import {
  biof3Events,
  subscribeBioF3Event,
  type AgentBackgroundProcessDetail,
} from '@/lib/events';
import styles from './BackgroundProcessDock.module.css';

/**
 * BLOCK-34 P3 — 后台进程浮窗（右下角）
 *
 * 触发：agent 成功启动 workspace_exec_background（biof3:agent-background-process）
 * 时自动弹出；1s 轮询进程状态与日志尾部增量渲染；可折叠为 chip、可手动关闭。
 * 数据源为后端内存进程表（per conversation 隔离），无新增持久化。
 */

const POLL_INTERVAL_MS = 1000;
const LOG_TAIL_BYTES = 32 * 1024;

const STATUS_LABEL: Record<BackgroundProcessStatus, string> = {
  running: '运行中',
  exited: '已退出',
  stopped: '已停止',
  failed: '启动失败',
  orphaned: '失联',
};

export function isProcessActive(status: BackgroundProcessStatus): boolean {
  return status === 'running';
}

function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h${m}m`;
  if (m > 0) return `${m}m${s}s`;
  return `${s}s`;
}

interface BackgroundProcessDockProps {
  conversationId: string | null;
  projectId?: string | null;
}

export function BackgroundProcessDock({
  conversationId,
  projectId,
}: BackgroundProcessDockProps) {
  const [dismissed, setDismissed] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [processes, setProcesses] = useState<BackgroundProcessView[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const logRef = useRef<HTMLPreElement | null>(null);
  // 轮询回调里读到的最新会话/项目（避免 interval 反复重建）
  const ctxRef = useRef({ conversationId, projectId });
  ctxRef.current = { conversationId, projectId };

  // 事件触发：绑定到当前会话才弹出
  useEffect(() => {
    if (!conversationId) return;
    return subscribeBioF3Event(
      biof3Events.agentBackgroundProcess,
      (detail: AgentBackgroundProcessDetail) => {
        if (detail.conversationId && detail.conversationId !== conversationId) return;
        setDismissed(false);
        setExpanded(true);
        setActiveId(detail.processId);
      }
    );
  }, [conversationId]);

  // 轮询：展开或存在已观察进程时运行
  useEffect(() => {
    if (dismissed || !conversationId) return;
    let cancelled = false;

    const poll = async () => {
      const { conversationId: conv, projectId: proj } = ctxRef.current;
      if (!conv) return;
      try {
        const [list, active] = await Promise.all([
          listBackgroundProcesses(conv, proj),
          activeId
            ? fetchProcessLogTail(activeId, conv, proj, LOG_TAIL_BYTES).catch(() => null)
            : Promise.resolve(null),
        ]);
        if (cancelled) return;
        setProcesses(list);
        if (active) {
          setProcesses((prev) =>
            prev.map((p) => (p.processId === active.processId ? { ...p, ...active } : p))
          );
        }
      } catch {
        // 轮询失败静默重试（后端重启时进程表失联，不打扰用户）
      }
    };

    void poll();
    const timer = setInterval(() => void poll(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [dismissed, conversationId, activeId]);

  // 活跃进程被清出进程表（上限淘汰）时自动切换到最新进程
  useEffect(() => {
    if (!activeId && processes.length > 0) {
      setActiveId(processes[processes.length - 1].processId);
    }
  }, [activeId, processes]);

  const active = processes.find((p) => p.processId === activeId) || null;
  const runningCount = processes.filter((p) => isProcessActive(p.status)).length;

  // 日志自动滚动：仅在用户未上滚（autoScroll）时吸附底部
  useEffect(() => {
    if (!autoScroll || !expanded) return;
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [active?.logTail, autoScroll, expanded]);

  const handleLogScroll = useCallback(() => {
    const el = logRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    setAutoScroll(atBottom);
  }, []);

  const close = useCallback(() => {
    setDismissed(true);
    setActiveId(null);
    setProcesses([]);
  }, []);

  if (dismissed || !conversationId || processes.length === 0) return null;

  if (!expanded) {
    return (
      <button
        type="button"
        className={styles.chip}
        onClick={() => setExpanded(true)}
        title="后台进程"
      >
        <span
          className={styles.dot}
          data-status={runningCount > 0 ? 'running' : 'idle'}
          aria-hidden="true"
        />
        <span className={styles.chipLabel}>
          后台进程 {runningCount > 0 ? `${runningCount} 运行中` : ''}
        </span>
      </button>
    );
  }

  return (
    <div className={styles.dock} data-testid="background-process-dock">
      <div className={styles.header}>
        <span
          className={styles.dot}
          data-status={runningCount > 0 ? 'running' : 'idle'}
          aria-hidden="true"
        />
        <span className={styles.title}>后台进程</span>
        {processes.length > 1 && (
          <div className={styles.tabs}>
            {processes.map((p) => (
              <button
                key={p.processId}
                type="button"
                className={`${styles.tab} ${p.processId === activeId ? styles.tabActive : ''}`}
                onClick={() => {
                  setActiveId(p.processId);
                  setAutoScroll(true);
                }}
              >
                {formatDuration(p.durationMs || 0)}
              </button>
            ))}
          </div>
        )}
        <div className={styles.headerActions}>
          {active && (
            <span className={styles.statusLabel} data-status={active.status}>
              {STATUS_LABEL[active.status]}
              {isProcessActive(active.status) ? ` · ${formatDuration(active.durationMs)}` : ''}
            </span>
          )}
          <button
            type="button"
            className={styles.iconBtn}
            onClick={() => setExpanded(false)}
            title="折叠"
            aria-label="折叠后台进程浮窗"
          >
            ▾
          </button>
          <button
            type="button"
            className={styles.iconBtn}
            onClick={close}
            title="关闭"
            aria-label="关闭后台进程浮窗"
          >
            ×
          </button>
        </div>
      </div>
      {active && (
        <>
          <div className={styles.command} title={active.command}>
            {active.command}
          </div>
          <pre
            ref={logRef}
            className={styles.log}
            onScroll={handleLogScroll}
            data-empty={!active.logTail ? true : undefined}
          >
            {active.logTail || '（暂无输出）'}
          </pre>
          <div className={styles.footer}>
            <button
              type="button"
              className={`${styles.footerBtn} ${autoScroll ? styles.footerBtnActive : ''}`}
              onClick={() => setAutoScroll((v) => !v)}
              title="自动滚动到最新输出"
            >
              自动滚动{autoScroll ? '开' : '关'}
            </button>
            {active.logTruncated && <span className={styles.truncated}>日志仅显示尾部</span>}
            <span className={styles.meta}>PID {active.pid}</span>
          </div>
        </>
      )}
    </div>
  );
}

export default BackgroundProcessDock;
