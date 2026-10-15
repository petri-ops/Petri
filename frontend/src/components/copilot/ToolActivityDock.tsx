import { useCallback, useEffect, useRef, useState } from 'react';
// BLOCK-173 CP-9 — 编排 DAG 可视化（spawn 树只读投影；数据源=既有 run 快照）
import { useSubAgentTasksForConversation } from './conversationRunStore/subAgentTasks';
import { getConversationRunSnapshot } from './conversationRunStore';
import { OrchestrationGraph } from '@/components/workspace-panels/OrchestrationGraph';
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
import { Icon } from '@/components/icons/Icon';

/**
 * UI-268 — 「后台进程」指示器（composer 工具栏内联图标 + 展开浮层面板）
 *
 * 折叠态=28×28 图标钮（cpu 图标+状态脉冲点），位于 sc-composer-right 预算环左侧；
 * 展开态=fixed 浮层面板（右下角锚定 composer 上方）。
 * - 检测到后台进程事件自动弹出，1s 轮询进程表 + 日志尾部；
 * - 手动关闭（×）后新进程再弹出；可折叠回图标。
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
  // BLOCK-173 CP-9 — 编排图形态开关（有子 agent 任务时头部出现切换钮）
  const [showGraph, setShowGraph] = useState(false);
  const subAgentTasks = useSubAgentTasksForConversation(conversationId);
  const logRef = useRef<HTMLPreElement | null>(null);
  // 轮询回调里读到的最新会话/项目（避免 interval 反复重建）。
  // BLOCK-173 W3 — ref 写入移出 render（react-hooks 新规）：effect 每渲染同步，
  // 轮询 interval 读取时点在 effect 之后，语义不变。
  const ctxRef = useRef({ conversationId, projectId });
  useEffect(() => {
    ctxRef.current = { conversationId, projectId };
  });

  const runningProcessCount = processes.filter((p) => isProcessActive(p.status)).length;

  // 会话切换后重置回关闭态（避免打开会话即弹历史浮窗）。
  // BLOCK-173 W3 — 改用 React 官方「render 期 adjust-state」模式（prev 对比），
  // 消除 effect 内同步 setState（react-hooks/set-state-in-effect）。
  const [prevConversationId, setPrevConversationId] = useState(conversationId);
  if (prevConversationId !== conversationId) {
    setPrevConversationId(conversationId);
    setDismissed(true);
    setProcesses([]);
  }

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

  // BLOCK-181 代行评估抓真 — spawn 子任务是编排图的一等数据源，但子任务
  // 从不发 background-process 事件（该事件仅 workspace_exec_background 发），
  // dock 缺省 dismissed + processes 空 → 编排图钮在纯 spawn 流结构性不可达。
  // 修复：子任务出现（0→>0 跳变）时自动弹出；用户手动关闭仍优先到下一个
  // 新子任务出现为止。
  const prevSubAgentCount = useRef(0);
  useEffect(() => {
    if (subAgentTasks.length > 0 && prevSubAgentCount.current === 0) {
      setDismissed(false);
    }
    prevSubAgentCount.current = subAgentTasks.length;
  }, [subAgentTasks.length]);

  if (dismissed || !conversationId || (processes.length === 0 && subAgentTasks.length === 0)) return null;

  if (!expanded) {
    const hasActive = runningProcessCount > 0 || subAgentTasks.some((t) => t.status === 'running');
    return (
      <button
        type="button"
        className={`sc-composer-icon-btn ${styles.composerIcon}`}
        onClick={() => setExpanded(true)}
        title={runningProcessCount > 0 ? `后台进程 ${runningProcessCount} 运行中` : '编排子任务'}
        aria-label="后台进程"
        data-testid="tool-activity-dock-trigger"
      >
        <Icon name="zap" size={14} />
        {hasActive && (
          <span
            className={styles.dot}
            data-status="running"
            aria-hidden="true"
          />
        )}
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
          {subAgentTasks.length > 0 && (
            <button
              type="button"
              className={`${button.iconBase} ${styles.iconBtn}`}
              onClick={() => setShowGraph((v) => !v)}
              title={showGraph ? '查看日志' : '查看编排图'}
              aria-label={showGraph ? '查看日志' : '查看编排图'}
              data-testid="dock-graph-toggle"
            >
              ⎇
            </button>
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
      {/* BLOCK-181 代行评估抓真 — 纯 spawn 流没有 activeProcess（后台进程事件仅
          workspace_exec_background 发），但编排图的数据源是 subAgentTasks：
          图形态开启或有子任务时渲染 dock 体，不再被 activeProcess 一票否决。 */}
      {(activeProcess || (showGraph && subAgentTasks.length > 0)) && (
        <>
          {activeProcess && (
            <div className={styles.command} title={activeProcess.command}>
              {activeProcess.command}
            </div>
          )}
          {showGraph && subAgentTasks.length > 0 ? (
            <OrchestrationGraph
              tasks={subAgentTasks.map((t) => ({
                taskId: t.taskId,
                parentTaskId: t.parentTaskId,
                status: t.status,
                userContent: t.userContent,
              }))}
              rootTaskId={conversationId ? getConversationRunSnapshot(conversationId)?.taskId ?? null : null}
            />
          ) : activeProcess ? (
            <pre
              ref={logRef}
              className={styles.log}
              onScroll={handleLogScroll}
              data-empty={!activeProcess.logTail ? true : undefined}
            >
              {activeProcess.logTail || '（暂无输出）'}
            </pre>
          ) : null}
          {activeProcess && (
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
          )}
        </>
      )}
    </div>
  );
}

