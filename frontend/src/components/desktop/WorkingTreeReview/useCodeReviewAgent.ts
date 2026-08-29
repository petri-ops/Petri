// BLOCK-25/26 — state machine for the AI review run in the Working Tree
// Review drawer. Owns the review task lifecycle (launch / stream / restore /
// reattach) and the finding selection set; the panel stays presentational.
//
// BLOCK-26 P3: the latest outcome per project survives drawer close/reopen
// via reviewResultStore; a still-running task re-attaches through the SSE
// replay. Unmounting only detaches the stream — the backend task keeps
// running.

import { useCallback, useEffect, useRef, useState } from 'react';

import { cancelReviewTask, launchReview, streamReviewTask } from '@/lib/review-client';
import type { ReviewFinding, ReviewOutputEvent, ReviewTarget } from '@/lib/review-types';
import { clearReviewState, loadReviewState, saveReviewState, type PersistedReviewState } from './reviewResultStore';

export interface ReviewActivityEntry {
  label: string;
  at: number;
}

export interface CodeReviewAgentState {
  phase: 'idle' | 'launching' | 'running' | 'done' | 'error';
  statusText: string | null;
  findings: ReviewFinding[];
  output: ReviewOutputEvent | null;
  error: string | null;
  taskId: string | null;
  selected: Set<number>;
  /** BLOCK-26 P1: rolling tool-activity feed (last entries last). */
  activity: ReviewActivityEntry[];
  startedAt: number | null;
  /** Channel used for the run (persisted last-used value kept by the panel). */
  channelLabel: string | null;
  targetHint: string | null;
}

export interface CodeReviewAgentApi extends CodeReviewAgentState {
  start: (projectId: string, target: ReviewTarget, modelPresetId?: string | null, modelLabel?: string | null) => Promise<void>;
  cancel: () => void;
  reset: () => void;
  toggleFinding: (index: number) => void;
  buildFixPrompt: () => string | null;
  /** BLOCK-26 P3: restore the last outcome / reattach a running task. */
  restore: (projectId: string) => void;
}

function persistedFrom(
  phase: PersistedReviewState['phase'],
  parts: {
    taskId: string | null;
    findings: ReviewFinding[];
    output: ReviewOutputEvent | null;
    error: string | null;
    startedAt: number | null;
    channelLabel: string | null;
    targetHint: string | null;
  },
): PersistedReviewState {
  return {
    phase,
    taskId: parts.taskId,
    findings: parts.findings,
    output: parts.output,
    error: parts.error,
    startedAt: parts.startedAt,
    channelLabel: parts.channelLabel,
    targetHint: parts.targetHint,
  };
}

