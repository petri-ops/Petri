// BLOCK-255 C17 — composer drop 统一入口：先识别会话拖拽，再回落文件附件。
//
// 抽成 hook 是为了守住 SimpleChat.tsx 的 code-size 棘轮（原 handleDrop 整体外移），
// 同时保证会话引用仍只走 composerContext.addItem 这条唯一通道。
import { useCallback } from 'react';
import type * as React from 'react';
import { onDragLeave, onDragOver, onDrop, type AttachmentFile } from '../attachments';
import { loadConversationDragItem, readConversationDragData } from '../conversationDrag';
import type { ComposerContextItem } from '../contextItems';

export interface UseComposerDropOptions {
  conversationId: string | null;
  addItem: (item: ComposerContextItem) => void;
  setAttachments: React.Dispatch<React.SetStateAction<AttachmentFile[]>>;
  setIsDraggingOver: (value: boolean) => void;
  existingCount: number;
  visionEnabled?: boolean;
  chatVisionCapable?: boolean;
  /** 复用既有可见提示条（当前会话自引用/读取失败/附件提示）。 */
  onNotice?: (message: string | null) => void;
}

export interface ComposerDropHandlers {
  handleDragOver: (event: React.DragEvent) => void;
  handleDragLeave: (event: React.DragEvent) => void;
  handleDrop: (event: React.DragEvent) => void;
}

export function useComposerDrop(options: UseComposerDropOptions): ComposerDropHandlers {
  const {
    conversationId,
    addItem,
    setAttachments,
    setIsDraggingOver,
    existingCount,
    visionEnabled,
    chatVisionCapable,
    onNotice,
  } = options;

  const handleDrop = useCallback((event: React.DragEvent) => {
    const payload = readConversationDragData(event.dataTransfer);
    if (payload) {
      event.preventDefault();
      event.stopPropagation();
      setIsDraggingOver(false);
      if (payload.id === conversationId) {
        onNotice?.('当前会话无需引用自己');
        return;
      }
      void loadConversationDragItem(payload, conversationId)
        .then(({ item }) => {
          if (item) {
            addItem(item);
            onNotice?.(null);
          } else {
            onNotice?.('未能引用会话：可改用 @ 选择会话');
          }
        })
        .catch(() => onNotice?.('未能引用会话：可改用 @ 选择会话'));
      return;
    }
    const notice = onDrop(
      event,
      setAttachments,
      setIsDraggingOver,
      { visionEnabled, chatVisionCapable },
      existingCount,
    );
    if (notice) onNotice?.(notice);
  }, [
    addItem,
    chatVisionCapable,
    conversationId,
    existingCount,
    onNotice,
    setAttachments,
    setIsDraggingOver,
    visionEnabled,
  ]);

  const handleDragOver = useCallback((event: React.DragEvent) => {
    onDragOver(event, setIsDraggingOver);
  }, [setIsDraggingOver]);

  const handleDragLeave = useCallback((event: React.DragEvent) => {
    onDragLeave(event, setIsDraggingOver);
  }, [setIsDraggingOver]);

  return { handleDragOver, handleDragLeave, handleDrop };
}
