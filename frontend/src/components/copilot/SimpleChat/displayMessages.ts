// BLOCK-92 Wave A-3 — SimpleChat 消息列表派生纯函数（自主组件平移，零行为变化）。
// baseDisplayMessages / displayMessages / railItems 三个渲染期派生逻辑由此承载，
// 主组件只做调用与 memo 编排。
import type { MessageRailItem } from '../MessageRail';
import { resolveToolSummaryPresentation } from '../toolSummaryPresentation';
import {
  getConversationFallbackNotice,
  getChildFinishedNotices,
  type ConversationLoopState,
  type ConversationRunSnapshot,
} from '../conversationRunStore';
import type { SimpleMessage } from './types';

export function buildBaseDisplayMessages(options: {
  activeRun: ConversationRunSnapshot | null;
  conversationId: string | null;
  messages: SimpleMessage[];
  durableLoop: { loop: ConversationLoopState | null };
}): SimpleMessage[] {
  const { activeRun, conversationId, messages, durableLoop } = options;
  if (!activeRun || activeRun.conversationId !== conversationId) {
    if (!durableLoop.loop) return messages;
    let lastAssistantIndex = -1;
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index].role === 'assistant') {
        lastAssistantIndex = index;
        break;
      }
    }
    if (lastAssistantIndex < 0) return messages;
    const next = messages.slice();
    next[lastAssistantIndex] = { ...next[lastAssistantIndex], loop: durableLoop.loop };
    return next;
  }
  const next = messages.slice();
  const lastUser = [...next].reverse().find((message) => message.role === 'user');
  const runUserPersisted =
    lastUser?.content === activeRun.userContent &&
    lastUser.ts !== activeRun.historyLastUserTs;
  if (activeRun.userContent && !runUserPersisted) {
    next.push({
      role: 'user',
      content: activeRun.userContent,
      ts: activeRun.userTs,
    });
  }
  const lastAssistant = next[next.length - 1];
  const assistantAlreadyPersisted =
    lastAssistant?.role === 'assistant' &&
    Boolean(activeRun.assistantContent) &&
    lastAssistant.content === activeRun.assistantContent &&
    Boolean(lastAssistant.ts && Date.parse(lastAssistant.ts) >= activeRun.startedAt);
  if (!assistantAlreadyPersisted) {
    const summaryPresentation = resolveToolSummaryPresentation({
      assistantContent: activeRun.assistantContent,
      assistantError: activeRun.assistantError,
      statusMessage: activeRun.statusMessage,
      toolActivities: activeRun.toolActivities,
    });

    next.push({
      role: 'assistant',
      content: summaryPresentation.content,
      pending: activeRun.assistantPending,
      error: summaryPresentation.error,
      ts: activeRun.assistantTs,
      toolActivities: activeRun.toolActivities,
      reasoningByIteration: activeRun.reasoningByIteration,
      processingDurationMs: activeRun.processingDurationMs,
      statusMessage: summaryPresentation.statusMessage,
      summaryUnavailable: summaryPresentation.summaryUnavailable,
      retryToolJobId: summaryPresentation.retryToolJobId,
      progressUpdates: activeRun.progressUpdates,
      resultEditProgress: activeRun.resultEditProgress,
      loop: durableLoop.loop || activeRun.loop,
      // UI-AGENTWB-### / chat-error-rendering: forward the raw stack
      // + error code stored by conversationRunStore.finish so the
      // ErrorBanner "查看详情" disclosure becomes reachable. Without
      // these the user only ever sees the humanised "发生未知错误".
      technicalDetails: activeRun.technicalDetails,
      errorCode: activeRun.errorCode,
      // BLOCK-38 P2 / UI-275 — 服务中断可续跑：转发标记 + taskId 供「继续执行」入口
      resumable: activeRun.resumable,
      interruptedAt: activeRun.interruptedAt,
      taskId: activeRun.taskId,
      // BLOCK-56 P1 — 模型降级提示（任务条持久显示「已降级到 X 模型」）
      modelFallbackNotice: activeRun.modelFallbackNotice,
    });
  }
  return next;
}

// BLOCK-56 P1 / UI-287 — 降级提示附着到最后一条助手消息（覆盖全部构建路径）。
// 请求级降级常与任务终态同批到达：run 终态对账（clearConversationRun）会清掉
// run 快照且持久化消息不携带该字段，因此除 activeRun 外还兜底读会话级 notice
// （store 模块级保留，下一次 run 开始才清除），否则提示存活 <300ms 用户不可见。
export function applyConversationNotices(options: {
  base: SimpleMessage[];
  activeRun: ConversationRunSnapshot | null;
  conversationId: string | null;
}): SimpleMessage[] {
  const { base, activeRun, conversationId } = options;
  const fallbackNotice = activeRun?.modelFallbackNotice
    || (conversationId ? getConversationFallbackNotice(conversationId) : null);
  const childNotices = conversationId ? getChildFinishedNotices(conversationId) : [];
  if (!fallbackNotice && childNotices.length === 0) return base;
  const next = base.slice();
  const lastMsg = next[next.length - 1];
  if (lastMsg && lastMsg.role === 'assistant') {
    if (fallbackNotice && !lastMsg.modelFallbackNotice) {
      next[next.length - 1] = { ...lastMsg, modelFallbackNotice: fallbackNotice };
    }
    if (childNotices.length > 0 && !lastMsg.childFinishedNotices) {
      next[next.length - 1] = {
        ...next[next.length - 1],
        childFinishedNotices: childNotices.map((n) => ({
          childTaskId: n.childTaskId,
          status: n.status,
          summaryHead: n.summaryHead,
        })),
      };
    }
  }
  return next;
}

// UI-262 — 左缘用户消息导航条：当前会话每条用户消息一个刻度，
// 附紧随其后的 AI 回复摘要供悬浮预览。
export function buildRailItems(displayMessages: SimpleMessage[]): MessageRailItem[] {
  const items: MessageRailItem[] = [];
  displayMessages.forEach((m, i) => {
    if (m.role !== 'user' || !m.content) return;
    let reply: string | undefined;
    for (let j = i + 1; j < displayMessages.length; j++) {
      if (displayMessages[j].role === 'assistant') {
        reply = displayMessages[j].content;
        break;
      }
    }
    items.push({ key: m.ts ? `${m.ts}-${i}` : `idx-${i}`, content: m.content, reply });
  });
  return items;
}
