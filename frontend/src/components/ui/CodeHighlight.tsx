import React from 'react';
import hljs from 'highlight.js';
import './code-highlight.css';

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
  return hljs.getLanguage(mapped) ? mapped : null;
}

export function HighlightedCode({
  code,
  language,
}: {
  code: string;
  language?: string | null;
}): React.ReactElement {
  const normalized = normalizeCodeLanguage(language || undefined);
  if (!normalized) return <code>{code}</code>;

  const html = hljs.highlight(code, {
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
