import { useEffect, useState } from 'react';
import {
  fetchHarnessWorkflowStatus,
  type HarnessWorkflowJobState,
} from '@/lib/harness-client';

export interface HarnessWorkflowStatusState {
  workflow: HarnessWorkflowJobState | null;
  loading: boolean;
  error: string;
}

export function workflowPollDelay(workflow: HarnessWorkflowJobState | null): number | null {
  // BLOCK-102 P4 — 尚无 workflow 的 job 曾以 1.5s 高频空轮询（40 req/min）；
  // 降频到 5s，workflow 出现后恢复 1.5s 跟随。
  if (!workflow) return 5000;
  return workflow.terminal ? null : 1500;
}

export function isDirectRecoveryAction(actionId: string | null | undefined): boolean {
  return actionId === 'reconcile_artifacts' || actionId === 'retry_run';
}

export function useHarnessWorkflowStatus(
  jobId: string | null | undefined,
  enabled = true,
  refreshKey = 0,
): HarnessWorkflowStatusState {
  const [state, setState] = useState<HarnessWorkflowStatusState>({
    workflow: null,
    loading: false,
    error: '',
  });

  useEffect(() => {
    if (!jobId || !enabled) {
      setState({ workflow: null, loading: false, error: '' });
      return;
    }

    let cancelled = false;
    let timer: number | null = null;
    const load = async (initial: boolean) => {
      if (initial) {
        setState((current) => ({ ...current, loading: true, error: '' }));
      }
      try {
        const response = await fetchHarnessWorkflowStatus(jobId);
        if (cancelled) return;
        const workflow = response.workflow || null;
        setState({ workflow, loading: false, error: '' });
        const delay = workflowPollDelay(workflow);
        if (delay != null) timer = window.setTimeout(() => void load(false), delay);
      } catch (error) {
        if (cancelled) return;
        setState({
          workflow: null,
          loading: false,
          error: error instanceof Error ? error.message : 'Workflow 状态读取失败',
        });
        timer = window.setTimeout(() => void load(false), 4000);
      }
    };

    void load(true);
    return () => {
      cancelled = true;
      if (timer != null) window.clearTimeout(timer);
    };
  }, [enabled, jobId, refreshKey]);

  return state;
}
