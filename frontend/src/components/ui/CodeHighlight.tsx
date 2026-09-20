import React, { useEffect, useState } from 'react';
import './code-highlight.css';

/**
 * BLOCK-106 P1 — highlight.js 移出首屏关键 chunk。
 *
 * 全量 highlight.js（190 种语言，源码 ~1.5 MB）此前经 `import hljs from 'highlight.js'`
 * 静态进主 chunk（实测主 chunk 1,873,300 B 中最大单项），而聊天首屏（SimpleChat →
 * HighlightedCode）就要解析它。改为动态引入 + 模块加载即并行预取：关键路径不再解析
 * 该库，语言覆盖一份不减（不做 common 子集，避免 LaTeX/Julia/dockerfile 等退化）。
 *
 * 降级形态：hljs 未就位时 `HighlightedCode` 渲染纯文本 `<code>`，就位后重渲染上色；
 * `normalizeCodeLanguage` / `codeLanguageForFile` 在未就位时返回 null（=「暂不高亮」），
 * 就位后同一输入返回准确语言。刻意不做乐观返回、也不内置语言清单——注册表只有
 * hljs 一个真相源，调用方拿 null 走纯文本即旧语义。
 */
type HljsInstance = typeof import('highlight.js').default;

let hljsInstance: HljsInstance | null = null;
let hljsLoading: Promise<HljsInstance | null> | null = null;
const hljsReadyListeners = new Set<() => void>();

function loadHljs(): Promise<HljsInstance | null> {
  if (hljsInstance) return Promise.resolve(hljsInstance);
  if (!hljsLoading) {
    hljsLoading = import('highlight.js')
      .then((mod) => {
        hljsInstance = mod.default ?? (mod as unknown as HljsInstance);
        for (const listener of hljsReadyListeners) listener();
        return hljsInstance;
      })
      .catch(() => null);
  }
  return hljsLoading;
}

// 并行预取：不等第一次渲染，缩短「纯文本→上色」的可见窗口。
void loadHljs();

export function isCodeHighlightReady(): boolean {
  return hljsInstance !== null;
}

/** 供测试与需要严格语言判定的调用方等待就绪（不做第二套语言清单=避免真相源分裂）。 */
export function whenCodeHighlightReady(): Promise<boolean> {
  return loadHljs().then((instance) => instance !== null);
}

function subscribeHljsReady(onReady: () => void): () => void {
  hljsReadyListeners.add(onReady);
  return () => {
    hljsReadyListeners.delete(onReady);
  };
}

const LANGUAGE_ALIASES: Record<string, string> = {
  bash: 'bash',
  cjs: 'javascript',
  css: 'css',
  html: 'xml',
  ini: 'ini',
  js: 'javascript',
  javascript: 'javascript',
  json: 'json',
  jsonl: 'json',
  jsx: 'javascript',
  mjs: 'javascript',
  py: 'python',
  python: 'python',
  r: 'r',
  rb: 'ruby',
  ruby: 'ruby',
  scss: 'scss',
  sh: 'bash',
  shell: 'bash',
  sql: 'sql',
  toml: 'ini',
  ts: 'typescript',
  tsx: 'typescript',
  typescript: 'typescript',
  xml: 'xml',
  yaml: 'yaml',
  yml: 'yaml',
  zsh: 'bash',
};

export function codeLanguageForFile(name?: string): string | null {
  const baseName = (name || '').split('/').pop()?.toLowerCase() || '';
  if (!baseName) return null;
  if (baseName === 'dockerfile') return 'dockerfile';
  if (baseName === 'makefile') return 'makefile';
  const dot = baseName.lastIndexOf('.');
  const extension = dot >= 0 ? baseName.slice(dot + 1) : '';
  return normalizeCodeLanguage(extension);
}

export function normalizeCodeLanguage(language?: string): string | null {
  const normalized = (language || '').trim().toLowerCase().replace(/^language-/, '');
  if (!normalized || normalized === 'text' || normalized === 'txt' || normalized === 'plaintext') {
    return null;
  }
  const mapped = LANGUAGE_ALIASES[normalized] || normalized;
  // 严格语义：hljs 未就位时无法判定语言是否注册，一律按「不高亮」处理（返回 null），
  // 就位后同一输入即得准确结果——避免维护第二套语言清单造成真相源分裂。
  if (!hljsInstance) return null;
  return hljsInstance.getLanguage(mapped) ? mapped : null;
}

export function HighlightedCode({
  code,
  language,
}: {
  code: string;
  language?: string | null;
}): React.ReactElement {
  const [ready, setReady] = useState(isCodeHighlightReady);

  useEffect(() => {
    if (ready) return undefined;
    const unsubscribe = subscribeHljsReady(() => setReady(true));
    void loadHljs();
    return unsubscribe;
  }, [ready]);

  const normalized = normalizeCodeLanguage(language || undefined);
  if (!normalized || !hljsInstance) return <code>{code}</code>;

  const html = hljsInstance.highlight(code, {
    language: normalized,
    ignoreIllegals: true,
  }).value;
  return (
    <code
      className={`hljs language-${normalized}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
