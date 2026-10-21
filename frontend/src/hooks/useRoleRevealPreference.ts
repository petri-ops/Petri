/**
 * useRoleRevealPreference — BLOCK-227 首启角色揭示状态（userPrefs.roleRevealSeen）。
 *
 * 读取失败按「未知」处理且不渲染（避免后端抖动时反复弹首启）；
 * `dismiss` 先关本端再写回服务端，失败给可见错误但不重新弹窗。
 */

import { useCallback, useEffect, useState } from 'react';
import { getPlatformApiPrefix, getToken } from '@/lib/authClient';

export interface RoleRevealPreferenceState {
  visible: boolean;
  dismiss: () => Promise<void>;
  error: string | null;
}

function prefsUrl(): string {
  return `${getPlatformApiPrefix()}/user/prefs`;
}

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

export function useRoleRevealPreference(): RoleRevealPreferenceState {
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(prefsUrl(), { headers: authHeaders() });
        if (!response.ok) return;
        const body: unknown = await response.json();
        const prefs = body && typeof body === 'object'
          ? (body as Record<string, unknown>).prefs
          : null;
        if (!cancelled && prefs && typeof prefs === 'object') {
          setVisible((prefs as Record<string, unknown>).roleRevealSeen !== true);
        }
      } catch {
        // 读取失败=不展示（未知不等于首次）。
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const dismiss = useCallback(async () => {
    setVisible(false);
    setError(null);
    try {
      const response = await fetch(prefsUrl(), {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({ roleRevealSeen: true }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
    } catch {
      setError('已关闭本次引导，但未能记录状态；若再次出现属预期。');
    }
  }, []);

  return { visible, dismiss, error };
}
