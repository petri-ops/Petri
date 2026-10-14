/**
 * BLOCK-183 P1 — 投影数据桥 WS-first 传输契约。
 *
 * 契约：
 *  ① WS 优先：白名单读路径走共享单连接 data 信封，成功时 fetch 零调用；
 *     data-res 解包 {status,data} 与 HTTP getJson 返回形状一致。
 *  ② 传输失败逐请求回退 HTTP：WS 建连/请求失败 → getJson 落回既有 fetch，行为不变。
 *  ③ 传输级连续 3 次失败 → 5min 冷却直走 HTTP（对齐 agentTaskStream 形态），到期恢复尝试。
 *  ④ 断线清 pending：连接关闭时在途请求全部 reject（调用方回退 HTTP），下一条请求重建连接。
 *  ⑤ 业务 data-err（如 path_not_allowed）reject 但不计入传输失败连击。
 *  ⑥ 白名单镜像：非白名单路径不发 WS 帧，直接走 HTTP。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/projectionLink', () => ({
  isProjectionEnv: () =>
    typeof document !== 'undefined'
    && document.documentElement.getAttribute('data-projection') === '1',
  markProjectionBridgeFailure: vi.fn(),
  markProjectionBridgeSuccess: vi.fn(),
}));

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static failMode = false;
  static reset() {
    FakeWebSocket.instances = [];
    FakeWebSocket.failMode = false;
  }

  url: string;
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
    if (FakeWebSocket.failMode) {
      queueMicrotask(() => {
        this.onerror?.();
        this.onclose?.();
      });
    } else {
      queueMicrotask(() => {
        this.readyState = 1;
        this.onopen?.();
      });
    }
  }

  serverSend(obj: unknown) {
    this.onmessage?.({ data: JSON.stringify(obj) });
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.readyState = 3;
    this.onclose?.();
  }
}

const projectionOn = () => document.documentElement.setAttribute('data-projection', '1');

/** 从 FakeWebSocket 取出模块发出的 data 请求帧（最近一条）。 */
function lastDataRequest(ws: FakeWebSocket): { t: string; id: string; url: string } {
  return JSON.parse(ws.sent[ws.sent.length - 1]) as { t: string; id: string; url: string };
}

async function freshModule() {
  vi.resetModules();
  return import('./projectionWsData');
}

