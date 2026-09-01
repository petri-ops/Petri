import { useCallback, useEffect, useRef, useState } from 'react';
import type { ToolActivityItem } from './toolActivity';
import { formatToolDuration, formatToolSideEffects } from './toolActivity';
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
import { Icon } from '@/components/icons/Icon';
import styles from './ToolActivityDock.module.css';

/**
 * BLOCK-36 — 会话级统一「执行记录」浮窗（右下角）
 *
 * 吸收 BLOCK-34 BackgroundProcessDock 全部行为并扩展：
 * - tab 按消息分组列出本会话全部工具活动组（数据源 = 消息 meta.toolActivities
 *   持久化快照，历史会话恢复后仍可查看）；
 * - 后台进程（workspace_exec_background）作为特殊 tab，1s 轮询进程表 + 日志尾部；
 * - 检测到 running/awaiting_confirmation 工具活动自动弹出，完成后窗口保留；
 * - 手动关闭（×）后新运行再弹出；可折叠为 chip（运行数 + 状态点）；
 * - 会话区摘要条点击经 focusRequest 打开并定位到对应分组。
 */

const POLL_INTERVAL_MS = 1000;
const LOG_TAIL_BYTES = 32 * 1024;
const PROCESSES_TAB = '__processes__';

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

export interface ToolActivityDockGroup {
  /** 与会话消息渲染 key 一致（`${role}-${ts}-${index}`），供摘要条定位。 */
  id: string;
  label: string;
  activities: ToolActivityItem[];
  processingDurationMs?: number;
}

export interface ToolActivityFocusRequest {
  groupId: string;
  nonce: number;
}

