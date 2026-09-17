/**
 * BLOCK-22-CODEMIRROR-INLINE-DIFF — languageLoader
 *
 * 按文件路径（或语言标识）懒加载语言包，返回 extension 或 null（null = 调用方走通用保底）。
 *
 * UI-395 后继（2026-09-17 用户反馈「.js 没有高亮，常见格式都要有，保底通用高亮」）：
 * - **修复 P0 起即断链的解析**：@codemirror/lang-* 全家族均为 named 工厂导出
 *   （`javascript()` / `python()` …），**没有 default 导出**——旧实现只认
 *   `mod.default`，恒返回 null，所有语言高亮从未真正工作过。
 * - ts/mts/cts/tsx/jsx 以对应选项启用（typescript/jsx 语法）。
 * - **语言包扩充（用户裁决「1 · 全量官方包+legacy」2026-09-17）**：新增
 *   lang-css / lang-html / lang-sql / lang-cpp / lang-java / lang-go / lang-rust
 *   七个官方包 + @codemirror/legacy-modes（shell/dockerfile/toml/ini/R/ruby/php/
 *   lua/perl/julia/objectivec/swift/csharp 等，经 StreamLanguage 桥接）。
 *   全部动态 import 懒加载，不增大启动 bundle。
 */

import { StreamLanguage } from '@codemirror/language';
import type { Extension } from '@codemirror/state';

interface CmSpec {
  kind: 'cm';
  mod: Promise<unknown>;
  /** @codemirror/lang-* 包内的 named 工厂函数名。 */
  factory: string;
  options?: Record<string, boolean>;
}

interface LegacySpec {
  kind: 'legacy';
  mod: Promise<unknown>;
  /** legacy-modes 子模块的 named 导出（StreamLanguage 描述符）。 */
  exportName: string;
}

type LanguageSpec = CmSpec | LegacySpec;

const JS = () => import('@codemirror/lang-javascript');
const PY = () => import('@codemirror/lang-python');
const JSONL = () => import('@codemirror/lang-json');
const MD = () => import('@codemirror/lang-markdown');
const YML = () => import('@codemirror/lang-yaml');
const CSS = () => import('@codemirror/lang-css');
const HTML = () => import('@codemirror/lang-html');
const SQL = () => import('@codemirror/lang-sql');
const CPP = () => import('@codemirror/lang-cpp');
const JAVA = () => import('@codemirror/lang-java');
const GO = () => import('@codemirror/lang-go');
const RUST = () => import('@codemirror/lang-rust');

const cm = (mod: Promise<unknown>, factory: string, options?: Record<string, boolean>): LanguageSpec =>
  ({ kind: 'cm', mod, factory, options });
const legacy = (mod: Promise<unknown>, exportName: string): LanguageSpec =>
  ({ kind: 'legacy', mod, exportName });

const TS_SPEC = () => cm(JS(), 'javascript', { typescript: true });
const TSX_SPEC = () => cm(JS(), 'javascript', { typescript: true, jsx: true });
const JSX_SPEC = () => cm(JS(), 'javascript', { jsx: true });
const JS_SPEC = () => cm(JS(), 'javascript');

