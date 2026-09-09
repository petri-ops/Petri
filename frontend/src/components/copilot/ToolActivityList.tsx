import { useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/icons/Icon';
import { CodeMirrorDiffView } from '@/components/desktop/WorkingTreeReview/CodeMirrorDiffView';
import { gewuEvents, dispatchGewuEvent } from '@/lib/events';
import { getBridge } from '@/lib/desktopBridge';
import {
  EXEC_TOOL_NAMES,
  formatToolDuration,
  formatToolSideEffects,
  type ToolActivityItem,
} from './toolActivity';

/**
 * UI-268 — 会话内工具活动摘要条 + 内联手风琴
 *
 * 一条消息的工具活动收敛为一行摘要条（如「已完成 3 项 · 3.9 s」），
 * 点击就地向下展开执行记录（执行命令 + 详细输出），再次点击收起；
 * 右下角浮窗（ToolActivityDock）只保留后台进程（持久输出）职责。
 *
 * UI-272 增补 — 两级折叠：手风琴内的「思考」块与每条「执行」记录默认收起，
 * 点击单条展开详细信息，避免一点开就全量铺开导致信息淹没。
 */

const TOOL_STATUS_LABEL: Record<ToolActivityItem['status'], string> = {
  running: '运行中',
  awaiting_confirmation: '等待确认',
  success: '已完成',
  error: '失败',
  denied: '已拒绝',
};

/** UI-272 — 单条思考段：默认收起，点击展开全文（限高滚动）。 */
function ReasoningRow({ iteration, text }: { iteration: number; text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="sc-tool-reasoning">
      <button
        type="button"
        className="sc-tool-row-head sc-tool-reasoning-head"
        data-expanded={open || undefined}
        aria-expanded={open}
        aria-label={open ? `收起思考 第 ${iteration} 轮` : `展开思考 第 ${iteration} 轮`}
        title={open ? '收起思考' : '展开思考'}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="sc-tool-reasoning-label">思考 · 第 {iteration} 轮</span>
        <span className="sc-tool-row-chevron" aria-hidden="true">
          <Icon name="chevron-right" size={12} />
        </span>
      </button>
      {open && <p className="sc-tool-reasoning-text">{text}</p>}
    </div>
  );
}

/**
 * UI-315 — exec 类工具（workspace_exec / workspace_exec_background）的
 * 原生终端块：`$ 命令` + 流式输出尾部，等宽深色、默认展开、限高滚动。
 * 输出增量来自既有 tool_output SSE（BLOCK-33 P3），运行中自动滚底；
 * 命令随 meta.toolActivities 持久化，历史消息仍可回看命令。
 */
function TerminalRow({ activity }: { activity: ToolActivityItem }) {
  const [open, setOpen] = useState(true);
  const duration = formatToolDuration(activity.durationMs);
  const command = activity.command || activity.actionDetail || '';
  const outputTail = activity.output?.tail || '';
  const running = activity.status === 'running';
  const outputRef = useRef<HTMLPreElement | null>(null);

  // 运行中输出增长时自动滚到底部（终态后停止跟随，方便回看）
  useEffect(() => {
    if (running && outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [outputTail, running]);

  return (
    <div className={`sc-tool-term sc-tool-term-${activity.status}`} data-testid="tool-term">
      <button
        type="button"
        className="sc-tool-term-head"
        data-expanded={open || undefined}
        aria-expanded={open}
        aria-label={open ? '收起终端' : '展开终端'}
        title={open ? '收起终端' : '展开终端'}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="sc-tool-term-badge" aria-hidden="true">
          <Icon name="terminal" size={12} />
        </span>
        <span className="sc-tool-term-title">
          终端{activity.name === 'workspace_exec_background' ? ' · 后台' : ''}
        </span>
        <span className="sc-tool-term-status" data-status={activity.status}>
          {TOOL_STATUS_LABEL[activity.status]}
        </span>
        {duration && <span className="sc-tool-term-duration">{duration}</span>}
        <span className="sc-tool-row-chevron" aria-hidden="true">
          <Icon name={open ? 'chevron-down' : 'chevron-right'} size={12} />
        </span>
      </button>
      {open && (
        <div className="sc-tool-term-body">
          <pre className="sc-tool-term-command">
            <span className="sc-tool-term-prompt">$ </span>
            {command || activity.actionDetail || activity.name}
          </pre>
          {(outputTail || running) && (
            <pre ref={outputRef} className="sc-tool-term-output" data-testid="tool-term-output">
              {outputTail}
              {running && !outputTail ? '…' : ''}
              {activity.output?.truncated ? '\n…（输出已截断）' : ''}
            </pre>
          )}
          {activity.status === 'error' && activity.terminationReason && (
            <div className="sc-tool-term-err">原因：{activity.terminationReason}</div>
          )}
        </div>
      )}
    </div>
  );
}

/** UI-272 增补 — 单条工具执行记录：头部一行摘要，点击展开命令输出等详情。 */
function ActivityRow({ activity }: { activity: ToolActivityItem }) {  const [open, setOpen] = useState(false);
  const duration = formatToolDuration(activity.durationMs);
  const sideEffects = formatToolSideEffects(activity.sideEffects);
  const showReason = activity.status === 'error' || activity.status === 'denied';
  // BLOCK-59 P4 — 子 agent 活动行「详情窗」入口（agent 独立窗：实时工作流 + 终态摘要）
  const windowManagerBridge = getBridge('windowManager');
  const openAgentWindow = () => {
    if (!activity.agentRunId) return;
    void windowManagerBridge?.popOut('agent', activity.agentRunId);
  };
  return (
    <div className={`sc-tool-activity sc-tool-activity-${activity.status}`}>
      <button
        type="button"
        className="sc-tool-row-head sc-tool-activity-row-head"
        data-expanded={open || undefined}
        aria-expanded={open}
        aria-label={open ? `收起执行详情 ${activity.actionLabel}` : `展开执行详情 ${activity.actionLabel}`}
        title={open ? '收起执行详情' : '展开执行详情'}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="sc-tool-activity-icon" aria-hidden="true">
          <Icon name={activity.status === 'success' ? 'check' : 'wrench'} size={14} />
        </span>
        <span className="sc-tool-activity-action">{activity.actionLabel}</span>
        {activity.actionDetail && (
          <code className="sc-tool-activity-command">{activity.actionDetail}</code>
        )}
        <span className="sc-tool-activity-status">{TOOL_STATUS_LABEL[activity.status]}</span>
        {duration && <span className="sc-tool-activity-duration">{duration}</span>}
        <span className="sc-tool-row-chevron" aria-hidden="true">
          <Icon name="chevron-right" size={12} />
        </span>
      </button>
      {open && (
        <div className="sc-tool-activity-body sc-tool-activity-detail">
          <span className="sc-tool-activity-tool">{activity.name}</span>
          {activity.agentRunId && windowManagerBridge && (
            <button
              type="button"
              className="gewu-btn gewu-btn--ghost gewu-btn--sm"
              onClick={openAgentWindow}
              title="弹出 agent 详情独立窗（实时工作流 + 终态摘要，只读投影）"
            >
              详情窗
            </button>
          )}
          {activity.truncated && activity.status === 'success' && <span>仅显示摘要</span>}
          {/* UI-273 增补 — 写操作展开显示本次操作的实际改动：文件行（点击跳审阅）+ diff 预览，
              与审阅文件行同构呈现 */}
          {activity.changeDiff ? (
            <div className="sc-tool-changediff">
              <button
                type="button"
                className="sc-tool-changediff-file"
                title={`${activity.actionDetail || activity.name} — 点击在审阅中查看`}
                onClick={() =>
                  dispatchGewuEvent(gewuEvents.reviewOpenFile, {
                    filePath: activity.actionDetail || activity.name,
                  })
                }
              >
                <Icon name="file" size={12} />
                <span className="sc-tool-changediff-path">
                  {activity.actionDetail || activity.name}
                </span>
                <span className="sc-changes-add">+{activity.changeDiff.added}</span>
                <span className="sc-changes-del">−{activity.changeDiff.removed}</span>
              </button>
              {activity.changeDiff.truncated && (
                <span className="sc-tool-changediff-truncated">差异已截断</span>
              )}
              {activity.changeDiff.hunks.length > 0 ? (
                <div className="sc-tool-changediff-preview">
                  {activity.changeDiff.hunks.map((hunk, hunkIndex) => (
                    <CodeMirrorDiffView
                      key={`${activity.key}:${hunkIndex}`}
                      filePath={activity.actionDetail || activity.name}
                      isBinary={false}
                      hunks={[hunk]}
                    />
                  ))}
                </div>
              ) : (
                <div className="sc-tool-changediff-empty">差异较大，仅显示行数统计。</div>
              )}
            </div>
          ) : (
            sideEffects && <span>影响：{sideEffects}</span>
          )}
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
      )}
    </div>
  );
}

export function ToolActivityList({
  activities,
  processingDurationMs,
  reasoningByIteration,
}: {
  activities: ToolActivityItem[];
  processingDurationMs?: number;
  /** UI-272 — 按迭代聚合的模型思考段，展开时展示每次工具调用前的衔接思路。 */
  reasoningByIteration?: Record<number, string>;
}): React.ReactElement {
  const [expanded, setExpanded] = useState(false);
  const [userToggled, setUserToggled] = useState(false);
  // UI-315 — exec 命令运行中自动展开活动条（终端块直接可见，ZCode 式）；
  // 用户手动切换后不再代管展开态。
  const hasRunningExec = activities.some(
    (activity) => EXEC_TOOL_NAMES.has(activity.name) && activity.status === 'running'
  );
  useEffect(() => {
    if (hasRunningExec && !userToggled) setExpanded(true);
  }, [hasRunningExec, userToggled]);
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
  const actionCounts = activities.reduce<Record<string, number>>((counts, activity) => {
    const action = activity.actionLabel.replace(/^已/, '') || '处理';
    counts[action] = (counts[action] || 0) + 1;
    return counts;
  }, {});
  const actionSummary = Object.entries(actionCounts)
    .slice(0, 3)
    .map(([action, count]) => `${action} ${count} 次`)
    .join(' · ');
  const summary = running > 0
    ? `正在处理 ${running}/${activities.length} 项${actionSummary ? ` · ${actionSummary}` : ''}`
    : awaiting > 0
      ? `等待确认 ${awaiting} 项`
      : `已完成 ${activities.length} 项${attention ? ` · ${attention} 项需注意` : ''}${actionSummary ? ` · ${actionSummary}` : ''}${totalDuration ? ` · 耗时 ${totalDuration}` : ''}`;

  // UI-272 — 每轮思考只在该轮首个工具前插入一次
  const renderedIterations = new Set<number>();

  return (
    <div className="sc-tool-activity-list" aria-label="工具活动">
      <button
        type="button"
        className="sc-tool-activity-summary"
        data-expanded={expanded || undefined}
        aria-expanded={expanded}
        aria-label={expanded ? '收起执行记录' : '展开执行记录'}
        title={expanded ? '收起执行记录' : '展开执行记录'}
        onClick={() => {
          setUserToggled(true);
          setExpanded((v) => !v);
        }}
      >
        <span className="sc-tool-activity-summary-label">{summary}</span>
        <Icon name="chevron-right" size={14} />
      </button>
      {expanded && (
        <div className="sc-tool-activity-inline">
          {activities.map((activity) => {
            const iterationKey = activity.iteration ?? -1;
            const iterReasoning =
              activity.iteration != null ? reasoningByIteration?.[activity.iteration] : undefined;
            const isFirstOfIteration = !renderedIterations.has(iterationKey);
            if (isFirstOfIteration) renderedIterations.add(iterationKey);
            return (
              <div key={activity.key}>
                {isFirstOfIteration && iterReasoning && (
                  <ReasoningRow iteration={activity.iteration as number} text={iterReasoning} />
                )}
                {/* UI-315 — exec 类工具以原生终端块呈现（默认展开），其余保持行式 */}
                {EXEC_TOOL_NAMES.has(activity.name) ? (
                  <TerminalRow activity={activity} />
                ) : (
                  <ActivityRow activity={activity} />
                )}
              </div>
            );
          })}
          {/* UI-272 — 未对应任何工具的思考段（如最终结论前的整理思考），按迭代序补在末尾 */}
          {(() => {
            const toolIterations = new Set(
              activities.map((a) => a.iteration).filter((it): it is number => it != null)
            );
            const leftovers = Object.entries(reasoningByIteration || {})
              .map(([iter, text]) => ({ iteration: Number(iter), text }))
              .filter((entry) => Number.isInteger(entry.iteration) && !toolIterations.has(entry.iteration))
              .sort((a, b) => a.iteration - b.iteration);
            if (leftovers.length === 0) return null;
            return leftovers.map((entry) => (
              <ReasoningRow key={`reasoning-${entry.iteration}`} iteration={entry.iteration} text={entry.text} />
            ));
          })()}
        </div>
      )}
    </div>
  );
}

export default ToolActivityList;
