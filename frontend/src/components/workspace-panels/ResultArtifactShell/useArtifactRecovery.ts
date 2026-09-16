import { useCallback, useEffect, useState } from 'react';
import type { ToolJob } from '@/lib/project-types';
import { runHarnessWorkflowAction, type HarnessWorkflowJobState } from '@/lib/harness-client';
import { isDirectRecoveryAction } from '@/hooks/useHarnessWorkflowStatus';

// BLOCK-92 Wave B-2 — 恢复动作状态簇外迁（原 ResultArtifactShell 内联，纯搬运零行为变化）：
// workflow 恢复动作的两段式确认（request → pendingRecovery → resolve）与忙/错状态。
interface UseArtifactRecoveryOptions {
  job: ToolJob | null;
  workflow: HarnessWorkflowJobState | null;
  onAskAgent: (prompt: string) => void;
  onWorkflowChanged?: () => void;
}

type RecoveryAction = NonNullable<HarnessWorkflowJobState['nextActions']>[number];

export function useArtifactRecovery(options: UseArtifactRecoveryOptions): {
  recoveryAction: RecoveryAction | null;
  recoveryBusy: boolean;
  pendingRecovery: { actionId: string; label: string; token: string } | null;
  recoveryError: string;
  requestRecovery: () => Promise<void>;
  resolveRecovery: (confirm: boolean) => Promise<void>;
} {
  const { job, workflow, onAskAgent, onWorkflowChanged } = options;

  const [pendingRecovery, setPendingRecovery] = useState<{
    actionId: string;
    label: string;
    token: string;
  } | null>(null);
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [recoveryError, setRecoveryError] = useState('');

  useEffect(() => {
    setPendingRecovery(null);
    setRecoveryError('');
  }, [job?.id]);

  const recoveryAction = workflow?.nextActions?.[0] || null;
  const actionRunsDirectly = isDirectRecoveryAction(recoveryAction?.id);

  const requestRecovery = useCallback(async () => {
    if (!job || !recoveryAction) return;
    if (!actionRunsDirectly) {
      onAskAgent(
        `请处理任务 ${job.id} 的 ${recoveryAction.label}。先说明原因和拟采取的操作，得到我确认后再执行。`,
      );
      return;
    }
    setRecoveryBusy(true);
    setRecoveryError('');
    try {
      const response = await runHarnessWorkflowAction({
        jobId: job.id,
        actionId: recoveryAction.id,
      });
      if (!response.confirmationToken) throw new Error('未获得恢复确认凭证');
      setPendingRecovery({
        actionId: recoveryAction.id,
        label: recoveryAction.label,
        token: response.confirmationToken,
      });
    } catch (error) {
      setRecoveryError(error instanceof Error ? error.message : '恢复请求失败');
    } finally {
      setRecoveryBusy(false);
    }
  }, [actionRunsDirectly, job, onAskAgent, recoveryAction]);

  const resolveRecovery = useCallback(async (confirm: boolean) => {
    if (!job || !pendingRecovery) return;
    setRecoveryBusy(true);
    setRecoveryError('');
    try {
      await runHarnessWorkflowAction({
        jobId: job.id,
        actionId: pendingRecovery.actionId,
        confirmationToken: pendingRecovery.token,
        confirm,
      });
      setPendingRecovery(null);
      if (confirm) onWorkflowChanged?.();
    } catch (error) {
      setRecoveryError(error instanceof Error ? error.message : '恢复操作失败');
    } finally {
      setRecoveryBusy(false);
    }
  }, [job, onWorkflowChanged, pendingRecovery]);

  return {
    recoveryAction,
    recoveryBusy,
    pendingRecovery,
    recoveryError,
    requestRecovery,
    resolveRecovery,
  };
}
