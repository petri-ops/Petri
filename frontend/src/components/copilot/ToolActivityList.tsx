import { lazy, Suspense, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Icon } from '@/components/icons/Icon';
// BLOCK-106 P1 — 工具活动卡的 diff 预览按需加载：静态引入会把整个 CodeMirror 栈
// （@codemirror/view 479 KB + state/language/commands/merge ≈ 966 KB 源码）挂进
// 入口 chunk，而多数会话根本不展开 changeDiff 预览。
const CodeMirrorDiffView = lazy(() =>
  import('@/components/desktop/WorkingTreeReview/CodeMirrorDiffView').then((m) => ({ default: m.CodeMirrorDiffView }))
);
import { gewuEvents, dispatchGewuEvent } from '@/lib/events';
import { getSubAgentTaskSnapshot, stopSubAgentTask, subscribeSubAgentTask } from '@/components/copilot/conversationRunStore';
import { resolveAgentCategory } from '@/lib/agentCategories';
import {
  EXEC_TOOL_NAMES,
  formatToolDuration,
  formatToolSideEffects,
  groupToolActivities,
  type ToolActivityItem,
} from './toolActivity';

/** UI-316 — agent 管理类工具（子智能体独立标识 + 行内实时状态）。 */
const ACTIVITY_AGENT_TOOLS: ReadonlySet<string> = new Set([
  'spawn_agent',
  'wait_agent',
  'list_agents',
  'interrupt_agent',
  'send_message',
  'followup_task',
]);

const SUB_STATUS_LABEL: Record<string, string> = {
  running: '运行中',
  done: '已完成',
  error: '失败',
  stopped: '已停止',
};
import { parseAnsiToSpans } from './ansi';

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

/** BLOCK-107 P2b（D4）— 未终结状态：运行中 / 待确认。 */
const RUNNING_STATUSES: ReadonlySet<ToolActivityItem['status']> = new Set([
  'running',
  'awaiting_confirmation',
]);

/** UI-272 — 单条思考段：默认收起，点击展开全文（限高滚动）。
 *  BLOCK-108 P3 — 支持 Qoder 行形态覆写：`label`（如「已思考」）与折叠态
 *  `preview`（首行预览，折叠即可看出这一轮在琢磨什么）。 */
