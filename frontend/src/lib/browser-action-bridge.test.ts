import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  performBrowserAction,
  READ_TEXT_LIMIT,
  type WebviewActionBridge,
} from './browser-action-bridge';

// BLOCK-269 — 执行器纯逻辑：动作 → 注入的 webview bridge → 有界结果/如实失败。

function makeBridge(overrides: Partial<WebviewActionBridge> = {}): WebviewActionBridge {
  return {
    navigate: vi.fn(() => Promise.resolve()),
    executeJavaScript: vi.fn(() => Promise.resolve(null)),
    capturePage: vi.fn(() => Promise.resolve({ size: { width: 800, height: 600 } })),
    ...overrides,
  };
}

describe('performBrowserAction', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('navigate 无 url → url_required；有 url → 调 bridge.navigate', async () => {
    const navigateMock = vi.fn(() => Promise.resolve());
    const bridge = makeBridge({ navigate: navigateMock });
    expect((await performBrowserAction({ action: 'navigate' }, bridge)).error).toBe('url_required');
    const ok = await performBrowserAction({ action: 'navigate', url: 'https://example.com/' }, bridge);
    expect(ok.ok).toBe(true);
    expect(navigateMock).toHaveBeenCalledWith('https://example.com/');
  });

  it('read_text 有界：超 20k 截断标 truncated', async () => {
    const long = 'x'.repeat(READ_TEXT_LIMIT + 100);
    const bridge = makeBridge({ executeJavaScript: vi.fn(() => Promise.resolve(long)) });
    const outcome = await performBrowserAction({ action: 'read_text' }, bridge);
    expect(outcome.ok).toBe(true);
    const result = outcome.result as { text: string; truncated: boolean };
    expect(result.text.length).toBe(READ_TEXT_LIMIT);
    expect(result.truncated).toBe(true);
  });

  it('click selector 不存在 → selector_not_found；存在 → clicked', async () => {
    const missing = makeBridge({ executeJavaScript: vi.fn(() => Promise.resolve({ found: false })) });
    expect((await performBrowserAction({ action: 'click', selector: '#a' }, missing)).error).toBe('selector_not_found');
    const clickJs = vi.fn((_code: string) => Promise.resolve({ found: true, clicked: true }));
    const hit = makeBridge({ executeJavaScript: clickJs });
    const outcome = await performBrowserAction({ action: 'click', selector: '#a' }, hit);
    expect(outcome.ok).toBe(true);
    // 注入安全：selector 必须走 JSON.stringify（零裸拼接）
    const code = clickJs.mock.calls[0]?.[0] ?? '';
    expect(code).toContain('"#a"');
  });

  it('fill 拒绝态（非输入元素）→ fill_rejected；成功 → filled', async () => {
    const rejected = makeBridge({ executeJavaScript: vi.fn(() => Promise.resolve({ found: true, filled: false, reason: 'not_input' })) });
    expect((await performBrowserAction({ action: 'fill', selector: '#a', text: 'x' }, rejected)).error).toBe('fill_rejected');
    const fillJs = vi.fn((_code: string) => Promise.resolve({ found: true, filled: true }));
    const okBridge = makeBridge({ executeJavaScript: fillJs });
    const outcome = await performBrowserAction({ action: 'fill', selector: '#a', text: 'hello' }, okBridge);
    expect(outcome.ok).toBe(true);
    const code = fillJs.mock.calls[0]?.[0] ?? '';
    expect(code).toContain('"hello"');
  });

  it('screenshot 只回尺寸不回像素', async () => {
    const bridge = makeBridge();
    const outcome = await performBrowserAction({ action: 'screenshot' }, bridge);
    expect(outcome.ok).toBe(true);
    expect(outcome.result).toEqual({ width: 800, height: 600, pixels: 'not_transferred' });
  });

  it('webview 异常如实失败；未知动作 action_not_allowed', async () => {
    const broken = makeBridge({ executeJavaScript: vi.fn(() => Promise.reject(new Error('detached'))) });
    const outcome = await performBrowserAction({ action: 'read_text' }, broken);
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toBe('webview_error');
    expect((await performBrowserAction({ action: 'evil' }, makeBridge())).error).toBe('action_not_allowed');
  });
});
