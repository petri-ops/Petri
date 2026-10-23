/**
 * messageRatingClient.ts — BLOCK-246 C4 消息评价（赞/踩）前端封装。
 *
 * 单一真相 = `/api/message-ratings`（表在 `src/migrations/017_message_ratings.sql`）。
 * 语义：同一条消息再评价 = 覆盖；传 null = 撤销。
 */

import { getApiPrefix } from '../components/copilot/copilotClient';

export type MessageRatingValue = 'up' | 'down';

export interface MessageRating {
  messageKey: string;
  conversationId: string | null;
  projectId: string | null;
  rating: MessageRatingValue;
  reason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SetMessageRatingInput {
  messageKey: string;
  rating: MessageRatingValue | null;
  reason?: string;
  conversationId?: string | null;
  projectId?: string | null;
}

/** 评价一条消息；`rating: null` = 撤销。失败抛错（调用方按需提示）。 */
export async function setMessageRating(input: SetMessageRatingInput): Promise<MessageRating | null> {
  const response = await fetch(`${getApiPrefix()}/message-ratings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const data = (await response.json().catch(() => null)) as
    | { ok: true; rating: MessageRating | null }
    | { ok: false; error?: string }
    | null;
  if (!response.ok || !data || data.ok !== true) {
    const message = data && 'error' in data ? data.error : undefined;
    throw new Error(message || `评价失败（HTTP ${response.status}）`);
  }
  return data.rating;
}
