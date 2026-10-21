/**
 * useMcpServers — MCP 服务货架状态 hook（BLOCK-156 P2）。
 *
 * 数据面走后端 HTTP（/api/mcp/servers*）：MCP 连接住在 petri-server 进程
 * （与 agent 工具执行同进程，P3 投影前提），不走 desktopBridge IPC。
 * 后端缺位（老栈/未起）=空清单 + 一次性 error，不阻塞货架渲染。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { getApiPrefix } from '@/lib/env';

export type McpServerStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

/**
 * 后端 getStatuses() 行形状（配置 ∪ 运行态）。
 *
 * BLOCK-221（Q8）— env **值不再下发**（第三方 token），只留键名与数量；
 * `policy` 是服务级治理摘要（信任位 / 允许 / 阻断 / 生效投影数）。
 */
export interface McpServerRow {
  id: string;
  command: string;
  args: string[];
  envKeys: string[];
  envCount: number;
  autoConnect: boolean;
  status: McpServerStatus;
  error: string | null;
  toolCount: number;
  connectedAt: number | null;
  policy?: {
    trust: 'ask' | 'allow';
    allowCount: number;
    blockCount: number;
    allow: string[];
    block: string[];
    projectedToolCount: number;
  };
}

export interface McpServerDraft {
  id: string;
  command: string;
  args: string[];
  env?: Record<string, string>;
}

/** UI-547 — 服务级策略写面（信任位本轮只读，不随 patch 下发）。 */
export interface McpPolicyPatch {
  allow?: string[];
  block?: string[];
}

export interface McpPolicyDiagnostic {
  code: string;
  value?: string;
  limit?: number;
  got?: number;
}

export interface McpUpdatePolicyResult {
  ok: boolean;
  diagnostics: McpPolicyDiagnostic[];
  error?: string;
}

function normalizeDiagnostics(value: unknown): McpPolicyDiagnostic[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .filter((item) => typeof item.code === 'string')
    .map((item) => ({
      code: String(item.code),
      ...(typeof item.value === 'string' ? { value: item.value } : {}),
      ...(typeof item.limit === 'number' ? { limit: item.limit } : {}),
      ...(typeof item.got === 'number' ? { got: item.got } : {}),
    }));
}

class McpApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly diagnostics: McpPolicyDiagnostic[];

  constructor(status: number, data: Record<string, unknown>) {
    const diagnostics = normalizeDiagnostics(data.diagnostics);
    const code = typeof data.error === 'string' && data.error ? data.error : `http_${status}`;
    const detail = diagnostics
      .map((item) => `${item.code}${item.value ? `（${item.value}）` : ''}`)
      .join('；');
    super(detail || errText(data.error, `HTTP ${status}`));
    this.name = 'McpApiError';
    this.status = status;
    this.code = code;
    this.diagnostics = diagnostics;
  }
}

/** 任意错误面转可读文本（避免 unknown 直接 String 化成 [object Object]）。 */
function errText(value: unknown, fallback: string): string {
  if (typeof value === 'string' && value.length > 0) return value;
  if (value instanceof Error) return value.message;
  try {
    const serialized = JSON.stringify(value);
    if (serialized && serialized !== '{}') return serialized;
  } catch { /* 不可序列化走 fallback */ }
  return fallback;
}

