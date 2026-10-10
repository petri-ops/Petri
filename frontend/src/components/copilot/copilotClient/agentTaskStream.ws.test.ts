/**
 * BLOCK-162 P3 — agent 任务流 WS-first 传输契约（投影环境）。
 *
 * 契约：
 *  ①投影环境 WS 优先：/m/api/ws 单连接收 ev/done 帧，语义与 SSE 等价
 *    （onIter 分发 / onDone / emitAgentTaskDone），fetch 零调用；
 *  ②水位续传跨传输：WS 断开 → 重连 sub 带 lastSeq afterSeq（外层循环共用）；
 *  ③传输级连续 3 次失败 → 5min 冷却回退既有 SSE（防代理拦死 upgrade 死循环）；
 *  ④非投影环境（桌面）恒走 SSE——由既有 reconnect 测试覆盖，此处不重复。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { subscribeAgentTask } from './agentTaskStream';

vi.mock('./apiBase', () => ({
  emitAgentTaskDone: vi.fn(),
  getApiPrefix: () => '/api',
  getAuthHeader: () => ({}),
}));

vi.mock('@/lib/events', () => ({
  petriEvents: { tokenBudget: 'tokenBudget' },
  dispatchPetriEvent: vi.fn(),
}));

const encoder = new TextEncoder();

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
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
    if (FakeWebSocket.failMode) {
      queueMicrotask(() => this.onerror?.());
    } else {
      queueMicrotask(() => this.open());
    }
  }

  open() {
    this.readyState = 1;
    this.onopen?.();
  }

  serverSend(obj: unknown) {
    this.onmessage?.({ data: JSON.stringify(obj) });
  }

  fail() {
    this.onerror?.();
    this.onclose?.();
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    this.closed = true;
  }
}

const projectionOn = () => document.documentElement.setAttribute('data-projection', '1');

describe('agentTaskStream WS-first（投影环境）', () => {

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

  it('① WS 优先：ev/done 帧语义与 SSE 等价，fetch 零调用', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(() => { throw new Error('SSE 不该被走'); });
    const iters: number[] = [];
    let done = 0;
    const pending = subscribeAgentTask('task-ws', {
      kind: undefined,
      onIter: (n: number) => iters.push(n),
      onDone: () => { done += 1; },
    } as never);
    await vi.waitFor(() => expect(FakeWebSocket.instances[0]?.readyState).toBe(1));
    const ws = FakeWebSocket.instances[0];
    expect(ws.url).toContain('/m/api/ws');
    expect(JSON.parse(ws.sent[0])).toMatchObject({ t: 'sub', taskId: 'task-ws', afterSeq: 0 });
    ws.serverSend({ t: 'ev', taskId: 'task-ws', seq: 3, eventType: 'iter', payload: { event: 'iter', n: 7 } });
    ws.serverSend({ t: 'done', taskId: 'task-ws', status: 'done', filesChanged: [{ path: 'a', status: 'M' }] });
    await pending;
    expect(iters).toEqual([7]);
    expect(done).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('② 水位续传跨传输：WS 断开 → 重连 sub 带 lastSeq afterSeq', async () => {
    const pending = subscribeAgentTask('task-ws2', { kind: undefined } as never);
    await vi.waitFor(() => expect(FakeWebSocket.instances[0]?.readyState).toBe(1));
    const ws1 = FakeWebSocket.instances[0];
    ws1.serverSend({ t: 'ev', taskId: 'task-ws2', seq: 5, eventType: 'iter', payload: { event: 'iter', n: 1 } });
    ws1.fail(); // 传输断开（已收 seq=5）
    await vi.waitFor(() => expect(FakeWebSocket.instances.length).toBeGreaterThanOrEqual(2), { timeout: 4000 });
    const ws2 = FakeWebSocket.instances[1];
    await vi.waitFor(() => expect(ws2.sent.length).toBeGreaterThan(0), { timeout: 4000 });
    expect((JSON.parse(ws2.sent[0]) as { afterSeq?: number }).afterSeq).toBe(5);
    ws2.serverSend({ t: 'done', taskId: 'task-ws2', status: 'done' });
    await pending;
  });

  it('③ WS 连续 3 次失败 → 冷却回退 SSE（fetch 接管）', async () => {
    vi.resetModules();
    const { subscribeAgentTask: freshSubscribe } = await import('./agentTaskStream');
    vi.useFakeTimers();
    FakeWebSocket.failMode = true;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(() => Promise.resolve(new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        },
      }),
      { status: 200 }
    )));
    const pending = freshSubscribe('task-ws3', { kind: undefined } as never);
    await vi.advanceTimersByTimeAsync(30_000);
    await pending;
    expect(FakeWebSocket.instances.length).toBe(3);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
