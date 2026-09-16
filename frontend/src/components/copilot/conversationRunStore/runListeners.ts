/**
 * Per-conversation listener registry shared by the primary-run store
 * (conversationRunStore.ts) and the sub-agent store (subAgentTasks.ts).
 * One map keeps `emit` reachable from both sides without a circular module
 * import; subscribeConversationRun keeps its original export path.
 */
const listeners = new Map<string, Set<() => void>>();

export function emitConversationRun(conversationId: string): void {
  listeners.get(conversationId)?.forEach((listener) => listener());
}

export function subscribeConversationRun(
  conversationId: string | null | undefined,
  listener: () => void
): () => void {
  if (!conversationId) return () => {};
  const current = listeners.get(conversationId) || new Set<() => void>();
  current.add(listener);
  listeners.set(conversationId, current);
  return () => {
    const active = listeners.get(conversationId);
    active?.delete(listener);
    if (active?.size === 0) listeners.delete(conversationId);
  };
}

export function clearConversationRunListeners(): void {
  listeners.clear();
}
