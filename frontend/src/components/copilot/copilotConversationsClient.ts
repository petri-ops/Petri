// ============================================================
// Conversation API client
// ============================================================

import { getApiPrefix } from './copilotClient';

function getAuthHeader(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  try {
    const token = localStorage.getItem('biof3_token');
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

export type ConversationStatus = 'active' | 'archived';

export interface ConversationSummary {
  id: string;
  title: string;
  status: ConversationStatus;
  last_page: string | null;
  message_count: number;
  created_at: string;
  updated_at: string;
  last_topic_shift_at?: string | null;
  last_topic_shift_reason?: string | null;
  project_id?: string | null;
  /** Branch support: ID of the parent conversation this was forked from */
  parent_id?: string | null;
  /** Branch support: visual color identifier for the branch line */
  branch_color?: string | null;
}

export interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  ts: string;
  meta?: Record<string, unknown> | null;
}

export async function listConversations(
  status: ConversationStatus | 'all' = 'active',
  projectId?: string
): Promise<ConversationSummary[]> {
  try {
    let url = getApiPrefix() + '/ai/conversations?status=' + status;
    if (projectId) url += '&project_id=' + encodeURIComponent(projectId);
    const resp = await fetch(url, {
      headers: getAuthHeader(),
    });
    if (!resp.ok) return [];
    const data = await resp.json();
    return data.status === 'ok' ? data.conversations || [] : [];
  } catch {
    return [];
  }
}

export async function createConversation(
  title?: string,
  lastPage?: string,
  projectId?: string
): Promise<ConversationSummary | null> {
  try {
    const resp = await fetch(getApiPrefix() + '/ai/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
      body: JSON.stringify({ title: title || '新对话', lastPage: lastPage || null, project_id: projectId || null }),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    return data.status === 'ok' ? data.conversation : null;
  } catch {
    return null;
  }
}

export async function getConversationMessages(
  id: string,
  limit = 100
): Promise<ConversationMessage[]> {
  try {
    const resp = await fetch(
      getApiPrefix() + '/ai/conversations/' + encodeURIComponent(id) + '/messages?limit=' + limit,
      { headers: getAuthHeader() }
    );
    if (!resp.ok) return [];
    const data = await resp.json();
    return data.status === 'ok' ? data.messages || [] : [];
  } catch {
    return [];
  }
}

export async function renameConversation(id: string, title: string): Promise<boolean> {
  try {
    const resp = await fetch(
      getApiPrefix() + '/ai/conversations/' + encodeURIComponent(id) + '/update',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify({ title }),
      }
    );
    return resp.ok;
  } catch {
    return false;
  }
}

export async function archiveConversation(id: string, archive: boolean): Promise<boolean> {
  try {
    const resp = await fetch(
      getApiPrefix() + '/ai/conversations/' + encodeURIComponent(id) + '/update',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify({ status: archive ? 'archived' : 'active' }),
      }
    );
    return resp.ok;
  } catch {
    return false;
  }
}

export async function deleteConversation(id: string): Promise<boolean> {
  try {
    const resp = await fetch(getApiPrefix() + '/ai/conversations/' + encodeURIComponent(id), {
      method: 'DELETE',
      headers: getAuthHeader(),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

export async function dismissTopicShift(id: string): Promise<boolean> {
  try {
    const resp = await fetch(
      getApiPrefix() + '/ai/conversations/' + encodeURIComponent(id) + '/dismiss-topic-shift',
      {
        method: 'POST',
        headers: getAuthHeader(),
      }
    );
    return resp.ok;
  } catch {
    return false;
  }
}

/**
 * Fork an existing conversation — creates a new conversation with messages copied.
 * @param id - source conversation id
 * @param title - optional new conversation title
 * @param untilIndex - optional 0-based message index; if provided, only messages up to that index (inclusive) are copied.
 */
export async function forkConversation(
  id: string,
  title?: string,
  untilIndex?: number
): Promise<ConversationSummary | null> {
  try {
    const body: Record<string, unknown> = {};
    if (title !== undefined) body.title = title;
    if (untilIndex !== undefined) body.untilIndex = untilIndex;
    const resp = await fetch(
      getApiPrefix() + '/ai/conversations/' + encodeURIComponent(id) + '/fork',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
        body: JSON.stringify(body),
      }
    );
    if (!resp.ok) return null;
    const data = await resp.json();
    return data.status === 'ok' ? data.conversation : null;
  } catch {
    return null;
  }
}
