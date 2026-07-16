// ============================================================
// Action card — renders Copilot actions inline in the chat.
//
// Behavior matrix:
//   - navigate / external_link / read   → auto-execute after a 1.2s "cancellable" countdown
//   - start_analysis / recluster        → inline confirm (确认 / 取消), no modal
//
// Visual state:
//   countdown — auto-exec scheduled, "取消" button visible
//   running   — executing
//   done      — succeeded
//   error     — failed (retry button shown)
//   cancelled — user clicked cancel
// ============================================================

import { errMsg } from './error';
import React, { useState, useEffect, useRef } from 'react';
import type { CopilotAction } from './actions';
import { shortDescription } from './actions';
import { dispatchAction, type ActionResult } from './actionBus';

const ICONS: Record<CopilotAction['type'], string> = {
  start_analysis: '🧬',
  recluster: '🔄',
  navigate: '↗',
  external_link: '🔗',
};

const KNOWN_TYPES = new Set<string>(['start_analysis', 'recluster', 'navigate', 'external_link']);

const AUTO_EXEC_TYPES = new Set<CopilotAction['type']>(['navigate', 'external_link']);

const AUTO_EXEC_DELAY_MS = 1200;

export function ActionCard({
  action,
  suppressAutoExec,
}: {
  action: CopilotAction;
  suppressAutoExec?: boolean;
}) {
  const [state, setState] = useState<
    'idle' | 'countdown' | 'running' | 'done' | 'error' | 'cancelled'
  >('idle');
  const [feedback, setFeedback] = useState<string>('');
  const [secondsLeft, setSecondsLeft] = useState<number>(0);
  const autoExecutedRef = useRef(false);
  const countdownTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  const clearTimers = () => {
    if (countdownTimer.current) {
      clearTimeout(countdownTimer.current);
      countdownTimer.current = null;
    }
    if (countdownInterval.current) {
      clearInterval(countdownInterval.current);
      countdownInterval.current = null;
    }
  };

  const run = async () => {
    clearTimers();
    if (state === 'running' || state === 'done') return;
    setState('running');
    setFeedback('');
    let result: ActionResult;
    try {
      result = await dispatchAction(action);
    } catch (e: unknown) {
      result = { ok: false, error: errMsg(e) };
    }
    if (result.ok) {
      setState('done');
      setFeedback(result.message || '已执行');
    } else {
      setState('error');
      setFeedback(result.error);
    }
  };

  const onCancel = () => {
    clearTimers();
    setState('cancelled');
  };

  // Schedule auto-exec with cancellable countdown
  useEffect(() => {
    // Unknown types render null — skip effect entirely to avoid needless state updates.
    if (!KNOWN_TYPES.has(action.type as string)) return;
    if (autoExecutedRef.current) return;
    if (suppressAutoExec) {
      autoExecutedRef.current = true;
      setState('done');
      return;
    }
    if (AUTO_EXEC_TYPES.has(action.type) && state === 'idle') {
      autoExecutedRef.current = true;
      setState('countdown');
      const startedAt = Date.now();
      const tick = () => {
        const elapsed = Date.now() - startedAt;
        const left = Math.max(0, Math.ceil((AUTO_EXEC_DELAY_MS - elapsed) / 100) / 10);
        setSecondsLeft(left);
      };
      tick();
      countdownInterval.current = setInterval(tick, 100);
      countdownTimer.current = setTimeout(() => {
        clearTimers();
        run();
      }, AUTO_EXEC_DELAY_MS);
    }
    return clearTimers;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Silently hide cards for unknown / tool-only types — those ran via tool calls,
  // there's no frontend handler, and showing a red "不支持" error would be misleading.
  // ponytail: early return moved AFTER all hooks — Rules of Hooks requires
  // hooks called unconditionally in the same order every render.
  if (!KNOWN_TYPES.has(action.type as string)) {
    return null;
  }

  const params = (action as unknown as Record<string, unknown>).params as
    | Record<string, unknown>
    | undefined;
  const rationale = (action as unknown as Record<string, unknown>).rationale as string | undefined;
  const needsConfirm = !AUTO_EXEC_TYPES.has(action.type);

  return (
    <div
      className={`cp-action ${state === 'done' ? 'cp-action-done' : ''} ${state === 'error' ? 'cp-action-error' : ''} ${state === 'cancelled' ? 'cp-action-cancelled' : ''} ${AUTO_EXEC_TYPES.has(action.type) ? 'cp-action-auto' : ''}`}
    >
      <div className="cp-action-row">
        <span className="cp-action-icon">{ICONS[action.type] || '•'}</span>
        <div className="cp-action-body">
          <div className="cp-action-label">{action.label || shortDescription(action)}</div>
          <div className="cp-action-sub">{shortDescription(action)}</div>
        </div>
        {needsConfirm ? (
          // Write-op inline confirmation buttons
          state === 'idle' ? (
            <div className="cp-action-confirm">
              <button className="cp-action-cancel" onClick={() => setState('done')} title="取消">
                取消
              </button>
              <button className="cp-action-btn" onClick={run}>
                确认执行
              </button>
            </div>
          ) : (
            <button
              className="cp-action-btn"
              onClick={run}
              disabled={state === 'running' || state === 'done'}
            >
              {state === 'running' && '执行中…'}
              {state === 'done' && '✓ 完成'}
              {state === 'error' && '重试'}
            </button>
          )
        ) : // Auto-exec actions: show status; allow cancel during countdown
        state === 'countdown' ? (
          <div className="cp-action-confirm">
            <button className="cp-action-cancel" onClick={onCancel}>
              取消 ({secondsLeft.toFixed(1)}s)
            </button>
            <button className="cp-action-btn" onClick={run}>
              立即执行
            </button>
          </div>
        ) : (
          <span className={`cp-action-auto-status cp-action-auto-${state}`}>
            {state === 'running' && '⚡ 执行中…'}
            {state === 'done' && '✓ 已执行'}
            {state === 'error' && '✗ 失败'}
            {state === 'cancelled' && '已取消'}
            {state === 'idle' && '⚡ 即将执行'}
          </span>
        )}
      </div>
      {(rationale || (params && Object.keys(params).length > 0)) && (
        <div className="cp-action-detail">
          {rationale && <div className="cp-action-rationale">{rationale}</div>}
          {params && Object.keys(params).length > 0 && (
            <div className="cp-action-params">
              {Object.entries(params).map(([k, v]) => (
                <span key={k} className="cp-action-param">
                  <span className="cp-action-param-k">{k}</span>=
                  <span className="cp-action-param-v">{String(v)}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      )}
      {feedback && state === 'error' && (
        <div className="cp-action-feedback cp-action-feedback-error">{feedback}</div>
      )}
      {feedback && state === 'done' && needsConfirm && (
        <div className="cp-action-feedback">{feedback}</div>
      )}
    </div>
  );
}
