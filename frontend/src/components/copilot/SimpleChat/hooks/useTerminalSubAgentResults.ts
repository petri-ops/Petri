import { useEffect, useState } from 'react';
import { getPlatformApiPrefix } from '@/lib/authClient';
import type { SubAgentCardData } from '../../SubAgentResultCard';

/** UI-405 — 会话终态子智能体结果（真相轮询 5s；BLOCK-92 拆分）。UI-432（BLOCK-109 P3）弃 slice(-2)：最近一批全量返回，组卡收拢呈现。 */
export function useTerminalSubAgentResults(projectId: string | null | undefined, conversationId: string | null | undefined): SubAgentCardData[] {
  const [rows, setRows] = useState<SubAgentCardData[]>([]);
  useEffect(() => {
    if (!conversationId) return;
    let alive = true;
    const load = () => {
      // BLOCK-102 P4 — 页面隐藏时跳过轮询（回到可见即由下个 tick 恢复）
      if (typeof document !== 'undefined' && document.hidden) return;
      fetch(`${getPlatformApiPrefix()}/ai/agent/tasks?limit=50&conversationId=${encodeURIComponent(conversationId)}`, {
        headers: { Authorization: 'Bearer desktop-local' },
      })
        .then((resp) => resp.json())
        .then((body) => {
          if (!alive || !body || body.ok !== true) return;
          const terminal = (body.tasks || [])
            .filter((t: { status?: string }) => t.status && t.status !== 'running')
            // UI-432（BLOCK-109 P3）— 弃 slice(-2) 截断：最近一批终态子任务全量返回，
            // 由 SubAgentResultGroup 收拢为可折叠汇总卡（刷屏与信息缺失两头都解决）。
            .map((t: { taskId: string; taskText?: string; status: string; createdAt?: string; finishedAt?: string; summaryHead?: string | null }) => ({
              taskId: String(t.taskId || ''),
              taskText: String(t.taskText || ''),
              status: String(t.status || ''),
              createdAt: t.createdAt || null,
              finishedAt: t.finishedAt || null,
              summaryHead: t.summaryHead || null,
            }));
          setRows(terminal);
        })
        .catch(() => {});
    };
    load();
    const timer = window.setInterval(load, 5000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [projectId, conversationId]);
  return rows;
}
