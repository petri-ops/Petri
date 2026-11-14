// BLOCK-447 — MCP App 自动渲染与双向 RPC 组件契约
import React from 'react';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { McpAppCard } from './McpAppCard';

const prepareMcpApp = vi.fn(() => Promise.resolve({ ok: true, url: 'petri-genui://gen-test123/index.html' }));
const callMcpAppTool = vi.fn(() => Promise.resolve({ ok: true, result: { content: [{ type: 'text', text: 'PONG' }] } }));
const openExternal = vi.fn(() => Promise.resolve({ ok: true }));

vi.mock('@/lib/desktopBridge', () => ({
  getBridge: () => (window as unknown as { petri?: { genUi?: unknown } }).petri?.genUi ?? null,
}));

const app = { serverId: 'demo-server', uri: 'ui://demo/panel.html' };

function setBridge(overrides: Record<string, unknown> = {}) {
  (window as unknown as { petri?: unknown }).petri = {
    genUi: { prepareMcpApp, callMcpAppTool, openExternal, ...overrides },
  };
}

describe('McpAppCard 自动渲染 + 双向 RPC', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    delete (window as unknown as { petri?: unknown }).petri;
  });

  it('prepareMcpApp 成功后渲染沙箱 iframe（独立 origin + 受限 sandbox）', async () => {
    setBridge();
    const { container } = render(<McpAppCard app={app} title="Demo App" />);
    const frame = await waitFor(() => {
      const el = container.querySelector('iframe');
      expect(el).not.toBeNull();
      return el as HTMLIFrameElement;
    });
    expect(prepareMcpApp).toHaveBeenCalledWith({ serverId: 'demo-server', uri: 'ui://demo/panel.html', title: 'Demo App' });
    expect(frame.getAttribute('src')).toBe('petri-genui://gen-test123/index.html');
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin');
  });

  it('prepare 失败显示结构化错误（不静默空白）', async () => {
    setBridge({ prepareMcpApp: () => Promise.resolve({ ok: false, code: 'resource-read-failed', message: 'server 未连接' }) });
    render(<McpAppCard app={app} />);
    const alert = await waitFor(() => {
      const el = document.querySelector('[data-testid="mcp-app-error"]');
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    expect(alert.textContent).toContain('server 未连接');
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('页面内 petri/mcp-app/call-tool RPC 经 sessionId 中继并回结果', async () => {
    setBridge();
    const { container } = render(<McpAppCard app={app} />);
    const frame = await waitFor(() => {
      const el = container.querySelector('iframe');
      expect(el).not.toBeNull();
      return el as HTMLIFrameElement;
    });
    const postSpy = vi.spyOn(frame.contentWindow as Window, 'postMessage');
    await act(async () => {
      const event = new MessageEvent('message', {
        data: {
          type: 'petri-gen-ui-rpc', id: 7, method: 'petri/mcp-app/call-tool',
          params: { toolName: 'ping', args: { value: 1 } },
        },
      });
      Object.defineProperty(event, 'origin', { value: 'petri-genui://gen-test123' });
      Object.defineProperty(event, 'source', { value: frame.contentWindow });
      window.dispatchEvent(event);
      await Promise.resolve();
    });
    expect(callMcpAppTool).toHaveBeenCalledWith({
      sessionId: 'gen-test123', toolName: 'ping', args: { value: 1 },
    });
    await waitFor(() => {
      expect(postSpy).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'petri-gen-ui-rpc-result', id: 7, ok: true }),
        'petri-genui://gen-test123',
      );
    });
  });

  it('伪造 origin 的 RPC 不处理（沙箱隔离不失效）', async () => {
    setBridge();
    const { container } = render(<McpAppCard app={app} />);
    const frame = await waitFor(() => {
      const el = container.querySelector('iframe');
      expect(el).not.toBeNull();
      return el as HTMLIFrameElement;
    });
    await act(async () => {
      const event = new MessageEvent('message', {
        data: { type: 'petri-gen-ui-rpc', id: 8, method: 'petri/mcp-app/call-tool', params: { toolName: 'ping' } },
      });
      Object.defineProperty(event, 'origin', { value: 'https://evil.example' });
      Object.defineProperty(event, 'source', { value: frame.contentWindow });
      window.dispatchEvent(event);
      await Promise.resolve();
    });
    expect(callMcpAppTool).not.toHaveBeenCalled();
  });
});
