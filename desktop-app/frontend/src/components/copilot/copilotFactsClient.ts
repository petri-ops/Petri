// ============================================================
// Client for /api/ai/facts (Layer 3a — structured user memory)
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

export type FactCategory = 'research_focus' | 'preference' | 'entity' | 'task_state' | 'note';

export interface UserFact {
  id: string;
  user_id: string;
  category: FactCategory;
  content: string;
  pinned: number;
  source: 'auto' | 'manual';
  created_at: string;
  updated_at: string;
}

export interface FactsResponse {
  facts: UserFact[];
  categories: FactCategory[];
  labels: Record<FactCategory, string>;
}

export const FACT_CATEGORY_LABELS: Record<FactCategory, string> = {
  research_focus: '研究方向',
  preference: '偏好',
  entity: '关键实体',
  task_state: '任务状态',
  note: '笔记',
};

export async function listFacts(): Promise<FactsResponse | null> {
  try {
    const resp = await fetch(getApiPrefix() + '/ai/facts', { headers: getAuthHeader() });
    if (!resp.ok) return null;
    const data = await resp.json();
    if (data.status !== 'ok') return null;
    return { facts: data.facts || [], categories: data.categories, labels: data.labels };
  } catch {
    return null;
  }
}

export async function createFact(
  category: FactCategory,
  content: string,
  pinned = false
): Promise<UserFact | null> {
  try {
    const resp = await fetch(getApiPrefix() + '/ai/facts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
      body: JSON.stringify({ category, content, pinned }),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    return data.status === 'ok' ? data.fact : null;
  } catch {
    return null;
  }
}

export async function updateFact(
  id: string,
  patch: Partial<{ category: FactCategory; content: string; pinned: boolean }>
): Promise<UserFact | null> {
  try {
    const resp = await fetch(getApiPrefix() + '/ai/facts/' + encodeURIComponent(id), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
      body: JSON.stringify(patch),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    return data.status === 'ok' ? data.fact : null;
  } catch {
    return null;
  }
}

export async function deleteFact(id: string): Promise<boolean> {
  try {
    const resp = await fetch(getApiPrefix() + '/ai/facts/' + encodeURIComponent(id), {
      method: 'DELETE',
      headers: getAuthHeader(),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

export async function clearAllFacts(): Promise<boolean> {
  try {
    const resp = await fetch(getApiPrefix() + '/ai/facts', {
      method: 'DELETE',
      headers: getAuthHeader(),
    });
    return resp.ok;
  } catch {
    return false;
  }
}
