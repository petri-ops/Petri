// BLOCK-447 — 工具结果里的 MCP App 描述驱动自动渲染
import { describe, expect, it } from 'vitest';
import { mergeToolResultActivity } from './toolActivity';
import type { ToolResultEvent } from './copilotClient/types';

function event(overrides: Record<string, unknown>): ToolResultEvent {
  return {
    name: 'mcp_tool',
    summary: 'ok',
    toolResult: {
      contractVersion: '1.0.0',
      callId: 'call_mcp_app',
      traceId: 'trace_mcp_app',
      status: 'success',
      ...overrides,
    },
  } as unknown as ToolResultEvent;
}

describe('mergeToolResultActivity · MCP App 描述', () => {
  it('data.ui 携带 serverId/uri 时挂到活动项（自动渲染入口）', () => {
    const [item] = mergeToolResultActivity([], event({
      data: { ui: { serverId: 'demo-server', uri: 'ui://demo/panel.html' } },
    }));
    expect(item.mcpApp).toEqual({ serverId: 'demo-server', uri: 'ui://demo/panel.html' });
  });

  it('顶层 ui 也兼容；缺字段不挂（fail-closed 不误渲染）', () => {
    const [ok] = mergeToolResultActivity([], event({
      ui: { serverId: 's2', uri: 'ui://other/panel.html' },
    }));
    expect(ok.mcpApp).toEqual({ serverId: 's2', uri: 'ui://other/panel.html' });
    const [missing] = mergeToolResultActivity([], event({
      ui: { serverId: 's2' },
    }));
    expect(missing.mcpApp).toBeUndefined();
    const [plain] = mergeToolResultActivity([], event({ data: { text: 'plain' } }));
    expect(plain.mcpApp).toBeUndefined();
  });
});
