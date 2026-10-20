/**
 * useTurnNotifications — BLOCK-223 回合终态/待审批 → 系统通知。
 *
 * 只负责“什么时候报”：状态从 running 落到终态、或新的审批 token 出现。
 * 是否真弹（偏好/窗口聚焦/去重）由主进程决定，渲染侧不重复判断。
 * 通知不携带对话正文或工具参数。
 */

import { useEffect, useRef } from 'react';
import { getBridge } from '@/lib/desktopBridge';

interface PendingApprovalLike {
  ackToken?: string;
  toolId?: string;
}

export function useTurnNotifications(
  conversationId: string | null | undefined,
  status: string | null | undefined,
  pendingApproval: PendingApprovalLike | null | undefined
): void {
  const prevStatusRef = useRef<string | null>(null);
  const prevApprovalTokenRef = useRef<string | null>(null);

  useEffect(() => {
    const current = status ?? null;
    const prev = prevStatusRef.current;
    prevStatusRef.current = current;
    if (!conversationId || !current || current === 'running' || prev !== 'running') return;
    const bridge = getBridge('app');
    if (!bridge?.notify) return;
    void bridge.notify({
      kind: current === 'error' ? 'turn_failed' : 'turn_completed',
      conversationId: conversationId || undefined,
    });
  }, [conversationId, status]);

  const token = pendingApproval?.ackToken ?? null;
  const toolId = pendingApproval?.toolId;
  useEffect(() => {
    const prev = prevApprovalTokenRef.current;
    prevApprovalTokenRef.current = token;
    if (!conversationId || !token || token === prev) return;
    const bridge = getBridge('app');
    if (!bridge?.notify) return;
    void bridge.notify({
      kind: 'approval_required',
      conversationId: conversationId || undefined,
      toolName: toolId || undefined,
      dedupeKey: token,
    });
  }, [conversationId, token, toolId]);
}
