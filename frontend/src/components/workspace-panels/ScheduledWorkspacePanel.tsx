import React from 'react';
import { Icon } from '@/components/icons/Icon';
import {
  ackReminder,
  createSchedule,
  deleteSchedule,
  fetchAutomation,
  runSchedule,
  setGoalStatus,
  toggleSchedule,
  type AutomationGoal,
  type AutomationReminder,
  type AutomationRun,
  type AutomationSchedule,
  type AutomationSnapshot,
  type GoalStatus,
  type ScheduleKind,
} from '@/lib/automationClient';
import styles from './ScheduledWorkspacePanel.module.css';
import button from '@/components/ui/controls/button.module.css';

const GOAL_STATUS_LABELS: Record<GoalStatus, string> = {
  active: '进行中',
  paused: '已暂停',
  completed: '已完成',
  blocked: '阻塞',
};

const RUN_STATUS_LABELS: Record<string, string> = {
  queued: '排队',
  running: '运行中',
  completed: '完成',
  failed: '失败',
  reminder: '提醒',
  skipped_budget: '预算跳过',
  skipped_goal: '目标跳过',
};

function formatTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : '—';
}

function statusClass(status: string): string {
  if (status === 'completed' || status === 'reminder') return styles.statusOk;
  if (status === 'failed') return styles.statusError;
  if (status === 'skipped_budget' || status === 'skipped_goal') return styles.statusWarn;
  if (status === 'running' || status === 'queued') return styles.statusRunning;
  return '';
}

function GoalCard({
  goal,
  busy,
  onStatus,
}: {
  goal: AutomationGoal;
  busy: boolean;
  onStatus: (status: GoalStatus) => void;
}): React.ReactElement {
  return (
    <div className={styles.card} data-testid={`automation-goal-${goal.id}`}>
      <div className={styles.cardHead}>
        <span className={styles.cardTitle}>{goal.title}</span>
        <span className={`${styles.badge} ${goal.budgetLimited ? styles.statusError : goal.usageLimited ? styles.statusWarn : ''}`}>
          {GOAL_STATUS_LABELS[goal.status]}
          {goal.budgetLimited ? ' · 预算用尽' : goal.usageLimited ? ' · 接近预算' : ''}
        </span>
      </div>
      {goal.description && <p className={styles.meta}>{goal.description}</p>}
      <div className={styles.progressTrack} title={`${goal.usageTokens} / ${goal.budgetTokens || '未设'} tokens`}>
        <span className={styles.progressFill} style={{ width: `${Math.round(goal.usagePct * 100)}%` }} />
      </div>
      <div className={styles.metaRow}>
        <span>{goal.budgetTokens > 0 ? `用量 ${goal.usageTokens} / 预算 ${goal.budgetTokens} tokens` : `用量 ${goal.usageTokens} tokens · 未设预算`}</span>
        <span>已用 {Math.max(1, Math.round(goal.elapsedMs / 60000))} 分钟</span>
      </div>
      <div className={styles.cardActions}>
        {goal.status === 'active' && (
          <button type="button" className={button.ghost} disabled={busy} onClick={() => onStatus('paused')}>暂停</button>
        )}
        {(goal.status === 'paused' || goal.status === 'blocked') && (
          <button type="button" className={button.ghost} disabled={busy} onClick={() => onStatus('active')}>恢复</button>
        )}
        {goal.status !== 'completed' && (
          <button type="button" className={button.ghost} disabled={busy} onClick={() => onStatus('completed')}>完成</button>
        )}
        {goal.status === 'completed' && (
          <button type="button" className={button.ghost} disabled={busy} onClick={() => onStatus('active')}>重开</button>
        )}
      </div>
    </div>
  );
}

