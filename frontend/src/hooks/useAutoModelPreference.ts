/**
 * useAutoModelPreference — BLOCK-225 D4 自动选模型开关（userPrefs.autoModel）。
 *
 * 真值在 `/api/user/prefs`（与其它偏好同链）；本 hook 只做读取与写回。
 * 写失败不回滚本端，但错误必须可见（选择器里提示未同步）。
 */

import { useCallback, useEffect, useState } from 'react';
import { getPlatformApiPrefix, getToken } from '@/lib/authClient';

export interface AutoModelPreferenceState {
  autoModel: boolean;
  setAutoModel: (next: boolean) => Promise<void>;
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

export function useAutoModelPreference(): AutoModelPreferenceState {
  const [autoModel, setAutoModelState] = useState(false);
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
          setAutoModelState((prefs as Record<string, unknown>).autoModel === true);
        }
      } catch {
        // 读失败保持关闭（默认零行为变化）。
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const setAutoModel = useCallback(async (next: boolean) => {
    setAutoModelState(next);
    setError(null);
    try {
      const response = await fetch(prefsUrl(), {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({ autoModel: next }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
    } catch {
      setError('本机已切换，但未能同步到服务端');
    }
  }, []);

  return { autoModel, setAutoModel, error };
}
