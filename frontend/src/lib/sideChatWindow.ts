/**
 * sideChatWindow — UI-627（BLOCK-321）— 侧聊独立窗开启 helper。
 *
 * 页内悬浮面退役（DOM 画不出软件窗口边界，跨屏拖动/八方位 resize/丝滑度都受
 * 浏览器视口钳制）：侧聊升级为 frameless 原生窗（OS 边框八方位 resize、全屏
 * 任意拖动、跨显示器，位置记忆走主进程 geometry）。
 *
 * 跨窗初始状态走 URL query（主进程 POP_OUT_QUERY_KEYS 白名单）：localStorage
 * 跨进程写入/读取无 happens-before（实机抓真竞态——弹窗概率性读空），故 fork
 * 在本 helper（主窗进程）内完成，弹窗页只从 URL 读初始会话。localStorage 仅
 * 存「主窗↔自己」的 per-project 会话记忆，同进程读写无竞态。
 */
import { getBridge, isDesktop } from '@/lib/desktopBridge';
import { forkConversation } from '@/components/copilot/copilotConversationsClient';

export const sideChatConvKey = (projectId: string) => `petri:side-chat-conv:${projectId}`;

function readStoredSideConversation(projectId: string): string | null {
  try {
    return window.localStorage.getItem(sideChatConvKey(projectId));
  } catch {
    return null;
  }
}

function writeStoredSideConversation(projectId: string, id: string | null): void {
  try {
    if (id) window.localStorage.setItem(sideChatConvKey(projectId), id);
    else window.localStorage.removeItem(sideChatConvKey(projectId));
  } catch {
    // localStorage 不可用：记忆退化，链路不受阻
  }
}

export interface SideChatWindowOpen {
  projectId: string;
  /** 主窗当前主会话：首开且无侧聊会话记忆时 fork 它继承记录；null = 空态首发送建话。 */
  sourceConversationId: string | null;
}

/**
 * 打开/聚焦侧聊独立窗。非 Electron 环境返回 false（入口不可用）。
 * 同内容已开 = 主进程聚焦既有窗（防双开）；query 里带初始 projectId/convId。
 */
export async function openSideChatWindow({ projectId, sourceConversationId }: SideChatWindowOpen): Promise<boolean> {
  if (!isDesktop() || !projectId) return false;
  // 初始会话解析：已有 per-project 记忆优先（同进程读，无竞态）；
  // 无记忆且有主会话 → fork 继承记录后写回记忆；都无 → 空态首发送建话。
  let convId = readStoredSideConversation(projectId);
  if (!convId && sourceConversationId) {
    try {
      const forked = await forkConversation(sourceConversationId, '侧边聊天');
      if (forked?.id) {
        convId = forked.id;
        writeStoredSideConversation(projectId, convId);
      }
    } catch {
      // fork 失败：降级空态开窗（首发送建话），不阻塞入口
    }
  }
  void getBridge('windowManager')?.popOut('side-chat', undefined, {
    projectId,
    ...(convId ? { convId } : {}),
  });
  return true;
}