function RunRow({
  run,
  onOpenConversation,
}: {
  run: AutomationRun;
  onOpenConversation?: (id: string) => void;
}): React.ReactElement {
  return (
    <div className={styles.runRow} data-testid={`automation-run-${run.id}`}>
      <span className={`${styles.runStatus} ${statusClass(run.status)}`}>{RUN_STATUS_LABELS[run.status] || run.status}</span>
      <span className={styles.runTitle}>{run.schedule_title || run.schedule_id}</span>
      <span className={styles.meta}>{formatTime(run.started_at)}</span>
      {run.task_id && <span className={styles.mono}>task {run.task_id.slice(0, 8)}</span>}
      {run.conversation_id && onOpenConversation && (
        <button type="button" className={button.ghost} onClick={() => onOpenConversation(run.conversation_id as string)}>
          打开会话
        </button>
      )}
      {run.error && <span className={styles.errorText} title={run.error}>{run.error.slice(0, 80)}</span>}
    </div>
  );
}

export interface ScheduledWorkspacePanelProps {
  projectId?: string;
  onBackToChat: () => void;
  onOpenConversation?: (id: string) => void;
}

/**
 * Q7（BLOCK-256）自动化与目标看板。
 * 数据只来自 /api/automation；动作只调 REST，不在前端维护第二份状态。
 */
