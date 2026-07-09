// ============================================================
// Admin Panel — cache stats + cleanup
// Activate via URL: ?admin=1
// ============================================================

import React, { useState, useEffect, useCallback } from 'react';
import { getApiPrefix, formatSize } from './_api';
import { getAuthHeaders, fetchWithAuth } from './_auth';
export { fetchWithAuth } from './_auth';

// ── Admin API response types (from r-server/routes/ai-admin.js) ──
interface UsageDailyRow {
  day: string;
  kind: string;
  calls: number;
  prompt_tokens: number;
  completion_tokens: number;
  avg_latency: number;
  errors: number;
  estimated_cost_cny: number;
}
interface UsagePerUserRow {
  id: string;
  username: string;
  calls: number;
  prompt_tokens: number;
  completion_tokens: number;
  avg_latency: number;
  errors: number;
  estimated_cost_cny: number;
}
interface UsageTopAct {
  action: string;
  n: number;
  undone: number;
}
interface UsageError {
  error_code: string;
  n: number;
}
interface UsageStats {
  days: number;
  pricing: Record<string, unknown>;
  daily: UsageDailyRow[];
  perUser: UsagePerUserRow[];
  topActs: UsageTopAct[];
  errors: UsageError[];
}
interface AiUserRow {
  id: string;
  username: string;
  role: string;
  created_at: string;
  conv_count: number;
  msg_count: number;
  fact_count: number;
  vec_count: number;
  plan_count: number;
  active_plans: number;
  act_count: number;
  undone_n: number;
  last_act_at: string | null;
  agent_paused: boolean;
  last_conv_at: string | null;
}
interface AiAuditRow {
  id: string;
  user_id: string;
  action: string;
  ts: string;
  undone: boolean;
  undone_at: string | null;
  argsSummary: string;
}

interface CacheStats {
  temp: { totalBytes: number; fileCount: number; dirCount: number; sizeHuman: string };
  cache: {
    totalBytes: number;
    fileCount: number;
    dirCount: number;
    sizeHuman: string;
    files: Array<{ name: string; size: number; isSymlink: boolean; mtime: string; atime: string }>;
  };
  totalBytes: number;
  totalHuman: string;
}

interface DiskStats {
  host: string;
  timestamp: string;
  mounts: Array<{
    filesystem: string;
    type: string;
    mountedOn: string;
    totalBytes: number;
    usedBytes: number;
    availableBytes: number;
    usePercent: number;
    totalHuman: string;
    usedHuman: string;
    availableHuman: string;
  }>;
  paths: Array<{
    key: string;
    label: string;
    path: string;
    exists: boolean;
    totalBytes: number | null;
    sizeHuman: string;
    mount?: string | null;
    error?: string | null;
  }>;
  warnings: string[];
}

interface OssStats {
  totalBytes: number;
  sizeHuman: string;
  objectCount: number;
  byPrefix: Array<{ prefix: string; count: number; sizeHuman: string }>;
  topFiles: Array<{ name: string; size: number; sizeHuman: string; lastModified: string }>;
}

interface CleanupReport {
  dryRun: boolean;
  tempDeleted?: Array<{ name: string; sizeBytes: number; mtime: string }>;
  cacheDeleted?: Array<{ name: string; sizeBytes: number; reason: string; atime: string }>;
  cacheKept?: Array<{ name: string; reason: string }>;
  deleted?: Array<{ name: string; sizeBytes: number; sizeHuman: string; lastModified: string }>;
  kept?: Array<{ name: string; reason: string }>;
  bytesFreed: number;
  bytesFreedHuman: string;
  errors: string[];
}

export function isAdminEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('admin') === '1';
}

export interface AdminPanelProps {
  /** When true, render inline (no modal overlay). Used by /admin page. */
  embedded?: boolean;
  /** Externally controlled active tab (only used in embedded mode). */
  activeTab?:
    | 'local'
    | 'compute'
    | 'assets'
    | 'oss'
    | 'backup'
    | 'errors'
    | 'users'
    | 'ai'
    | 'usage';
}

interface ComputeHealth {
  timestamp: string;
  platform: { role: string; runMode: string; uptime: number; workerId: string; database: string };
  nodes: Record<
    string,
    {
      baseUrl: string;
      health: {
        ok: boolean;
        statusCode: number;
        latencyMs: number;
        error?: string;
        data?: Record<string, unknown>;
      };
      queue?: {
        ok: boolean;
        statusCode: number;
        latencyMs: number;
        error?: string;
        data?: Record<string, unknown>;
      };
    }
  >;
  queue: {
    byEngineStatus: Record<string, Record<string, number>>;
    byWorker: Array<{
      engine: string;
      workerId: string;
      status: string;
      count: number;
      lastSeen: string | null;
    }>;
    recentTasks: Array<{
      taskId: string;
      engine: string;
      type: string;
      status: string;
      progress: number;
      progressMessage?: string;
      workerId?: string | null;
      createdAt: string;
      startedAt?: string | null;
      finishedAt?: string | null;
      error?: string | null;
    }>;
    staleRunning: Array<{
      taskId: string;
      engine: string;
      type: string;
      status: string;
      progress: number;
      workerId?: string | null;
      createdAt: string;
      startedAt?: string | null;
      claimedAt?: string | null;
    }>;
  } | null;
  queueError?: string | null;
}

interface AssetInspection {
  host: string;
  timestamp: string;
  jobsDir: string;
  summary: { demoCount: number; demoOk: number; demoMissing: number; recentJobs: number };
  demos: Array<{
    toolId: string;
    jobId: string;
    ok: boolean;
    outputExists: boolean;
    fileCount: number;
    totalHuman: string;
    newestMtime?: string | null;
    manifest: {
      exists: boolean;
      valid: boolean;
      fileCount: number;
      hasSummary?: boolean;
      error?: string | null;
    };
    hasRunLog: boolean;
    publicDemoUrl: string;
    topFiles: Array<{ name: string; type: string; sizeHuman: string }>;
    error?: string | null;
  }>;
  recentJobs: Array<{
    jobId: string;
    isPublicDemo: boolean;
    outputExists: boolean;
    fileCount: number;
    totalHuman: string;
    newestMtime?: string | null;
    manifest: { exists: boolean; valid: boolean; fileCount: number; error?: string | null };
    hasRunLog: boolean;
    topFiles: Array<{ name: string; type: string; sizeHuman: string }>;
    error?: string | null;
  }>;
}

// ---------- Global Governance Data Cache for SWR Pattern ----------
const govDataCache: {
  stats?: CacheStats;
  diskStats?: DiskStats;
  ossStats?: OssStats;
  backups?: Array<{ name: string; sizeHuman: string; lastModified: string; engine?: string }>;
  errors?: Array<{
    time: string;
    source: string;
    message: string;
    stack?: string;
    url?: string;
    userAgent?: string;
    ip?: string;
  }>;
  users?: Array<{
    id: string;
    username: string;
    role: string;
    quota_mb: number;
    enabled: boolean;
    permissions?: Record<string, boolean> | null;
    created_at: string;
    stats: { projects: number; datasets: number; analyses: number; storageHuman: string };
  }>;
  guestPerms?: Record<string, boolean>;
  aiUsers?: AiUserRow[];
  globalPaused?: boolean;
  usageStats?: UsageStats;
  usageDays?: number;
  computeHealth?: ComputeHealth;
  assetInspection?: AssetInspection;
} = {};

