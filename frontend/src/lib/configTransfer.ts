/**
 * configTransfer — 设置全景导出/导入/按区重置的客户端（BLOCK-201 W2）。
 *
 * 与设置页其他写面同一出口形状（`getPlatformApiPrefix` + Bearer）：拒绝=400 + diagnostics，
 * 客户端不猜语义、不本地裁剪——校验的真相在后端 `config-transfer` helper。
 * 凭据不在此文件任何类型里出现（D-2）。
 */

import { getPlatformApiPrefix, getToken } from '@/lib/authClient';

export interface ConfigEnvelope {
  format: 'petri-config';
  version: 1;
  exportedAt?: string;
  families: Record<string, unknown>;
  excludes?: Array<{ what: string; reason: string }>;
  envShadowed?: Array<{ family: string; path: string; envKey: string; overrides: boolean }>;
  note?: string;
}

export interface ConfigDiagnostic {
  family?: string;
  path?: string;
  code?: string;
  message?: string;
}

export interface ConfigMutationResult {
  ok: boolean;
  applied: string[];
  diagnostics: ConfigDiagnostic[];
}

function authHeader(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function networkFailure(error: unknown): ConfigDiagnostic {
  return { code: 'network-error', message: error instanceof Error ? error.message : String(error) };
}

export async function exportConfigEnvelope(): Promise<ConfigEnvelope> {
  const response = await fetch(`${getPlatformApiPrefix()}/config/export`, { headers: authHeader() });
  const data = (await response.json().catch(() => ({}))) as { status?: string; config?: ConfigEnvelope; error?: string };
  if (!response.ok || data.status !== 'ok' || !data.config) {
    throw new Error(data.error || `导出失败（HTTP ${response.status}）`);
  }
  return data.config;
}

export async function importConfigEnvelope(envelope: ConfigEnvelope): Promise<ConfigMutationResult> {
  try {
    const response = await fetch(`${getPlatformApiPrefix()}/config/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify(envelope),
    });
    const data = (await response.json().catch(() => ({}))) as {
      status?: string;
      applied?: string[];
      diagnostics?: ConfigDiagnostic[];
      error?: string;
    };
    if (!response.ok || data.status !== 'ok') {
      return { ok: false, applied: data.applied || [], diagnostics: data.diagnostics || [{ message: data.error || `HTTP ${response.status}` }] };
    }
    return { ok: true, applied: data.applied || [], diagnostics: data.diagnostics || [] };
  } catch (error) {
    return { ok: false, applied: [], diagnostics: [networkFailure(error)] };
  }
}

export async function resetConfigFamilies(families: string[]): Promise<ConfigMutationResult> {
  try {
    const response = await fetch(`${getPlatformApiPrefix()}/config/reset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({ families }),
    });
    const data = (await response.json().catch(() => ({}))) as {
      status?: string;
      reset?: string[];
      diagnostics?: ConfigDiagnostic[];
      error?: string;
    };
    if (!response.ok || data.status !== 'ok') {
      return { ok: false, applied: [], diagnostics: data.diagnostics || [{ message: data.error || `HTTP ${response.status}` }] };
    }
    return { ok: true, applied: data.reset || [], diagnostics: [] };
  } catch (error) {
    return { ok: false, applied: [], diagnostics: [networkFailure(error)] };
  }
}
