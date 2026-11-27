/**
 * item89：会话切换的项目上下文绑定。
 * 旧项目的 activeConvId 不得挡住新项目的预选/首条会话——否则文件面板仍绑旧 workspace。
 */
const PRESELECT_KEY = 'petri.conversationPreselect';

/** 跨项目点击先把目标会话写入一次性交接，再导航；不先污染旧项目的 activeConvId。 */
export function writeConversationPreselect(conversationId: string): void {
  try { sessionStorage.setItem(PRESELECT_KEY, JSON.stringify({ conversationId })); } catch { /* 交接失败即回落自动选 */ }
}

export function consumeConversationPreselect(): string | null {
  try {
    const raw = sessionStorage.getItem(PRESELECT_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(PRESELECT_KEY);
    return (JSON.parse(raw) as { conversationId?: string }).conversationId || null;
  } catch {
    try { sessionStorage.removeItem(PRESELECT_KEY); } catch { /* ignore */ }
    return null;
  }
}

export interface ConversationProjectRef {
  id: string;
  project_id?: string | null;
}

export function resolveActiveConversationId({
  projectId,
  conversations,
  activeConvId,
  preselectedConversationId,
}: {
  projectId: string | null | undefined;
  conversations: readonly ConversationProjectRef[] | null | undefined;
  activeConvId?: string | null;
  preselectedConversationId?: string | null;
}): { conversationId: string | null; projectId: string | null } {
  const list = (conversations || []).filter((c) => c && c.id);
  const belongs = (id?: string | null) => Boolean(id && list.some((c) => c.id === id));
  const owner = projectId || null;
  if (belongs(activeConvId)) return { conversationId: activeConvId || null, projectId: owner };
  if (belongs(preselectedConversationId)) return { conversationId: preselectedConversationId || null, projectId: owner };
  return { conversationId: list[0]?.id ?? null, projectId: owner };
}
