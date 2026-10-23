// ============================================================
// useMessageActions.ts — BLOCK-246 C4 消息行新增动作的宿主侧状态
//
// 只做三件事：
//   1. 「加入上下文」→ 产 messageQuoteContextItem 进单一通道；
//   2. 「评价」→ 乐观更新 + PUT /api/message-ratings，失败回滚并给可见提示；
//   3. 按 messageKey 读出当前评价（受控给行组件）。
//
// 为什么单独成 hook：SimpleChat.tsx 受 code-size 棘轮约束（只许变短），
// 而行级回调必须是稳定引用（行是 React.memo 边界），两者都指向"把状态搬出去"。
// ============================================================
import { useCallback, useMemo, useState } from 'react';
import { setMessageRating, type MessageRatingValue } from '@/lib/messageRatingClient';
import { messageQuoteContextItem, type ComposerContextItem } from '../contextItems';
import { nextRating } from '../messageActions';

export interface UseMessageActionsOptions {
  conversationId: string | null;
  projectId?: string;
  addItem: (item: ComposerContextItem) => void;
  /** 复用宿主既有的可见提示条（失败不静默）。 */
  onNotice?: (message: string | null) => void;
}

export interface MessageRowActionProps {
  onQuoteToContext: (messageKey: string, content: string) => void;
  onRateMessage: (messageKey: string, rating: MessageRatingValue) => void;
  messageRating: MessageRatingValue | null;
}

export interface ComposerMessageActions {
  /** 一行展开成行组件的三个动作 prop（宿主 JSX 只需 `{...rowProps(key)}`）。 */
  rowProps: (messageKey: string) => MessageRowActionProps;
}

export function useMessageActions(options: UseMessageActionsOptions): ComposerMessageActions {
  const { conversationId, projectId, addItem, onNotice } = options;
  const [ratings, setRatings] = useState<Record<string, MessageRatingValue | null>>({});

  const onQuoteToContext = useCallback((messageKey: string, content: string) => {
    addItem(messageQuoteContextItem({ messageKey, content, conversationId }));
  }, [addItem, conversationId]);

  const onRateMessage = useCallback((messageKey: string, rating: MessageRatingValue) => {
    setRatings((prev) => {
      const next = nextRating(prev[messageKey] ?? null, rating);
      // 乐观更新：先给反馈，失败再回滚（否则点击到落库之间按钮像没反应）
      void setMessageRating({
        messageKey,
        rating: next,
        conversationId,
        projectId: projectId ?? null,
      }).catch((error: unknown) => {
        setRatings((current) => ({ ...current, [messageKey]: prev[messageKey] ?? null }));
        onNotice?.(error instanceof Error ? `评价未保存：${error.message}` : '评价未保存');
      });
      return { ...prev, [messageKey]: next };
    });
  }, [conversationId, onNotice, projectId]);

  const rowProps = useCallback((messageKey: string): MessageRowActionProps => ({
    onQuoteToContext,
    onRateMessage,
    messageRating: ratings[messageKey] ?? null,
  }), [onQuoteToContext, onRateMessage, ratings]);

  return useMemo(() => ({ rowProps }), [rowProps]);
}
