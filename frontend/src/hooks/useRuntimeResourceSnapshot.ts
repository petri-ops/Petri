import { useCallback, useEffect, useState } from 'react';
import { getPlatformApiPrefix, getToken } from '@/lib/authClient';

export interface RuntimeResourceSnapshot {
  schemaVersion: number;
  observedAt: string;
  expiresAt: string;
  state: 'ready' | 'warning' | 'unavailable';
  platform: string;
  cpu: { logicalCores: number; load1m: number | null };
  memory: { totalBytes: number; availableBytes: number; estimatedBytes: number };
  disk: { availableBytes: number | null; totalBytes: number | null; usePercent: number | null };
  runtime: { r: boolean; python: boolean; details: string | null };
  activeJobs: number;
}

export function useRuntimeResourceSnapshot(refreshMs = 10_000): {
  snapshot: RuntimeResourceSnapshot | null;
  loading: boolean;
  error: string;
  refresh: () => Promise<void>;
} {
  const [snapshot, setSnapshot] = useState<RuntimeResourceSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    try {
      const token = getToken();
      const response = await fetch(`${getPlatformApiPrefix()}/harness/resource-snapshot`, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      const data = await response.json();
      if (!response.ok || !data?.ok || !data?.snapshot) throw new Error(data?.message || '资源快照不可用');
      setSnapshot(data.snapshot);
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), Math.max(5_000, refreshMs));
    return () => window.clearInterval(timer);
  }, [refresh, refreshMs]);
  return { snapshot, loading, error, refresh };
}
