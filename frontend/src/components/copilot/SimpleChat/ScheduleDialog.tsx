import React from 'react';
import { Icon } from '@/components/icons/Icon';
import { createSchedule, fetchAutomation, fetchAutoToolNames } from '@/lib/automationClient';
import styles from './ScheduleDialog.module.css';
import button from '@/components/ui/controls/button.module.css';

export interface ScheduleDialogProps {
  open: boolean;
  projectId?: string;
  prompt: string;
  onClose: () => void;
  onCreated: (title: string) => void;
}

function defaultTitle(prompt: string): string {
  const first = prompt.split('\n').map((line) => line.trim()).find(Boolean) || '定时任务';
  return first.slice(0, 40);
}

/** Q7（BLOCK-256）I2 — composer `/schedule` 确认框：只创建计划，不发送聊天消息。
 *  BLOCK-516 — 唤醒预授权折起区（默认收起）：trusted 档需显式勾选 + 绑定带预算 goal
 *  + 白名单勾选（registry 内置名单；白名单外工具在运行时被硬拒绝，BLOCK-515 执行面）。 */
export function ScheduleDialog({ open, projectId, prompt, onClose, onCreated }: ScheduleDialogProps): React.ReactElement | null {
  const [title, setTitle] = React.useState('');
  const [intervalMinutes, setIntervalMinutes] = React.useState(60);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [lastPrompt, setLastPrompt] = React.useState<string | null>(null);
  const [promptText, setPromptText] = React.useState('');
  const [trusted, setTrusted] = React.useState(false);
  const [goalId, setGoalId] = React.useState('');
  const [goals, setGoals] = React.useState<Array<{ id: string; title: string; status: string; budgetTokens: number; budgetLimited: boolean }>>([]);
  const [toolNames, setToolNames] = React.useState<string[]>([]);
  const [allowlist, setAllowlist] = React.useState<string[]>([]);

  if (open && lastPrompt !== prompt) {
    setLastPrompt(prompt);
    setTitle(defaultTitle(prompt));
    setPromptText(prompt);
    setIntervalMinutes(60);
    setError(null);
    setBusy(false);
  } else if (!open && lastPrompt !== null) {
    setLastPrompt(null);
  }

  if (!open) return null;

  const onTrustedToggle = async (checked: boolean) => {
    setTrusted(checked);
    if (!checked) {
      setGoalId('');
      setAllowlist([]);
      return;
    }
    // 首次展开：拉取带预算 goal 与内置工具名单（各自独立失败不互相阻断）
    if (projectId) {
      try {
        const snap = await fetchAutomation(projectId);
        setGoals((snap.goals || []).filter((g) => g.status === 'active' && Number(g.budgetTokens) > 0 && !g.budgetLimited));
      } catch { /* goal 列表失败：提交时服务端仍会校验并透出 */ }
    }
    if (toolNames.length === 0) {
      try {
        const names = await fetchAutoToolNames();
        setToolNames(names.names || []);
      } catch { /* 名单失败：勾选列表为空，提交时服务端仍会校验 */ }
    }
  };

  const toggleAllowlistTool = (name: string) => {
    setAllowlist((current) => (current.includes(name) ? current.filter((n) => n !== name) : [...current, name]));
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!projectId) {
      setError('请先选择项目：定时计划按项目隔离。');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await createSchedule({
        projectId, title, prompt: promptText, intervalMinutes,
        goalId: trusted && goalId ? goalId : undefined,
        autoMode: trusted ? 'trusted' : undefined,
        autoToolAllowlist: trusted ? allowlist : undefined,
      });
      onCreated(title);
    } catch (e) {
      setError(e instanceof Error ? e.message : '创建定时计划失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.overlay} role="presentation">
      <form className={styles.dialog} role="dialog" aria-modal="true" aria-label="创建定时任务" data-testid="schedule-dialog" onSubmit={(event) => void submit(event)}>
        <div className={styles.head}>
          <Icon name="calendar" size={16} />
          <strong>创建定时任务</strong>
          <button type="button" className={styles.close} onClick={onClose} aria-label="关闭">
            <Icon name="x" size={14} />
          </button>
        </div>
        <label className={styles.field}>
          <span>标题</span>
          <input className={styles.input} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} />
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
          <span>任务 Prompt</span>
          <textarea className={styles.textarea} value={promptText} onChange={(e) => setPromptText(e.target.value)} rows={4} placeholder="到点后交给 agent 的完整指令" data-testid="schedule-dialog-prompt" />
        </label>
        {error && <div className={styles.error} role="alert">{error}</div>}
        <details className={styles.field} data-testid="schedule-dialog-trusted-fold">
          <summary>无人值守预授权（可选，默认关）</summary>
          <label className={styles.field}>
            <input
              type="checkbox"
              data-testid="schedule-dialog-trusted"
              checked={trusted}
              onChange={(e) => void onTrustedToggle(e.target.checked)}
            />
            <span>无人值守以 trusted 档运行（预授权白名单，白名单外工具硬拒绝）</span>
          </label>
          {trusted && (
            <>
              <label className={styles.field}>
                <span>预算 Goal（必选：预算硬顶由 goal 预算执行）</span>
                <select
                  className={styles.input}
                  data-testid="schedule-dialog-goal"
                  value={goalId}
                  onChange={(e) => setGoalId(e.target.value)}
                >
                  <option value="">选择带预算的活跃目标…</option>
                  {goals.map((g) => (
                    <option key={g.id} value={g.id}>{g.title}（预算 {g.budgetTokens}）</option>
                  ))}
                </select>
              </label>
              <div className={styles.field} data-testid="schedule-dialog-allowlist">
                <span>预授权工具白名单（最小只读起步；白名单外运行时硬拒绝）</span>
                {toolNames.map((name) => (
                  <label key={name}>
                    <input
                      type="checkbox"
                      checked={allowlist.includes(name)}
                      onChange={() => toggleAllowlistTool(name)}
                    />
                    <span>{name}</span>
                  </label>
                ))}
                {toolNames.length === 0 && <span>工具名单不可用（可手填提交，服务端会校验）</span>}
              </div>
            </>
          )}
        </details>
        <div className={styles.actions}>
          <button type="submit" className={button.primary} disabled={busy || !promptText.trim()} data-testid="schedule-dialog-submit">
            {busy ? '创建中…' : '创建'}
          </button>
          <button type="button" className={button.ghost} onClick={onClose} disabled={busy}>取消</button>
        </div>
      </form>
    </div>
  );
}