describe('projectionWsData WS-first（投影数据桥）', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    FakeWebSocket.reset();
    projectionOn();
    (globalThis as { WebSocket: unknown }).WebSocket = FakeWebSocket;
  });

  afterEach(() => {
    document.documentElement.removeAttribute('data-projection');
    vi.useRealTimers();
  });

  it('① WS 优先：data-res 解包 {status,data}，fetch 零调用', async () => {
    const { wsDataRequest, wsDataAvailable } = await freshModule();
    expect(wsDataAvailable()).toBe(true);
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('WS 成功时不应走 HTTP');
    });
    const pending = wsDataRequest('/api/runtime/status');
    await vi.waitFor(() => expect(FakeWebSocket.instances.length).toBe(1));
    const ws = FakeWebSocket.instances[0];
    await vi.waitFor(() => expect(ws.sent.length).toBe(1));
    expect(ws.url).toContain('/m/api/ws');
    const frame = lastDataRequest(ws);
    expect(frame.t).toBe('data');
    expect(frame.url).toBe('/api/runtime/status');
    ws.serverSend({ t: 'data-res', id: frame.id, status: 200, data: { ok: true, runtime: { r: { installed: true } } } });
    await expect(pending).resolves.toEqual({ status: 200, data: { ok: true, runtime: { r: { installed: true } } } });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('② 传输失败逐请求回退 HTTP：getJson WS 失败落回 fetch，形状不变', async () => {
    FakeWebSocket.failMode = true;
    vi.resetModules();
    const bridges = await import('./projectionDataBridges');
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({ ok: true, status: 'ok', settings: { theme: 'dark' } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ));
    const settings = await bridges.getProjectionAiSettingsBridge().get();
    // FakeWebSocket.failMode=true：WS 三连失败后冷却，本请求由 HTTP 兜底返回
    expect(settings).toEqual({ theme: 'dark' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0] as string)).toBe('/api/ai/settings');
  });

  it('③ 传输级 3 连失败 → 5min 冷却直走 HTTP，到期恢复尝试', async () => {
    vi.useFakeTimers();
    const { wsDataRequest, wsDataAvailable } = await freshModule();
    FakeWebSocket.failMode = true;
    expect(wsDataAvailable()).toBe(true);
    for (let i = 0; i < 3; i += 1) {
      await expect(wsDataRequest('/api/runtime/status')).rejects.toThrow();
    }
    expect(wsDataAvailable()).toBe(false);
    await expect(wsDataRequest('/api/runtime/status')).rejects.toThrow('ws_unavailable');
    expect(FakeWebSocket.instances.length).toBe(3);
    // 冷却期内不再建连；5 分钟后恢复
    vi.advanceTimersByTime(5 * 60 * 1000);
    expect(wsDataAvailable()).toBe(true);
    FakeWebSocket.failMode = false;
    const pending = wsDataRequest('/api/runtime/status');
    await vi.advanceTimersByTimeAsync(0);
    await vi.waitFor(() => expect(FakeWebSocket.instances.length).toBe(4));
    const ws = FakeWebSocket.instances[3];
    await vi.waitFor(() => expect(ws.sent.length).toBe(1));
    const frame = lastDataRequest(ws);
    ws.serverSend({ t: 'data-res', id: frame.id, status: 200, data: { ok: true } });
    await expect(pending).resolves.toEqual({ status: 200, data: { ok: true } });
  });

  it('④ 断线清 pending：在途请求 reject，下一条请求重建连接', async () => {
    const { wsDataRequest } = await freshModule();
    const pending = wsDataRequest('/api/runtime/status');
    await vi.waitFor(() => expect(FakeWebSocket.instances[0]?.readyState).toBe(1));
    const ws1 = FakeWebSocket.instances[0];
    await vi.waitFor(() => expect(ws1.sent.length).toBe(1));
    ws1.close(); // 建连后断线：在途请求 reject
    await expect(pending).rejects.toThrow();
    FakeWebSocket.failMode = false;
    const pending2 = wsDataRequest('/api/skills/registry');
    await vi.waitFor(() => expect(FakeWebSocket.instances.length).toBe(2));
    const ws2 = FakeWebSocket.instances[1];
    await vi.waitFor(() => expect(ws2.sent.length).toBe(1));
    const frame = lastDataRequest(ws2);
    expect(frame.url).toBe('/api/skills/registry');
    ws2.serverSend({ t: 'data-res', id: frame.id, status: 200, data: { ok: true, skills: [] } });
    await expect(pending2).resolves.toEqual({ status: 200, data: { ok: true, skills: [] } });
  });

  it('⑤ 业务 data-err reject 不计入传输连击（不触发冷却）', async () => {
    const { wsDataRequest, wsDataAvailable } = await freshModule();
    for (let i = 0; i < 5; i += 1) {
      const pending = wsDataRequest('/api/runtime/status');
      await vi.waitFor(() => expect(FakeWebSocket.instances[i]?.sent.length).toBe(1));
      const ws = FakeWebSocket.instances[i];
      const frame = lastDataRequest(ws);
      ws.serverSend({ t: 'data-err', id: frame.id, error: 'data_timeout' });
      await expect(pending).rejects.toThrow('data_timeout');
    }
    expect(wsDataAvailable(), '业务错不应累计传输失败连击').toBe(true);
  });

  it('⑥ 白名单镜像：非白名单路径不发 WS 帧直接拒绝（走 HTTP），写路径 POST 不在面内', async () => {
    const { wsDataRequest } = await freshModule();
    await expect(wsDataRequest('/api/sessions')).rejects.toThrow('path_not_allowed');
    await expect(wsDataRequest('/api/runtime/status?verbose=1')).rejects.toThrow('path_not_allowed');
    expect(FakeWebSocket.instances.length).toBe(0);
  });
});