export function ScheduledWorkspacePanel({
  projectId,
  onBackToChat,
  onOpenConversation,
}: ScheduledWorkspacePanelProps): React.ReactElement {
  const [snapshot, setSnapshot] = React.useState<AutomationSnapshot | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [formOpen, setFormOpen] = React.useState(false);
  const [title, setTitle] = React.useState('');
  const [prompt, setPrompt] = React.useState('');
  const [kind, setKind] = React.useState<ScheduleKind>('task');
  const [intervalMinutes, setIntervalMinutes] = React.useState(60);
  const [reminderText, setReminderText] = React.useState('');
  const [workflowScript, setWorkflowScript] = React.useState('');
  const [workflowArgsText, setWorkflowArgsText] = React.useState('');
  const [goalId, setGoalId] = React.useState('');

  const refresh = React.useCallback(async () => {
    if (!projectId) return;
    try {
      const data = await fetchAutomation(projectId);
      setSnapshot(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '自动化数据加载失败');
    }
  }, [projectId]);

  React.useEffect(() => {
    if (!projectId) return undefined;
    void Promise.resolve().then(refresh);
    const timer = window.setInterval(() => { void refresh(); }, 10_000);
    return () => window.clearInterval(timer);
  }, [projectId, refresh]);

  const act = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(true);
    setNotice(null);
    try {
      await fn();
      setNotice(label);
      await refresh();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : `${label}失败`);
    } finally {
      setBusy(false);
    }
  };

  const submitCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!projectId) return;
    let workflowArgs: Record<string, unknown> | null = null;
    if (kind === 'workflow' && workflowArgsText.trim()) {
      try {
        const parsed = JSON.parse(workflowArgsText) as unknown;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('args_not_object');
        workflowArgs = parsed as Record<string, unknown>;
      } catch {
        setNotice('工作流参数必须是 JSON 对象');
        return;
      }
    }
    await act('定时计划已创建', () => createSchedule({
      projectId,
      title,
      prompt,
      kind,
      intervalMinutes,
      reminderText,
      workflowScript,
      workflowArgs,
      goalId: goalId || null,
    }));
    setFormOpen(false);
    setTitle('');
    setPrompt('');
    setReminderText('');
    setWorkflowScript('');
    setWorkflowArgsText('');
    setGoalId('');
  };

  const schedules: AutomationSchedule[] = snapshot?.schedules ?? [];
  const goals: AutomationGoal[] = snapshot?.goals ?? [];
  const runs: AutomationRun[] = snapshot?.runs ?? [];
  const reminders: AutomationReminder[] = snapshot?.reminders ?? [];

  return (
    <div className={styles.root} data-testid="automation-panel">
      <div className={styles.header}>
        <button type="button" className={button.backBtn} onClick={onBackToChat}>
          <Icon name="message-circle" size={14} />
          <span>返回对话</span>
        </button>
        <span className={styles.headerTitle}>自动化与目标</span>
        <button type="button" className={button.ghost} onClick={() => void refresh()} disabled={busy}>
          <Icon name="refresh" size={13} />
          刷新
        </button>
      </div>

      {!projectId && <div className={styles.empty}>请先选择项目：定时任务与目标按项目隔离。</div>}
      {error && <div className={styles.errorBox} role="alert">{error}</div>}
      {notice && <div className={styles.noticeBox} role="status">{notice}</div>}

      {projectId && (
        <div className={styles.body}>
          <section className={styles.section}>
            <div className={styles.sectionHead}>
              <h3 className={styles.sectionTitle}>定时任务</h3>
              <button type="button" className={button.primary} onClick={() => setFormOpen((open) => !open)}>
                <Icon name="plus" size={13} />
                新建
              </button>
            </div>
            {formOpen && (
              <form className={styles.form} onSubmit={(event) => void submitCreate(event)}>
                <div className={styles.formGrid}>
                  <label className={styles.field}>
                    <span>标题</span>
                    <input className={styles.input} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例如：每日质控汇总" />
                  </label>
                  <label className={styles.field}>
                    <span>类型</span>
                    <select className={styles.input} value={kind} onChange={(e) => setKind(e.target.value as ScheduleKind)}>
                      <option value="task">自动分析</option>
                      <option value="workflow">工作流</option>
                      <option value="reminder">提醒</option>
                    </select>
                  </label>
                  <label className={styles.field}>
                    <span>间隔（分钟）</span>
                    <input
                      className={styles.input}
                      type="number"
                      min={1}
                      max={10080}
                      value={intervalMinutes}
                      onChange={(e) => setIntervalMinutes(Number(e.target.value) || 60)}
                    />
                  </label>
                  <label className={styles.field}>
                    <span>关联目标（可选）</span>
                    <select className={styles.input} value={goalId} onChange={(e) => setGoalId(e.target.value)}>
                      <option value="">不关联</option>
                      {goals.filter((goal) => goal.status === 'active' || goal.status === 'paused').map((goal) => (
                        <option key={goal.id} value={goal.id}>{goal.title}</option>
                      ))}
                    </select>
                  </label>
                </div>
                {kind === 'task' && (
                  <label className={styles.field}>
                    <span>任务 Prompt</span>
                    <textarea className={styles.textarea} value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={3} placeholder="到点后交给 agent 的完整指令" />
                  </label>
                )}
                {kind === 'workflow' && (
                  <>
                    <label className={styles.field}>
                      <span>工作流脚本</span>
                      <textarea
                        className={styles.textarea}
                        value={workflowScript}
                        onChange={(e) => setWorkflowScript(e.target.value)}
                        rows={8}
                        placeholder={"export const meta = { name: 'scheduled-review', version: 1 }\nexport default async function run(ctx) { await agent({ prompt: '…' }); }"}
                      />
                    </label>
                    <label className={styles.field}>
                      <span>工作流参数（JSON 对象，可选）</span>
                      <textarea className={styles.textarea} value={workflowArgsText} onChange={(e) => setWorkflowArgsText(e.target.value)} rows={3} placeholder='{ "focus": "每日质控" }' />
                    </label>
                  </>
                )}
                {kind === 'reminder' && (
                  <label className={styles.field}>
                    <span>提醒文本</span>
                    <input className={styles.input} value={reminderText} onChange={(e) => setReminderText(e.target.value)} placeholder="到点后进入通知中心的提醒" />
                  </label>
                )}
                <div className={styles.formActions}>
                  <button type="submit" className={button.primary} disabled={busy}>创建</button>
                  <button type="button" className={button.ghost} onClick={() => setFormOpen(false)}>取消</button>
                </div>
              </form>
            )}

            {schedules.length === 0 ? (
              <div className={styles.empty}>还没有定时计划。新建一个，或在对话里用 `/schedule`。</div>
            ) : (
              <div className={styles.cards}>
                {schedules.map((schedule) => (
                  <div key={schedule.id} className={styles.card} data-testid={`automation-schedule-${schedule.id}`}>
                    <div className={styles.cardHead}>
                      <span className={styles.cardTitle}>{schedule.title}</span>
                      <span className={`${styles.badge} ${schedule.enabled ? styles.statusOk : ''}`}>
                        {schedule.kind === 'reminder' ? '提醒' : schedule.kind === 'workflow' ? '工作流' : '分析'} · {schedule.enabled ? '启用' : '暂停'}
                      </span>
                    </div>
                    <div className={styles.metaRow}>
                      <span>每 {schedule.interval_minutes} 分钟</span>
                      <span>下次 {formatTime(schedule.next_run_at)}</span>
                      {schedule.goal && <span>目标：{schedule.goal.title}{schedule.goal.budgetLimited ? '（预算用尽）' : ''}</span>}
                    </div>
                    {schedule.lastRun && (
                      <div className={styles.metaRow}>
                        <span className={`${styles.runStatus} ${statusClass(schedule.lastRun.status)}`}>
                          {RUN_STATUS_LABELS[schedule.lastRun.status] || schedule.lastRun.status}
                        </span>
                        <span>{formatTime(schedule.lastRun.started_at)}</span>
                      </div>
                    )}
                    <div className={styles.cardActions}>
                      <button
                        type="button"
                        className={button.ghost}
                        disabled={busy}
                        onClick={() => void act('已切换计划状态', () => toggleSchedule(schedule.id, !schedule.enabled))}
                      >
                        {schedule.enabled ? '暂停' : '启用'}
                      </button>
                      <button
                        type="button"
                        className={button.ghost}
                        disabled={busy}
                        onClick={() => void act('已提交运行', async () => {
                          const result = await runSchedule(schedule.id);
                          if (result.result.status === 'failed') throw new Error(result.result.error || '运行失败');
                        })}
                      >
                        <Icon name="play" size={12} />
                        立即运行
                      </button>
                      <button
                        type="button"
                        className={button.danger}
                        disabled={busy}
                        onClick={() => void act('已删除计划', () => deleteSchedule(schedule.id))}
                      >
                        <Icon name="trash" size={12} />
                        删除
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className={styles.section}>
            <div className={styles.sectionHead}>
              <h3 className={styles.sectionTitle}>目标</h3>
            </div>
            {goals.length === 0 ? (
              <div className={styles.empty}>还没有目标。让 Agent 用 `create_goal` 建一个，或继续对话时声明目标。</div>
            ) : (
              <div className={styles.cards}>
                {goals.map((goal) => (
                  <GoalCard
                    key={goal.id}
                    goal={goal}
                    busy={busy}
                    onStatus={(status) => void act('目标状态已更新', () => setGoalStatus(goal.id, status))}
                  />
                ))}
              </div>
            )}
          </section>

          <section className={styles.section}>
            <div className={styles.sectionHead}>
              <h3 className={styles.sectionTitle}>最近运行</h3>
            </div>
            {runs.length === 0 ? (
              <div className={styles.empty}>还没有运行记录。</div>
            ) : (
              <div className={styles.runs}>{runs.slice(0, 12).map((run) => <RunRow key={run.id} run={run} onOpenConversation={onOpenConversation} />)}</div>
            )}
          </section>

          <section className={styles.section}>
            <div className={styles.sectionHead}>
              <h3 className={styles.sectionTitle}>提醒</h3>
            </div>
            {reminders.length === 0 ? (
              <div className={styles.empty}>没有未确认提醒。</div>
            ) : (
              <div className={styles.runs}>
                {reminders.map((reminder) => (
                  <div key={reminder.id} className={styles.reminderRow} data-testid={`automation-reminder-${reminder.id}`}>
                    <Icon name="bell" size={13} />
                    <span className={styles.runTitle}>{reminder.message}</span>
                    <span className={styles.meta}>{formatTime(reminder.due_at)}</span>
                    <button type="button" className={button.ghost} onClick={() => void act('提醒已确认', () => ackReminder(reminder.id))}>
                      确认
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
