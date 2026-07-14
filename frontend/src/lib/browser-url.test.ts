import { describe, expect, it } from 'vitest';
import { isBioF3LocalBrowserUrl, normalizeBrowserUrl } from './browser-url';

describe('browser URL routing', () => {
  it('normalizes local and external addresses', () => {
    expect(normalizeBrowserUrl('localhost:3001/api/health')).toBe('http://localhost:3001/api/health');
    expect(normalizeBrowserUrl('example.com')).toBe('https://example.com');
  });

  it('uses the stable frame renderer for every local BioF3 page', () => {
    expect(isBioF3LocalBrowserUrl('http://localhost:3001/api/tools/file/tj_1/final-report.html?token=x')).toBe(true);
    expect(isBioF3LocalBrowserUrl('http://127.0.0.1:3001/api/tools/file/tj_1/report.html')).toBe(true);
    expect(isBioF3LocalBrowserUrl('http://localhost:3001/api/health')).toBe(true);
    expect(isBioF3LocalBrowserUrl('https://localhost:3001/api/health')).toBe(false);
    expect(isBioF3LocalBrowserUrl('https://example.com/api/tools/file/tj_1/final-report.html')).toBe(false);
  });
});
