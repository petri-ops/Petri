/**
 * frontend/src/components/copilot/gen-ui/schema.ts
 *
 * BLOCK-166 [A 层] `::visualize` 引用的严格 schema——手写校验器（零依赖先例：
 * 对齐 CopilotMarkdown；ZCode 用 zod，本仓 plan §3 裁决不新增依赖）。
 * 线格式校验 only：执行端（主进程）拥有归一化与文件系统授权的最终裁决。
 */

export interface GenUiReference {
  path: string;
  title?: string;
  mode?: 'wide';
}

const PATH_MAX = 4096;
const TITLE_MAX = 250;
const FILENAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*\.html$/;
const ABSOLUTE_PATH_PATTERN = /^(?:\/|[A-Za-z]:[\\/]|\\\\)/u;

export function isGenUiPath(value: unknown): value is string {
  if (typeof value !== 'string' || value.length < 1 || value.length > PATH_MAX) return false;
  if (value.includes('\0') || /[\r\n]/u.test(value)) return false;
  const segments = value.split(/[\\/]/u);
  if (segments.includes('..')) return false;
  const filename = segments.at(-1) ?? '';
  return ABSOLUTE_PATH_PATTERN.test(value) && FILENAME_PATTERN.test(filename);
}

/** 解析并校验引用对象；任何不符合返回 null（上层降级为 invalid 占位）。 */
export function parseGenUiReference(value: unknown): GenUiReference | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  if (keys.length < 1 || keys.length > 3) return null;
  if (keys.some((key) => key !== 'path' && key !== 'title' && key !== 'mode')) return null;
  if (!('path' in record) || !isGenUiPath(record.path)) return null;
  if ('title' in record && (typeof record.title !== 'string' || record.title.length > TITLE_MAX)) return null;
  if ('mode' in record && record.mode !== 'wide') return null;
  const reference: GenUiReference = { path: record.path };
  if (typeof record.title === 'string') reference.title = record.title;
  if (record.mode === 'wide') reference.mode = 'wide';
  return reference;
}

/** 去重键：Windows 分隔符归一化后按全路径比对（坑 8）。 */
export function normalizeGenUiPath(value: string): string {
  return value.replace(/\\/g, '/');
}
