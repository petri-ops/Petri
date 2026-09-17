/**
 * BLOCK-22-CODEMIRROR-INLINE-DIFF — languageLoader
 *
 * 按文件路径（或语言标识）懒加载 `@codemirror/lang-*` 语言包。
 * 返回 `LanguageSupport | null`：null = 无该语言包（调用方走通用保底高亮）。
 *
 * UI-395 后继（2026-09-17 用户反馈「.js 没有高亮，常见格式都要有，保底通用高亮」）：
 * - **修复 P0 起即断链的解析**：@codemirror/lang-* 全家族均为 named 工厂导出
 *   （`javascript()` / `python()` …），**没有 default 导出**——旧实现只认
 *   `mod.default`，恒返回 null，所有语言高亮从未真正工作过。
 * - ts/mts/cts/tsx/jsx 以对应选项启用（typescript/jsx 语法）。
 */

import type { Extension } from '@codemirror/state';

interface LanguageSpec {
  mod: Promise<unknown>;
  /** @codemirror/lang-* 包内的 named 工厂函数名。 */
  factory: string;
  /** 工厂选项（javascript({typescript, jsx})）。 */
  options?: Record<string, boolean>;
}

const JS = () => import('@codemirror/lang-javascript');
const PY = () => import('@codemirror/lang-python');
const JSONL = () => import('@codemirror/lang-json');
const MD = () => import('@codemirror/lang-markdown');
const YML = () => import('@codemirror/lang-yaml');

/** 与包内 named 工厂同名。 */
const FACTORIES = {
  js: JS,
  py: PY,
  json: JSONL,
  md: MD,
  yaml: YML,
};

function spec(mod: Promise<unknown>, factory: string, options?: Record<string, boolean>): LanguageSpec {
  return { mod, factory, options };
}

const TS_SPEC = () => spec(JS(), 'javascript', { typescript: true });
const TSX_SPEC = () => spec(JS(), 'javascript', { typescript: true, jsx: true });
const JSX_SPEC = () => spec(JS(), 'javascript', { jsx: true });
const JS_SPEC = () => spec(JS(), 'javascript');

/** 扩展名 → 语言包 spec。 */
const EXTENSION_SPECS: Record<string, () => LanguageSpec> = {
  py: () => spec(PY(), 'python'),
  js: JS_SPEC,
  mjs: JS_SPEC,
  cjs: JS_SPEC,
  jsx: JSX_SPEC,
  ts: TS_SPEC,
  mts: TS_SPEC,
  cts: TS_SPEC,
  tsx: TSX_SPEC,
  json: () => spec(JSONL(), 'json'),
  jsonl: () => spec(JSONL(), 'json'),
  md: () => spec(MD(), 'markdown'),
  markdown: () => spec(MD(), 'markdown'),
  yml: () => spec(YML(), 'yaml'),
  yaml: () => spec(YML(), 'yaml'),
};

/** 语言标识 → 语言包 spec（扩展名未命中时查此表）。 */
const LANGUAGE_SPECS: Record<string, () => LanguageSpec> = {
  python: () => spec(PY(), 'python'),
  javascript: JS_SPEC,
  typescript: TS_SPEC,
  jsx: JSX_SPEC,
  tsx: TSX_SPEC,
  json: () => spec(JSONL(), 'json'),
  markdown: () => spec(MD(), 'markdown'),
  yaml: () => spec(YML(), 'yaml'),
};

const cache = new Map<string, Promise<Extension | null>>();

function fileExtensionLower(name: string): string {
  const idx = name.lastIndexOf('.');
  if (idx < 0 || idx === name.length - 1) return '';
  return name.slice(idx + 1).toLowerCase();
}

async function resolveSpec(sp: LanguageSpec): Promise<Extension | null> {
  try {
    const mod = (await sp.mod) as Record<string, unknown>;
    if (!mod || typeof mod !== 'object') return null;
    // @codemirror/lang-* 家族为 named 工厂导出（无 default）——按 factory 名取。
    const factory = mod[sp.factory];
    if (typeof factory === 'function') {
      return ((factory as (o?: unknown) => unknown)(sp.options) ?? null) as Extension | null;
    }
    // 兼容 default 工厂形态（防家族未来改导出方式）。
    if (typeof mod['default'] === 'function') {
      return ((mod['default'] as (o?: unknown) => unknown)(sp.options) ?? null) as Extension | null;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * 加载语言 extension。返回 null 表示无该语言包（走通用保底高亮）。
 *
 * @param input 文件名（`a/b/foo.py`）或语言标识（`python` / `ts`）。
 */
export async function loadLanguage(input: string): Promise<Extension | null> {
  if (!input) return null;
  const key = input.trim();
  const cached = cache.get(key);
  if (cached) return cached;

  const make = EXTENSION_SPECS[fileExtensionLower(key)] ?? LANGUAGE_SPECS[key.toLowerCase()];
  if (!make) {
    cache.set(key, Promise.resolve(null));
    return null;
  }

  const promise = resolveSpec(make());
  cache.set(key, promise);
  return promise;
}

/** 仅供测试：清空缓存。 */
export function _resetLanguageCache(): void {
  cache.clear();
}
