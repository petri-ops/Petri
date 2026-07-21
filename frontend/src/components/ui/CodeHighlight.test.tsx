import React from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  HighlightedCode,
  codeLanguageForFile,
  normalizeCodeLanguage,
} from './CodeHighlight';

afterEach(cleanup);

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
});