interface ToolActivityDockProps {
  conversationId: string | null;
  projectId?: string | null;
  groups: ToolActivityDockGroup[];
  focusRequest?: ToolActivityFocusRequest | null;
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

function groupSummary(activities: ToolActivityItem[], processingDurationMs?: number): string {
  const running = activities.filter((activity) => activity.status === 'running').length;
  const awaiting = activities.filter((activity) => activity.status === 'awaiting_confirmation').length;
  const attention = activities.filter(
    (activity) => activity.status === 'error' || activity.status === 'denied'
  ).length;
  const totalDurationMs = activities.reduce(
    (total, activity) => total + (typeof activity.durationMs === 'number' ? activity.durationMs : 0),
    0
  );
  const totalDuration = formatToolDuration(processingDurationMs ?? totalDurationMs);
  if (running > 0) return `正在处理 ${running}/${activities.length} 项`;
  if (awaiting > 0) return `等待确认 ${awaiting} 项`;
  return `已完成 ${activities.length} 项${attention ? ` · ${attention} 项需注意` : ''}${totalDuration ? ` · ${totalDuration}` : ''}`;
}

export function ToolActivityDock({
  conversationId,
  projectId,
  groups,
  focusRequest,
}: ToolActivityDockProps) {
  const [dismissed, setDismissed] = useState(true);
  const [expanded, setExpanded] = useState(true);
  const [processes, setProcesses] = useState<BackgroundProcessView[]>([]);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const logRef = useRef<HTMLPreElement | null>(null);
  // 轮询回调里读到的最新会话/项目（避免 interval 反复重建）
  const ctxRef = useRef({ conversationId, projectId });
  ctxRef.current = { conversationId, projectId };

  const runningToolCount = groups.reduce(
    (count, group) =>
      count +
      group.activities.filter(
        (activity) => activity.status === 'running' || activity.status === 'awaiting_confirmation'
      ).length,
    0
  );
  const runningProcessCount = processes.filter((p) => isProcessActive(p.status)).length;

  // 会话切换后重置回关闭态（避免打开会话即弹历史浮窗）
  useEffect(() => {
    setDismissed(true);
    setActiveTab(null);
    setProcesses([]);
  }, [conversationId]);

  // 摘要条定位：打开并切到对应分组（按 nonce 去重，容忍调用方内联对象引用变化）
  const lastFocusNonceRef = useRef(0);
  useEffect(() => {
    if (!focusRequest || !focusRequest.groupId) return;
    if (focusRequest.nonce === lastFocusNonceRef.current) return;
    lastFocusNonceRef.current = focusRequest.nonce;
    setDismissed(false);
    setExpanded(true);
    setActiveTab(focusRequest.groupId);
  }, [focusRequest]);

  // 后台进程事件：绑定到当前会话才弹出
  useEffect(() => {
    if (!conversationId) return;
    return subscribeBioF3Event(
      biof3Events.agentBackgroundProcess,
      (detail: AgentBackgroundProcessDetail) => {
        if (detail.conversationId && detail.conversationId !== conversationId) return;
        setDismissed(false);
        setExpanded(true);
        setActiveTab(PROCESSES_TAB);
      }
    );
  }, [conversationId]);

  // 新运行出现时自动弹出（用户手动关闭后 re-pop；折叠态不强拆）。
  // 触发依据 = 运行中/待确认活动集合签名变化，而非计数增减。
  const runningSig = groups
    .flatMap((group) =>
      group.activities
        .filter(
          (activity) =>
            activity.status === 'running' || activity.status === 'awaiting_confirmation'
        )
        .map((activity) => activity.key)
    )
    .sort()
    .join('|');
  const prevRunningSigRef = useRef('');
  useEffect(() => {
    const previous = prevRunningSigRef.current;
    prevRunningSigRef.current = runningSig;
    if (!runningSig || runningSig === previous) return;
    if (!dismissed) return;
    setDismissed(false);
    setExpanded(true);
    const runningGroup = [...groups]
      .reverse()
      .find((group) =>
        group.activities.some(
          (activity) =>
            activity.status === 'running' || activity.status === 'awaiting_confirmation'
        )
      );
    if (runningGroup) setActiveTab(runningGroup.id);
  }, [runningSig, dismissed, groups]);

  // 未选中 tab 时默认定位：最新运行组 → 最新分组 → 后台进程
  useEffect(() => {
    if (dismissed || activeTab) return;
    const runningGroup = [...groups]
      .reverse()
      .find((group) =>
        group.activities.some(
          (activity) =>
            activity.status === 'running' || activity.status === 'awaiting_confirmation'
        )
      );
    if (runningGroup) {
      setActiveTab(runningGroup.id);
    } else if (groups.length > 0) {
      setActiveTab(groups[groups.length - 1].id);
    } else if (processes.length > 0) {
      setActiveTab(PROCESSES_TAB);
    }
  }, [dismissed, activeTab, groups, processes.length]);

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

  // 活跃进程日志尾部轮询（仅后台进程 tab 激活时）
  const activeProcess = activeTab === PROCESSES_TAB
    ? processes.find((p) => isProcessActive(p.status)) || processes[processes.length - 1] || null
    : null;
  useEffect(() => {
    if (dismissed || activeTab !== PROCESSES_TAB || !activeProcess) return;
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
  }, [dismissed, activeTab, activeProcess?.processId]);

  const activeGroup = groups.find((group) => group.id === activeTab) || null;

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
    setActiveTab(null);
    setProcesses([]);
  }, []);

  if (dismissed || !conversationId || (groups.length === 0 && processes.length === 0)) return null;

  if (!expanded) {
    return (
      <button
        type="button"
        className={styles.chip}
        onClick={() => setExpanded(true)}
        title="执行记录"
      >
        <span
          className={styles.dot}
          data-status={runningToolCount + runningProcessCount > 0 ? 'running' : 'idle'}
          aria-hidden="true"
        />
        <span className={styles.chipLabel}>
          执行记录 {runningToolCount + runningProcessCount > 0 ? `${runningToolCount + runningProcessCount} 运行中` : ''}
        </span>
      </button>
    );
  }

  return (
    <div className={styles.dock} data-testid="tool-activity-dock">
      <div className={styles.header}>
        <span
          className={styles.dot}
          data-status={runningToolCount + runningProcessCount > 0 ? 'running' : 'idle'}
          aria-hidden="true"
        />
        <span className={styles.title}>执行记录</span>
        {(groups.length > 1 || (groups.length > 0 && processes.length > 0)) && (
          <div className={styles.tabs}>
            {groups.map((group) => {
              const groupRunning = group.activities.some(
                (activity) =>
                  activity.status === 'running' || activity.status === 'awaiting_confirmation'
              );
              return (
                <button
                  key={group.id}
                  type="button"
                  className={`${styles.tab} ${group.id === activeTab ? styles.tabActive : ''}`}
                  onClick={() => setActiveTab(group.id)}
                >
                  {groupRunning && <span className={styles.tabDot} aria-hidden="true" />}
                  {group.label}
                </button>
              );
            })}
            {processes.length > 0 && (
              <button
                type="button"
                className={`${styles.tab} ${activeTab === PROCESSES_TAB ? styles.tabActive : ''}`}
                onClick={() => setActiveTab(PROCESSES_TAB)}
              >
                后台进程
              </button>
            )}
          </div>
        )}
        <div className={styles.headerActions}>
          {activeProcess && (
            <span className={styles.statusLabel} data-status={activeProcess.status}>
              {STATUS_LABEL[activeProcess.status]}
              {isProcessActive(activeProcess.status) ? ` · ${formatDuration(activeProcess.durationMs)}` : ''}
            </span>
          )}
          <button
            type="button"
            className={styles.iconBtn}
            onClick={() => setExpanded(false)}
            title="折叠"
            aria-label="折叠执行记录浮窗"
          >
            ▾
          </button>
          <button
            type="button"
            className={styles.iconBtn}
            onClick={close}
            title="关闭"
            aria-label="关闭执行记录浮窗"
          >
            ×
          </button>
        </div>
      </div>
      {activeGroup && (
        <div className={styles.detail}>
          <div className={styles.groupSummary}>{groupSummary(activeGroup.activities, activeGroup.processingDurationMs)}</div>
          {activeGroup.activities.map((activity) => {
            const duration = formatToolDuration(activity.durationMs);
            const sideEffects = formatToolSideEffects(activity.sideEffects);
            const showReason = activity.status === 'error' || activity.status === 'denied';
            const statusLabels: Record<ToolActivityItem['status'], string> = {
              running: '运行中',
              awaiting_confirmation: '等待确认',
              success: '已完成',
              error: '失败',
              denied: '已拒绝',
            };
            return (
              <div
                key={activity.key}
                className={`sc-tool-activity sc-tool-activity-${activity.status}`}
              >
                <span className="sc-tool-activity-icon" aria-hidden="true">
                  <Icon name={activity.status === 'success' ? 'check' : 'wrench'} size={14} />
                </span>
                <div className="sc-tool-activity-body sc-tool-activity-detail">
                  <span className="sc-tool-activity-action">{activity.actionLabel}</span>
                  {activity.actionDetail && (
                    <code className="sc-tool-activity-command">{activity.actionDetail}</code>
                  )}
                  <span className="sc-tool-activity-status">{statusLabels[activity.status]}</span>
                  {duration && <span>{duration}</span>}
                  <span className="sc-tool-activity-tool">{activity.name}</span>
                  {activity.truncated && activity.status === 'success' && <span>仅显示摘要</span>}
                  {sideEffects && <span>影响：{sideEffects}</span>}
                  {showReason && activity.terminationReason && (
                    <span className="sc-tool-activity-reason">原因：{activity.terminationReason}</span>
                  )}
                  {activity.output?.tail && (
                    <pre
                      className={`sc-tool-activity-output${activity.output.truncated ? ' sc-tool-activity-output-truncated' : ''}`}
                    >
                      {activity.output.tail}
                      {activity.output.truncated ? '\n…（输出已截断）' : ''}
                    </pre>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {!activeGroup && activeProcess && (
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

export default ToolActivityDock;
