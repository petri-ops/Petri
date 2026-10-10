// ============================================================
// copilotClient 家族共享底座：API 前缀 / 鉴权头 / 主任务收尾广播。
// 家法（BLOCK-92）：原 import 路径 ./copilotClient 保留全量 re-export，
// 消费方与测试零改动。
// ============================================================

import { getPlatformApiPrefix } from '@/lib/authClient';
import { petriEvents, dispatchPetriEvent } from '@/lib/events';
import type { AgentTaskDoneDetail } from '@/lib/events';

export function getApiPrefix(): string {
  return getPlatformApiPrefix();
}

export function getAuthHeader(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  try {
    // BLOCK-61 读旧兼容：历史 key petri_token
    const token = localStorage.getItem('petri_token') ?? localStorage.getItem('petri_token');
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

/**
 * BLOCK-16 PHASE 3：在 primary agent task 收尾时派发 petri:agent-task-done，
 * 触发 useWorkingTreeReview 自动弹出浮层。仅 kind === 'primary' 触发；
 * subagent 收尾不广播（避免淹没）。
 * BLOCK-31 P2：payload 尽量携带 SSE done 事件中的权威 filesChanged（后端
 * task_events 回放聚合产物）与任务所属 conversationId（供会话级改动索引）；
 * legacy 路径或后端未携带时缺省，消费方仍走 git status/diff 自刷兜底。
 */
export function emitAgentTaskDone(
  taskId: string,
  optsKind?: string,
  payload?: { filesChanged?: Array<{ path: string; status: string }>; conversationId?: string }
): void {
  if (!taskId) return;
  if (optsKind === 'subagent') return;
  try {
    const detail: AgentTaskDoneDetail = {
      taskId,
      filesChanged: payload?.filesChanged ?? [],
      conversationId: payload?.conversationId,
    };
    dispatchPetriEvent(petriEvents.agentTaskDone, detail);
  } catch {
    // 事件总线失败不应阻塞 SSE 收口路径
  }
}