async function apiJson(path: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const resp = await fetch(`${getApiPrefix()}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  let data: Record<string, unknown> = {};
  try {
    data = (await resp.json()) as Record<string, unknown>;
  } catch {
    data = {};
  }
  if (!resp.ok) {
    throw new McpApiError(resp.status, data);
  }
  return data;
}

export function useMcpServers(): {
  servers: McpServerRow[];
  loading: boolean;
  error: string | null;
  notice: string | null;
  busyId: string | null;
  refresh: () => Promise<void>;
  addServer: (draft: McpServerDraft) => Promise<boolean>;
  removeServer: (id: string) => Promise<boolean>;
  connect: (id: string) => Promise<void>;
  disconnect: (id: string) => Promise<void>;
  updatePolicy: (id: string, patch: McpPolicyPatch) => Promise<McpUpdatePolicyResult>;
} {
  const [servers, setServers] = useState<McpServerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    try {
      const data = await apiJson('/mcp/servers');
      if (alive.current) {
        setServers((data.servers as McpServerRow[]) ?? []);
        setError(null);
      }
    } catch (e) {
      if (alive.current) setError(errText(e instanceof Error ? e.message : e, '加载失败'));
    } finally {
      if (alive.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    // 挂载加载延一拍（set-state-in-effect 语义：effect 同步面零 setState）
    const t = setTimeout(() => void refresh(), 0);
    return () => clearTimeout(t);
  }, [refresh]);

  // 连接中的 server 轮询状态（连接是异步过程，最长 20s；2s 步进）
  useEffect(() => {
    const anyConnecting = servers.some((s) => s.status === 'connecting');
    if (!anyConnecting) return;
    const timer = setInterval(() => void refresh(), 2_000);
    return () => clearInterval(timer);
  }, [servers, refresh]);

  const addServer = useCallback(
    async (draft: McpServerDraft) => {
      try {
        await apiJson('/mcp/servers', {
          method: 'POST',
          body: JSON.stringify({ ...draft, autoConnect: false }),
        });
        setNotice(`已添加 ${draft.id}`);
        await refresh();
        return true;
      } catch (e) {
        setNotice(errText(e instanceof Error ? e.message : e, '操作失败'));
        return false;
      }
    },
    [refresh],
  );

  const removeServer = useCallback(
    async (id: string) => {
      setBusyId(id);
      try {
        await apiJson(`/mcp/servers/${encodeURIComponent(id)}`, { method: 'DELETE' });
        setNotice(`已移除 ${id}`);
        await refresh();
        return true;
      } catch (e) {
        setNotice(errText(e instanceof Error ? e.message : e, '操作失败'));
        return false;
      } finally {
        setBusyId(null);
      }
    },
    [refresh],
  );

  const connect = useCallback(
    async (id: string) => {
      setBusyId(id);
      setNotice(null);
      try {
        const data = await apiJson(`/mcp/servers/${encodeURIComponent(id)}/connect`, { method: 'POST' });
        setNotice(`已连接 ${id}（${Number(data.toolCount ?? 0)} 个工具）`);
      } catch (e) {
        setNotice(`连接失败：${errText(e instanceof Error ? e.message : e, '未知错误')}`);
      } finally {
        setBusyId(null);
        await refresh();
      }
    },
    [refresh],
  );

  const disconnect = useCallback(
    async (id: string) => {
      setBusyId(id);
      try {
        await apiJson(`/mcp/servers/${encodeURIComponent(id)}/disconnect`, { method: 'POST' });
        setNotice(`已断开 ${id}`);
      } catch (e) {
        setNotice(errText(e instanceof Error ? e.message : e, '操作失败'));
      } finally {
        setBusyId(null);
        await refresh();
      }
    },
    [refresh],
  );

  const updatePolicy = useCallback(
    async (id: string, patch: McpPolicyPatch): Promise<McpUpdatePolicyResult> => {
      try {
        const data = await apiJson(`/mcp/servers/${encodeURIComponent(id)}/policy`, {
          method: 'PUT',
          body: JSON.stringify(patch),
        });
        const diagnostics = normalizeDiagnostics(data.diagnostics);
        setNotice(diagnostics.length > 0
          ? `已保存 ${id} 工具治理（${diagnostics.length} 条提示）`
          : `已保存 ${id} 工具治理`);
        await refresh();
        return { ok: true, diagnostics };
      } catch (e) {
        const diagnostics = e instanceof McpApiError ? e.diagnostics : [];
        const message = errText(e instanceof Error ? e.message : e, '保存失败');
        setNotice(`保存失败：${message}`);
        return { ok: false, diagnostics, error: message };
      }
    },
    [refresh],
  );

  return {
    servers,
    loading,
    error,
    notice,
    busyId,
    refresh,
    addServer,
    removeServer,
    connect,
    disconnect,
    updatePolicy,
  };
}
