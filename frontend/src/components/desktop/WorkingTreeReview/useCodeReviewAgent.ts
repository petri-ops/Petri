// BLOCK-25 — state machine for the AI review run in the Working Tree Review
// drawer. Owns the review task lifecycle and the finding selection set; the
// panel component stays presentational.

import { useCallback, useEffect, useRef, useState } from 'react';

import { cancelReviewTask, launchReview, streamReviewTask } from '@/lib/review-client';
import type { ReviewFinding, ReviewOutputEvent, ReviewTarget } from '@/lib/review-types';

export interface CodeReviewAgentState {
  phase: 'idle' | 'launching' | 'running' | 'done' | 'error';
  statusText: string | null;
  findings: ReviewFinding[];
  output: ReviewOutputEvent | null;
  error: string | null;
  taskId: string | null;
  selected: Set<number>;
}

export interface CodeReviewAgentApi extends CodeReviewAgentState {
  start: (projectId: string, target: ReviewTarget, modelPresetId?: string | null) => Promise<void>;
  cancel: () => void;
  reset: () => void;
  toggleFinding: (index: number) => void;
  buildFixPrompt: () => string | null;
}

export function useCodeReviewAgent(): CodeReviewAgentApi {
  const [phase, setPhase] = useState<CodeReviewAgentState['phase']>('idle');
  const [statusText, setStatusText] = useState<string | null>(null);
  const [findings, setFindings] = useState<ReviewFinding[]>([]);
  const [output, setOutput] = useState<ReviewOutputEvent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const abortRef = useRef<AbortController | null>(null);
  const taskIdRef = useRef<string | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const start = useCallback(async (projectId: string, target: ReviewTarget, modelPresetId?: string | null) => {
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
    try {
      const launched = await launchReview({ projectId, target, modelPresetId, signal: controller.signal });
      setTaskId(launched.taskId);
      taskIdRef.current = launched.taskId;
      setPhase('running');
      setStatusText(`评审中 · ${launched.userFacingHint}`);
      await streamReviewTask(
        launched.taskId,
        {
          onDelta: () => {},
          onStatus: (phaseName, detail) => {
            if (phaseName === 'review_tool') {
              setStatusText(`评审中 · 检查 ${String(detail?.name || '仓库')}`);
            } else if (phaseName === 'review_started') {
              setStatusText('评审中 · 读取变更');
            } else if (phaseName === 'review_finished') {
              setStatusText('整理结论…');
            }
          },
          onReviewOutput: (event) => {
            setOutput(event);
            setFindings(event.findings);
            setStatusText(null);
          },
          onDone: () => {},
          onError: (err) => {
            if (controller.signal.aborted) return;
            setError(err.message);
            setPhase('error');
          },
        },
        controller.signal
      );
      if (controller.signal.aborted) return;
      setPhase((prev) => (prev === 'error' ? prev : 'done'));
    } catch (e) {
      if (controller.signal.aborted) return;
      setError(e instanceof Error ? e.message : String(e));
      setPhase('error');
    }
  }, []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    if (taskIdRef.current) void cancelReviewTask(taskIdRef.current);
    setPhase('idle');
    setStatusText(null);
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
    start,
    cancel,
    reset,
    toggleFinding,
    buildFixPrompt,
  };
}
