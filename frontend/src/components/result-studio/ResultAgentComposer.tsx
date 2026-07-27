import React from 'react';
import { Icon } from '@/components/icons/Icon';
import type { ResultEditProgressEvent } from '@/components/copilot/copilotClient';
import { isResultStudioContextToken } from '@/lib/result-edit-agent-bridge';
import type { ResultEditSubmission } from './ResultEditPanel';
import styles from './ResultAgentComposer.module.css';

export interface ResultAgentComposerContext {
  status: 'ready' | 'blocked' | 'loading';
  contextToken?: string | null;
  reason?: string | null;
  selectionUsable?: boolean;
  selectionCompatibility?: 'compatible' | 'stale' | 'invalid' | null;
  publicPhases?: string[];
}

function compactPublicProgress(progress: ResultEditProgressEvent[]): Array<{
  phase: string;
  label: string;
  status: string;
}> {
  const byPhase = new Map<string, { phase: string; label: string; status: string }>();
  for (const event of progress) {
    const phase = event.publicPhase;
    if (!phase || !event.publicPhaseLabel) continue;
    byPhase.set(phase, {
      phase,
      label: event.publicPhaseLabel,
      status: event.status,
    });
  }
  return [...byPhase.values()];
}

function readinessMessage(context: ResultAgentComposerContext | null): string {
  if (!context || context.status === 'loading') return '正在绑定当前结果、版本与选择…';
  if (context.status === 'blocked') return context.reason || '当前结果缺少可复现的来源坐标，暂时无法修改。';
  if (!isResultStudioContextToken(context.contextToken)) return '当前结果上下文不完整，请等待刷新后再试。';
  if (context.selectionUsable) return '当前结果、版本和选择已绑定；当前选择会一并绑定给 Agent。';
  if (context.selectionCompatibility === 'stale') return '结果与版本已绑定；过期选择不会交给 Agent，请重新选择。';
  if (context.selectionCompatibility === 'invalid') return '结果与版本已绑定；不可用选择不会交给 Agent。';
  return '当前结果与版本已绑定；你只需描述希望发生的变化。';
}

function publicStatusLabel(status: string): string {
  if (status === 'completed' || status === 'ready') return '已完成';
  if (status === 'blocked') return '已阻断';
  return '进行中';
}

/** P4R-3 — result-focus natural-language editing entry. */
export function ResultAgentComposer({
  context,
  draft,
  onDraftChange,
  onSubmit,
  submitting = false,
  progress = [],
}: {
  context: ResultAgentComposerContext | null;
  draft: string;
  onDraftChange: (next: string) => void;
  onSubmit: (submission: ResultEditSubmission) => boolean | void;
  submitting?: boolean;
  progress?: ResultEditProgressEvent[];
}): React.ReactElement {
  const token = context?.contextToken;
  const ready = context?.status === 'ready' && isResultStudioContextToken(token);
  const canSubmit = ready && !submitting && draft.trim().length > 0;
  const publicProgress = React.useMemo(() => compactPublicProgress(progress), [progress]);
  const terminalProgress = React.useMemo(
    () => [...progress].reverse().find((event) => event.status === 'terminal') || null,
    [progress],
  );

  const submit = React.useCallback(() => {
    const requestedOutcome = draft.trim();
    if (!canSubmit || !isResultStudioContextToken(token)) return;
    const accepted = onSubmit({
      origin: 'agent',
      requestedOutcome,
      parameterPatch: {},
      scientificConfirmed: false,
      contextToken: token,
    });
    if (accepted !== false) onDraftChange('');
  }, [canSubmit, draft, onDraftChange, onSubmit, token]);

  return (
    <section className={styles.root} aria-label="用 Agent 修改当前结果" data-state={context?.status || 'loading'}>
      <div className={styles.heading}>
        <div>
          <strong>告诉 Agent 你想怎么改</strong>
          <span>{readinessMessage(context)}</span>
        </div>
        <span className={styles.binding} data-ready={ready}>{ready ? '上下文已绑定' : '暂不可提交'}</span>
      </div>
      <div className={styles.composerRow}>
        <textarea
          aria-label="描述你希望当前结果发生什么变化"
          rows={2}
          value={draft}
          placeholder="例如：换成色盲友好配色，并让标签更容易阅读"
          disabled={submitting}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              submit();
            }
          }}
        />
        <button type="button" disabled={!canSubmit} onClick={submit}>
          <Icon name="sparkles" size={14} />
          交给 Agent
        </button>
      </div>
      <div className={styles.note}>
        <span>Agent 先给出参数 Patch 和影响边界；科学、数据或流程变化只有具备真实工作流来源时才可规划，否则会阻断。</span>
        <span>⌘/Ctrl + Enter 发送</span>
      </div>
      {publicProgress.length > 0 && (
        <ol className={styles.progress} aria-label="结果修改公开进度">
          {publicProgress.map((item) => (
            <li key={item.phase} data-status={item.status}>
              <span>{item.label}</span>
              <small>{publicStatusLabel(item.status)}</small>
            </li>
          ))}
        </ol>
      )}
      {terminalProgress && (
        <p className={styles.terminal} role="status">
          {terminalProgress.stage === 'cancelled' ? '修改已停止' : '修改未完成'}
        </p>
      )}
    </section>
  );
}
