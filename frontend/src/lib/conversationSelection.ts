/**
 * item89：会话切换的项目上下文绑定。
 * 旧项目的 activeConvId 不得挡住新项目的预选/首条会话——否则文件面板仍绑旧 workspace。
 */
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
