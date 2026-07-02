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
}

export interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  ts: string;
  meta?: Record<string, unknown> | null;
}

export async function listConversations(
  status: ConversationStatus | 'all' = 'active'
): Promise<ConversationSummary[]> {
  try {
    const resp = await fetch(getApiPrefix() + '/ai/conversations?status=' + status, {
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
  lastPage?: string
): Promise<ConversationSummary | null> {
  try {
    const resp = await fetch(getApiPrefix() + '/ai/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
      body: JSON.stringify({ title: title || '新对话', lastPage: lastPage || null }),
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
