import React from 'react';
import { Icon } from '@/components/icons/Icon';
import { createSchedule } from '@/lib/automationClient';
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

/** Q7（BLOCK-256）I2 — composer `/schedule` 确认框：只创建计划，不发送聊天消息。 */
export function ScheduleDialog({ open, projectId, prompt, onClose, onCreated }: ScheduleDialogProps): React.ReactElement | null {
  const [title, setTitle] = React.useState('');
  const [intervalMinutes, setIntervalMinutes] = React.useState(60);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [lastPrompt, setLastPrompt] = React.useState<string | null>(null);
  const [promptText, setPromptText] = React.useState('');

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

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!projectId) {
      setError('请先选择项目：定时计划按项目隔离。');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await createSchedule({ projectId, title, prompt: promptText, intervalMinutes });
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
