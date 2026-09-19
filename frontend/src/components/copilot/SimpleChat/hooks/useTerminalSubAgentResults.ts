import { useEffect, useState } from 'react';
import { getPlatformApiPrefix } from '@/lib/authClient';
import type { SubAgentCardData } from '../../SubAgentResultCard';

/** UI-405 — 会话终态子智能体结果（服务端真相轮询 5s；失败静默保留上次数据）。
 *  BLOCK-92 三波拆分 — 自 SimpleChat.tsx 尾部原样平移（调用点原位，零行为变化）。 */
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
            .slice(-2)
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
