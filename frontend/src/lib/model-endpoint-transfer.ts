import { unknownText } from './unknownText';
import type { ChatModelPreset } from '@/hooks/useAiSettings';
import { endpointBaseUrl } from './model-provider-options';

export interface EndpointTransferProfile {
  id?: string;
  supplier: string;
  baseUrl: string;
  defaultModel: string;
  provider?: string;
  hasApiKey?: boolean;
  /** Included only for an explicit user-requested credential export. */
  apiKey?: string;
}

export interface ParsedEndpointTransfer {
  profiles: EndpointTransferProfile[];
  warnings: string[];
}

const CSV_HEADERS = ['id', 'supplier', 'baseUrl', 'defaultModel', 'provider', 'hasApiKey'];

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : value == null ? '' : unknownText(value).trim();
}

function boolValue(value: unknown): boolean | undefined {
  const normalized = clean(value).toLowerCase();
  if (!normalized) return undefined;
  if (['true', '1', 'yes', 'y', '是', '有'].includes(normalized)) return true;
  if (['false', '0', 'no', 'n', '否', '无'].includes(normalized)) return false;
  return undefined;
}

function normalizeProfile(input: unknown, index: number): EndpointTransferProfile | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Record<string, unknown>;
  const baseUrl = clean(raw.baseUrl ?? raw.base_url ?? raw.url);
  const defaultModel = clean(raw.defaultModel ?? raw.default_model ?? raw.model);
  if (!baseUrl || !defaultModel) return null;
  try {
    const parsed = new URL(baseUrl);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
  } catch {
    return null;
  }
  const supplier = clean(raw.supplier ?? raw.label ?? raw.name) || `导入渠道 ${index + 1}`;
  return {
    id: clean(raw.id) || undefined,
    supplier: supplier.slice(0, 120),
    baseUrl: baseUrl.replace(/\/$/, ''),
    defaultModel: defaultModel.slice(0, 200),
    provider: clean(raw.provider) || undefined,
    hasApiKey: boolValue(raw.hasApiKey ?? raw.has_api_key),
    apiKey: clean(raw.apiKey ?? raw.api_key ?? raw.key) || undefined,
  };
}

function csvEscape(value: unknown): string {
  const text = unknownText(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function endpointProfilesForTransfer(
  profiles: ChatModelPreset[],
  apiKeys: Record<string, string> = {}
): EndpointTransferProfile[] {
  return profiles.map((profile) => ({
    id: profile.id,
    supplier: profile.label || profile.provider,
    baseUrl: endpointBaseUrl(profile),
    defaultModel: profile.defaultModel || profile.model,
    provider: profile.provider,
    hasApiKey: undefined,
    ...(apiKeys[profile.id] ? { apiKey: apiKeys[profile.id] } : {}),
  })).filter((profile) => profile.baseUrl && profile.defaultModel);
}

/**
 * BLOCK-203 W4a P8（runlist D-2 rider）— 凭据脱敏。
 *
 * 默认导出**不再带明文 Key**：只保留后四位，让用户能核对"哪个渠道配了 Key"，
 * 又不足以复用。要迁移到另一台机器必须显式二次确认（见 useEndpointProfilesEditor）。
 */
export function maskApiKey(key: string): string {
  const trimmed = String(key || '').trim();
  if (!trimmed) return '';
  if (trimmed.length <= 4) return '***';
  return `***${trimmed.slice(-4)}`;
}

interface EndpointExportOptions {
  /** true = 脱敏（默认）；false = 明文（用户显式二次确认后的跨机迁移路径）。 */
  masked?: boolean;
}

/**
 * 脱敏在**构建器内部**完成，而不是靠调用方先打码：
 * 只要调用方忘了传 masked:false，出来的就是脱敏值——把 D-2 变成默认安全而不是纪律。
 */
function keysForExport(apiKeys: Record<string, string>, options: EndpointExportOptions): Record<string, string> {
  if (options.masked === false) return apiKeys;
  return Object.fromEntries(Object.entries(apiKeys).map(([id, key]) => [id, maskApiKey(key)]));
}

function exportNote(apiKeys: Record<string, string>, options: EndpointExportOptions): string {
  if (!Object.keys(apiKeys).length) return 'API keys were not available for this export.';
  if (options.masked !== false) {
    return 'API keys are masked (last 4 characters only). Plaintext export requires an explicit confirmation.';
  }
  return 'API keys were included because the user explicitly requested a credential export.';
}

export function exportEndpointProfilesJson(
  profiles: ChatModelPreset[],
  apiKeys: Record<string, string> = {},
  options: EndpointExportOptions = {},
): string {
  return JSON.stringify({
    format: 'petri-api-endpoints',
    version: 1,
    exportedAt: new Date().toISOString(),
    note: exportNote(apiKeys, options),
    profiles: endpointProfilesForTransfer(profiles, keysForExport(apiKeys, options)),
  }, null, 2);
}

export function exportEndpointProfilesCsv(
  profiles: ChatModelPreset[],
  apiKeys: Record<string, string> = {},
  options: EndpointExportOptions = {},
): string {
  const headers = [...CSV_HEADERS, 'apiKey'];
  const rows = endpointProfilesForTransfer(profiles, keysForExport(apiKeys, options)).map((profile) =>
    headers.map((header) => csvEscape(profile[header as keyof EndpointTransferProfile])).join(',')
  );
  // CSV 表头不变（下游解析器依赖列顺序）；脱敏与否体现在值上，CSV 没有 note 字段
  void options;
  return `\uFEFF${headers.join(',')}\n${rows.join('\n')}\n`;
}

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { cell += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"' && cell === '') quoted = true;
    else if (char === ',') { row.push(cell); cell = ''; }
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i += 1;
      row.push(cell); cell = '';
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
    } else cell += char;
  }
  if (cell || row.length) { row.push(cell); if (row.some((value) => value.trim())) rows.push(row); }
  if (rows.length === 0) return [];
  const headers = rows.shift()!.map((value) => value.replace(/^\uFEFF/, '').trim());
  return rows.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] || ''])));
}

export function parseEndpointProfiles(text: string, format: 'json' | 'csv'): ParsedEndpointTransfer {
  const warnings: string[] = [];
  let rawProfiles: unknown[] = [];
  if (format === 'json') {
    const parsed: unknown = JSON.parse(text);
    if (Array.isArray(parsed)) rawProfiles = parsed;
    else if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { profiles?: unknown[] }).profiles)) {
      rawProfiles = (parsed as { profiles: unknown[] }).profiles;
    } else throw new Error('JSON 中没有 profiles 数组');
  } else {
    rawProfiles = parseCsv(text);
  }
  if (rawProfiles.length > 100) throw new Error('单次最多导入 100 个渠道');
  const profiles: EndpointTransferProfile[] = [];
  rawProfiles.forEach((raw, index) => {
    const profile = normalizeProfile(raw, index);
    if (profile) profiles.push(profile);
    else warnings.push(`第 ${index + 1} 行缺少有效 Base URL 或默认模型，已跳过。`);
  });
  if (profiles.length === 0) throw new Error('没有可导入的有效渠道');
  return { profiles, warnings };
}
