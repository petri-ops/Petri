// BLOCK-92 Wave A-3 — 会话分支状态簇（自主组件平移，零行为变化）：
// forking / forkingAtIndex + handleFork / handleForkAt（fork 后广播
// conversationForked 供 LeftPanel 刷新会话列表）。
import { useCallback, useState } from 'react';
import { forkConversation } from '@/components/copilot/copilotConversationsClient';
import { gewuEvents, dispatchGewuEvent } from '@/lib/events';

interface UseForkConversationOptions {
  conversationId: string | null;
  projectId: string;
  refreshConversations: () => Promise<void>;
  onConversationChange: (id: string | null) => void;
}

export function useForkConversation(options: UseForkConversationOptions): {
  forking: boolean;
  forkingAtIndex: number | null;
  handleFork: () => Promise<void>;
  handleForkAt: (messageIndex: number) => Promise<void>;
} {
  const { conversationId, projectId, refreshConversations, onConversationChange } = options;
  const [forking, setForking] = useState(false);
  // Per-message index for "fork at this message" action
  const [forkingAtIndex, setForkingAtIndex] = useState<number | null>(null);

  // Fork: create a new conversation with all messages copied from the current one.
  const handleFork = useCallback(async () => {
    if (!conversationId || forking) return;
    setForking(true);
    try {
      const forked = await forkConversation(conversationId);
      if (forked) {
        await refreshConversations();
        onConversationChange(forked.id);
      }
    } finally {
      setForking(false);
    }
  }, [conversationId, forking, refreshConversations, onConversationChange]);

  // Fork at a specific message index — creates a branch that includes all messages up to and including that index.
  const handleForkAt = useCallback(async (messageIndex: number) => {
    if (!conversationId || forkingAtIndex !== null) return;
    setForkingAtIndex(messageIndex);
    try {
      const forked = await forkConversation(conversationId, undefined, messageIndex);
      if (forked) {
        await refreshConversations();
        onConversationChange(forked.id);
        // Broadcast so LeftPanel (via project-workspace) refreshes the conversation list
        dispatchGewuEvent(gewuEvents.conversationForked, {
          newConversationId: forked.id,
          projectId: projectId || '',
        });
      }
    } finally {
      setForkingAtIndex(null);
    }
  }, [conversationId, forkingAtIndex, projectId, refreshConversations, onConversationChange]);

  return { forking, forkingAtIndex, handleFork, handleForkAt };
}