function ReasoningRow({ iteration, text, label }: {
  iteration: number;
  text: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  // UI-437 v4 加映 — 与工具行同款骨架（brain 图标 + 标签 + 箭头）；
  // 默认标签去轮次号（内部迭代细节不外露，对齐 ZCode「思考」）。
  const resolvedLabel = label || '思考';
  const ariaName = `${open ? '收起' : '展开'} ${resolvedLabel}`;
  return (
    <div className="sc-tool-activity sc-tool-qoder-row">
      <button
        type="button"
        className="sc-tool-row-head sc-tool-qoder-head"
        aria-expanded={open}
        aria-label={ariaName}
        title={open ? '收起思考' : '展开思考'}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="sc-tool-qoder-kind" aria-hidden="true">
          <Icon name="brain" size={12} />
        </span>
        <span className="sc-tool-qoder-label">{resolvedLabel}</span>
        <span className="sc-tool-row-chevron" aria-hidden="true">
          <Icon name={open ? 'chevron-down' : 'chevron-right'} size={12} />
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
 *
 * UI-315 优化包 — 解析强化 + 视觉精修：
 *   - 输出 ANSI SGR 解析着色（其余转义剥除）
 *   - 头行显示实际使用的 shell（powershell / cmd / bash…）
 *   - 运行中 spinner；复制命令/输出按钮
 *   - 滚动跟随：手动上滚暂停自动滚底 + 「回到底部」悬浮按钮
 */
/**
 * BLOCK-108 P3 — 终端展开体（命令全量 + 流式输出 + 复制/滚随）。
 * 从 TerminalRow 抽出供两处复用：legacy TerminalRow（UI-315）与 Qoder 统一
 * 单行行式（时间线模式）。挂载即展开态，滚随/复制状态随挂载生命周期。
 */
function TerminalBody({ activity }: { activity: ToolActivityItem }) {
  const [copied, setCopied] = useState('');
  const command = activity.command || activity.actionDetail || '';
  const outputTail = activity.output?.tail || '';
  const running = activity.status === 'running';
  const outputRef = useRef<HTMLPreElement | null>(null);
  const outputSpans = parseAnsiToSpans(outputTail);
  const followRef = useRef(true);
  const [showJump, setShowJump] = useState(false);

  // 滚动跟随：运行中输出增长时自动滚到底；用户上滚即暂停跟随
  useEffect(() => {
    if (!running || !followRef.current || !outputRef.current) return;
    outputRef.current.scrollTop = outputRef.current.scrollHeight;
  }, [outputTail, running]);

  const handleOutputScroll = () => {
    const el = outputRef.current;
    if (!el) return;
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 24;
    followRef.current = atBottom;
    setShowJump(!atBottom);
  };

  const jumpToBottom = () => {
    const el = outputRef.current;
    if (!el) return;
    followRef.current = true;
    el.scrollTop = el.scrollHeight;
    setShowJump(false);
  };

  const copyText = async (text: string, what: string) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      window.setTimeout(() => setCopied(''), 1200);
    } catch {
      setCopied('');
    }
  };

  return (
    <div className="sc-tool-term-body">
      <div className="sc-tool-term-command">
        <span className="sc-tool-term-prompt">$ </span>
        <span className="sc-tool-term-command-text">{command}</span>
        <button
          type="button"
          className={`sc-tool-term-copy${copied === 'cmd' ? ' is-copied' : ''}`}
          title="复制命令"
          aria-label="复制命令"
          onClick={() => void copyText(command, 'cmd')}
        >
          <Icon name={copied === 'cmd' ? 'check' : 'copy'} size={11} />
        </button>
      </div>
      {(outputTail || running) && (
        <div className="sc-tool-term-output-wrap">
          <pre
            ref={outputRef}
            className="sc-tool-term-output"
            data-testid="tool-term-output"
            onScroll={handleOutputScroll}
          >
            {outputSpans.length > 0
              ? outputSpans.map((span, index) =>
                  span.cls ? (
                    <span key={index} className={span.cls}>{span.text}</span>
                  ) : (
                    <span key={index}>{span.text}</span>
                  )
                )
              : outputTail}
            {running && !outputTail ? '…' : ''}
            {activity.output?.truncated ? '\n…（输出已截断）' : ''}
          </pre>
          <button
            type="button"
            className={`sc-tool-term-copy sc-tool-term-copy-out${copied === 'out' ? ' is-copied' : ''}`}
            title="复制输出"
            aria-label="复制输出"
            onClick={() => void copyText(outputTail, 'out')}
          >
            <Icon name={copied === 'out' ? 'check' : 'copy'} size={11} />
          </button>
          {showJump && (
            <button
              type="button"
              className="sc-tool-term-jump"
              onClick={jumpToBottom}
              title="回到底部（恢复自动跟随）"
            >
              ↓ 回到底部
            </button>
          )}
        </div>
      )}
      {activity.status === 'error' && activity.terminationReason && (
        <div className="sc-tool-term-err">原因：{activity.terminationReason}</div>
      )}
    </div>
  );
}

function TerminalRow({ activity }: { activity: ToolActivityItem }) {
  // UI-315 优化二 — 命令即身份：折叠行以等宽命令为主体（一眼看出跑了什么），
  // 展开后是完整输出；柔和主题底色分组，无左右边框线。
  const [open, setOpen] = useState(false);
  const duration = formatToolDuration(activity.durationMs);
  const command = activity.command || activity.actionDetail || '';
  const running = activity.status === 'running';

  const firstLine = (command.split('\n')[0] || '').slice(0, 120);
  const statusGlyph = running
    ? null
    : activity.status === 'success'
      ? '✓'
      : activity.status === 'error' || activity.status === 'denied'
        ? '✕'
        : '···';

  return (
    <div className={`sc-tool-term sc-tool-term-${activity.status}`} data-status={activity.status} data-testid="tool-term">
      <button
        type="button"
        className="sc-tool-term-head"
        data-expanded={open || undefined}
        aria-expanded={open}
        aria-label={open ? '收起终端' : '展开终端'}
        title={open ? '收起终端' : '展开终端'}
        onClick={() => setOpen((v) => !v)}
      >
        {running ? (
          <span className="sc-tool-term-spinner" aria-hidden="true" />
        ) : (
          <span className="sc-tool-term-badge" aria-hidden="true">
            <Icon name="terminal" size={12} />
          </span>
        )}
        <code className="sc-tool-term-cmd-preview" title={command}>
          <span className="sc-tool-term-prompt">$ </span>
          {firstLine}
        </code>
        <span className="sc-tool-term-status" data-status={activity.status}>
          {statusGlyph || '···'}
        </span>
        {duration && <span className="sc-tool-term-duration">{duration}</span>}
        <span className="sc-tool-row-chevron" aria-hidden="true">
          <Icon name={open ? 'chevron-down' : 'chevron-right'} size={12} />
        </span>
      </button>
      {open && <TerminalBody activity={activity} />}
    </div>
  );
}

/** UI-272 增补 — 单条工具执行记录：头部一行摘要，点击展开命令输出等详情。 */
function ActivityBody({ activity, subSnap }: {
  activity: ToolActivityItem;
  subSnap: ReturnType<typeof getSubAgentTaskSnapshot>;
}) {
  const sideEffects = formatToolSideEffects(activity.sideEffects);
  const showReason = activity.status === 'error' || activity.status === 'denied';
  // UI-385 — 子 agent 详情改由右栏「智能体」tab 承载（独立窗退役）：派发
  // agentOpenInRail 事件，project-workspace 切 tab 并把面板指到该 runId。
  const openAgentDetail = () => {
    if (!activity.agentRunId) return;
    dispatchGewuEvent(gewuEvents.agentOpenInRail, { runId: activity.agentRunId });
  };
  return (
    <div className="sc-tool-activity-body sc-tool-activity-detail">
      <span className="sc-tool-activity-tool">{activity.name}</span>
      {activity.agentRunId && subSnap && (
        // UI-382 — 子智能体实况卡内联到派发源头（工具调用时间线），
        // 不再只沉在底部聚合条；详情窗/中断动作随卡就地可达。
        <div className="sc-tool-subagent-inline" data-status={subSnap.status}>
          <div className="sc-tool-subagent-line">
            {/* UI-387 + BLOCK-93 P2 — emoji=职能（显式 spawn role 优先，文本推断兜底），形状回答「它是谁」 */}
            <span aria-hidden="true">{resolveAgentCategory(subSnap.agentRole, subSnap.userContent).emoji}</span>
            <span className="sc-tool-subagent-desc" title={subSnap.userContent}>
              {(subSnap.userContent || '').replace(/\s+/g, ' ').trim().slice(0, 80) || '（无描述）'}
            </span>
            <span className="sc-tool-agent-status" data-status={subSnap.status}>
              <Icon name="bot" size={10} />
              {SUB_STATUS_LABEL[subSnap.status] || subSnap.status}
            </span>
          </div>
          <div className="sc-tool-subagent-actions">
            <button
              type="button"
              className="gewu-btn gewu-btn--ghost gewu-btn--sm"
              onClick={openAgentDetail}
              title="在右侧栏「智能体」面板查看实时工作流 + 终态摘要"
            >
              详情
            </button>
            {subSnap.status === 'running' && (
              <button
                type="button"
                className="gewu-btn gewu-btn--ghost gewu-btn--sm"
                onClick={() => stopSubAgentTask(activity.agentRunId)}
                title="中断该子智能体"
              >
                中断
              </button>
            )}
          </div>
        </div>
      )}
      {activity.agentRunId && !subSnap && (
        <button
          type="button"
          className="gewu-btn gewu-btn--ghost gewu-btn--sm"
          onClick={openAgentDetail}
          title="在右侧栏「智能体」面板查看实时工作流 + 终态摘要"
        >
          详情
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
              <Suspense fallback={<code className="sc-tool-changediff-loading">差异加载中…</code>}>
              {activity.changeDiff.hunks.map((hunk, hunkIndex) => (
                <CodeMirrorDiffView
                  key={`${activity.key}:${hunkIndex}`}
                  filePath={activity.actionDetail || activity.name}
                  isBinary={false}
                  hunks={[hunk]}
                />
              ))}
              </Suspense>
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
  );
}

function ActivityRow({ activity }: { activity: ToolActivityItem }) {
  const [open, setOpen] = useState(false);
  const duration = formatToolDuration(activity.durationMs);
  // UI-316 — agent 管理类工具用 bot 图标（独立智能体标识），spawn 行内联
  // 显示该子 agent 的实时状态（订阅会话 store 自动更新）。
  const isAgentTool = ACTIVITY_AGENT_TOOLS.has(activity.name);
  const subSnap = useSyncExternalStore(
    activity.agentRunId
      ? (cb) => subscribeSubAgentTask(activity.agentRunId, cb)
      : () => () => {},
    () => (activity.agentRunId ? getSubAgentTaskSnapshot(activity.agentRunId) : null)
  );
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
          <Icon
            name={isAgentTool || activity.agentRunId ? 'bot' : activity.status === 'success' ? 'check' : 'wrench'}
            size={14}
          />
        </span>
        <span className="sc-tool-activity-action">{activity.actionLabel}</span>
        {activity.actionDetail && (
          <code className="sc-tool-activity-command">{activity.actionDetail}</code>
        )}
        {subSnap && (
          <span className="sc-tool-agent-status" data-status={subSnap.status} title="子智能体实时状态">
            <Icon name="bot" size={10} />
            {SUB_STATUS_LABEL[subSnap.status] || subSnap.status}
          </span>
        )}
        <span className="sc-tool-activity-status">{TOOL_STATUS_LABEL[activity.status]}</span>
        {duration && <span className="sc-tool-activity-duration">{duration}</span>}
        <span className="sc-tool-row-chevron" aria-hidden="true">
          <Icon name="chevron-right" size={12} />
        </span>
      </button>
      {open && <ActivityBody activity={activity} subSnap={subSnap} />}
    </div>
  );
}

/** BLOCK-108 P3 — Qoder 行形态的类别图标与状态词。 */
const QODER_WRITE_TOOLS: ReadonlySet<string> = new Set(['workspace_write', 'workspace_replace']);
const QODER_STATUS_WORD: Record<ToolActivityItem['status'], string> = {
  running: '运行中',
  awaiting_confirmation: '等待确认',
  success: '已运行',
  error: '失败',
  denied: '已拒绝',
};

/** UI-431 P2 — 派发行运行计时：running 时每秒步进（impure Date.now 收进 effect）。 */
function useSubAgentElapsed(startedAt: number | undefined, active: boolean): number | null {
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);
  useEffect(() => {
    if (!active || !startedAt) return undefined;
    const timer = setInterval(() => setElapsedMs(Date.now() - startedAt), 1000);
    return () => {
      clearInterval(timer);
      setElapsedMs(null);
    };
  }, [startedAt, active]);
  return elapsedMs;
}

/**
 * BLOCK-108 P3 — Qoder 统一单行行式（时间线模式专属）。
 *
 * 与 legacy 的差别：**所有**活动（含 exec）折叠态都是一行——状态字形 +
 * 类别标签（终端命令 已运行 / actionLabel）+ 单行预览（命令首行 / 路径），
 * 点击才展开（exec=TerminalBody 终端块；其余=ActivityBody 详情体）。
 * 这消除了 legacy「exec 默认展开终端块」的形态，使簇内是纯单行流，
 * 扫一眼即可知道这批工具各自动了什么。
 */
function QoderRow({ activity }: { activity: ToolActivityItem }) {
  const [open, setOpen] = useState(false);
  const duration = formatToolDuration(activity.durationMs);
  const running = activity.status === 'running';
  const isExec = EXEC_TOOL_NAMES.has(activity.name);
  const isAgent = ACTIVITY_AGENT_TOOLS.has(activity.name) || Boolean(activity.agentRunId);
  const command = activity.command || activity.actionDetail || '';
  const previewSource = isExec ? (command.split('\n')[0] || '').slice(0, 120) : (activity.actionDetail || activity.summary || '');
  const subSnap = useSyncExternalStore(
    activity.agentRunId
      ? (cb) => subscribeSubAgentTask(activity.agentRunId, cb)
      : () => () => {},
    () => (activity.agentRunId ? getSubAgentTaskSnapshot(activity.agentRunId) : null)
  );
  // UI-431 P2 — 派发行运行计时（running 时每秒步进）
  const spawnElapsedMs = useSubAgentElapsed(subSnap?.startedAt, subSnap?.status === 'running');
  // UI-437 — ZCode 形态：写入/编辑行带 +N -N 差异角标（changeDiff 为预计算聚合值）。
  const isWrite = QODER_WRITE_TOOLS.has(activity.name);
  const diffStat = activity.changeDiff && (activity.changeDiff.added > 0 || activity.changeDiff.removed > 0)
    ? { added: activity.changeDiff.added, removed: activity.changeDiff.removed }
    : null;
  const kindIcon = isExec ? 'terminal' : isAgent ? 'bot' : isWrite ? 'pencil' : 'file';
  const label = isExec ? `终端命令 ${QODER_STATUS_WORD[activity.status]}` : activity.actionLabel;
  return (
    <div className={`sc-tool-activity sc-tool-qoder-row sc-tool-qoder-row-${activity.status}`} data-status={activity.status}>
      <button
        type="button"
        className="sc-tool-row-head sc-tool-qoder-head"
        data-expanded={open || undefined}
        data-testid="qoder-row-head"
        aria-expanded={open}
        aria-label={open ? `收起 ${label}` : `展开 ${label}`}
        title={open ? '收起' : '展开'}
        onClick={() => setOpen((v) => !v)}
      >
        {running ? (
          <span className="sc-tool-term-spinner" aria-hidden="true" />
        ) : (
          <span className={`sc-tool-qoder-glyph sc-tool-qoder-glyph-${activity.status}`} aria-hidden="true">
            {activity.status === 'success' ? '✓' : activity.status === 'error' || activity.status === 'denied' ? '✕' : '···'}
          </span>
        )}
        <span className="sc-tool-qoder-kind" aria-hidden="true">
          <Icon name={kindIcon} size={12} />
        </span>
        <span className="sc-tool-qoder-label">{label}</span>
        {previewSource && (
          <code className="sc-tool-qoder-preview" title={previewSource}>{previewSource}</code>
        )}
        {diffStat && (
          <span className="sc-tool-qoder-diffstat" aria-label={`变更 +${diffStat.added} -${diffStat.removed}`}>
            {diffStat.added > 0 && <span className="sc-tool-qoder-diffstat-add">+{diffStat.added}</span>}
            {diffStat.removed > 0 && <span className="sc-tool-qoder-diffstat-del">-{diffStat.removed}</span>}
          </span>
        )}
        {subSnap && (
          <span className="sc-tool-agent-status" data-status={subSnap.status} title="子智能体实时状态">
            <Icon name="bot" size={10} />
            {SUB_STATUS_LABEL[subSnap.status] || subSnap.status}
            {/* UI-431 P2 — 派发行运行计时：收缩态也有信息量 */}
            {subSnap.status === 'running' && spawnElapsedMs !== null
              ? ` · ${formatToolDuration(spawnElapsedMs) ?? ''}`
              : typeof subSnap.processingDurationMs === 'number' && subSnap.processingDurationMs > 0
                ? ` · ${formatToolDuration(subSnap.processingDurationMs) ?? ''}`
                : ''}
          </span>
        )}
        {duration && (activity.durationMs ?? 0) > 0 && <span className="sc-tool-activity-duration">{duration}</span>}
        <span className="sc-tool-row-chevron" aria-hidden="true">
          <Icon name={open ? 'chevron-down' : 'chevron-right'} size={12} />
        </span>
      </button>
      {open && (isExec
        ? <TerminalBody activity={activity} />
        : <ActivityBody activity={activity} subSnap={subSnap} />)}
    </div>
  );
}

/**
 * BLOCK-107 P2c（D4 配套）— 运行中秒表：自「本簇首次被观察到有未终结项」起累计墙钟。
 * 数据层没有活动起始时刻（`ToolActivityItem` 只有终态 `durationMs`），故运行态的
 * 秒表只能取渲染侧观察时刻——语义为「从我们看见它在跑起算」，与终态后显示的
 * 活动耗时之和是两套口径，不互相覆盖。首秒不显示（等第一次 tick），转终态即卸载
 * 计时器并清空读数，收起后不再逐秒重渲染。
 */
function useRunningElapsed(active: boolean): number | null {
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);
  useEffect(() => {
    if (!active) return undefined;
    // 锚点留在 effect 闭包里：既不在 render 读 ref，也不在 effect 体内同步 setState
    // （两条 react-hooks 编译规则各拦一头）。起点即本次激活，天然不带上一簇的残余。
    const startedAt = Date.now();
    const timer = setInterval(() => setElapsedMs(Date.now() - startedAt), 1000);
    return () => {
      clearInterval(timer);
      setElapsedMs(null);
    };
  }, [active]);
  return elapsedMs;
}

