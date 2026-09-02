import { useState } from 'react';
import { Icon } from '@/components/icons/Icon';
import { CodeMirrorDiffView } from '@/components/desktop/WorkingTreeReview/CodeMirrorDiffView';
import { biof3Events, dispatchBioF3Event } from '@/lib/events';
import {
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

/** UI-272 增补 — 单条工具执行记录：头部一行摘要，点击展开命令输出等详情。 */
function ActivityRow({ activity }: { activity: ToolActivityItem }) {
  const [open, setOpen] = useState(false);
  const duration = formatToolDuration(activity.durationMs);
  const sideEffects = formatToolSideEffects(activity.sideEffects);
  const showReason = activity.status === 'error' || activity.status === 'denied';
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
          {activity.truncated && activity.status === 'success' && <span>仅显示摘要</span>}
          {/* UI-273 增补 — 写操作展开显示本次操作的实际改动：文件行（点击跳审阅）+ diff 预览，
              与工作区改动卡片（AgentChangesCard）同构呈现 */}
          {activity.changeDiff ? (
            <div className="sc-tool-changediff">
              <button
                type="button"
                className="sc-tool-changediff-file"
                title={`${activity.actionDetail || activity.name} — 点击在审阅中查看`}
                onClick={() =>
                  dispatchBioF3Event(biof3Events.reviewOpenFile, {
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
        onClick={() => setExpanded((v) => !v)}
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
                <ActivityRow activity={activity} />
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
