// ============================================================
// Client for memory stats + one-click wipe
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

export interface MemoryStats {
  facts: number;
  factsPinned: number;
  summary: { msgCount: number; updatedAt: string } | null;
  vectors: number;
  audit: { totalCalls: number; firstAt?: string | null; lastAt?: string | null };
}

export async function fetchMemoryStats(): Promise<MemoryStats | null> {
  try {
    const resp = await fetch(getApiPrefix() + '/ai/memory-stats', { headers: getAuthHeader() });
    if (!resp.ok) return null;
    const data = await resp.json();
    return data.status === 'ok' ? data.stats : null;
  } catch {
    return null;
  }
}

export async function wipeAllMemory(): Promise<{ ok: boolean; removed: number }> {
  try {
    const resp = await fetch(getApiPrefix() + '/ai/memory-wipe', {
      method: 'POST',
      headers: getAuthHeader(),
    });
    if (!resp.ok) return { ok: false, removed: 0 };
    const data = await resp.json();
    return data.status === 'ok'
      ? { ok: true, removed: data.removed || 0 }
      : { ok: false, removed: 0 };
  } catch {
    return { ok: false, removed: 0 };
  }
}

export interface AdminMemoryRow {
  id: string;
  username: string;
  facts: number;
  has_summary: number | null;
  vectors: number;
  chat_calls: number;
  last_active: string | null;
}

export async function fetchAdminMemoryStats(): Promise<AdminMemoryRow[] | null> {
  try {
    const resp = await fetch(getApiPrefix() + '/ai/admin/memory-stats', {
      headers: getAuthHeader(),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    return data.status === 'ok' ? data.users || [] : null;
  } catch {
    return null;
  }
}

export interface AgentSettings {
  agentPaused: boolean;
}

export async function fetchAgentSettings(): Promise<AgentSettings | null> {
  try {
    const resp = await fetch(getApiPrefix() + '/ai/agent-settings', { headers: getAuthHeader() });
    if (!resp.ok) return null;
    const data = await resp.json();
    return data.status === 'ok' ? { agentPaused: !!data.agentPaused } : null;
  } catch {
    return null;
  }
}

export async function setAgentPaused(paused: boolean): Promise<boolean> {
  try {
    const resp = await fetch(getApiPrefix() + '/ai/agent-settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
      body: JSON.stringify({ agentPaused: paused }),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

// ============================================================
// Recent agent acts (for SSE-interrupt recovery)
// ============================================================

export interface RecentAgentAct {
  id: number;
  undo_token: string;
  action: string;
  args: unknown;
  result: unknown;
  ts: string;
  undone: number;
}

export async function fetchRecentAgentActs(): Promise<RecentAgentAct[] | null> {
  try {
    const resp = await fetch(getApiPrefix() + '/ai/agent-audit', { headers: getAuthHeader() });
    if (!resp.ok) return null;
    const data = await resp.json();
    return data.status === 'ok' ? data.items || [] : null;
  } catch {
    return null;
  }
}