export function ToolActivityList({
  activities,
  processingDurationMs,
  reasoningByIteration,
  collapseWhenSettled = false,
  showRunningStopwatch = false,
  forceOpen = false,
}: {
  activities: ToolActivityItem[];
  processingDurationMs?: number;
  /** UI-272 — 按迭代聚合的模型思考段，展开时展示每次工具调用前的衔接思路。 */
  reasoningByIteration?: Record<number, string>;
  /**
   * UI-437 v2（ZCode 纯流水，用户裁决「按照流水线走下去就好 总结的味道少一点」）：
   * 无簇头摘要——运行中=「工作中 · 已运行 Ns」头部 + 最新一条事件单行；
   * 完成=全部事件单行常驻（一行一事件，静音可扫读），失败以 error 行可见。
   * 默认 false = legacy 摘要条 + 手风琴（既有调用方契约零变化）。
   */
  collapseWhenSettled?: boolean;
  /** BLOCK-107 P2c — 运行中「已运行 Ns」秒表（时间线的「工作中」头部启用）。 */
  showRunningStopwatch?: boolean;
  /**
   * UI-437 v4 — 运行级展开托管：由 ConversationTimeline 的运行摘要行统管折叠，
   * 本簇无簇头、行常驻（点开运行摘要后才是每轮思考和执行的细节）。
   */
  forceOpen?: boolean;
}): React.ReactElement {
  const [manualExpanded, setManualExpanded] = useState<boolean | null>(null);
  // UI-383 — 常规只读组折叠状态（legacy 组键 = 首项 key；默认折叠，点击就地展开逐条）
  const [unfoldedRoutineGroups, setUnfoldedRoutineGroups] = useState<Set<string>>(new Set());
  const anyRunning = activities.some((activity) => RUNNING_STATUSES.has(activity.status));
  const hasExec = activities.some((activity) => EXEC_TOOL_NAMES.has(activity.name));
  // legacy（非时间线）展开态：含 exec 默认展开；手动态最优先。
  const expanded = manualExpanded !== null ? manualExpanded : hasExec;
  const runningElapsedMs = useRunningElapsed(showRunningStopwatch && anyRunning);

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
    ? `正在处理 ${running}/${activities.length} 项${actionSummary ? ` · ${actionSummary}` : ''}${
      runningElapsedMs !== null ? ` · 已运行 ${formatToolDuration(runningElapsedMs)}` : ''}`
    : awaiting > 0
      ? `等待确认 ${awaiting} 项`
      : `已完成 ${activities.length} 项${attention ? ` · ${attention} 项需注意` : ''}${actionSummary ? ` · ${actionSummary}` : ''}${totalDuration ? ` · 耗时 ${totalDuration}` : ''}`;

  // UI-430 — 簇内按迭代交错：每轮「已思考行 → 该轮工具行」（ZCode 参考形态）。
  const groupOrder: number[] = [];
  const byIteration = new Map<number, ToolActivityItem[]>();
  for (const activity of activities) {
    const key = activity.iteration ?? 0;
    let list = byIteration.get(key);
    if (!list) { list = []; byIteration.set(key, list); groupOrder.push(key); }
    list.push(activity);
  }
  const reasoningMap = reasoningByIteration || {};
  const unmatchedReasoning = Object.entries(reasoningMap)
    .map(([iter, text]) => ({ iteration: Number(iter), text }))
    .filter((entry) => Number.isInteger(entry.iteration) && entry.text.trim() && !byIteration.has(entry.iteration))
    .sort((a, b) => a.iteration - b.iteration);
  const reasoningRows = unmatchedReasoning.map((entry) => (
    <ReasoningRow
      key={`qoder-reasoning-${entry.iteration}`}
      iteration={entry.iteration}
      text={entry.text}
      label="已思考"
    />
  ));
  const renderedIterations = new Set<number>();

  // UI-437 v3/v4（用户裁决「每一轮所有任务都自动折叠 需要再点开」）：完成簇自动折叠
  // 为一行摘要（点簇头展开明细、再点收起）；运行簇=「工作中 · 已运行 Ns」+ 最新
  // 一条事件单行。所有轮次同一规则，无一例外。
  // v4 — forceOpen（运行摘要行已点开）：无簇头，行常驻，细节直接可见。
  if (collapseWhenSettled && forceOpen) {
    return (
      <div className="sc-tool-activity-list" aria-label="工具活动">
        <div className="sc-tool-activity-inline" data-testid="qoder-cluster-body">
          {reasoningRows}
          {groupOrder.map((iterationKey) => (
            <div key={`qoder-iter-${iterationKey}`}>
              {reasoningMap[iterationKey] ? (
                <ReasoningRow
                  iteration={iterationKey}
                  text={reasoningMap[iterationKey]}
                  label="已思考"
                />
              ) : null}
              {(byIteration.get(iterationKey) || []).map((activity) => (
                <QoderRow key={activity.key} activity={activity} />
              ))}
            </div>
          ))}
        </div>
      </div>
    );
  }
  if (collapseWhenSettled) {
    const last = activities[activities.length - 1];
    const runningTail = anyRunning && manualExpanded === null;
    const headOpen = runningTail ? false : (manualExpanded !== null ? manualExpanded : false);
    const singlePreview = activities.length === 1 && activities[0]
      ? `${activities[0].actionLabel}${activities[0].actionDetail ? ` ${activities[0].actionDetail}` : ''}`.slice(0, 64)
      : '';
    const attentionCount = activities.filter(
      (activity) => activity.status === 'error' || activity.status === 'denied'
    ).length;
    const settledDuration = (processingDurationMs ?? totalDurationMs) > 0 ? totalDuration : null;
    const headText = anyRunning
      ? `工作中 · 已运行 ${runningElapsedMs !== null ? formatToolDuration(runningElapsedMs) : '0 s'}`
      : `执行工具 ${activities.length} 次${attentionCount ? ` · ${attentionCount} 项需注意` : ''}${singlePreview ? ` · ${singlePreview}` : ''}${settledDuration ? ` · 耗时 ${settledDuration}` : ''}`;
    return (
      <div className="sc-tool-activity-list" aria-label="工具活动">
        <button
          type="button"
          className="sc-tool-activity-summary"
          data-expanded={headOpen || undefined}
          data-state={anyRunning ? 'running' : 'settled'}
          aria-expanded={headOpen}
          aria-label={headOpen ? '收起执行记录' : '展开执行记录'}
          title={headOpen ? '收起执行记录' : '展开执行记录'}
          onClick={() => setManualExpanded(!headOpen)}
        >
          {anyRunning && <span className="sc-tool-term-spinner" aria-hidden="true" />}
          <span className="sc-tool-activity-summary-label">{headText}</span>
          <Icon name={headOpen ? 'chevron-down' : 'chevron-right'} size={14} />
        </button>
        {(headOpen || runningTail) && (
          <div className="sc-tool-activity-inline" data-testid="qoder-cluster-body">
            {reasoningRows}
            {runningTail && last ? (
              <QoderRow key={last.key} activity={last} />
            ) : groupOrder.map((iterationKey) => (
              <div key={`qoder-iter-${iterationKey}`}>
                {reasoningMap[iterationKey] ? (
                  <ReasoningRow
                    iteration={iterationKey}
                    text={reasoningMap[iterationKey]}
                    label="已思考"
                  />
                ) : null}
                {(byIteration.get(iterationKey) || []).map((activity) => (
                  <QoderRow key={activity.key} activity={activity} />
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="sc-tool-activity-list" aria-label="工具活动">
      <button
        type="button"
        className="sc-tool-activity-summary"
        data-expanded={expanded || undefined}
        aria-expanded={expanded}
        aria-label={expanded ? '收起执行记录' : '展开执行记录'}
        title={expanded ? '收起执行记录' : '展开执行记录'}
        onClick={() => setManualExpanded(!expanded)}
      >
        <span className="sc-tool-activity-summary-label">{summary}</span>
        <Icon name="chevron-right" size={14} />
      </button>
      {expanded && (
        <div className="sc-tool-activity-inline">
          {groupToolActivities(activities).map((group) => {
            const first = group.items[0];
            const firstIterationKey = first.iteration ?? -1;
            const firstIterReasoning =
              first.iteration != null ? reasoningByIteration?.[first.iteration] : undefined;
            const groupStartsIteration = !renderedIterations.has(firstIterationKey);
            if (groupStartsIteration) renderedIterations.add(firstIterationKey);
            const groupKey = `routine-group:${first.key}`;
            const folded = group.kind === 'routine' && group.items.length >= 3
              && !unfoldedRoutineGroups.has(groupKey);
            if (folded) {
              const labelCounts = group.items.reduce<Record<string, number>>((counts, item) => {
                const label = item.actionLabel.replace(/^已/, '') || '处理';
                counts[label] = (counts[label] || 0) + 1;
                return counts;
              }, {});
              const label = Object.entries(labelCounts)
                .map(([action, count]) => `${action} ${count}`)
                .join(' · ');
              return (
                <div key={groupKey}>
                  {groupStartsIteration && firstIterReasoning && (
                    <ReasoningRow iteration={first.iteration as number} text={firstIterReasoning} />
                  )}
                  <button
                    type="button"
                    className="sc-tool-routine-group"
                    title="常规读取已折叠；点击展开逐条记录"
                    onClick={() => setUnfoldedRoutineGroups((prev) => new Set(prev).add(groupKey))}
                  >
                    <Icon name="chevron-right" size={12} />
                    <span>常规读取：{label} · 全部成功</span>
                    <span className="sc-tool-routine-group-note">点击展开</span>
                  </button>
                </div>
              );
            }
            return (
              <div key={groupKey}>
                {groupStartsIteration && firstIterReasoning && (
                  <ReasoningRow iteration={first.iteration as number} text={firstIterReasoning} />
                )}
                {group.items.map((activity) => (
                  <div key={activity.key}>
                    {/* UI-315 — exec 类工具以原生终端块呈现（默认展开），其余保持行式 */}
                    {EXEC_TOOL_NAMES.has(activity.name) ? (
                      <TerminalRow activity={activity} />
                    ) : (
                      <ActivityRow activity={activity} />
                    )}
                  </div>
                ))}
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
