/**
 * useTurnNotifications — BLOCK-223 回合终态/待审批 → 系统通知。
 *
 * 只负责“什么时候报”：状态从 running 落到终态、或新的审批 token 出现。
 * 是否真弹（偏好/窗口聚焦/去重）由主进程决定，渲染侧不重复判断。
 * 通知不携带对话正文或工具参数。
 */

import { useEffect, useRef } from 'react';
import { getBridge } from '@/lib/desktopBridge';
import { pushNotice } from '@/lib/notification-center';

interface PendingApprovalLike {
  ackToken?: string;
  toolId?: string;
}

export function useTurnNotifications(
  conversationId: string | null | undefined,
  projectId: string | null | undefined,
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
    pushNotice({
      kind: current === 'error' ? 'turn_failed' : 'turn_completed',
      title: current === 'error' ? '本轮失败' : '本轮完成',
      body: current === 'error' ? '执行失败，可在应用内查看原因' : '对话已完成',
      conversationId: conversationId || undefined,
      projectId: projectId || undefined,
    });
    const bridge = getBridge('app');
    if (!bridge?.notify) return;
    void bridge.notify({
      kind: current === 'error' ? 'turn_failed' : 'turn_completed',
      conversationId: conversationId || undefined,
    });
  }, [conversationId, projectId, status]);

  const token = pendingApproval?.ackToken ?? null;
  const toolId = pendingApproval?.toolId;
  useEffect(() => {
    const prev = prevApprovalTokenRef.current;
    prevApprovalTokenRef.current = token;
    if (!conversationId || !token || token === prev) return;
    pushNotice({
      kind: 'approval_required',
      title: '需要确认',
      body: toolId ? `工具 ${toolId} 正在等待授权` : '有工具调用正在等待授权',
      conversationId: conversationId || undefined,
      projectId: projectId || undefined,
    });
    const bridge = getBridge('app');
    if (!bridge?.notify) return;
    void bridge.notify({
      kind: 'approval_required',
      conversationId: conversationId || undefined,
      toolName: toolId || undefined,
      dedupeKey: token,
    });
  }, [conversationId, projectId, token, toolId]);
}