export function AdminPanel({ embedded = false, activeTab }: AdminPanelProps = {}) {
  const [open, setOpen] = useState(true); // Auto-open when ?admin=1 (component only renders when isAdminEnabled())
  const [tab, setTab] = useState<
    'local' | 'compute' | 'assets' | 'oss' | 'backup' | 'errors' | 'users' | 'ai' | 'usage'
  >(activeTab || 'local');
  const [stats, setStats] = useState<CacheStats | null>(govDataCache.stats || null);
  const [diskStats, setDiskStats] = useState<DiskStats | null>(govDataCache.diskStats || null);
  const [computeHealth, setComputeHealth] = useState<ComputeHealth | null>(
    govDataCache.computeHealth || null
  );
  const [assetInspection, setAssetInspection] = useState<AssetInspection | null>(
    govDataCache.assetInspection || null
  );
  const [ossStats, setOssStats] = useState<OssStats | null>(govDataCache.ossStats || null);
  const [backups, setBackups] = useState<Array<{
    name: string;
    sizeHuman: string;
    lastModified: string;
    engine?: string;
  }> | null>(govDataCache.backups || null);
  const [errors, setErrors] = useState<Array<{
    time: string;
    source: string;
    message: string;
    stack?: string;
    url?: string;
    userAgent?: string;
    ip?: string;
  }> | null>(govDataCache.errors || null);
  const [users, setUsers] = useState<Array<{
    id: string;
    username: string;
    role: string;
    quota_mb: number;
    enabled: boolean;
    permissions?: Record<string, boolean> | null;
    created_at: string;
    stats: { projects: number; datasets: number; analyses: number; storageHuman: string };
  }> | null>(govDataCache.users || null);
  const [guestPerms, setGuestPerms] = useState<Record<string, boolean> | null>(
    govDataCache.guestPerms || null
  );
  const [guestPermsSaving, setGuestPermsSaving] = useState(false);

  // Sync external tab changes (embedded mode) — also auto-fetch data for the new tab
  useEffect(() => {
    if (embedded && activeTab) {
      setTab(activeTab);
    }
  }, [embedded, activeTab]);
  // ADMIN_AI_GOV_v1 — AI governance state
  const [aiUsers, setAiUsers] = useState<AiUserRow[] | null>(govDataCache.aiUsers || null);
  const [globalPaused, setGlobalPaused] = useState(govDataCache.globalPaused || false);
  const [aiAudit, setAiAudit] = useState<AiAuditRow[] | null>(null);
  const [aiAuditUserFilter, setAiAuditUserFilter] = useState<string>('');
  // AI_USAGE_v1 — usage dashboard state
  const [usageStats, setUsageStats] = useState<UsageStats | null>(govDataCache.usageStats || null);
  const [usageDays, setUsageDays] = useState<number>(govDataCache.usageDays || 30);
  const [backingUp, setBackingUp] = useState(false);
  const [report, setReport] = useState<CleanupReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [tempHours, setTempHours] = useState(24);
  const [cacheDays, setCacheDays] = useState(7);
  const [ossDays, setOssDays] = useState(30);

  const fetchStats = useCallback(async (isSilent = false) => {
    if (!isSilent) setLoading(true);
    try {
      const diskPromise = fetchWithAuth(getApiPrefix() + '/admin/disk/stats', undefined, 30_000)
        .then((r) => r.json())
        .then((r3) => {
          if (r3.status === 'ok') {
            setDiskStats(r3.stats);
            govDataCache.diskStats = r3.stats;
          }
        })
        .catch(() => {});
      const [r1, r2] = await Promise.all([
        fetchWithAuth(getApiPrefix() + '/admin/cache/stats').then((r) => r.json()),
        fetchWithAuth(getApiPrefix() + '/admin/oss/stats').then((r) => r.json()),
      ]);
      if (r1.status === 'ok') {
        setStats(r1.stats);
        govDataCache.stats = r1.stats;
      }
      if (r2.status === 'ok') {
        setOssStats(r2.stats);
        govDataCache.ossStats = r2.stats;
      }
      void diskPromise;
    } catch (e: any) {
      alert(`获取统计失败: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  const runLocalCleanup = useCallback(
    async (dryRun: boolean) => {
      if (
        !dryRun &&
        !confirm(
          `确认清理本地？将删除 >${tempHours}h 临时文件 + >${cacheDays} 天未访问的孤儿缓存。`
        )
      )
        return;
      setLoading(true);
      try {
        const resp = await fetchWithAuth(getApiPrefix() + '/admin/cache/cleanup', {
          method: 'POST',
          body: JSON.stringify({ dryRun, tempMaxAgeHours: tempHours, cacheMaxIdleDays: cacheDays }),
        });
        const data = await resp.json();
        if (data.status === 'ok') {
          setReport(data.report);
          if (!dryRun) await fetchStats(true);
        } else alert(`清理失败: ${data.error}`);
      } catch (e: any) {
        alert(`清理失败: ${e.message}`);
      } finally {
        setLoading(false);
      }
    },
    [tempHours, cacheDays, fetchStats]
  );

  const fetchComputeHealth = useCallback(async (isSilent = false) => {
    if (!isSilent) setLoading(true);
    try {
      const resp = await fetchWithAuth(getApiPrefix() + '/admin/compute/health', undefined, 20_000);
      const data = await resp.json();
      if (data.status === 'ok') {
        setComputeHealth(data);
        govDataCache.computeHealth = data;
      } else alert(`获取算力健康失败: ${data.error}`);
    } catch (e: any) {
      alert(`获取算力健康失败: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchAssetInspection = useCallback(async (isSilent = false) => {
    if (!isSilent) setLoading(true);
    try {
      const resp = await fetchWithAuth(getApiPrefix() + '/admin/assets/inspect', undefined, 30_000);
      const data = await resp.json();
      if (data.status === 'ok') {
        setAssetInspection(data.assets);
        govDataCache.assetInspection = data.assets;
      } else alert(`获取资产巡检失败: ${data.error}`);
    } catch (e: any) {
      alert(`获取资产巡检失败: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  const runOssCleanup = useCallback(
    async (dryRun: boolean) => {
      if (
        !dryRun &&
        !confirm(`确认清理 OSS？将删除 >${ossDays} 天未引用的对象（demo/ 永远保留）。`)
      )
        return;
      setLoading(true);
      try {
        const resp = await fetchWithAuth(getApiPrefix() + '/admin/oss/cleanup', {
          method: 'POST',
          body: JSON.stringify({ dryRun, maxAgeDays: ossDays }),
        });
        const data = await resp.json();
        if (data.status === 'ok') {
          setReport(data.report);
          if (!dryRun) await fetchStats(true);
        } else alert(`清理失败: ${data.error}`);
      } catch (e: any) {
        alert(`清理失败: ${e.message}`);
      } finally {
        setLoading(false);
      }
    },
    [ossDays, fetchStats]
  );

  const fetchBackups = useCallback(async (isSilent = false) => {
    if (!isSilent) setLoading(true);
    try {
      const resp = await fetchWithAuth(getApiPrefix() + '/admin/backup/list');
      const data = await resp.json();
      if (data.status === 'ok') {
        setBackups(data.backups);
        govDataCache.backups = data.backups;
      } else alert(`获取备份列表失败: ${data.error}`);
    } catch (e: any) {
      alert(`获取备份列表失败: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchErrors = useCallback(async (isSilent = false) => {
    if (!isSilent) setLoading(true);
    try {
      const resp = await fetchWithAuth(getApiPrefix() + '/admin/errors');
      const data = await resp.json();
      if (data.status === 'ok') {
        const sorted = data.errors.reverse();
        setErrors(sorted); // newest first
        govDataCache.errors = sorted;
      } else alert(`获取错误日志失败: ${data.error}`);
    } catch (e: any) {
      alert(`获取错误日志失败: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchUsers = useCallback(async (isSilent = false) => {
    if (!isSilent) setLoading(true);
    try {
      const [usersResp, guestResp] = await Promise.all([
        fetchWithAuth(getApiPrefix() + '/admin/users'),
        fetchWithAuth(getApiPrefix() + '/admin/guest-permissions'),
      ]);
      const usersData = await usersResp.json();
      if (usersData.status === 'ok') {
        setUsers(usersData.users);
        govDataCache.users = usersData.users;
      }
      const guestData = await guestResp.json();
      if (guestData.status === 'ok') {
        setGuestPerms(guestData.permissions);
        govDataCache.guestPerms = guestData.permissions;
      }
    } catch (e: any) {
      alert(`获取用户列表失败: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  const saveGuestPermissions = useCallback(async (next: Record<string, boolean>) => {
    setGuestPermsSaving(true);
    try {
      const resp = await fetchWithAuth(getApiPrefix() + '/admin/guest-permissions', {
        method: 'PUT',
        body: JSON.stringify({ permissions: next }),
      });
      const data = await resp.json();
      if (data.status === 'ok') {
        setGuestPerms(data.permissions);
        try {
          const { fetchGuestPermissions } = await import('@/lib/authClient');
          await fetchGuestPermissions();
        } catch {
          /* ignore */
        }
      } else alert(`保存失败: ${data.error}`);
    } catch (e: any) {
      alert(e.message);
    } finally {
      setGuestPermsSaving(false);
    }
  }, []);

  const toggleGuestModule = useCallback(
    (moduleKey: string, allow: boolean) => {
      if (!guestPerms) return;
      const MODS: Array<[string, boolean]> = [
        ['docs', true],
        ['blog', true],
        ['figcode', true],
        ['tools', false],
        ['skills', false],
        ['single-cell', false],
        ['spatial', false],
        ['copilot', false],
      ];
      const base: Record<string, boolean> = {};
      for (const [k, def] of MODS) base[k] = guestPerms[k] ?? def;
      base[moduleKey] = allow;
      saveGuestPermissions(base);
    },
    [guestPerms, saveGuestPermissions]
  );

  const updateUserRole = useCallback(
    async (userId: string, role: string) => {
      try {
        await fetchWithAuth(getApiPrefix() + `/admin/users/${userId}`, {
          method: 'PUT',
          body: JSON.stringify({ role }),
        });
        fetchUsers();
      } catch (e: any) {
        alert(e.message);
      }
    },
    [fetchUsers]
  );

  const updateUserQuota = useCallback(
    async (userId: string, quotaMb: number) => {
      try {
        const resp = await fetchWithAuth(getApiPrefix() + `/admin/users/${userId}`, {
          method: 'PUT',
          body: JSON.stringify({ quotaMb }),
        });
        const data = await resp.json();
        if (data.status !== 'ok') {
          alert(`更新失败: ${data.error}`);
          return;
        }
        fetchUsers();
      } catch (e: any) {
        alert(`请求失败: ${e.message}`);
      }
    },
    [fetchUsers]
  );

  const toggleUserEnabled = useCallback(
    async (userId: string, enabled: boolean) => {
      try {
        await fetchWithAuth(getApiPrefix() + `/admin/users/${userId}`, {
          method: 'PUT',
          body: JSON.stringify({ enabled }),
        });
        fetchUsers();
      } catch (e: any) {
        alert(e.message);
      }
    },
    [fetchUsers]
  );

  // MODULE_PERMS_v1 — toggle a single module's access for a user.
  // Sends the full effective permission map (with the one key flipped) so the
  // backend stores an explicit override instead of relying on defaults.
  const updateUserModule = useCallback(
    async (
      userId: string,
      currentPerms: Record<string, boolean> | null | undefined,
      moduleKey: string,
      allow: boolean
    ) => {
      // Build the full 8-module map from current effective perms (defaults baked in
      // server-side, so currentPerms from /admin/users is already effective).
      const MODS: Array<[string, boolean]> = [
        ['docs', true],
        ['blog', true],
        ['figcode', true],
        ['tools', false],
        ['skills', false],
        ['single-cell', false],
        ['spatial', false],
        ['copilot', true],
      ];
      const base: Record<string, boolean> = {};
      for (const [k, def] of MODS) base[k] = currentPerms?.[k] ?? def;
      base[moduleKey] = allow;
      try {
        const resp = await fetchWithAuth(getApiPrefix() + `/admin/users/${userId}`, {
          method: 'PUT',
          body: JSON.stringify({ permissions: base }),
        });
        const data = await resp.json();
        if (data.status !== 'ok') {
          alert(`更新失败: ${data.error}`);
          return;
        }
        fetchUsers();
      } catch (e: any) {
        alert(`请求失败: ${e.message}`);
      }
    },
    [fetchUsers]
  );

  // ADMIN_AI_GOV_v1 — fetchers and mutators
  const fetchAiOverview = useCallback(async (isSilent = false) => {
    if (!isSilent) setLoading(true);
    try {
      const resp = await fetchWithAuth(getApiPrefix() + '/ai/admin/users-overview');
      const data = await resp.json();
      if (data.status === 'ok') {
        setAiUsers(data.users);
        govDataCache.aiUsers = data.users;
        setGlobalPaused(!!data.globalPaused);
        govDataCache.globalPaused = !!data.globalPaused;
      } else {
        alert(`获取 AI 用量失败: ${data.error}`);
      }
    } catch (e: any) {
      alert(`获取 AI 用量失败: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchAiAudit = useCallback(async (userId?: string) => {
    setLoading(true);
    try {
      const url =
        getApiPrefix() +
        '/ai/admin/audit?limit=80' +
        (userId ? '&userId=' + encodeURIComponent(userId) : '');
      const resp = await fetch(url, { headers: getAuthHeaders() });
      const data = await resp.json();
      if (data.status === 'ok') setAiAudit(data.audit);
      else alert(`获取审计失败: ${data.error}`);
    } catch (e: any) {
      alert(`获取审计失败: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  const toggleUserAiPause = useCallback(
    async (userId: string, paused: boolean) => {
      try {
        const resp = await fetchWithAuth(getApiPrefix() + '/ai/admin/pause-user', {
          method: 'POST',
          body: JSON.stringify({ userId, paused }),
        });
        const data = await resp.json();
        if (data.status === 'ok') fetchAiOverview(true);
        else alert(`操作失败: ${data.error}`);
      } catch (e: any) {
        alert(e.message);
      }
    },
    [fetchAiOverview]
  );

  const toggleGlobalAiPause = useCallback(async () => {
    if (
      !confirm(
        globalPaused
          ? '恢复全局 Agent Mode？所有用户的 AI 写操作（act/act_generic）将重新可用。'
          : '紧急暂停全局 Agent Mode？所有用户的 AI 写操作（act/act_generic）会被立即拦截，普通对话不受影响。'
      )
    )
      return;
    try {
      const resp = await fetchWithAuth(getApiPrefix() + '/ai/admin/global-pause', {
        method: 'POST',
        body: JSON.stringify({ paused: !globalPaused }),
      });
      const data = await resp.json();
      if (data.status === 'ok') {
        setGlobalPaused(!!data.paused);
        govDataCache.globalPaused = !!data.paused;
      } else {
        alert(`操作失败: ${data.error}`);
      }
    } catch (e: any) {
      alert(e.message);
    }
  }, [globalPaused]);

  const impersonate = useCallback(async (userId: string, username: string) => {
    if (
      !confirm(
        `模拟登录为「${username}」？\n你将以该用户身份看到他们的会话/记忆/计划。仅用于排查。`
      )
    )
      return;
    try {
      const resp = await fetchWithAuth(getApiPrefix() + `/admin/impersonate/${userId}`, {
        method: 'POST',
      });
      const data = await resp.json();
      if (data.status === 'ok' && data.token) {
        try {
          localStorage.setItem('biof3_token', data.token);
        } catch {}
        try {
          localStorage.removeItem('biof3_copilot_active_conv');
        } catch {}
        try {
          localStorage.removeItem('biof3_copilot_thread');
        } catch {}
        alert(`已切换为「${username}」，刷新页面生效。`);
        window.location.reload();
      } else {
        alert(`切换失败: ${data.error}`);
      }
    } catch (e: any) {
      alert(e.message);
    }
  }, []);

  // AI_USAGE_v1 — fetch usage stats
  const fetchUsageStats = useCallback(
    async (days: number = usageDays, isSilent = false) => {
      if (!isSilent) setLoading(true);
      try {
        const resp = await fetchWithAuth(
          getApiPrefix() + `/ai/admin/usage-stats?days=${days}`,
          undefined,
          30_000
        );
        const data = await resp.json();
        if (data.status === 'ok') setUsageStats(data);
        else alert(`获取用量统计失败: ${data.error}`);
      } catch (e: any) {
        alert(e.message);
      } finally {
        setLoading(false);
      }
    },
    [usageDays]
  );

  const triggerBackup = useCallback(async () => {
    setBackingUp(true);
    try {
      const resp = await fetchWithAuth(getApiPrefix() + '/admin/backup/db', {
        method: 'POST',
      });
      const data = await resp.json();
      if (data.status === 'ok') {
        alert(`备份成功！\n${data.result.ossKey}\n大小: ${data.result.sizeHuman}`);
        await fetchBackups();
      } else {
        alert(`备份失败: ${data.error || data.result?.error}`);
      }
    } catch (e: any) {
      alert(`备份失败: ${e.message}`);
    } finally {
      setBackingUp(false);
    }
  }, [fetchBackups]);

  const downloadBackup = useCallback(async (name: string) => {
    try {
      const resp = await fetchWithAuth(
        getApiPrefix() + `/admin/backup/download/${encodeURIComponent(name)}`
      );
      const data = await resp.json();
      if (data.status === 'ok' && data.url) {
        window.open(data.url, '_blank');
      } else {
        alert(`下载失败: ${data.error}`);
      }
    } catch (e: any) {
      alert(`下载失败: ${e.message}`);
    }
  }, []);

  useEffect(() => {
    if (open) {
      if (tab === 'compute') fetchComputeHealth(!!govDataCache.computeHealth);
      else if (tab === 'assets') fetchAssetInspection(!!govDataCache.assetInspection);
      else fetchStats(!!govDataCache.stats);
    }
  }, [open, tab, fetchStats, fetchComputeHealth, fetchAssetInspection]);

  // Embedded mode auto-load: when activeTab changes, fetch data for that tab
  useEffect(() => {
    if (!embedded || !activeTab) return;
    switch (activeTab) {
      case 'local':
      case 'oss':
        fetchStats(!!govDataCache.stats);
        break;
      case 'compute':
        fetchComputeHealth(!!govDataCache.computeHealth);
        break;
      case 'assets':
        fetchAssetInspection(!!govDataCache.assetInspection);
        break;
      case 'backup':
        fetchBackups(!!govDataCache.backups);
        break;
      case 'errors':
        fetchErrors(!!govDataCache.errors);
        break;
      case 'users':
        fetchUsers(!!govDataCache.users);
        break;
      case 'ai':
        fetchAiOverview(!!govDataCache.aiUsers);
        break;
      case 'usage':
        const isUsageCached = govDataCache.usageStats && govDataCache.usageDays === usageDays;
        fetchUsageStats(usageDays, !!isUsageCached);
        break;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [embedded, activeTab, usageDays, fetchComputeHealth, fetchAssetInspection]);

  const refreshCurrentTab = useCallback(() => {
    switch (tab) {
      case 'compute':
        return fetchComputeHealth();
      case 'assets':
        return fetchAssetInspection();
      case 'backup':
        return fetchBackups();
      case 'errors':
        return fetchErrors();
      case 'users':
        return fetchUsers();
      case 'ai':
        return fetchAiOverview();
      case 'usage':
        return fetchUsageStats(usageDays);
      default:
        return fetchStats();
    }
  }, [
    tab,
    fetchComputeHealth,
    fetchAssetInspection,
    fetchBackups,
    fetchErrors,
    fetchUsers,
    fetchAiOverview,
    fetchUsageStats,
    usageDays,
    fetchStats,
  ]);

  // When embedded, force open and skip the modal chrome via CSS class
  const isEmbedded = embedded;
  const shouldRender = isEmbedded || open;

  return (
    <>
      {/* Floating button removed — admin panel now opened via user menu in top-right */}

      {shouldRender && (
        <div
          className={isEmbedded ? 'sc-admin-embedded' : 'sc-modal-overlay'}
          onClick={
            isEmbedded
              ? undefined
              : () => {
                  setOpen(false);
                  history.replaceState(null, '', window.location.pathname + window.location.hash);
                }
          }
        >
          <div
            className={isEmbedded ? '' : 'sc-modal'}
            onClick={(e) => e.stopPropagation()}
            style={isEmbedded ? {} : { maxWidth: 900, width: '90vw' }}
          >
            {!isEmbedded && (
              <div className="sc-modal-header">
                <h2 className="sc-modal-title">管理面板</h2>
                <button
                  className="sc-modal-close"
                  onClick={() => {
                    setOpen(false);
                    history.replaceState(null, '', window.location.pathname + window.location.hash);
                  }}
                >
                  ×
                </button>
              </div>
            )}

            {/* Tabs (hidden in embedded mode — parent provides them) */}
            {!isEmbedded && (
              <div className="sc-result-tabs" style={{ marginBottom: 14 }}>
                <button
                  className={`sc-tab ${tab === 'local' ? 'active' : ''}`}
                  onClick={() => {
                    setTab('local');
                    setReport(null);
                    fetchStats(!!govDataCache.stats);
                  }}
                >
                  本地存储 (Dell)
                </button>
                <button
                  className={`sc-tab ${tab === 'compute' ? 'active' : ''}`}
                  onClick={() => {
                    setTab('compute');
                    setReport(null);
                    fetchComputeHealth(!!govDataCache.computeHealth);
                  }}
                >
                  算力健康
                </button>
                <button
                  className={`sc-tab ${tab === 'assets' ? 'active' : ''}`}
                  onClick={() => {
                    setTab('assets');
                    setReport(null);
                    fetchAssetInspection(!!govDataCache.assetInspection);
                  }}
                >
                  资产巡检
                </button>
                <button
                  className={`sc-tab ${tab === 'oss' ? 'active' : ''}`}
                  onClick={() => {
                    setTab('oss');
                    setReport(null);
                    fetchStats(!!govDataCache.stats);
                  }}
                >
                  OSS 对象存储
                </button>
                <button
                  className={`sc-tab ${tab === 'backup' ? 'active' : ''}`}
                  onClick={() => {
                    setTab('backup');
                    setReport(null);
                    fetchBackups(!!govDataCache.backups);
                  }}
                >
                  数据库备份
                </button>
                <button
                  className={`sc-tab ${tab === 'errors' ? 'active' : ''}`}
                  onClick={() => {
                    setTab('errors');
                    setReport(null);
                    fetchErrors(!!govDataCache.errors);
                  }}
                >
                  错误日志
                </button>
                <button
                  className={`sc-tab ${tab === 'users' ? 'active' : ''}`}
                  onClick={() => {
                    setTab('users');
                    setReport(null);
                    fetchUsers(!!govDataCache.users);
                  }}
                >
                  用户管理
                </button>
                <button
                  className={`sc-tab ${tab === 'ai' ? 'active' : ''}`}
                  onClick={() => {
                    setTab('ai');
                    setReport(null);
                    fetchAiOverview(!!govDataCache.aiUsers);
                  }}
                >
                  🤖 AI 治理
                </button>
                <button
                  className={`sc-tab ${tab === 'usage' ? 'active' : ''}`}
                  onClick={() => {
                    setTab('usage');
                    setReport(null);
                    fetchUsageStats(
                      usageDays,
                      !!(govDataCache.usageStats && govDataCache.usageDays === usageDays)
                    );
                  }}
                >
                  📊 AI 看板
                </button>
              </div>
            )}

            <div className="sc-modal-body">
              {/* ---------- Local tab ---------- */}
              {tab === 'local' && (
                <>
                  {!stats && <div className="sc-empty-desc">加载中...</div>}
                  {stats && (
                    <>
                      <div className="sc-admin-stats">
                        {diskStats?.mounts?.[0] && (
                          <div className="sc-admin-stat">
                            <div
                              className="sc-admin-stat-value"
                              style={{
                                color: diskStats.mounts[0].usePercent >= 85 ? '#dc2626' : '#059669',
                              }}
                            >
                              {diskStats.mounts[0].usePercent}%
                            </div>
                            <div className="sc-admin-stat-label">Dell 主存储水位</div>
                            <div className="sc-admin-stat-sub">
                              {diskStats.mounts[0].usedHuman} / {diskStats.mounts[0].totalHuman} ·
                              剩 {diskStats.mounts[0].availableHuman}
                            </div>
                          </div>
                        )}
                        <div className="sc-admin-stat">
                          <div className="sc-admin-stat-value">{stats.temp.sizeHuman}</div>
                          <div className="sc-admin-stat-label">临时空间</div>
                          <div className="sc-admin-stat-sub">
                            {stats.temp.fileCount} 文件 / {stats.temp.dirCount} 目录
                          </div>
                        </div>
                        <div className="sc-admin-stat">
                          <div className="sc-admin-stat-value">{stats.cache.sizeHuman}</div>
                          <div className="sc-admin-stat-label">缓存空间</div>
                          <div className="sc-admin-stat-sub">{stats.cache.fileCount} 文件</div>
                        </div>
                        <div className="sc-admin-stat">
                          <div className="sc-admin-stat-value">{stats.totalHuman}</div>
                          <div className="sc-admin-stat-label">总计</div>
                        </div>
                      </div>

                      {diskStats && (
                        <>
                          <div className="sc-admin-section-title">Dell 本地磁盘</div>
                          <div
                            style={{
                              padding: '10px 14px',
                              background: '#f8fafc',
                              borderRadius: 6,
                              fontSize: 11,
                              lineHeight: 1.6,
                              color: '#475569',
                              marginBottom: 12,
                            }}
                          >
                            节点: <code>{diskStats.host}</code> · 更新时间{' '}
                            {new Date(diskStats.timestamp).toLocaleString('zh-CN')}
                            {diskStats.warnings.length > 0 && (
                              <span style={{ color: '#dc2626' }}>
                                {' '}
                                · {diskStats.warnings.length} 个目录统计异常
                              </span>
                            )}
                          </div>
                          <div className="sc-admin-files">
                            {diskStats.paths.map((p) => (
                              <div key={p.key} className="sc-admin-file">
                                <span className="sc-admin-file-name">
                                  {p.label} · <code>{p.path}</code>
                                  {!p.exists && (
                                    <span style={{ color: '#dc2626', marginLeft: 6 }}>missing</span>
                                  )}
                                  {p.error && (
                                    <span
                                      style={{ color: '#dc2626', marginLeft: 6 }}
                                      title={p.error}
                                    >
                                      error
                                    </span>
                                  )}
                                </span>
                                <span className="sc-admin-file-size">{p.sizeHuman}</span>
                              </div>
                            ))}
                          </div>
                        </>
                      )}

                      <div className="sc-param-group" style={{ marginTop: 14 }}>
                        <div className="sc-param-title">清理策略</div>
                        <div className="sc-param-row">
                          <label>临时目录保留</label>
                          <input
                            type="number"
                            min={1}
                            max={168}
                            value={tempHours}
                            onChange={(e) => setTempHours(+e.target.value)}
                          />
                          <span style={{ fontSize: 11, color: '#9ca3af', marginLeft: 6 }}>
                            小时
                          </span>
                        </div>
                        <div className="sc-param-row">
                          <label>缓存空闲删除</label>
                          <input
                            type="number"
                            min={1}
                            max={90}
                            value={cacheDays}
                            onChange={(e) => setCacheDays(+e.target.value)}
                          />
                          <span style={{ fontSize: 11, color: '#9ca3af', marginLeft: 6 }}>天</span>
                        </div>
                      </div>

                      <div className="sc-admin-section-title">缓存文件 (Top 20)</div>
                      <div className="sc-admin-files">
                        {stats.cache.files.slice(0, 20).map((f) => (
                          <div key={f.name} className="sc-admin-file">
                            <span className="sc-admin-file-name">
                              {f.isSymlink && <span style={{ color: '#9ca3af' }}>↪ </span>}
                              {f.name}
                            </span>
                            <span className="sc-admin-file-size">{formatSize(f.size)}</span>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </>
              )}

              {/* ---------- Compute tab ---------- */}
              {tab === 'compute' && (
                <>
                  {!computeHealth && <div className="sc-empty-desc">加载中...</div>}
                  {computeHealth && (
                    <>
                      <div className="sc-admin-section-title">算力节点状态</div>
                      <div
                        style={{
                          padding: '10px 14px',
                          background: '#f8fafc',
                          borderRadius: 6,
                          fontSize: 11,
                          lineHeight: 1.6,
                          color: '#475569',
                          marginBottom: 12,
                        }}
                      >
                        平台: <code>{computeHealth.platform.role}</code> · 运行模式:{' '}
                        <code>{computeHealth.platform.runMode}</code> · 队列库:{' '}
                        <code>{computeHealth.platform.database}</code> · 更新时间{' '}
                        {new Date(computeHealth.timestamp).toLocaleString('zh-CN')}
                      </div>
                      <div className="sc-admin-stats">
                        {Object.entries(computeHealth.nodes).map(([name, node]) => (
                          <div key={name} className="sc-admin-stat">
                            <div
                              className="sc-admin-stat-value"
                              style={{ color: node.health.ok ? '#059669' : '#dc2626' }}
                            >
                              {node.health.ok ? 'OK' : '异常'}
                            </div>
                            <div className="sc-admin-stat-label">
                              {name === 'r' ? 'R 算力' : 'Python 算力'}
                            </div>
                            <div className="sc-admin-stat-sub">
                              health {node.health.statusCode || '-'} · {node.health.latencyMs}ms
                              {node.health.error ? ` · ${node.health.error}` : ''}
                            </div>
                            {node.queue && (
                              <div className="sc-admin-stat-sub">
                                queue {node.queue.statusCode || '-'} · {node.queue.latencyMs}ms
                              </div>
                            )}
                          </div>
                        ))}
                        <div className="sc-admin-stat">
                          <div className="sc-admin-stat-value">
                            {Math.round(computeHealth.platform.uptime / 60)}m
                          </div>
                          <div className="sc-admin-stat-label">ECS 平台进程</div>
                          <div className="sc-admin-stat-sub">{computeHealth.platform.workerId}</div>
                        </div>
                      </div>

                      <div className="sc-admin-section-title">PG 队列统计</div>
                      {computeHealth.queueError && (
                        <div className="sc-empty-desc">
                          队列查询失败: {computeHealth.queueError}
                        </div>
                      )}
                      {computeHealth.queue && (
                        <>
                          <div className="sc-admin-stats">
                            {Object.entries(computeHealth.queue.byEngineStatus).map(
                              ([engine, counts]) => (
                                <div key={engine} className="sc-admin-stat">
                                  <div className="sc-admin-stat-value">
                                    {(counts.pending || 0) + (counts.running || 0)}
                                  </div>
                                  <div className="sc-admin-stat-label">{engine} 待处理/运行</div>
                                  <div className="sc-admin-stat-sub">
                                    pending {counts.pending || 0} · running {counts.running || 0} ·
                                    done {counts.done || 0} · failed {counts.failed || 0}
                                  </div>
                                </div>
                              )
                            )}
                            <div className="sc-admin-stat">
                              <div
                                className="sc-admin-stat-value"
                                style={{
                                  color: computeHealth.queue.staleRunning.length
                                    ? '#dc2626'
                                    : '#059669',
                                }}
                              >
                                {computeHealth.queue.staleRunning.length}
                              </div>
                              <div className="sc-admin-stat-label">疑似卡住任务</div>
                              <div className="sc-admin-stat-sub">running 超过 2 小时</div>
                            </div>
                          </div>

                          <div className="sc-admin-section-title">Worker 分布</div>
                          <div className="sc-admin-files">
                            {computeHealth.queue.byWorker.slice(0, 24).map((w, i) => (
                              <div
                                key={`${w.engine}-${w.workerId}-${w.status}-${i}`}
                                className="sc-admin-file"
                              >
                                <span className="sc-admin-file-name">
                                  {w.engine} · {w.workerId} · {w.status}
                                </span>
                                <span className="sc-admin-file-size">{w.count}</span>
                                {w.lastSeen && (
                                  <span style={{ fontSize: 10, color: '#9ca3af', marginLeft: 8 }}>
                                    {new Date(w.lastSeen).toLocaleString('zh-CN')}
                                  </span>
                                )}
                              </div>
                            ))}
                            {computeHealth.queue.byWorker.length === 0 && (
                              <div className="sc-empty-desc">暂无最近 7 天 worker 记录</div>
                            )}
                          </div>

                          <div className="sc-admin-section-title">最近任务</div>
                          <div className="sc-admin-files">
                            {computeHealth.queue.recentTasks.slice(0, 12).map((t) => (
                              <div key={t.taskId} className="sc-admin-file">
                                <span className="sc-admin-file-name">
                                  {t.engine} · {t.type} · {t.status} · {t.taskId.slice(0, 8)}
                                </span>
                                <span className="sc-admin-file-size">{t.progress || 0}%</span>
                                {t.workerId && (
                                  <span style={{ fontSize: 10, color: '#64748b', marginLeft: 8 }}>
                                    {t.workerId}
                                  </span>
                                )}
                                <span style={{ fontSize: 10, color: '#9ca3af', marginLeft: 8 }}>
                                  {new Date(t.createdAt).toLocaleString('zh-CN')}
                                </span>
                              </div>
                            ))}
                            {computeHealth.queue.recentTasks.length === 0 && (
                              <div className="sc-empty-desc">暂无任务</div>
                            )}
                          </div>
                        </>
                      )}
                    </>
                  )}
                </>
              )}

              {/* ---------- Assets tab ---------- */}
              {tab === 'assets' && (
                <>
                  {!assetInspection && <div className="sc-empty-desc">加载中...</div>}
                  {assetInspection && (
                    <>
                      <div className="sc-admin-section-title">结果资产巡检</div>
                      <div
                        style={{
                          padding: '10px 14px',
                          background: '#f8fafc',
                          borderRadius: 6,
                          fontSize: 11,
                          lineHeight: 1.6,
                          color: '#475569',
                          marginBottom: 12,
                        }}
                      >
                        节点: <code>{assetInspection.host}</code> · 目录:{' '}
                        <code>{assetInspection.jobsDir}</code> · 更新时间{' '}
                        {new Date(assetInspection.timestamp).toLocaleString('zh-CN')}
                      </div>
                      <div className="sc-admin-stats">
                        <div className="sc-admin-stat">
                          <div
                            className="sc-admin-stat-value"
                            style={{
                              color: assetInspection.summary.demoMissing ? '#dc2626' : '#059669',
                            }}
                          >
                            {assetInspection.summary.demoOk}/{assetInspection.summary.demoCount}
                          </div>
                          <div className="sc-admin-stat-label">公开 Demo 资产</div>
                          <div className="sc-admin-stat-sub">
                            缺失/异常 {assetInspection.summary.demoMissing}
                          </div>
                        </div>
                        <div className="sc-admin-stat">
                          <div className="sc-admin-stat-value">
                            {assetInspection.summary.recentJobs}
                          </div>
                          <div className="sc-admin-stat-label">最近结果目录</div>
                          <div className="sc-admin-stat-sub">按输出文件时间排序</div>
                        </div>
                      </div>

                      <div className="sc-admin-section-title">公开 Demo 映射</div>
                      <div className="sc-admin-files">
                        {assetInspection.demos.map((d) => (
                          <div key={d.toolId} className="sc-admin-file">
                            <span className="sc-admin-file-name">
                              <span
                                style={{ color: d.ok ? '#059669' : '#dc2626', fontWeight: 700 }}
                              >
                                {d.ok ? 'OK' : 'BAD'}
                              </span>{' '}
                              {d.toolId} · {d.jobId}
                              {!d.manifest.valid && d.manifest.exists && (
                                <span style={{ color: '#dc2626', marginLeft: 6 }}>manifest</span>
                              )}
                              {!d.outputExists && (
                                <span style={{ color: '#dc2626', marginLeft: 6 }}>
                                  missing output
                                </span>
                              )}
                            </span>
                            <span className="sc-admin-file-size">
                              {d.fileCount} 文件 · {d.totalHuman}
                            </span>
                            {d.newestMtime && (
                              <span style={{ fontSize: 10, color: '#9ca3af', marginLeft: 8 }}>
                                {new Date(d.newestMtime).toLocaleString('zh-CN')}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>

                      <div className="sc-admin-section-title">最近结果目录</div>
                      <div className="sc-admin-files">
                        {assetInspection.recentJobs.slice(0, 20).map((j) => (
                          <div key={j.jobId} className="sc-admin-file">
                            <span className="sc-admin-file-name">
                              {j.isPublicDemo && (
                                <span style={{ color: '#0f766e', fontWeight: 700 }}>DEMO </span>
                              )}
                              {j.jobId}
                              {!j.outputExists && (
                                <span style={{ color: '#dc2626', marginLeft: 6 }}>
                                  missing output
                                </span>
                              )}
                              {j.manifest.exists && !j.manifest.valid && (
                                <span style={{ color: '#dc2626', marginLeft: 6 }}>
                                  bad manifest
                                </span>
                              )}
                            </span>
                            <span className="sc-admin-file-size">
                              {j.fileCount} 文件 · {j.totalHuman}
                            </span>
                            {j.newestMtime && (
                              <span style={{ fontSize: 10, color: '#9ca3af', marginLeft: 8 }}>
                                {new Date(j.newestMtime).toLocaleString('zh-CN')}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </>
              )}

              {/* ---------- OSS tab ---------- */}
              {tab === 'oss' && (
                <>
                  {!ossStats && <div className="sc-empty-desc">加载中...</div>}
                  {ossStats && (
                    <>
                      <div className="sc-admin-stats">
                        <div className="sc-admin-stat">
                          <div className="sc-admin-stat-value">{ossStats.sizeHuman}</div>
                          <div className="sc-admin-stat-label">OSS 总用量</div>
                          <div className="sc-admin-stat-sub">{ossStats.objectCount} 对象</div>
                        </div>
                        {ossStats.byPrefix.slice(0, 2).map((p) => (
                          <div key={p.prefix} className="sc-admin-stat">
                            <div className="sc-admin-stat-value">{p.sizeHuman}</div>
                            <div className="sc-admin-stat-label">{p.prefix}/</div>
                            <div className="sc-admin-stat-sub">{p.count} 对象</div>
                          </div>
                        ))}
                      </div>

                      <div className="sc-param-group" style={{ marginTop: 14 }}>
                        <div className="sc-param-title">OSS 清理策略</div>
                        <div className="sc-param-row">
                          <label>未引用对象保留</label>
                          <input
                            type="number"
                            min={0}
                            max={365}
                            value={ossDays}
                            onChange={(e) => setOssDays(+e.target.value)}
                          />
                          <span style={{ fontSize: 11, color: '#9ca3af', marginLeft: 6 }}>
                            天 (0=立即清理)
                          </span>
                        </div>
                        <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 6 }}>
                          ⚠ demo/ 前缀永远保留 · 数据库中仍引用的 OSS 对象不会被删除
                        </div>
                      </div>

                      <div className="sc-admin-section-title">最大对象 (Top 20)</div>
                      <div className="sc-admin-files">
                        {ossStats.topFiles.slice(0, 20).map((f) => (
                          <div key={f.name} className="sc-admin-file">
                            <span className="sc-admin-file-name">{f.name}</span>
                            <span className="sc-admin-file-size">{f.sizeHuman}</span>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </>
              )}

              {/* ---------- Backup tab ---------- */}
              {tab === 'backup' && (
                <>
                  <div className="sc-admin-section-title">数据库备份策略</div>
                  <div
                    style={{
                      padding: '10px 14px',
                      background: '#f8faf9',
                      borderRadius: 6,
                      fontSize: 11,
                      lineHeight: 1.6,
                      color: '#475569',
                      marginBottom: 12,
                    }}
                  >
                    每天自动备份 <code>ECS Docker PostgreSQL</code> → 上传到 OSS{' '}
                    <code>backups/postgresql/</code> · 可手动触发
                  </div>

                  <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                    <button
                      className="sc-btn sc-btn-primary"
                      onClick={triggerBackup}
                      disabled={backingUp}
                    >
                      {backingUp ? '备份中...' : '立即备份'}
                    </button>
                    <button className="sc-btn" onClick={() => fetchBackups()} disabled={loading}>
                      刷新列表
                    </button>
                  </div>

                  {backups === null && <div className="sc-empty-desc">加载中...</div>}
                  {backups && backups.length === 0 && <div className="sc-empty-desc">暂无备份</div>}
                  {backups && backups.length > 0 && (
                    <>
                      <div className="sc-admin-section-title">已有备份 ({backups.length})</div>
                      <div className="sc-admin-files">
                        {backups.map((b) => (
                          <div
                            key={b.name}
                            className="sc-admin-file"
                            onClick={() => downloadBackup(b.name)}
                            style={{ cursor: 'pointer' }}
                          >
                            <span className="sc-admin-file-name">{b.name}</span>
                            <span className="sc-admin-file-size">{b.sizeHuman}</span>
                            {b.engine && (
                              <span style={{ fontSize: 10, color: '#64748b', marginLeft: 8 }}>
                                {b.engine}
                              </span>
                            )}
                            <span style={{ fontSize: 10, color: '#9ca3af', marginLeft: 8 }}>
                              ↓ 下载
                            </span>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </>
              )}

              {/* ---------- Errors tab ---------- */}
              {tab === 'errors' && (
                <>
                  <div className="sc-admin-section-title">错误日志（最近 200 条）</div>
                  <div style={{ marginBottom: 10, fontSize: 11, color: '#9ca3af' }}>
                    收集前后端的未捕获异常 · 实时推送 · 来源: <code>/var/log/biof3-errors.log</code>
                  </div>
                  {errors === null && <div className="sc-empty-desc">加载中...</div>}
                  {errors && errors.length === 0 && <div className="sc-empty-desc">✓ 暂无错误</div>}
                  {errors && errors.length > 0 && (
                    <div style={{ maxHeight: 400, overflowY: 'auto' }}>
                      {errors.map((e, i) => (
                        <div
                          key={i}
                          style={{
                            padding: '8px 10px',
                            borderBottom: '1px solid #f1f5f9',
                            fontSize: 11,
                          }}
                        >
                          <div
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              marginBottom: 4,
                            }}
                          >
                            <span style={{ color: '#dc2626', fontWeight: 600 }}>
                              [{e.source}] {e.message}
                            </span>
                            <span style={{ color: '#9ca3af', fontSize: 10 }}>
                              {new Date(e.time).toLocaleString('zh-CN')}
                            </span>
                          </div>
                          {e.url && (
                            <div style={{ color: '#9ca3af', fontSize: 10 }}>URL: {e.url}</div>
                          )}
                          {e.ip && <div style={{ color: '#9ca3af', fontSize: 10 }}>IP: {e.ip}</div>}
                          {e.stack && (
                            <details style={{ marginTop: 4 }}>
                              <summary
                                style={{ cursor: 'pointer', fontSize: 10, color: '#64748b' }}
                              >
                                堆栈
                              </summary>
                              <pre
                                style={{
                                  fontSize: 10,
                                  color: '#475569',
                                  whiteSpace: 'pre-wrap',
                                  marginTop: 4,
                                  padding: 6,
                                  background: '#f8faf9',
                                  borderRadius: 4,
                                }}
                              >
                                {e.stack}
                              </pre>
                            </details>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}

              {/* ---------- Users tab ---------- */}
              {tab === 'users' && (
                <>
                  <div
                    style={{
                      marginBottom: 16,
                      padding: '14px 16px',
                      borderRadius: 10,
                      border: '1px solid #e2e8f0',
                      background: 'linear-gradient(135deg, #f8fafc 0%, #f0fdf4 100%)',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'flex-start',
                        flexWrap: 'wrap',
                        gap: 10,
                      }}
                    >
                      <div>
                        <div className="sc-admin-section-title" style={{ margin: 0, fontSize: 14 }}>
                          游客权限（未登录访客）
                        </div>
                        <p
                          style={{
                            fontSize: 11,
                            color: '#64748b',
                            margin: '6px 0 0',
                            maxWidth: 520,
                            lineHeight: 1.5,
                          }}
                        >
                          控制未登录用户能否使用各模块。教程/博客/FigCode
                          浏览始终公开；此处主要限制在线工具、Skills、单细胞/空间云、
                          <strong>Copilot</strong>（站点 AI 组学实践助手，模块键{' '}
                          <code>copilot</code>）等需算力的能力。后端 API 与导航会同步生效。
                        </p>
                      </div>
                      <button
                        className="sc-btn sc-btn-sm"
                        onClick={() => fetchUsers()}
                        disabled={loading || guestPermsSaving}
                      >
                        刷新
                      </button>
                    </div>
                    {guestPerms === null ? (
                      <p className="sc-empty-desc" style={{ marginTop: 10 }}>
                        加载游客权限...
                      </p>
                    ) : (
                      <div
                        style={{
                          display: 'flex',
                          gap: 6,
                          flexWrap: 'wrap',
                          marginTop: 12,
                          alignItems: 'center',
                        }}
                      >
                        <span style={{ fontSize: 9, color: '#94a3b8' }} title="始终可浏览">
                          公开 教程/博客/FigCode
                        </span>
                        {(
                          [
                            ['tools', '在线工具', false],
                            ['skills', 'Skills', false],
                            ['single-cell', '单细胞云', false],
                            ['spatial', '空间组学', false],
                            ['copilot', 'Copilot', false],
                          ] as Array<[string, string, boolean]>
                        ).map(([key, label, def]) => {
                          const on = guestPerms[key] ?? def;
                          return (
                            <button
                              key={key}
                              disabled={guestPermsSaving}
                              onClick={() => toggleGuestModule(key, !on)}
                              title={`游客 · ${label}：${on ? '已开放' : '已关闭'}`}
                              style={{
                                fontSize: 10,
                                padding: '4px 10px',
                                borderRadius: 10,
                                cursor: guestPermsSaving ? 'wait' : 'pointer',
                                fontWeight: 600,
                                border: '1px solid ' + (on ? '#86efac' : '#e2e8f0'),
                                background: on ? '#dcfce7' : '#fff',
                                color: on ? '#15803d' : '#94a3b8',
                              }}
                            >
                              {label}
                            </button>
                          );
                        })}
                        {guestPermsSaving && (
                          <span style={{ fontSize: 10, color: '#64748b' }}>保存中…</span>
                        )}
                      </div>
                    )}
                  </div>

                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: 12,
                    }}
                  >
                    <div className="sc-admin-section-title" style={{ margin: 0 }}>
                      注册用户列表 ({users?.length || 0})
                    </div>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                      <span
                        style={{
                          fontSize: 11,
                          color: '#64748b',
                          background: '#f1f5f9',
                          padding: '4px 12px',
                          borderRadius: 6,
                        }}
                      >
                        🔓 开放注册 · 「功能权限」列按账号单独授权
                      </span>
                      <button
                        className="sc-btn sc-btn-primary sc-btn-sm"
                        onClick={() => {
                          const username = prompt('用户名:');
                          if (!username) return;
                          const password = prompt('密码:');
                          if (!password) return;
                          fetchWithAuth(getApiPrefix() + '/admin/users', {
                            method: 'POST',
                            body: JSON.stringify({ username, password }),
                          })
                            .then((r) => r.json())
                            .then((d) => {
                              if (d.status === 'ok') {
                                alert(`✓ 用户 ${username} 创建成功`);
                                fetchUsers();
                              } else alert(d.error);
                            })
                            .catch((e) => alert(e.message));
                        }}
                      >
                        + 新增用户
                      </button>
                      <button className="sc-btn sc-btn-sm" onClick={() => fetchUsers()} disabled={loading}>
                        刷新
                      </button>
                    </div>
                  </div>

                  {users === null && <div className="sc-empty-desc">加载中...</div>}
                  {users && users.length === 0 && <div className="sc-empty-desc">暂无用户</div>}
                  {users && users.length > 0 && (
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
                        <thead>
                          <tr
                            style={{
                              borderBottom: '2px solid #e5ebe8',
                              textAlign: 'left',
                              color: '#64748b',
                            }}
                          >
                            <th style={{ padding: '8px' }}>用户名</th>
                            <th style={{ padding: '8px' }}>角色</th>
                            <th style={{ padding: '8px' }}>配额</th>
                            <th style={{ padding: '8px' }}>已用</th>
                            <th style={{ padding: '8px' }}>项目</th>
                            <th style={{ padding: '8px' }}>数据集</th>
                            <th style={{ padding: '8px' }}>分析</th>
                            <th style={{ padding: '8px' }}>功能权限</th>
                            <th style={{ padding: '8px' }}>注册时间</th>
                            <th style={{ padding: '8px' }}>状态</th>
                          </tr>
                        </thead>
                        <tbody>
                          {users.map((u) => (
                            <tr key={u.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                              <td style={{ padding: '8px' }}>
                                <strong>{u.username}</strong>
                                {u.role === 'admin' && (
                                  <span style={{ marginLeft: 4, fontSize: 9, color: '#dc2626' }}>
                                    ★
                                  </span>
                                )}
                              </td>
                              <td style={{ padding: '8px' }}>
                                <select
                                  value={u.role}
                                  onChange={(e) => updateUserRole(u.id, e.target.value)}
                                  style={{
                                    fontSize: 10,
                                    padding: '3px 6px',
                                    border: '1px solid #e2e8f0',
                                    borderRadius: 4,
                                    background: 'white',
                                  }}
                                >
                                  <option value="user">用户</option>
                                  <option value="admin">管理员</option>
                                </select>
                              </td>
                              <td style={{ padding: '8px' }}>
                                <select
                                  value={String(u.quota_mb || 500)}
                                  onChange={(e) => updateUserQuota(u.id, parseInt(e.target.value))}
                                  style={{
                                    fontSize: 10,
                                    padding: '3px 6px',
                                    border: '1px solid #e2e8f0',
                                    borderRadius: 4,
                                    background: 'white',
                                  }}
                                >
                                  <option value="100">100 MB</option>
                                  <option value="500">500 MB</option>
                                  <option value="1024">1 GB</option>
                                  <option value="2048">2 GB</option>
                                  <option value="5120">5 GB</option>
                                  <option value="10240">10 GB</option>
                                </select>
                              </td>
                              <td style={{ padding: '8px', color: '#475569' }}>
                                {u.stats.storageHuman}
                              </td>
                              <td style={{ padding: '8px', color: '#64748b' }}>
                                {u.stats.projects}
                              </td>
                              <td style={{ padding: '8px', color: '#64748b' }}>
                                {u.stats.datasets}
                              </td>
                              <td style={{ padding: '8px', color: '#64748b' }}>
                                {u.stats.analyses}
                              </td>
                              <td style={{ padding: '8px' }}>
                                {u.role === 'admin' ? (
                                  <span style={{ fontSize: 10, color: '#94a3b8' }}>全部</span>
                                ) : (
                                  <div
                                    style={{
                                      display: 'flex',
                                      gap: 4,
                                      flexWrap: 'wrap',
                                      maxWidth: 230,
                                      alignItems: 'center',
                                    }}
                                  >
                                    <span
                                      style={{ fontSize: 9, color: '#94a3b8' }}
                                      title="教程/博客/FigCode 对所有人开放，不可单独控制"
                                    >
                                      公开✓
                                    </span>
                                    {(
                                      [
                                        ['tools', '工具', false],
                                        ['skills', 'Skills', false],
                                        ['single-cell', '单细胞', false],
                                        ['spatial', '空间', false],
                                        ['copilot', 'Copilot', true],
                                      ] as Array<[string, string, boolean]>
                                    ).map(([key, label, def]) => {
                                      const on = u.permissions ? (u.permissions[key] ?? def) : def;
                                      return (
                                        <button
                                          key={key}
                                          onClick={() =>
                                            updateUserModule(u.id, u.permissions, key, !on)
                                          }
                                          title={`${label}：${on ? '已开放（点击关闭）' : '已关闭（点击开放）'}`}
                                          style={{
                                            fontSize: 9,
                                            padding: '2px 7px',
                                            borderRadius: 10,
                                            cursor: 'pointer',
                                            fontWeight: 600,
                                            border: '1px solid ' + (on ? '#bbf7d0' : '#e2e8f0'),
                                            background: on ? '#dcfce7' : '#f8fafc',
                                            color: on ? '#16a34a' : '#94a3b8',
                                          }}
                                        >
                                          {label}
                                        </button>
                                      );
                                    })}
                                  </div>
                                )}
                              </td>
                              <td style={{ padding: '8px', color: '#9ca3af', fontSize: 10 }}>
                                {new Date(u.created_at).toLocaleDateString('zh-CN')}
                              </td>
                              <td style={{ padding: '8px' }}>
                                <button
                                  onClick={() => toggleUserEnabled(u.id, !u.enabled)}
                                  style={{
                                    fontSize: 10,
                                    padding: '3px 10px',
                                    borderRadius: 10,
                                    border: 'none',
                                    cursor: 'pointer',
                                    fontWeight: 600,
                                    background: u.enabled ? '#dcfce7' : '#fee2e2',
                                    color: u.enabled ? '#16a34a' : '#dc2626',
                                  }}
                                >
                                  {u.enabled ? '正常' : '已禁用'}
                                </button>
                                <button
                                  style={{
                                    marginLeft: 6,
                                    fontSize: 10,
                                    padding: '3px 8px',
                                    borderRadius: 4,
                                    border: '1px solid #e2e8f0',
                                    background: 'white',
                                    cursor: 'pointer',
                                    color: '#64748b',
                                  }}
                                  title="以该用户身份登录（1小时有效）"
                                  onClick={() => {
                                    if (
                                      !confirm(`模拟登录为「${u.username}」？将看到该用户的数据。`)
                                    )
                                      return;
                                    fetchWithAuth(getApiPrefix() + `/admin/impersonate/${u.id}`, {
                                      method: 'POST',
                                    })
                                      .then((r) => r.json())
                                      .then((d) => {
                                        if (d.status === 'ok') {
                                          localStorage.setItem('biof3_token', d.token);
                                          localStorage.setItem(
                                            'biof3_user',
                                            JSON.stringify(d.user)
                                          );
                                          window.location.reload();
                                        } else alert(d.error);
                                      })
                                      .catch((e) => alert(e.message));
                                  }}
                                >
                                  👤
                                </button>
                                {u.role !== 'admin' && (
                                  <button
                                    style={{
                                      marginLeft: 4,
                                      fontSize: 10,
                                      padding: '3px 8px',
                                      borderRadius: 4,
                                      border: '1px solid #fecaca',
                                      background: 'white',
                                      cursor: 'pointer',
                                      color: '#dc2626',
                                    }}
                                    title="删除该用户及其所有数据"
                                    onClick={() => {
                                      if (
                                        !confirm(
                                          `确定删除用户「${u.username}」？\n该用户的所有项目和数据将被保留（变为无主数据）。`
                                        )
                                      )
                                        return;
                                      fetchWithAuth(getApiPrefix() + `/admin/users/${u.id}`, {
                                        method: 'DELETE',
                                      })
                                        .then((r) => r.json())
                                        .then((d) => {
                                          if (d.status === 'ok') fetchUsers();
                                          else alert(d.error);
                                        })
                                        .catch((e) => alert(e.message));
                                    }}
                                  >
                                    ✕
                                  </button>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}

              {/* Report (shared between tabs) */}
              {report && (
                <>
                  <div className="sc-admin-section-title">
                    {report.dryRun ? '预览' : '已执行'} · 释放 {report.bytesFreedHuman}
                  </div>
                  <div className="sc-admin-report">
                    {(report.tempDeleted?.length || 0) === 0 &&
                      (report.cacheDeleted?.length || 0) === 0 &&
                      (report.deleted?.length || 0) === 0 && (
                        <div className="sc-empty-desc">无可清理内容</div>
                      )}
                    {report.tempDeleted?.map((t) => (
                      <div key={t.name} className="sc-admin-report-item">
                        <span
                          className="sc-admin-tag"
                          style={{ background: '#fef3c7', color: '#b45309' }}
                        >
                          TEMP
                        </span>
                        <span className="sc-admin-file-name">{t.name}</span>
                        <span className="sc-admin-file-size">{formatSize(t.sizeBytes)}</span>
                      </div>
                    ))}
                    {report.cacheDeleted?.map((c) => (
                      <div key={c.name} className="sc-admin-report-item">
                        <span
                          className="sc-admin-tag"
                          style={{ background: '#fee2e2', color: '#dc2626' }}
                        >
                          CACHE
                        </span>
                        <span className="sc-admin-file-name">{c.name}</span>
                        <span style={{ fontSize: 10, color: '#9ca3af' }}>{c.reason}</span>
                        <span className="sc-admin-file-size">{formatSize(c.sizeBytes)}</span>
                      </div>
                    ))}
                    {report.deleted?.map((d) => (
                      <div key={d.name} className="sc-admin-report-item">
                        <span
                          className="sc-admin-tag"
                          style={{ background: '#dbeafe', color: '#2563eb' }}
                        >
                          OSS
                        </span>
                        <span className="sc-admin-file-name">{d.name}</span>
                        <span className="sc-admin-file-size">{d.sizeHuman}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {/* ---------- AI Governance tab ---------- */}
              {tab === 'ai' && (
                <>
                  <div className="sc-admin-section-title">🤖 AI 治理面板</div>
                  <div
                    style={{ fontSize: 12, color: '#6b7280', marginBottom: 12, lineHeight: 1.6 }}
                  >
                    监控每个用户的 AI
                    助手使用情况、调用历史和暂停状态。出于隐私考虑，本面板不显示对话原文 —
                    如需排查具体会话，请用"模拟登录"以对方身份查看（用户可被告知）。
                  </div>

                  {/* Global pause */}
                  <div
                    style={{
                      padding: 12,
                      background: globalPaused ? '#fef2f2' : '#ecfdf5',
                      border: `1px solid ${globalPaused ? '#fca5a5' : '#a7f3d0'}`,
                      borderRadius: 8,
                      marginBottom: 14,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                    }}
                  >
                    <div style={{ flex: 1, fontSize: 13 }}>
                      <div style={{ fontWeight: 600, color: globalPaused ? '#991b1b' : '#047857' }}>
                        {globalPaused ? '⛔ 全局 Agent Mode 已暂停' : '✅ 全局 Agent Mode 正常'}
                      </div>
                      <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
                        {globalPaused
                          ? '所有用户的 act / act_generic 调用会被拦截，普通对话不受影响'
                          : '紧急情况（滥用/Bug）下可一键关停全部 AI 写操作'}
                      </div>
                    </div>
                    <button
                      className="sc-btn"
                      style={{
                        background: globalPaused ? '#10b981' : '#dc2626',
                        color: 'white',
                        borderColor: 'transparent',
                      }}
                      onClick={toggleGlobalAiPause}
                    >
                      {globalPaused ? '恢复' : '紧急暂停'}
                    </button>
                  </div>

                  {/* Per-user table */}
                  <div className="sc-admin-section-title" style={{ fontSize: 13 }}>
                    用户用量与状态
                  </div>
                  {!aiUsers && <div className="sc-empty-desc">加载中...</div>}
                  {aiUsers && aiUsers.length === 0 && <div className="sc-empty-desc">没有用户</div>}
                  {aiUsers && aiUsers.length > 0 && (
                    <div
                      style={{
                        overflow: 'auto',
                        maxHeight: 380,
                        border: '1px solid #e5e7eb',
                        borderRadius: 8,
                      }}
                    >
                      <table style={{ width: '100%', fontSize: 11.5, borderCollapse: 'collapse' }}>
                        <thead style={{ position: 'sticky', top: 0, background: '#f9fafb' }}>
                          <tr style={{ textAlign: 'left' }}>
                            <th style={{ padding: '8px 10px', borderBottom: '1px solid #e5e7eb' }}>
                              用户
                            </th>
                            <th
                              style={{
                                padding: '8px 6px',
                                borderBottom: '1px solid #e5e7eb',
                                textAlign: 'right',
                              }}
                            >
                              会话
                            </th>
                            <th
                              style={{
                                padding: '8px 6px',
                                borderBottom: '1px solid #e5e7eb',
                                textAlign: 'right',
                              }}
                            >
                              消息
                            </th>
                            <th
                              style={{
                                padding: '8px 6px',
                                borderBottom: '1px solid #e5e7eb',
                                textAlign: 'right',
                              }}
                            >
                              事实
                            </th>
                            <th
                              style={{
                                padding: '8px 6px',
                                borderBottom: '1px solid #e5e7eb',
                                textAlign: 'right',
                              }}
                            >
                              向量
                            </th>
                            <th
                              style={{
                                padding: '8px 6px',
                                borderBottom: '1px solid #e5e7eb',
                                textAlign: 'right',
                              }}
                            >
                              计划
                            </th>
                            <th
                              style={{
                                padding: '8px 6px',
                                borderBottom: '1px solid #e5e7eb',
                                textAlign: 'right',
                              }}
                            >
                              act
                            </th>
                            <th
                              style={{
                                padding: '8px 6px',
                                borderBottom: '1px solid #e5e7eb',
                                textAlign: 'right',
                              }}
                            >
                              撤销
                            </th>
                            <th style={{ padding: '8px 8px', borderBottom: '1px solid #e5e7eb' }}>
                              最近活跃
                            </th>
                            <th style={{ padding: '8px 6px', borderBottom: '1px solid #e5e7eb' }}>
                              状态
                            </th>
                            <th style={{ padding: '8px 6px', borderBottom: '1px solid #e5e7eb' }}>
                              操作
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {aiUsers.map((u) => (
                            <tr key={u.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                              <td style={{ padding: '6px 10px', fontWeight: 600 }}>
                                {u.username}
                                {u.role === 'admin' && (
                                  <span
                                    style={{
                                      marginLeft: 6,
                                      fontSize: 9,
                                      padding: '1px 5px',
                                      background: '#fef3c7',
                                      color: '#92400e',
                                      borderRadius: 4,
                                    }}
                                  >
                                    admin
                                  </span>
                                )}
                              </td>
                              <td style={{ padding: '6px', textAlign: 'right' }}>{u.conv_count}</td>
                              <td style={{ padding: '6px', textAlign: 'right' }}>{u.msg_count}</td>
                              <td style={{ padding: '6px', textAlign: 'right' }}>{u.fact_count}</td>
                              <td style={{ padding: '6px', textAlign: 'right' }}>{u.vec_count}</td>
                              <td style={{ padding: '6px', textAlign: 'right' }}>
                                {u.active_plans}/{u.plan_count}
                              </td>
                              <td style={{ padding: '6px', textAlign: 'right' }}>{u.act_count}</td>
                              <td
                                style={{
                                  padding: '6px',
                                  textAlign: 'right',
                                  color: u.undone_n > 0 ? '#dc2626' : '#9ca3af',
                                }}
                              >
                                {u.undone_n}
                              </td>
                              <td
                                style={{
                                  padding: '6px 8px',
                                  color: '#6b7280',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {u.last_act_at
                                  ? new Date(u.last_act_at).toLocaleString('zh-CN', {
                                      month: 'numeric',
                                      day: 'numeric',
                                      hour: '2-digit',
                                      minute: '2-digit',
                                      hour12: false,
                                    })
                                  : '—'}
                              </td>
                              <td style={{ padding: '6px' }}>
                                {u.agent_paused ? (
                                  <span
                                    style={{
                                      padding: '2px 6px',
                                      background: '#fee2e2',
                                      color: '#991b1b',
                                      borderRadius: 4,
                                      fontSize: 10,
                                    }}
                                  >
                                    已暂停
                                  </span>
                                ) : (
                                  <span
                                    style={{
                                      padding: '2px 6px',
                                      background: '#d1fae5',
                                      color: '#065f46',
                                      borderRadius: 4,
                                      fontSize: 10,
                                    }}
                                  >
                                    正常
                                  </span>
                                )}
                              </td>
                              <td style={{ padding: '6px' }}>
                                <div style={{ display: 'flex', gap: 4 }}>
                                  <button
                                    className="sc-btn"
                                    style={{ padding: '2px 8px', fontSize: 10 }}
                                    onClick={() => toggleUserAiPause(u.id, !u.agent_paused)}
                                    title={u.agent_paused ? '恢复' : '暂停 AI 写操作'}
                                  >
                                    {u.agent_paused ? '恢复' : '暂停'}
                                  </button>
                                  <button
                                    className="sc-btn"
                                    style={{ padding: '2px 8px', fontSize: 10 }}
                                    onClick={() => {
                                      setAiAuditUserFilter(u.id);
                                      fetchAiAudit(u.id);
                                    }}
                                    title="查看该用户的 act 审计日志"
                                  >
                                    日志
                                  </button>
                                  <button
                                    className="sc-btn"
                                    style={{ padding: '2px 8px', fontSize: 10 }}
                                    onClick={() => impersonate(u.id, u.username)}
                                    title="以该用户身份登录（看到他们的会话/记忆）"
                                  >
                                    模拟
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* Audit log */}
                  <div className="sc-admin-section-title" style={{ fontSize: 13, marginTop: 16 }}>
                    审计日志
                    {aiAuditUserFilter && (
                      <span
                        style={{ marginLeft: 8, fontSize: 11, fontWeight: 400, color: '#6b7280' }}
                      >
                        (用户:{' '}
                        {aiUsers?.find((u) => u.id === aiAuditUserFilter)?.username ||
                          aiAuditUserFilter}
                        )
                        <button
                          style={{
                            marginLeft: 6,
                            fontSize: 11,
                            color: '#10b981',
                            background: 'transparent',
                            border: 'none',
                            cursor: 'pointer',
                            textDecoration: 'underline',
                          }}
                          onClick={() => {
                            setAiAuditUserFilter('');
                            fetchAiAudit();
                          }}
                        >
                          显示全部
                        </button>
                      </span>
                    )}
                    {!aiAuditUserFilter && (
                      <button
                        style={{
                          marginLeft: 8,
                          fontSize: 11,
                          color: '#10b981',
                          background: 'transparent',
                          border: 'none',
                          cursor: 'pointer',
                          textDecoration: 'underline',
                        }}
                        onClick={() => fetchAiAudit()}
                      >
                        加载全部
                      </button>
                    )}
                  </div>
                  {aiAudit && aiAudit.length === 0 && (
                    <div className="sc-empty-desc">还没有 act 调用</div>
                  )}
                  {aiAudit && aiAudit.length > 0 && (
                    <div
                      style={{
                        overflow: 'auto',
                        maxHeight: 280,
                        border: '1px solid #e5e7eb',
                        borderRadius: 8,
                      }}
                    >
                      <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
                        <thead style={{ position: 'sticky', top: 0, background: '#f9fafb' }}>
                          <tr style={{ textAlign: 'left' }}>
                            <th style={{ padding: '6px 10px', borderBottom: '1px solid #e5e7eb' }}>
                              时间
                            </th>
                            <th style={{ padding: '6px 6px', borderBottom: '1px solid #e5e7eb' }}>
                              用户
                            </th>
                            <th style={{ padding: '6px 6px', borderBottom: '1px solid #e5e7eb' }}>
                              操作
                            </th>
                            <th style={{ padding: '6px 6px', borderBottom: '1px solid #e5e7eb' }}>
                              参数摘要
                            </th>
                            <th style={{ padding: '6px 6px', borderBottom: '1px solid #e5e7eb' }}>
                              已撤销
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {aiAudit.map((a) => (
                            <tr key={a.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                              <td
                                style={{
                                  padding: '4px 10px',
                                  whiteSpace: 'nowrap',
                                  color: '#6b7280',
                                }}
                              >
                                {new Date(a.ts).toLocaleString('zh-CN', {
                                  month: 'numeric',
                                  day: 'numeric',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                  second: '2-digit',
                                  hour12: false,
                                })}
                              </td>
                              <td style={{ padding: '4px 6px' }}>
                                {aiUsers?.find((u) => u.id === a.user_id)?.username ||
                                  a.user_id.slice(0, 8)}
                              </td>
                              <td
                                style={{
                                  padding: '4px 6px',
                                  fontFamily: 'monospace',
                                  color: '#4338ca',
                                }}
                              >
                                {a.action}
                              </td>
                              <td
                                style={{
                                  padding: '4px 6px',
                                  fontFamily: 'monospace',
                                  fontSize: 10,
                                  color: '#6b7280',
                                  maxWidth: 260,
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap',
                                }}
                              >
                                {a.argsSummary}
                              </td>
                              <td style={{ padding: '4px 6px' }}>
                                {a.undone ? (
                                  <span style={{ color: '#dc2626' }}>
                                    ✓{' '}
                                    {a.undone_at
                                      ? new Date(a.undone_at).toLocaleTimeString('zh-CN', {
                                          hour12: false,
                                        })
                                      : ''}
                                  </span>
                                ) : (
                                  '—'
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}

              {/* ---------- AI Usage Dashboard tab ---------- */}
              {tab === 'usage' && (
                <>
                  <div className="sc-admin-section-title">📊 AI 用量看板</div>
                  <div
                    style={{ fontSize: 12, color: '#6b7280', marginBottom: 12, lineHeight: 1.6 }}
                  >
                    每次 LLM / Embedding 调用的 token
                    消耗、延迟、错误，按当前定价估算实际人民币成本。这是数据驱动决策的依据。
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 14 }}>
                    <span style={{ fontSize: 12, color: '#6b7280' }}>时间范围：</span>
                    {[7, 30, 90].map((d) => (
                      <button
                        key={d}
                        className="sc-btn"
                        style={{
                          padding: '4px 12px',
                          fontSize: 12,
                          background: usageDays === d ? '#10b981' : 'transparent',
                          color: usageDays === d ? 'white' : 'inherit',
                          borderColor: usageDays === d ? '#10b981' : undefined,
                        }}
                        onClick={() => {
                          setUsageDays(d);
                          fetchUsageStats(d);
                        }}
                      >
                        {d} 天
                      </button>
                    ))}
                    <span style={{ flex: 1 }} />
                    <button
                      className="sc-btn"
                      style={{ padding: '4px 12px', fontSize: 12 }}
                      onClick={() => fetchUsageStats(usageDays)}
                    >
                      刷新
                    </button>
                  </div>

                  {!usageStats && <div className="sc-empty-desc">加载中...</div>}
                  {usageStats &&
                    (() => {
                      // Roll up totals
                      const totalCost = usageStats.daily.reduce(
                        (s, r) => s + (r.estimated_cost_cny || 0),
                        0
                      );
                      const totalCalls = usageStats.daily.reduce((s, r) => s + r.calls, 0);
                      const totalErrors = usageStats.daily.reduce((s, r) => s + r.errors, 0);
                      const totalTokens = usageStats.daily.reduce(
                        (s, r) => s + r.prompt_tokens + r.completion_tokens,
                        0
                      );
                      const errorRate = totalCalls > 0 ? (totalErrors / totalCalls) * 100 : 0;
                      return (
                        <>
                          {/* KPI cards */}
                          <div
                            style={{
                              display: 'grid',
                              gridTemplateColumns: 'repeat(4, 1fr)',
                              gap: 10,
                              marginBottom: 16,
                            }}
                          >
                            <div
                              style={{
                                padding: 12,
                                background: '#ecfdf5',
                                border: '1px solid #a7f3d0',
                                borderRadius: 8,
                              }}
                            >
                              <div style={{ fontSize: 11, color: '#065f46', fontWeight: 600 }}>
                                总成本
                              </div>
                              <div
                                style={{
                                  fontSize: 22,
                                  fontWeight: 700,
                                  color: '#047857',
                                  marginTop: 4,
                                }}
                              >
                                ¥{totalCost.toFixed(3)}
                              </div>
                              <div style={{ fontSize: 10, color: '#6b7280', marginTop: 2 }}>
                                {usageDays} 天累计
                              </div>
                            </div>
                            <div
                              style={{
                                padding: 12,
                                background: '#eff6ff',
                                border: '1px solid #bfdbfe',
                                borderRadius: 8,
                              }}
                            >
                              <div style={{ fontSize: 11, color: '#1e40af', fontWeight: 600 }}>
                                调用次数
                              </div>
                              <div
                                style={{
                                  fontSize: 22,
                                  fontWeight: 700,
                                  color: '#1e40af',
                                  marginTop: 4,
                                }}
                              >
                                {totalCalls}
                              </div>
                              <div style={{ fontSize: 10, color: '#6b7280', marginTop: 2 }}>
                                每天约 {Math.round(totalCalls / usageDays)} 次
                              </div>
                            </div>
                            <div
                              style={{
                                padding: 12,
                                background: '#fef3c7',
                                border: '1px solid #fde68a',
                                borderRadius: 8,
                              }}
                            >
                              <div style={{ fontSize: 11, color: '#92400e', fontWeight: 600 }}>
                                Tokens
                              </div>
                              <div
                                style={{
                                  fontSize: 22,
                                  fontWeight: 700,
                                  color: '#92400e',
                                  marginTop: 4,
                                }}
                              >
                                {(totalTokens / 1000).toFixed(1)}K
                              </div>
                              <div style={{ fontSize: 10, color: '#6b7280', marginTop: 2 }}>
                                累计输入+输出
                              </div>
                            </div>
                            <div
                              style={{
                                padding: 12,
                                background: errorRate > 5 ? '#fef2f2' : '#f9fafb',
                                border: '1px solid ' + (errorRate > 5 ? '#fca5a5' : '#e5e7eb'),
                                borderRadius: 8,
                              }}
                            >
                              <div
                                style={{
                                  fontSize: 11,
                                  color: errorRate > 5 ? '#991b1b' : '#6b7280',
                                  fontWeight: 600,
                                }}
                              >
                                错误率
                              </div>
                              <div
                                style={{
                                  fontSize: 22,
                                  fontWeight: 700,
                                  color: errorRate > 5 ? '#991b1b' : '#1f2937',
                                  marginTop: 4,
                                }}
                              >
                                {errorRate.toFixed(1)}%
                              </div>
                              <div style={{ fontSize: 10, color: '#6b7280', marginTop: 2 }}>
                                {totalErrors} / {totalCalls} 次
                              </div>
                            </div>
                          </div>

                          {/* Daily breakdown table */}
                          <div
                            className="sc-admin-section-title"
                            style={{ fontSize: 13, marginTop: 12 }}
                          >
                            每日用量
                          </div>
                          <div
                            style={{
                              overflow: 'auto',
                              maxHeight: 240,
                              border: '1px solid #e5e7eb',
                              borderRadius: 8,
                            }}
                          >
                            <table
                              style={{ width: '100%', fontSize: 11.5, borderCollapse: 'collapse' }}
                            >
                              <thead style={{ position: 'sticky', top: 0, background: '#f9fafb' }}>
                                <tr style={{ textAlign: 'left' }}>
                                  <th
                                    style={{
                                      padding: '6px 10px',
                                      borderBottom: '1px solid #e5e7eb',
                                    }}
                                  >
                                    日期
                                  </th>
                                  <th
                                    style={{
                                      padding: '6px 8px',
                                      borderBottom: '1px solid #e5e7eb',
                                    }}
                                  >
                                    类型
                                  </th>
                                  <th
                                    style={{
                                      padding: '6px 6px',
                                      borderBottom: '1px solid #e5e7eb',
                                      textAlign: 'right',
                                    }}
                                  >
                                    调用
                                  </th>
                                  <th
                                    style={{
                                      padding: '6px 6px',
                                      borderBottom: '1px solid #e5e7eb',
                                      textAlign: 'right',
                                    }}
                                  >
                                    输入 token
                                  </th>
                                  <th
                                    style={{
                                      padding: '6px 6px',
                                      borderBottom: '1px solid #e5e7eb',
                                      textAlign: 'right',
                                    }}
                                  >
                                    输出 token
                                  </th>
                                  <th
                                    style={{
                                      padding: '6px 6px',
                                      borderBottom: '1px solid #e5e7eb',
                                      textAlign: 'right',
                                    }}
                                  >
                                    平均延迟
                                  </th>
                                  <th
                                    style={{
                                      padding: '6px 6px',
                                      borderBottom: '1px solid #e5e7eb',
                                      textAlign: 'right',
                                    }}
                                  >
                                    错误
                                  </th>
                                  <th
                                    style={{
                                      padding: '6px 8px',
                                      borderBottom: '1px solid #e5e7eb',
                                      textAlign: 'right',
                                    }}
                                  >
                                    成本
                                  </th>
                                </tr>
                              </thead>
                              <tbody>
                                {usageStats.daily.map((r, i) => (
                                  <tr key={i} style={{ borderBottom: '1px solid #f3f4f6' }}>
                                    <td style={{ padding: '4px 10px', fontFamily: 'monospace' }}>
                                      {r.day}
                                    </td>
                                    <td style={{ padding: '4px 8px' }}>
                                      <span
                                        style={{
                                          padding: '1px 6px',
                                          background:
                                            r.kind === 'embedding' ? '#dbeafe' : '#dcfce7',
                                          color: r.kind === 'embedding' ? '#1e40af' : '#166534',
                                          borderRadius: 4,
                                          fontSize: 10,
                                        }}
                                      >
                                        {r.kind}
                                      </span>
                                    </td>
                                    <td style={{ padding: '4px 6px', textAlign: 'right' }}>
                                      {r.calls}
                                    </td>
                                    <td style={{ padding: '4px 6px', textAlign: 'right' }}>
                                      {r.prompt_tokens.toLocaleString()}
                                    </td>
                                    <td style={{ padding: '4px 6px', textAlign: 'right' }}>
                                      {r.completion_tokens.toLocaleString()}
                                    </td>
                                    <td
                                      style={{
                                        padding: '4px 6px',
                                        textAlign: 'right',
                                        color: '#6b7280',
                                      }}
                                    >
                                      {Math.round(r.avg_latency)}ms
                                    </td>
                                    <td
                                      style={{
                                        padding: '4px 6px',
                                        textAlign: 'right',
                                        color: r.errors > 0 ? '#dc2626' : '#9ca3af',
                                      }}
                                    >
                                      {r.errors}
                                    </td>
                                    <td
                                      style={{
                                        padding: '4px 8px',
                                        textAlign: 'right',
                                        fontWeight: 600,
                                        color: '#047857',
                                      }}
                                    >
                                      ¥{r.estimated_cost_cny.toFixed(4)}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>

                          {/* Per-user breakdown */}
                          <div
                            className="sc-admin-section-title"
                            style={{ fontSize: 13, marginTop: 16 }}
                          >
                            用户用量排名
                          </div>
                          <div
                            style={{
                              overflow: 'auto',
                              maxHeight: 200,
                              border: '1px solid #e5e7eb',
                              borderRadius: 8,
                            }}
                          >
                            <table
                              style={{ width: '100%', fontSize: 11.5, borderCollapse: 'collapse' }}
                            >
                              <thead style={{ position: 'sticky', top: 0, background: '#f9fafb' }}>
                                <tr style={{ textAlign: 'left' }}>
                                  <th
                                    style={{
                                      padding: '6px 10px',
                                      borderBottom: '1px solid #e5e7eb',
                                    }}
                                  >
                                    用户
                                  </th>
                                  <th
                                    style={{
                                      padding: '6px 6px',
                                      borderBottom: '1px solid #e5e7eb',
                                      textAlign: 'right',
                                    }}
                                  >
                                    调用
                                  </th>
                                  <th
                                    style={{
                                      padding: '6px 6px',
                                      borderBottom: '1px solid #e5e7eb',
                                      textAlign: 'right',
                                    }}
                                  >
                                    tokens
                                  </th>
                                  <th
                                    style={{
                                      padding: '6px 6px',
                                      borderBottom: '1px solid #e5e7eb',
                                      textAlign: 'right',
                                    }}
                                  >
                                    平均延迟
                                  </th>
                                  <th
                                    style={{
                                      padding: '6px 6px',
                                      borderBottom: '1px solid #e5e7eb',
                                      textAlign: 'right',
                                    }}
                                  >
                                    错误
                                  </th>
                                  <th
                                    style={{
                                      padding: '6px 8px',
                                      borderBottom: '1px solid #e5e7eb',
                                      textAlign: 'right',
                                    }}
                                  >
                                    成本
                                  </th>
                                </tr>
                              </thead>
                              <tbody>
                                {usageStats.perUser.map((r) => (
                                  <tr key={r.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                                    <td style={{ padding: '4px 10px', fontWeight: 600 }}>
                                      {r.username || r.id}
                                    </td>
                                    <td style={{ padding: '4px 6px', textAlign: 'right' }}>
                                      {r.calls}
                                    </td>
                                    <td style={{ padding: '4px 6px', textAlign: 'right' }}>
                                      {(r.prompt_tokens + r.completion_tokens).toLocaleString()}
                                    </td>
                                    <td
                                      style={{
                                        padding: '4px 6px',
                                        textAlign: 'right',
                                        color: '#6b7280',
                                      }}
                                    >
                                      {Math.round(r.avg_latency)}ms
                                    </td>
                                    <td
                                      style={{
                                        padding: '4px 6px',
                                        textAlign: 'right',
                                        color: r.errors > 0 ? '#dc2626' : '#9ca3af',
                                      }}
                                    >
                                      {r.errors}
                                    </td>
                                    <td
                                      style={{
                                        padding: '4px 8px',
                                        textAlign: 'right',
                                        fontWeight: 600,
                                        color: '#047857',
                                      }}
                                    >
                                      ¥{r.estimated_cost_cny.toFixed(4)}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>

                          {/* Top acts */}
                          <div
                            className="sc-admin-section-title"
                            style={{ fontSize: 13, marginTop: 16 }}
                          >
                            热门操作 Top 10
                          </div>
                          {usageStats.topActs.length === 0 && (
                            <div className="sc-empty-desc">还没有 act 调用</div>
                          )}
                          {usageStats.topActs.length > 0 && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                              {usageStats.topActs.slice(0, 10).map((a, i) => {
                                const undoneRate = a.n > 0 ? (a.undone / a.n) * 100 : 0;
                                const maxN = usageStats.topActs[0].n;
                                const widthPct = (a.n / maxN) * 100;
                                return (
                                  <div
                                    key={a.action}
                                    style={{
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: 8,
                                      fontSize: 11,
                                    }}
                                  >
                                    <span
                                      style={{
                                        width: 24,
                                        color: '#9ca3af',
                                        fontVariantNumeric: 'tabular-nums',
                                      }}
                                    >
                                      #{i + 1}
                                    </span>
                                    <span
                                      style={{
                                        minWidth: 200,
                                        fontFamily: 'monospace',
                                        color: '#4338ca',
                                      }}
                                    >
                                      {a.action}
                                    </span>
                                    <div
                                      style={{
                                        flex: 1,
                                        height: 16,
                                        background: '#f3f4f6',
                                        borderRadius: 3,
                                        position: 'relative',
                                        overflow: 'hidden',
                                      }}
                                    >
                                      <div
                                        style={{
                                          position: 'absolute',
                                          left: 0,
                                          top: 0,
                                          bottom: 0,
                                          width: widthPct + '%',
                                          background: 'linear-gradient(90deg, #10b981, #34d399)',
                                          transition: 'width 0.3s',
                                        }}
                                      />
                                    </div>
                                    <span
                                      style={{ width: 50, textAlign: 'right', fontWeight: 600 }}
                                    >
                                      {a.n}
                                    </span>
                                    {a.undone > 0 && (
                                      <span
                                        style={{
                                          width: 70,
                                          textAlign: 'right',
                                          color: '#dc2626',
                                          fontSize: 10,
                                        }}
                                      >
                                        ↶ {a.undone} ({undoneRate.toFixed(0)}%)
                                      </span>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}

                          {/* Errors breakdown */}
                          {usageStats.errors.length > 0 && (
                            <>
                              <div
                                className="sc-admin-section-title"
                                style={{ fontSize: 13, marginTop: 16, color: '#991b1b' }}
                              >
                                错误分布
                              </div>
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                {usageStats.errors.map((e) => (
                                  <div
                                    key={e.error_code}
                                    style={{
                                      padding: '4px 10px',
                                      background: '#fef2f2',
                                      border: '1px solid #fca5a5',
                                      borderRadius: 6,
                                      fontSize: 11,
                                    }}
                                  >
                                    <span style={{ fontFamily: 'monospace', color: '#991b1b' }}>
                                      {e.error_code}
                                    </span>
                                    <span style={{ color: '#6b7280', marginLeft: 6 }}>×{e.n}</span>
                                  </div>
                                ))}
                              </div>
                            </>
                          )}

                          {/* Pricing reference */}
                          <div
                            style={{
                              marginTop: 16,
                              padding: 10,
                              background: '#f9fafb',
                              borderRadius: 6,
                              fontSize: 11,
                              color: '#6b7280',
                            }}
                          >
                            <strong>定价参考（CNY/M tokens）：</strong>
                            {' DeepSeek-chat 输入 ¥0.5 / 输出 ¥8 / 缓存 ¥0.1；'}
                            {' DashScope text-embedding-v3 输入 ¥0.7'}
                          </div>
                        </>
                      );
                    })()}
                </>
              )}
            </div>

            <div className="sc-modal-footer">
              <button className="sc-btn" onClick={refreshCurrentTab} disabled={loading}>
                刷新
              </button>
              {tab === 'local' && (
                <>
                  <button
                    className="sc-btn"
                    onClick={() => runLocalCleanup(true)}
                    disabled={loading}
                  >
                    预览本地
                  </button>
                  <button
                    className="sc-btn sc-btn-primary"
                    onClick={() => runLocalCleanup(false)}
                    disabled={loading}
                  >
                    清理本地
                  </button>
                </>
              )}
              {tab === 'oss' && (
                <>
                  <button className="sc-btn" onClick={() => runOssCleanup(true)} disabled={loading}>
                    预览 OSS
                  </button>
                  <button
                    className="sc-btn sc-btn-primary"
                    onClick={() => runOssCleanup(false)}
                    disabled={loading}
                  >
                    清理 OSS
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
