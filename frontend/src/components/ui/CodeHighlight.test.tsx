import React from 'react';
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  HighlightedCode,
  codeLanguageForFile,
  isCodeHighlightReady,
  normalizeCodeLanguage,
  whenCodeHighlightReady,
} from './CodeHighlight';

afterEach(cleanup);

beforeAll(async () => {
  // BLOCK-106 P1：highlight.js 改为按需加载（不再进首屏关键 chunk），语言注册表
  // 只有就位后才可判定；所有严格语言断言必须先等就绪。
  expect(await whenCodeHighlightReady()).toBe(true);
});

describe('CodeHighlight', () => {
  it('maps common workspace script extensions', () => {
    expect(codeLanguageForFile('analysis.py')).toBe('python');
    expect(codeLanguageForFile('analysis.R')).toBe('r');
    expect(codeLanguageForFile('scripts/install.sh')).toBe('bash');
    expect(codeLanguageForFile('config.yaml')).toBe('yaml');
    expect(codeLanguageForFile('notes.txt')).toBeNull();
  });

  it('normalizes fenced aliases and rejects unknown languages', () => {
    expect(normalizeCodeLanguage('py')).toBe('python');
    expect(normalizeCodeLanguage('shell')).toBe('bash');
    expect(normalizeCodeLanguage('language-ts')).toBe('typescript');
    expect(normalizeCodeLanguage('tree')).toBeNull();
  });

  it('highlights known code without interpreting source as markup', () => {
    const { container } = render(
      <pre>
        <HighlightedCode code={'value = "<script>"'} language="python" />
      </pre>,
    );
    expect(container.querySelector('code.hljs.language-python')).not.toBeNull();
    expect(container.textContent).toContain('<script>');
    expect(container.querySelector('script')).toBeNull();
  });

  it('未就位时诚实降级：不猜语言、渲染纯文本，就位后升级上色', async () => {
    // 独立模块实例（resetModules）以复现「chunk 尚未到货」的启动窗口
    vi.resetModules();
    const fresh = await import('./CodeHighlight');
    expect(fresh.isCodeHighlightReady()).toBe(false);
    expect(fresh.normalizeCodeLanguage('py')).toBeNull();
    const { container } = render(
      <pre>
        <fresh.HighlightedCode code="value = 1" language="python" />
      </pre>,
    );
    expect(container.querySelector('code.hljs')).toBeNull();
    expect(container.textContent).toContain('value = 1');

    expect(await fresh.whenCodeHighlightReady()).toBe(true);
    await waitFor(() => expect(fresh.normalizeCodeLanguage('py')).toBe('python'));
    expect(isCodeHighlightReady()).toBe(true);
  });
});
