// ============================================================
// Client for /api/ai/memories (Layer 3b — vector memory)
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

export interface MemoryVector {
  id: string;
  kind: 'chat_turn' | 'analysis_summary' | 'ai_interpret';
  ref_id: string | null;
  page: string | null;
  page_title: string | null;
  content: string;
  ts: string;
}

export interface MemoryHit extends MemoryVector {
  sim: number;
}

export async function listMemories(): Promise<{ memories: MemoryVector[]; total: number } | null> {
  try {
    const resp = await fetch(getApiPrefix() + '/ai/memories', { headers: getAuthHeader() });
    if (!resp.ok) return null;
    const data = await resp.json();
    if (data.status !== 'ok') return null;
    return { memories: data.memories || [], total: data.total || 0 };
  } catch {
    return null;
  }
}

export async function searchMemories(q: string): Promise<MemoryHit[] | null> {
  try {
    const resp = await fetch(getApiPrefix() + '/ai/memories/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
      body: JSON.stringify({ q }),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    return data.status === 'ok' ? data.hits || [] : null;
  } catch {
    return null;
  }
}

export async function deleteMemory(id: string): Promise<boolean> {
  try {
    const resp = await fetch(getApiPrefix() + '/ai/memories/' + encodeURIComponent(id), {
      method: 'DELETE',
      headers: getAuthHeader(),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

export async function clearAllMemories(): Promise<boolean> {
  try {
    const resp = await fetch(getApiPrefix() + '/ai/memories', {
      method: 'DELETE',
      headers: getAuthHeader(),
    });
    return resp.ok;
  } catch {
    return false;
  }
}
