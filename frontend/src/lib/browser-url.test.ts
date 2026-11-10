import { describe, expect, it } from 'vitest';
import { getBrowserViewportSize, isNavigableWebUrl, isPetriLocalBrowserUrl, normalizeBrowserUrl } from './browser-url';

describe('browser URL routing', () => {
  it('normalizes local and external addresses', () => {
    expect(normalizeBrowserUrl('localhost:3001/api/health')).toBe('http://localhost:3001/api/health');
    expect(normalizeBrowserUrl('example.com')).toBe('https://example.com');
  });

  it('uses the stable frame renderer for every local Petri page', () => {
    expect(isPetriLocalBrowserUrl('http://localhost:3001/api/tools/file/tj_1/final-report.html?token=x')).toBe(true);
    expect(isPetriLocalBrowserUrl('http://127.0.0.1:3001/api/tools/file/tj_1/report.html')).toBe(true);
    expect(isPetriLocalBrowserUrl('http://localhost:3001/api/health')).toBe(true);
    expect(isPetriLocalBrowserUrl('https://localhost:3001/api/health')).toBe(false);
    expect(isPetriLocalBrowserUrl('https://example.com/api/tools/file/tj_1/final-report.html')).toBe(false);
  });

  it('turns the live browser host bounds into an explicit pixel viewport', () => {
    expect(getBrowserViewportSize(1180.9, 588.7)).toEqual({ width: 1180, height: 588 });
    expect(getBrowserViewportSize(0, 588)).toBeNull();
    expect(getBrowserViewportSize(Number.NaN, 588)).toBeNull();
  });
});

describe('isNavigableWebUrl（L1-4 / 蓝图 L-53：每次 loadURL 前的白名单）', () => {
  it('file:///javascript:/petri-genui:// 自定义协议全拒', () => {
    expect(isNavigableWebUrl('file:///etc/passwd')).toBe(false);
    expect(isNavigableWebUrl('javascript://x/%0aalert(1)')).toBe(false);
    expect(isNavigableWebUrl('petri-genui://conv/page.html')).toBe(false);
    expect(isNavigableWebUrl('ftp://example.com/x')).toBe(false);
  });
  it('回环主机全拒（本地报告走 iframe 独立通道）', () => {
    expect(isNavigableWebUrl('http://127.0.0.1:9223/x')).toBe(false);
    expect(isNavigableWebUrl('http://localhost:8080/')).toBe(false);
    expect(isNavigableWebUrl('http://[::1]:3000/')).toBe(false);
  });
  it('userinfo 形态拒', () => {
    expect(isNavigableWebUrl('http://localhost:3000@other-host/')).toBe(false);
    expect(isNavigableWebUrl('https://user:pass@example.com/')).toBe(false);
  });
  it('合法公网 http(s) 放行', () => {
    expect(isNavigableWebUrl('https://example.com/')).toBe(true);
    expect(isNavigableWebUrl('http://example.com/a?b=c#d')).toBe(true);
  });
});
