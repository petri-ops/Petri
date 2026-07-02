// ============================================================
// Client for Copilot summary API (Layer 2)
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

export interface SummaryInfo {
  summary: string | null;
  msgCount?: number;
  updatedAt?: string;
}

export async function fetchSummary(): Promise<SummaryInfo | null> {
  try {
    const resp = await fetch(getApiPrefix() + '/ai/summary', {
      headers: getAuthHeader(),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    if (data.status !== 'ok') return null;
    return { summary: data.summary, msgCount: data.msgCount, updatedAt: data.updatedAt };
  } catch {
    return null;
  }
}

export async function clearSummary(): Promise<boolean> {
  try {
    const resp = await fetch(getApiPrefix() + '/ai/summary', {
      method: 'DELETE',
      headers: getAuthHeader(),
    });
    return resp.ok;
  } catch {
    return false;
  }
}
