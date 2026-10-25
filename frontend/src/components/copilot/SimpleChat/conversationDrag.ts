// BLOCK-255 C17 — 会话拖入 composer 的纯函数层 + 摘要装载。
//
// 唯一通道纪律：拖放只产 ComposerContextItem，复用 buildConversationCandidates
// 与 buildConversationDigest 的既有上限（标题/id/消息数 + 8×300×2000 摘要），
// 不新建第二套注入通道；当前会话拒绝自引用。
import { getConversationMessages, type ConversationSummary } from '../copilotConversationsClient';
import type { ComposerContextItem } from './contextItems';
import { buildConversationCandidates, buildConversationDigest, type ConversationRow } from './contextSources';
import { CONVERSATION_DRAG_MIME } from './dragTypes';

export { CONVERSATION_DRAG_MIME } from './dragTypes';

export interface ConversationDragPayload {
  id: string;
  title: string;
  messageCount: number;
  updatedAt: string | null;
}

export function conversationDragPayload(
  conversation: Pick<ConversationSummary, 'id' | 'title' | 'message_count' | 'updated_at'>,
): ConversationDragPayload {
  return {
    id: conversation.id,
    title: conversation.title || '未命名对话',
    messageCount: Number.isFinite(conversation.message_count) ? Math.max(0, conversation.message_count) : 0,
    updatedAt: conversation.updated_at || null,
  };
}

export function setConversationDragData(dataTransfer: DataTransfer, conversation: ConversationSummary): void {
  const payload = conversationDragPayload(conversation);
  dataTransfer.setData(CONVERSATION_DRAG_MIME, JSON.stringify(payload));
  dataTransfer.setData('text/plain', payload.title);
  dataTransfer.effectAllowed = 'copy';
}

export function readConversationDragData(
  dataTransfer: DataTransfer | null | undefined,
): ConversationDragPayload | null {
  if (!dataTransfer) return null;
  let raw = '';
  try {
    raw = dataTransfer.getData(CONVERSATION_DRAG_MIME);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ConversationDragPayload>;
    if (!parsed || typeof parsed.id !== 'string' || !parsed.id) return null;
    return {
      id: parsed.id,
      title: typeof parsed.title === 'string' && parsed.title ? parsed.title : '未命名对话',
      messageCount: Number.isFinite(Number(parsed.messageCount))
        ? Math.max(0, Math.round(Number(parsed.messageCount)))
        : 0,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : null,
    };
  } catch {
    return null;
  }
}

export function buildConversationDragItem(
  payload: ConversationDragPayload,
  digestLines: string[] = [],
  currentConversationId?: string | null,
): ComposerContextItem | null {
  if (payload.id === currentConversationId) return null;
  const row: ConversationRow = {
    id: payload.id,
    title: payload.title,
    message_count: payload.messageCount,
    updated_at: payload.updatedAt || undefined,
    digest: digestLines,
  };
  return buildConversationCandidates([row], currentConversationId).candidates[0]?.item ?? null;
}

/**
 * 拉本会话最近 12 条消息生成有界摘要；失败不阻断引用，退化为元数据条目
 * 并在正文里如实写「摘要未能载入」。
 */
export async function loadConversationDragItem(
  payload: ConversationDragPayload,
  currentConversationId?: string | null,
): Promise<{ item: ComposerContextItem | null; digestUnavailable: boolean }> {
  if (payload.id === currentConversationId) return { item: null, digestUnavailable: false };
  let digestLines: string[] = [];
  let digestUnavailable = false;
  try {
    const messages = await getConversationMessages(payload.id, 12);
    digestLines = buildConversationDigest(messages).lines;
  } catch {
    digestUnavailable = true;
  }
  const item = buildConversationDragItem(payload, digestLines, currentConversationId);
  if (item && digestUnavailable) {
    item.lines.push('> 摘要：未能载入（网络或接口失败），仅引用标题与元数据');
  }
  return { item, digestUnavailable };
}