/** 扩展名 → 语言包 spec。 */
const EXTENSION_SPECS: Record<string, () => LanguageSpec> = {
  // 已装官方包（BLOCK-22 起既有）
  py: () => cm(PY(), 'python'),
  js: JS_SPEC,
  mjs: JS_SPEC,
  cjs: JS_SPEC,
  jsx: JSX_SPEC,
  ts: TS_SPEC,
  mts: TS_SPEC,
  cts: TS_SPEC,
  tsx: TSX_SPEC,
  json: () => cm(JSONL(), 'json'),
  jsonl: () => cm(JSONL(), 'json'),
  md: () => cm(MD(), 'markdown'),
  markdown: () => cm(MD(), 'markdown'),
  yml: () => cm(YML(), 'yaml'),
  yaml: () => cm(YML(), 'yaml'),
  // UI-395 扩充：官方包
  css: () => cm(CSS(), 'css'),
  scss: () => cm(CSS(), 'css'),
  less: () => cm(CSS(), 'css'),
  html: () => cm(HTML(), 'html'),
  htm: () => cm(HTML(), 'html'),
  xml: () => cm(HTML(), 'html'),
  svg: () => cm(HTML(), 'html'),
  vue: () => cm(HTML(), 'html'),
  sql: () => cm(SQL(), 'sql'),
  c: () => cm(CPP(), 'cpp'),
  h: () => cm(CPP(), 'cpp'),
  cpp: () => cm(CPP(), 'cpp'),
  cc: () => cm(CPP(), 'cpp'),
  cxx: () => cm(CPP(), 'cpp'),
  hpp: () => cm(CPP(), 'cpp'),
  hxx: () => cm(CPP(), 'cpp'),
  ino: () => cm(CPP(), 'cpp'),
  java: () => cm(JAVA(), 'java'),
  go: () => cm(GO(), 'go'),
  rs: () => cm(RUST(), 'rust'),
  // UI-395 扩充：legacy-modes（StreamLanguage 桥接）
  sh: () => legacy(import('@codemirror/legacy-modes/mode/shell'), 'shell'),
  bash: () => legacy(import('@codemirror/legacy-modes/mode/shell'), 'shell'),
  zsh: () => legacy(import('@codemirror/legacy-modes/mode/shell'), 'shell'),
  dockerfile: () => legacy(import('@codemirror/legacy-modes/mode/dockerfile'), 'dockerFile'),
  toml: () => legacy(import('@codemirror/legacy-modes/mode/toml'), 'toml'),
  ini: () => legacy(import('@codemirror/legacy-modes/mode/properties'), 'properties'),
  cfg: () => legacy(import('@codemirror/legacy-modes/mode/properties'), 'properties'),
  conf: () => legacy(import('@codemirror/legacy-modes/mode/properties'), 'properties'),
  properties: () => legacy(import('@codemirror/legacy-modes/mode/properties'), 'properties'),
  env: () => legacy(import('@codemirror/legacy-modes/mode/properties'), 'properties'),
  r: () => legacy(import('@codemirror/legacy-modes/mode/r'), 'r'),
  rb: () => legacy(import('@codemirror/legacy-modes/mode/ruby'), 'ruby'),
  ruby: () => legacy(import('@codemirror/legacy-modes/mode/ruby'), 'ruby'),
  lua: () => legacy(import('@codemirror/legacy-modes/mode/lua'), 'lua'),
  pl: () => legacy(import('@codemirror/legacy-modes/mode/perl'), 'perl'),
  pm: () => legacy(import('@codemirror/legacy-modes/mode/perl'), 'perl'),
  jl: () => legacy(import('@codemirror/legacy-modes/mode/julia'), 'julia'),
  m: () => legacy(import('@codemirror/legacy-modes/mode/clike'), 'objectiveC'),
  mm: () => legacy(import('@codemirror/legacy-modes/mode/clike'), 'objectiveC'),
  swift: () => legacy(import('@codemirror/legacy-modes/mode/swift'), 'swift'),
  cs: () => legacy(import('@codemirror/legacy-modes/mode/clike'), 'csharp'),
  scala: () => legacy(import('@codemirror/legacy-modes/mode/clike'), 'scala'),
  kotlin: () => legacy(import('@codemirror/legacy-modes/mode/clike'), 'kotlin'),
  kt: () => legacy(import('@codemirror/legacy-modes/mode/clike'), 'kotlin'),
};

/** 语言标识 → 语言包 spec（扩展名未命中时查此表）。 */
const LANGUAGE_SPECS: Record<string, () => LanguageSpec> = {
  python: () => cm(PY(), 'python'),
  javascript: JS_SPEC,
  typescript: TS_SPEC,
  jsx: JSX_SPEC,
  tsx: TSX_SPEC,
  json: () => cm(JSONL(), 'json'),
  markdown: () => cm(MD(), 'markdown'),
  yaml: () => cm(YML(), 'yaml'),
  css: () => cm(CSS(), 'css'),
  html: () => cm(HTML(), 'html'),
  xml: () => cm(HTML(), 'html'),
  sql: () => cm(SQL(), 'sql'),
  c: () => cm(CPP(), 'cpp'),
  cpp: () => cm(CPP(), 'cpp'),
  java: () => cm(JAVA(), 'java'),
  go: () => cm(GO(), 'go'),
  rust: () => cm(RUST(), 'rust'),
  shell: () => legacy(import('@codemirror/legacy-modes/mode/shell'), 'shell'),
  bash: () => legacy(import('@codemirror/legacy-modes/mode/shell'), 'shell'),
  dockerfile: () => legacy(import('@codemirror/legacy-modes/mode/dockerfile'), 'dockerFile'),
  toml: () => legacy(import('@codemirror/legacy-modes/mode/toml'), 'toml'),
  r: () => legacy(import('@codemirror/legacy-modes/mode/r'), 'r'),
  ruby: () => legacy(import('@codemirror/legacy-modes/mode/ruby'), 'ruby'),
  lua: () => legacy(import('@codemirror/legacy-modes/mode/lua'), 'lua'),
  perl: () => legacy(import('@codemirror/legacy-modes/mode/perl'), 'perl'),
  julia: () => legacy(import('@codemirror/legacy-modes/mode/julia'), 'julia'),
  swift: () => legacy(import('@codemirror/legacy-modes/mode/swift'), 'swift'),
  csharp: () => legacy(import('@codemirror/legacy-modes/mode/clike'), 'csharp'),
};

const cache = new Map<string, Promise<Extension | null>>();

function fileExtensionLower(name: string): string {
  const idx = name.lastIndexOf('.');
  if (idx < 0 || idx === name.length - 1) return '';
  return name.slice(idx + 1).toLowerCase();
}

async function resolveSpec(sp: LanguageSpec): Promise<Extension | null> {
  try {
    if (sp.kind === 'legacy') {
      const mod = (await sp.mod) as Record<string, unknown>;
      const descriptor = mod[sp.exportName];
      if (!descriptor) return null;
      return StreamLanguage.define(descriptor as never);
    }
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
