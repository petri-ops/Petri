/**
 * BLOCK-22-CODEMIRROR-INLINE-DIFF — languageLoader
 *
 * 按文件路径（或语言标识）懒加载 `@codemirror/lang-*` 语言包。
 * 返回 `LanguageSupport | null`：
 * - `LanguageSupport`：可直接作为 CodeMirror extension
 * - `null`：未知扩展名 → 调用方走基础高亮（fallback）
 *
 * P0 阶段完整实现：兜底机制要可用。
 *
 * 设计要点：
 * 1. 动态 `import()`：不强制把所有语言包拉入初始 bundle
 * 2. 缓存：同一 filePath / language 不重复 import
 * 3. null 兜底：识别不了的扩展名返回 null，由编辑器走无高亮路径
 */

import type { Extension } from '@codemirror/state';

type LoaderResult = Extension;
type Loader = () => Promise<{ default: (...args: unknown[]) => LoaderResult }>;

/**
 * 扩展名 → 动态 loader。
 *
 * 兜底规则：
 * - `.py` → lang-python
 * - `.js` / `.jsx` / `.mjs` / `.cjs` / `.ts` / `.tsx` → lang-javascript
 * - `.json` / `.jsonl` → lang-json
 * - `.md` / `.markdown` → lang-markdown
 * - `.yml` / `.yaml` → lang-yaml
 * - 其它 → null（无语法高亮，仅基础配色）
 *
 * 注：动态 import 返回的模块形态在不同 CM 包之间不完全一致（部分包 default
 * 是 factory，部分包直接导出对象）。下面的 cast 只为过 TS 类型检查，运行时
 * 通过 `.default(...)` 触发实际高亮。
 */
const EXTENSION_LOADERS: Record<string, () => Promise<unknown>> = {
  py: () => import('@codemirror/lang-python'),
  js: () => import('@codemirror/lang-javascript'),
  jsx: () => import('@codemirror/lang-javascript'),
  mjs: () => import('@codemirror/lang-javascript'),
  cjs: () => import('@codemirror/lang-javascript'),
  ts: () => import('@codemirror/lang-javascript'),
  tsx: () => import('@codemirror/lang-javascript'),
  json: () => import('@codemirror/lang-json'),
  jsonl: () => import('@codemirror/lang-json'),
  md: () => import('@codemirror/lang-markdown'),
  markdown: () => import('@codemirror/lang-markdown'),
  yml: () => import('@codemirror/lang-yaml'),
  yaml: () => import('@codemirror/lang-yaml'),
};

const LANGUAGE_LOADERS: Record<string, () => Promise<unknown>> = {
  python: () => import('@codemirror/lang-python'),
  javascript: () => import('@codemirror/lang-javascript'),
  typescript: () => import('@codemirror/lang-javascript'),
  jsx: () => import('@codemirror/lang-javascript'),
  tsx: () => import('@codemirror/lang-javascript'),
  json: () => import('@codemirror/lang-json'),
  markdown: () => import('@codemirror/lang-markdown'),
  yaml: () => import('@codemirror/lang-yaml'),
};

const cache = new Map<string, Promise<Extension | null>>();

function fileExtensionLower(name: string): string {
  const idx = name.lastIndexOf('.');
  if (idx < 0 || idx === name.length - 1) return '';
  return name.slice(idx + 1).toLowerCase();
}

async function resolveExtension(loader: () => Promise<unknown>): Promise<Extension | null> {
  try {
    const mod = await loader();
    if (!mod || typeof mod !== 'object') return null;
    const def = (mod as { default?: unknown }).default;
    if (typeof def !== 'function') return null;
    const result = (def as (...args: unknown[]) => unknown)();
    return (result ?? []) as Extension;
  } catch {
    return null;
  }
}

/**
 * 加载语言 extension。返回 null 表示无可用高亮。
 *
 * @param input 文件名（`a/b/foo.py`）或语言标识（`python` / `ts`）。
 *              注意：输入识别通过 `fileExtensionLower` 提取扩展名；
 *              如果扩展名未命中，再尝试当语言名查表。
 */
export async function loadLanguage(input: string): Promise<Extension | null> {
  if (!input) return null;
  const key = input.trim();
  const cached = cache.get(key);
  if (cached) return cached;

  const loader = EXTENSION_LOADERS[fileExtensionLower(key)] ?? LANGUAGE_LOADERS[key.toLowerCase()];
  if (!loader) {
    // 标记为不可加载，避免反复字符串处理
    cache.set(key, Promise.resolve(null));
    return null;
  }

  const promise = resolveExtension(loader);
  cache.set(key, promise);
  return promise;
}

/** 仅供测试：清空缓存。 */
export function _resetLanguageCache(): void {
  cache.clear();
}
