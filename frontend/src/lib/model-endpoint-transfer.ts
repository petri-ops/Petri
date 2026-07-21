import type { ChatModelPreset } from '@/hooks/useAiSettings';

export interface EndpointTransferProfile {
  id?: string;
  supplier: string;
  baseUrl: string;
  defaultModel: string;
  provider?: string;
  hasApiKey?: boolean;
}

export interface ParsedEndpointTransfer {
  profiles: EndpointTransferProfile[];
  warnings: string[];
}

const CSV_HEADERS = ['id', 'supplier', 'baseUrl', 'defaultModel', 'provider', 'hasApiKey'];

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
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
  };
}

function csvEscape(value: unknown): string {
  const text = value == null ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function endpointProfilesForTransfer(profiles: ChatModelPreset[]): EndpointTransferProfile[] {
  return profiles.map((profile) => ({
    id: profile.id,
    supplier: profile.label || profile.provider,
    baseUrl: profile.baseUrl || (profile.provider === 'deepseek' ? 'https://api.deepseek.com' : ''),
    defaultModel: profile.defaultModel || profile.model,
    provider: profile.provider,
    hasApiKey: undefined,
  })).filter((profile) => profile.baseUrl && profile.defaultModel);
}

export function exportEndpointProfilesJson(profiles: ChatModelPreset[]): string {
  return JSON.stringify({
    format: 'biof3-api-endpoints',
    version: 1,
    exportedAt: new Date().toISOString(),
    note: 'API keys are intentionally excluded. Re-enter keys after import.',
    profiles: endpointProfilesForTransfer(profiles),
  }, null, 2);
}

export function exportEndpointProfilesCsv(profiles: ChatModelPreset[]): string {
  const rows = endpointProfilesForTransfer(profiles).map((profile) =>
    CSV_HEADERS.map((header) => csvEscape(profile[header as keyof EndpointTransferProfile])).join(',')
  );
  return `\uFEFF${CSV_HEADERS.join(',')}\n${rows.join('\n')}\n`;
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
    const record = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
    if (record.apiKey || record.api_key || record.key) {
      warnings.push(`第 ${index + 1} 行包含 Key 字段，已忽略；请在设置页重新填写。`);
    }
    const profile = normalizeProfile(raw, index);
    if (profile) profiles.push(profile);
    else warnings.push(`第 ${index + 1} 行缺少有效 Base URL 或默认模型，已跳过。`);
  });
  if (profiles.length === 0) throw new Error('没有可导入的有效渠道');
  return { profiles, warnings };
}
