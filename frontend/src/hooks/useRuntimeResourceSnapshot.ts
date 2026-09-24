import { useCallback, useEffect, useRef, useState } from 'react';
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
  /** BLOCK-78 P2-①：快照来源——'remote' = 项目绑定节点真值（带 host）；缺省本机。 */
  source?: 'local' | 'remote';
  host?: string;
  /** 远程探测失败回退的历史读数（前端显示观测时间，不冒充新鲜读数）。 */
  stale?: boolean;
}

export function useRuntimeResourceSnapshot(
  /** BLOCK-78 P2-①：传 projectId 时后端按项目形态路由——ssh 项目经 mux 探测
   *  远程节点真值（snapshot.source='remote'+host），local/缺省走本机快照。 */
  projectId?: string | null,
  refreshMs = 10_000
): {
  snapshot: RuntimeResourceSnapshot | null;
  loading: boolean;
  error: string;
  refresh: () => Promise<void>;
} {
  const [snapshot, setSnapshot] = useState<RuntimeResourceSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // BLOCK-102 P2 — 切项目竞态守卫：10s 轮询的在途旧项目响应不得覆盖新项目
  // 快照（对照 useConversationJobs 的 requestSequence 家法）。
  const refreshSequenceRef = useRef(0);
  const refresh = useCallback(async () => {
    const seq = ++refreshSequenceRef.current;
    try {
      const token = getToken();
      const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : '';
      const response = await fetch(`${getPlatformApiPrefix()}/harness/resource-snapshot${query}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
      const data = (await response.json()) as { ok?: unknown; snapshot?: RuntimeResourceSnapshot; stale?: unknown; message?: unknown };
      if (seq !== refreshSequenceRef.current) return;
      if (!response.ok || !data?.ok || !data?.snapshot) throw new Error(typeof data?.message === 'string' && data.message ? data.message : '资源快照不可用');
      // stale:true = 远程探测失败回退的历史读数（诚实降级，前端显示观测时间）。
      setSnapshot(data.stale === true ? { ...data.snapshot, stale: true } : data.snapshot);
      setError('');
    } catch (reason) {
      if (seq !== refreshSequenceRef.current) return;
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (seq === refreshSequenceRef.current) setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), Math.max(5_000, refreshMs));
    return () => window.clearInterval(timer);
  }, [refresh, refreshMs, projectId]);
  return { snapshot, loading, error, refresh };
}
