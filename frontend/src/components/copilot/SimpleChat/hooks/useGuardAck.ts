/**
 * SimpleChat/hooks/useGuardAck.ts — BLOCK-171 CP-2 确认通道卡状态簇（W5b 第一刀
 * BLOCK-414 从 SimpleChat.tsx 原位平移；零行为变化——逻辑逐行保持，仅容器变更）。
 *
 * 簇内容：
 *   - ackedGuardKeys（本地已裁定键）+ guardAckBusy + guardAckNotice（5s 自动消退）
 *   - pendingGuardAck：从 run 快照工具活动派生最新一条待确认拒绝
 *     （dynamic_guard / user_rule_require_ack / mcp_trust_required 且带 guardKey；已裁定键跳过）
 *   - handleGuardAck / handleGuardDismiss：批准/拒绝上送（guard-ack 端点）
 *
 * 依赖注入：activeRun 由 SimpleChat 的 useConversationRun 传入（hook 顺序保持原位）。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { getPlatformApiPrefix, getToken } from '@/lib/authClient';
import { getConversationRunSnapshot, type ConversationRunSnapshot } from '@/components/copilot/conversationRunStore';

interface GuardAckActivity {
  status?: string;
  name?: string;
  resultData?: {
    error?: string; reason?: string; guardKey?: string; message?: string;
    requestId?: string; command?: string; spans?: Array<{ start: number; end: number; kind: string }>;
  };
  approval?: {
    requestId?: string;
    guardKey?: string;
    approvalVariant?: 'danger' | 'warning' | 'info';
    source?: 'main' | 'side-task';
    intent?: { action?: string; impact?: string; reversible?: string; reason?: string };
    explanation?: string;
    command?: string | null;
    spans?: Array<{ start: number; end: number; kind: string }> | null;
    argsPreview?: string | null;
    inputEditable?: boolean;
    pendingRequestCount?: number;
    duplicatePending?: boolean;
    mcpServerId?: string | null;
    expiresAt?: string;
    message?: string;
  };
}

export interface PendingGuardAck {
  guardKey: string;
  toolName: string;
  message: string;
  requestId?: string;
  command: string | null;
  spans: Array<{ start: number; end: number; kind: string }> | null;
  variant: 'danger' | 'warning' | 'info' | 'sideTask';
  intent: { action?: string; impact?: string; reversible?: string; reason?: string } | null;
  source?: 'main' | 'side-task';
  explanation?: string;
  argsPreview: string | null;
  inputEditable: boolean;
  pendingRequestCount: number;
  duplicatePending: boolean;
  mcpServerId: string | null;
  canAlways: boolean;
}

/** L-31 同族纯函数：从 run 快照工具活动派生最新待确认拒绝卡（W5b 第一刀抽取，逻辑逐行平移）。 */
function findPendingGuardAck(
  activities: GuardAckActivity[],
  ackedGuardKeys: string[],
  nowMs: number = Date.now(),
): PendingGuardAck | null {
    for (let i = activities.length - 1; i >= 0; i -= 1) {
      // 误报豁免：activities 为 run 快照自有数组（非外部输入）。
      // eslint-disable-next-line security/detect-object-injection
      const activity = activities[i];
      if (activity.status !== 'denied' && activity.status !== 'error') continue;
      const approval = activity.approval;
      const data = activity.resultData;
      const guardKey = approval?.guardKey || data?.guardKey;
      if (!guardKey) continue;
      // BLOCK-181 代行评估抓真 — 信封 error 实为 *_triggered（reason 才是
      // dynamic_guard/user_rule_require_ack）；两字段都接受以兼容历史快照。
      const isGuardDeny = Boolean(approval)
        || data?.error === 'dynamic_guard' || data?.error === 'dynamic_guard_triggered'
        || data?.reason === 'dynamic_guard' || data?.error === 'user_rule_require_ack'
        || data?.reason === 'user_rule_require_ack'
        || data?.error === 'mcp_trust_required' || data?.reason === 'mcp_trust_required';
      if (!isGuardDeny) continue;
      if (ackedGuardKeys.includes(guardKey)) continue;
      // eslint-disable-next-line react-hooks/purity -- expiresAt 过期判定必须取当前时刻（原 SimpleChat 实现同款语义平移）
      if (approval?.expiresAt && Date.parse(approval.expiresAt) <= nowMs) continue;
      const isMcpTrust = Boolean(approval?.mcpServerId)
        || data?.error === 'mcp_trust_required' || data?.reason === 'mcp_trust_required';
      const isUserRule = data?.error === 'user_rule_require_ack' || data?.reason === 'user_rule_require_ack';
      const isSideTask = approval?.source === 'side-task';
      const variant: 'danger' | 'warning' | 'info' | 'sideTask' = isSideTask ? 'sideTask' : approval?.approvalVariant || (isMcpTrust ? 'info' : isUserRule ? 'warning' : 'danger');
      return {
        guardKey,
        toolName: activity.name || '',
        message: approval?.message || data?.message || '',
        requestId: approval?.requestId || data?.requestId,
        command: approval?.command ?? data?.command ?? null,
        spans: approval?.spans ?? data?.spans ?? null,
        variant,
        intent: approval?.intent ?? null,
        source: approval?.source,
        explanation: approval?.explanation,
        argsPreview: approval?.argsPreview ?? null,
        inputEditable: approval?.inputEditable === true,
        pendingRequestCount: approval?.pendingRequestCount ?? 0,
        duplicatePending: approval?.duplicatePending === true,
        mcpServerId: approval?.mcpServerId ?? null,
        canAlways: isMcpTrust,
      };
    }
    return null;
}

