const COMPOSER_DRAFT_PREFIX = 'petri:composer-draft:';

function conversationDraftKey(projectId: string, conversationId: string | null): string {
  return `${projectId}:${conversationId || 'new'}`;
}

function storageKey(projectId: string, conversationId: string | null): string {
  return COMPOSER_DRAFT_PREFIX + conversationDraftKey(projectId, conversationId);
}

export function loadConversationDraft(projectId: string, conversationId: string | null): string {
  try {
    return window.localStorage.getItem(storageKey(projectId, conversationId)) || '';
  } catch {
    return '';
  }
}

export function saveConversationDraft(
  projectId: string,
  conversationId: string | null,
  text: string,
): void {
  try {
    const key = storageKey(projectId, conversationId);
    if (text) window.localStorage.setItem(key, text);
    else window.localStorage.removeItem(key);
  } catch {
    // Ignore quota and private-mode failures; the live input remains usable.
  }
}

export function clearConversationDraft(projectId: string, conversationId: string | null): void {
  try {
    window.localStorage.removeItem(storageKey(projectId, conversationId));
  } catch {
    // Ignore storage availability failures.
  }
}

export function migrateConversationDraft(
  projectId: string,
  sourceConversationId: string | null,
  targetConversationId: string,
): void {
  const sourceDraft = loadConversationDraft(projectId, sourceConversationId);
  const targetDraft = loadConversationDraft(projectId, targetConversationId);
  if (sourceDraft && !targetDraft) {
    saveConversationDraft(projectId, targetConversationId, sourceDraft);
  }
  clearConversationDraft(projectId, sourceConversationId);
}
