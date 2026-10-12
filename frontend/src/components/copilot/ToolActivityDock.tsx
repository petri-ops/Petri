import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchProcessLogTail,
  listBackgroundProcesses,
  type BackgroundProcessStatus,
  type BackgroundProcessView,
} from './backgroundProcesses';
import {
  petriEvents,
  subscribePetriEvent,
  type AgentBackgroundProcessDetail,
} from '@/lib/events';
import styles from './ToolActivityDock.module.css';
import button from '../ui/controls/button.module.css';

/**
 * UI-268 — 「后台进程」浮窗（右下角，持久输出独立小窗口）
 *
 * BLOCK-36 曾同时承载工具活动分组 + 后台进程 tab；UI-268 起工具活动记录
 * 改为会话内摘要条就地向下展开（SimpleChat ToolActivityList 手风琴），
 * 本浮窗只保留后台进程（workspace_exec_background）职责：
 * - 检测到后台进程事件自动弹出，1s 轮询进程表 + 日志尾部；
 * - 手动关闭（×）后新进程再弹出；可折叠为 chip（运行数 + 状态点）。
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

function isProcessActive(status: BackgroundProcessStatus): boolean {
  return status === 'running';
}

interface ToolActivityDockProps {
  conversationId: string | null;
  projectId?: string | null;
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

export function ToolActivityDock({ conversationId, projectId }: ToolActivityDockProps) {
  const [dismissed, setDismissed] = useState(true);
  const [expanded, setExpanded] = useState(true);
  const [processes, setProcesses] = useState<BackgroundProcessView[]>([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const logRef = useRef<HTMLPreElement | null>(null);
  // 轮询回调里读到的最新会话/项目（避免 interval 反复重建）
  const ctxRef = useRef({ conversationId, projectId });
  ctxRef.current = { conversationId, projectId };

  const runningProcessCount = processes.filter((p) => isProcessActive(p.status)).length;

  // 会话切换后重置回关闭态（避免打开会话即弹历史浮窗）
  useEffect(() => {
    setDismissed(true);
    setProcesses([]);
  }, [conversationId]);

  // 后台进程事件：绑定到当前会话才弹出
  useEffect(() => {
    if (!conversationId) return;
    return subscribePetriEvent(
      petriEvents.agentBackgroundProcess,
      (detail: AgentBackgroundProcessDetail) => {
        if (detail.conversationId && detail.conversationId !== conversationId) return;
        setDismissed(false);
        setExpanded(true);
      }
    );
  }, [conversationId]);

  // 后台进程轮询：浮窗可见时运行
  useEffect(() => {
    if (dismissed || !conversationId) return;
    let cancelled = false;

    const poll = async () => {
      const { conversationId: conv, projectId: proj } = ctxRef.current;
      if (!conv) return;
      try {
        const list = await listBackgroundProcesses(conv, proj);
        if (cancelled) return;
        setProcesses(list);
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
  }, [dismissed, conversationId]);

  // 活跃进程日志尾部轮询
  const activeProcess = processes.find((p) => isProcessActive(p.status))
    || processes[processes.length - 1]
    || null;
  useEffect(() => {
    if (dismissed || !activeProcess) return;
    let cancelled = false;
    const processId = activeProcess.processId;
    const poll = async () => {
      const { conversationId: conv, projectId: proj } = ctxRef.current;
      if (!conv) return;
      try {
        const active = await fetchProcessLogTail(processId, conv, proj, LOG_TAIL_BYTES);
        if (cancelled) return;
        setProcesses((prev) =>
          prev.map((p) => (p.processId === active.processId ? { ...p, ...active } : p))
        );
      } catch {
        // 静默重试
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [dismissed, activeProcess?.processId]);

  // 日志自动滚动：仅在用户未上滚（autoScroll）时吸附底部
  useEffect(() => {
    if (!autoScroll || !expanded) return;
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [activeProcess?.logTail, autoScroll, expanded]);

  const handleLogScroll = useCallback(() => {
    const el = logRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    setAutoScroll(atBottom);
  }, []);

  const close = useCallback(() => {
    setDismissed(true);
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
          data-status={runningProcessCount > 0 ? 'running' : 'idle'}
          aria-hidden="true"
        />
        <span className={styles.chipLabel}>
          后台进程 {runningProcessCount > 0 ? `${runningProcessCount} 运行中` : ''}
        </span>
      </button>
    );
  }

  return (
    <div className={styles.dock} data-testid="tool-activity-dock">
      <div className={styles.header}>
        <span
          className={styles.dot}
          data-status={runningProcessCount > 0 ? 'running' : 'idle'}
          aria-hidden="true"
        />
        <span className={styles.title}>后台进程</span>
        <div className={styles.headerActions}>
          {activeProcess && (
            <span className={styles.statusLabel} data-status={activeProcess.status}>
              {STATUS_LABEL[activeProcess.status]}
              {isProcessActive(activeProcess.status) ? ` · ${formatDuration(activeProcess.durationMs)}` : ''}
            </span>
          )}
          <button
            type="button"
            className={`${button.iconBase} ${styles.iconBtn}`}
            onClick={() => setExpanded(false)}
            title="折叠"
            aria-label="折叠后台进程浮窗"
          >
            ▾
          </button>
          <button
            type="button"
            className={`${button.iconBase} ${styles.iconBtn}`}
            onClick={close}
            title="关闭"
            aria-label="关闭后台进程浮窗"
          >
            ×
          </button>
        </div>
      </div>
      {activeProcess && (
        <>
          <div className={styles.command} title={activeProcess.command}>
            {activeProcess.command}
          </div>
          <pre
            ref={logRef}
            className={styles.log}
            onScroll={handleLogScroll}
            data-empty={!activeProcess.logTail ? true : undefined}
          >
            {activeProcess.logTail || '（暂无输出）'}
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
            {activeProcess.logTruncated && <span className={styles.truncated}>日志仅显示尾部</span>}
            <span className={styles.meta}>PID {activeProcess.pid}</span>
          </div>
        </>
      )}
    </div>
  );
}