export function useGuardAck(
  conversationId: string | null,
  activeRun: ConversationRunSnapshot | null,
): {
  pendingGuardAck: PendingGuardAck | null;
  guardAckBusy: boolean;
  guardAckNotice: string | null;
  ackedGuardKeys: string[];
  handleGuardAck: (mode: 'once' | 'task' | 'always', updatedInput?: unknown) => void;
  handleGuardDismiss: () => void;
} {
  const [ackedGuardKeys, setAckedGuardKeys] = useState<string[]>([]);
  const [guardAckBusy, setGuardAckBusy] = useState(false);
  const [guardAckNotice, setGuardAckNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!guardAckNotice) return undefined;
    const timer = window.setTimeout(() => setGuardAckNotice(null), 5000);
    return () => window.clearTimeout(timer);
  }, [guardAckNotice]);
  const pendingGuardAck = useMemo(
    () => findPendingGuardAck((activeRun?.toolActivities as GuardAckActivity[]) || [], ackedGuardKeys),
    [activeRun, ackedGuardKeys],
  );


  const handleGuardAck = useCallback((mode: 'once' | 'task' | 'always', updatedInput?: unknown) => {
    if (!pendingGuardAck || !conversationId) return;
    const runTaskId = getConversationRunSnapshot(conversationId)?.taskId;
    if (!runTaskId) return;
    setGuardAckBusy(true);
    void fetch(getPlatformApiPrefix() + '/ai/agent/task/' + encodeURIComponent(runTaskId) + '/guard-ack', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(getToken() ? { Authorization: 'Bearer ' + getToken() } : {}),
      },
      // BLOCK-243 — scope 取代 always 布尔；updatedInput 仅一次性批准可带。
      body: JSON.stringify({
        guardKey: pendingGuardAck.guardKey,
        scope: mode,
        ...(pendingGuardAck.requestId ? { requestId: pendingGuardAck.requestId, decision: 'approve' } : {}),
        ...(updatedInput !== undefined ? { updatedInput } : {}),
      }),
    })
      .then(async (response) => {
        const data = (await response.json().catch(() => ({}))) as { ok?: unknown; message?: unknown; error?: unknown };
        if (data && data.ok) {
          setAckedGuardKeys((current) => [...current, pendingGuardAck.guardKey]);
          if (updatedInput !== undefined) {
            setGuardAckNotice('已按你编辑的参数批准；模型重试该调用时将执行生效参数。');
          } else if (mode === 'always') {
            setGuardAckNotice('已将该 MCP 服务的信任位改为 allow。');
          }
          return;
        }
        const reason = typeof data.message === 'string' && data.message
          ? data.message
          : typeof data.error === 'string' && data.error ? data.error : `HTTP ${response.status}`;
        setGuardAckNotice(`审批未生效：${reason}`);
      })
      .catch(() => {
        // 网络失败保留卡片（用户可重试）；本地态不变
        setGuardAckNotice('审批未生效：网络错误，请重试。');
      })
      .finally(() => setGuardAckBusy(false));
  }, [conversationId, pendingGuardAck]);

  // BLOCK-180 P0 — 拒绝上送（请求级 deny 留痕；键级退化为本地关卡）
  const handleGuardDismiss = useCallback(() => {
    if (!pendingGuardAck || !conversationId) return;
    const runTaskId = getConversationRunSnapshot(conversationId)?.taskId;
    setAckedGuardKeys((current) => [...current, pendingGuardAck.guardKey]);
    if (!pendingGuardAck.requestId || !runTaskId) return;
    void fetch(getPlatformApiPrefix() + '/ai/agent/task/' + encodeURIComponent(runTaskId) + '/guard-ack', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(getToken() ? { Authorization: 'Bearer ' + getToken() } : {}),
      },
      body: JSON.stringify({ requestId: pendingGuardAck.requestId, guardKey: pendingGuardAck.guardKey, decision: 'deny', scope: 'once' }),
    }).catch(() => { /* deny 上送失败不阻塞本地关卡 */ });
  }, [conversationId, pendingGuardAck]);

  return {
    pendingGuardAck,
    guardAckBusy,
    guardAckNotice,
    ackedGuardKeys,
    handleGuardAck,
    handleGuardDismiss,
  };
}
