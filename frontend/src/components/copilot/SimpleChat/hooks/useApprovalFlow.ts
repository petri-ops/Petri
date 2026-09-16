// BLOCK-92 Wave A-3 — 审批流状态簇（自主组件平移，零行为变化）：
// paramDraft / approvalRepair / autoApproveRef + 参数草稿同步与 harness 修复
// 两个 effect + approve/reject 回调 + 只读自动批准门。簇内 hook 相对顺序与
// 原文件一致；调用点在 useChatStream 之后（依赖 send/streaming/accessMode）。
import { useCallback, useEffect, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import type { CopilotContext } from '@/lib/copilotContext';
import { ackRunTool } from '@/components/copilot/copilotClient';
import {
  fetchHarnessToolManifest,
  repairHarnessParams,
  type HarnessToolManifest,
} from '@/lib/harness-client';
import { lookupToolById } from '@/lib/tool-catalog';
import { stringifyParamValue } from '../formatHarness';
import { isToolCallAllowed } from '@/components/copilot/accessModeValidator';
import {
  clearConversationPendingApproval,
  type ConversationPendingApproval,
} from '@/components/copilot/conversationRunStore';
import type { AccessMode } from './useModelAccessMenus';
import type { ApprovalRepairState } from '../types';

interface UseApprovalFlowOptions {
  pendingApproval: ConversationPendingApproval | null;
  streaming: boolean;
  accessMode: AccessMode;
  copilotCtxRef: MutableRefObject<CopilotContext>;
  projectId: string;
  conversationId: string | null;
  send: (
    text: string,
    contextOverride?: Partial<CopilotContext>,
    opts?: { freshTurn?: boolean }
  ) => Promise<boolean>;
}

export function useApprovalFlow(options: UseApprovalFlowOptions): {
  approvalRepair: ApprovalRepairState;
  approvePending: () => Promise<void>;
  rejectPending: () => Promise<void>;
} {
  const { pendingApproval, streaming, accessMode, copilotCtxRef, projectId, conversationId, send } = options;
  const [paramDraft, setParamDraft] = useState<Record<string, string>>({});
  const [approvalRepair, setApprovalRepair] = useState<ApprovalRepairState>({ status: 'idle' });
  const autoApproveRef = useRef<string | null>(null);

  useEffect(() => {
    if (!pendingApproval?.params) {
      setParamDraft({});
      return;
    }
    const draft: Record<string, string> = {};
    Object.entries(pendingApproval.params).forEach(([key, value]) => {
      draft[key] = stringifyParamValue(value);
    });
    setParamDraft(draft);
  }, [pendingApproval]);

  useEffect(() => {
    if (!pendingApproval) {
      setApprovalRepair({ status: 'idle' });
      autoApproveRef.current = null;
      return;
    }
    if (!pendingApproval.toolId) {
      setApprovalRepair({ status: 'skipped', message: '缺少 toolId，暂时保留 agent 给出的原始参数。' });
      return;
    }

    let cancelled = false;
    const originalParams = pendingApproval.params || {};
    setApprovalRepair({ status: 'loading' });

    (async () => {
      try {
        const remoteManifest = await fetchHarnessToolManifest(pendingApproval.toolId || '');
        // BLOCK-83 D4：目录投影自插件；未安装该插件时无回退 manifest（保持既有跳过语义）。
        const catalogTool = await lookupToolById(pendingApproval.toolId);
        const fallbackManifest: HarnessToolManifest | undefined = catalogTool
          ? { id: catalogTool.id, title: catalogTool.title, inputs: catalogTool.inputs }
          : undefined;
        const manifest = remoteManifest || fallbackManifest || null;
        if (!manifest) {
          if (!cancelled) {
            setApprovalRepair({ status: 'skipped', message: '没有找到该工具的 manifest，参数将按原样确认。' });
          }
          return;
        }
        const activeArtifact = copilotCtxRef.current.activeArtifact;
        let response = null;
        if (activeArtifact) {
          try {
            response = await repairHarnessParams({
              scope: 'artifact',
              jobId: activeArtifact.jobId,
              activeArtifactName: activeArtifact.name,
              manifest,
              params: originalParams,
              maxFiles: 500,
            });
          } catch {
            // A stale result directory must not block project-level recovery.
            response = null;
          }
        }
        if (!response || response.diagnostics?.status === 'blocked') {
          response = await repairHarnessParams({
            scope: 'project',
            projectId,
            manifest,
            params: originalParams,
            maxFiles: 500,
          });
        }
        const repair = response.repair;
        if (!repair) {
          if (!cancelled) {
            setApprovalRepair({ status: 'skipped', message: 'Harness 未返回可用修复建议，参数将按原样确认。' });
          }
          return;
        }
        if (cancelled) return;
        setApprovalRepair({ status: 'ready', repair, diagnostics: response.diagnostics || null });
        setParamDraft((current) => {
          const next = { ...current };
          Object.entries(repair.repairedParams || {}).forEach(([key, value]) => {
            const originalValue = stringifyParamValue(originalParams[key]);
            if (next[key] == null || next[key] === originalValue) {
              next[key] = stringifyParamValue(value);
            }
          });
          return next;
        });
      } catch (error) {
        if (!cancelled) {
          setApprovalRepair({
            status: 'error',
            message: error instanceof Error ? error.message : 'Harness 参数修复失败',
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pendingApproval, projectId]);

  const approvePending = useCallback(async () => {
    if (!pendingApproval || streaming) return;
    const mergedParams: Record<string, unknown> = { ...(pendingApproval.params || {}) };
    Object.entries(paramDraft).forEach(([key, value]) => {
      try {
        mergedParams[key] = JSON.parse(value);
      } catch {
        mergedParams[key] = value;
      }
    });
    const { ackToken, toolId } = pendingApproval;
    const acknowledged = await ackRunTool(ackToken, true, {
      projectId: projectId || null,
      conversationId: conversationId || null,
    });
    if (!acknowledged) return;
    if (conversationId) clearConversationPendingApproval(conversationId);
    send(
      `用户已确认开始（ackToken=${ackToken}）。请重调 run_tool(op=run, toolId="${toolId ?? ''}", params=${JSON.stringify(mergedParams)}, ackToken="${ackToken}") 续跑该重操作。`
    );
  }, [conversationId, paramDraft, pendingApproval, projectId, send, streaming]);

  const rejectPending = useCallback(async () => {
    if (!pendingApproval || streaming) return;
    const acknowledged = await ackRunTool(pendingApproval.ackToken, false, {
      projectId: projectId || null,
      conversationId: conversationId || null,
    });
    if (!acknowledged) return;
    if (conversationId) clearConversationPendingApproval(conversationId);
    send('用户取消了该重操作，不要重试。请简短说明已取消，并给出如需继续时应调整哪些参数。');
  }, [conversationId, pendingApproval, projectId, send, streaming]);

  useEffect(() => {
    // BLOCK-20 wire-up: also gate auto-approve through the frontend
    // accessModeValidator so the import is on the consumption path.
    // The boolean result is identical to `accessMode !== 'full'` for
    // the canonical full/read states; calling the validator keeps the
    // contract documented in one place and gives us a single grep
    // target for "where does read-only mode gate UI actions".
    if (
      !pendingApproval
      || streaming
      || !isToolCallAllowed('run_tool', { ...copilotCtxRef.current, accessMode })
    ) return;
    if (approvalRepair.status === 'loading') return;
    if (autoApproveRef.current === pendingApproval.ackToken) return;
    autoApproveRef.current = pendingApproval.ackToken;
    const timer = window.setTimeout(() => {
      void approvePending();
    }, 120);
    return () => window.clearTimeout(timer);
  }, [accessMode, approvalRepair.status, approvePending, pendingApproval, streaming]);

  return { approvalRepair, approvePending, rejectPending };
}