export function useCodeReviewAgent(): CodeReviewAgentApi {
  const [phase, setPhase] = useState<CodeReviewAgentState['phase']>('idle');
  const [statusText, setStatusText] = useState<string | null>(null);
  const [findings, setFindings] = useState<ReviewFinding[]>([]);
  const [output, setOutput] = useState<ReviewOutputEvent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [activity, setActivity] = useState<ReviewActivityEntry[]>([]);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [channelLabel, setChannelLabel] = useState<string | null>(null);
  const [targetHint, setTargetHint] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const taskIdRef = useRef<string | null>(null);
  const projectIdRef = useRef<string | null>(null);

  // Detach on unmount only — the backend task continues and the next mount
  // re-attaches through the store + SSE replay.
  useEffect(() => () => abortRef.current?.abort(), []);

  const makeStateRef = useRef({ findings, output, error, startedAt, channelLabel, targetHint });
  makeStateRef.current = { findings, output, error, startedAt, channelLabel, targetHint };

  const persist = useCallback((nextPhase: PersistedReviewState['phase'], taskIdValue: string | null) => {
    if (!projectIdRef.current) return;
    const snap = makeStateRef.current;
    saveReviewState(projectIdRef.current, persistedFrom(nextPhase, {
      taskId: taskIdValue,
      findings: snap.findings,
      output: snap.output,
      error: snap.error,
      startedAt: snap.startedAt,
      channelLabel: snap.channelLabel,
      targetHint: snap.targetHint,
    }));
  }, []);

  const subscribe = useCallback((streamTaskId: string, controller: AbortController) => {
    return streamReviewTask(
      streamTaskId,
      {
        onDelta: () => {},
        onStatus: (phaseName, detail) => {
          if (phaseName === 'review_tool') {
            const label = String(detail?.name || '检查');
            const detailText = detail?.detail ? ` ${String(detail.detail)}` : '';
            setStatusText(`评审中 · ${label}${detailText}`);
            setActivity((prev) => [...prev.slice(-7), { label: `${label}${detailText}`, at: Date.now() }]);
          } else if (phaseName === 'review_started') {
            setStatusText('评审中 · 读取变更');
            setActivity((prev) => [...prev.slice(-7), { label: '开始读取变更', at: Date.now() }]);
          } else if (phaseName === 'review_retry') {
            setActivity((prev) => [...prev.slice(-7), { label: '网络抖动，自动重试一次', at: Date.now() }]);
          } else if (phaseName === 'review_finished') {
            setStatusText('整理结论…');
          }
        },
        onReviewOutput: (event) => {
          setOutput(event);
          setFindings(event.findings);
          setStatusText(null);
          // Persist from the event itself — setState snapshots lag here.
          if (projectIdRef.current) {
            const snap = makeStateRef.current;
            saveReviewState(projectIdRef.current, persistedFrom('done', {
              taskId: streamTaskId,
              findings: event.findings,
              output: event,
              error: null,
              startedAt: snap.startedAt,
              channelLabel: snap.channelLabel,
              targetHint: snap.targetHint,
            }));
          }
        },
        onDone: () => {},
        onError: (err) => {
          if (controller.signal.aborted) return;
          setError(err.message);
          setPhase('error');
          if (projectIdRef.current) {
            const snap = makeStateRef.current;
            saveReviewState(projectIdRef.current, persistedFrom('error', {
              taskId: streamTaskId,
              findings: snap.findings,
              output: snap.output,
              error: err.message,
              startedAt: snap.startedAt,
              channelLabel: snap.channelLabel,
              targetHint: snap.targetHint,
            }));
          }
        },
      },
      controller.signal
    );
  }, [persist]);

  const start = useCallback(async (projectId: string, target: ReviewTarget, modelPresetId?: string | null, modelLabel?: string | null) => {
    projectIdRef.current = projectId;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setPhase('launching');
    setStatusText('正在启动评审…');
    setFindings([]);
    setOutput(null);
    setError(null);
    setSelected(new Set());
    setTaskId(null);
    taskIdRef.current = null;
    setActivity([]);
    const startedAtLocal = Date.now();
    setStartedAt(startedAtLocal);
    setChannelLabel(modelLabel ?? null);
    try {
      const launched = await launchReview({ projectId, target, modelPresetId, signal: controller.signal });
      setTaskId(launched.taskId);
      taskIdRef.current = launched.taskId;
      setPhase('running');
      setTargetHint(launched.userFacingHint);
      setStatusText(`评审中 · ${launched.userFacingHint}`);
      if (projectIdRef.current) {
        saveReviewState(projectIdRef.current, persistedFrom('running', {
          taskId: launched.taskId,
          findings: [],
          output: null,
          error: null,
          startedAt: startedAtLocal,
          channelLabel: modelLabel ?? null,
          targetHint: launched.userFacingHint,
        }));
      }
      await subscribe(launched.taskId, controller);
      if (controller.signal.aborted) return;
      setPhase((prev) => (prev === 'error' ? prev : 'done'));
    } catch (e) {
      if (controller.signal.aborted) return;
      setError(e instanceof Error ? e.message : String(e));
      setPhase('error');
      persist('error', taskIdRef.current);
    }
  }, [persist, subscribe]);

  const restore = useCallback((projectId: string) => {
    if (phase !== 'idle') return;
    const saved = loadReviewState(projectId);
    if (!saved) return;
    projectIdRef.current = projectId;
    setFindings(saved.findings);
    setOutput(saved.output);
    setError(saved.error);
    setTaskId(saved.taskId);
    taskIdRef.current = saved.taskId;
    setStartedAt(saved.startedAt);
    setChannelLabel(saved.channelLabel);
    setTargetHint(saved.targetHint);
    if (saved.phase === 'running' && saved.taskId) {
      // Re-attach: the backend task may still be running; the SSE replay
      // (afterSeq=0) re-delivers review_output or the terminal error.
      const controller = new AbortController();
      abortRef.current = controller;
      setPhase('running');
      setStatusText(`评审中 · ${saved.targetHint || '重新连接…'}`);
      void subscribe(saved.taskId, controller)
        .then(() => {
          if (controller.signal.aborted) return;
          setPhase((prev) => (prev === 'error' ? prev : 'done'));
        })
        .catch((e) => {
          if (controller.signal.aborted) return;
          setError(e instanceof Error ? e.message : String(e));
          setPhase('error');
        });
      return;
    }
    setPhase(saved.phase === 'error' ? 'error' : 'done');
  }, [phase, subscribe]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    if (taskIdRef.current) void cancelReviewTask(taskIdRef.current);
    if (projectIdRef.current) clearReviewState(projectIdRef.current);
    setPhase('idle');
    setStatusText(null);
    setActivity([]);
    setStartedAt(null);
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setPhase('idle');
    setStatusText(null);
    setFindings([]);
    setOutput(null);
    setError(null);
    setSelected(new Set());
    setTaskId(null);
    taskIdRef.current = null;
    setActivity([]);
    setStartedAt(null);
    setChannelLabel(null);
    setTargetHint(null);
  }, []);

  const toggleFinding = useCallback((index: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }, []);

  const buildFixPrompt = useCallback((): string | null => {
    if (selected.size === 0 || findings.length === 0) return null;
    const chosen = [...selected]
      .sort((a, b) => a - b)
      .map((index) => findings[index])
      .filter(Boolean);
    if (chosen.length === 0) return null;
    const lines = chosen.map((finding) => {
      const loc = finding.codeLocation;
      return `- [${finding.title}] ${loc.absoluteFilePath}:${loc.lineRange.start}-${loc.lineRange.end}\n  ${finding.body.replace(/\n+/g, '\n  ')}`;
    });
    return `请修复以下代码审阅发现的问题（保持改动最小，不做无关重构）：\n\n${lines.join('\n\n')}`;
  }, [selected, findings]);

  return {
    phase,
    statusText,
    findings,
    output,
    error,
    taskId,
    selected,
    activity,
    startedAt,
    channelLabel,
    targetHint,
    start,
    cancel,
    reset,
    toggleFinding,
    buildFixPrompt,
    restore,
  };
}
