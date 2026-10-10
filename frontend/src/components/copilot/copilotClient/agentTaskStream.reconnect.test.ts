/**
 * BLOCK-159 P1-6 — agent 任务流水位续传重连契约。
 *
 * 旧实现 24 次/90s 硬预算：隧道长断烧窗后抛 AgentStreamDisconnectedError，
 * 会话被标「在完成前中断」——而服务端 DB 按 afterSeq 持久回放 + 前端单调 seq
 * 守卫已在，重试天然安全。契约：
 *  ①断线无限重试：两次网络失败后恢复，流内 [DONE] 正常收口（onDone 恰一次）；
 *  ②重连退避 1s 起指数、30s 封顶、±30% 抖动（attempt 高位延迟落在
 *    [21000, 39000] 窗）；attempt 递增持续上报 onStreamReconnecting；
 *  ③非水位错误（HTTP 5xx）不重试：直接上抛普通 Error；
 *  ④用户 abort 上抛 AbortError（不吞）。
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

function sseResponse(...frames: string[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const frame of frames) controller.enqueue(encoder.encode(frame));
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
}

const networkError = () => Promise.reject(new TypeError('fetch failed'));

describe('agentTaskStream 水位续传重连', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('①两次断线后恢复：重连按 lastSeq 续传并正常收口', async () => {
    let calls = 0;
    const reconnecting: Array<{ attempt: number; lastSeq: number; nextRetryMs: number }> = [];
    let doneCount = 0;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      calls += 1;
      if (calls <= 2) return networkError();
      return Promise.resolve(sseResponse('data: {"event":"done"}\n\n', 'data: [DONE]\n\n'));
    });

    await subscribeAgentTask('task-1', {
      kind: undefined,
      onDone: () => { doneCount += 1; },
      onStreamReconnecting: (info: { taskId: string; attempt: number; lastSeq: number; nextRetryMs: number }) => reconnecting.push(info),
    } as never);

    expect(calls).toBe(3);
    expect(reconnecting.map((r) => r.attempt)).toEqual([1, 2]);
    expect(reconnecting[0].nextRetryMs).toBeGreaterThanOrEqual(700); // 1s ±30%
    expect(reconnecting[0].nextRetryMs).toBeLessThanOrEqual(1300);
    expect(reconnecting[1].nextRetryMs).toBeGreaterThanOrEqual(1400); // 2s ±30%
    expect(reconnecting[1].nextRetryMs).toBeLessThanOrEqual(2600);
    expect(doneCount).toBe(1);
    fetchMock.mockRestore();
  });

  it('②持续断线：重试不设上限，退避 30s 封顶带抖动', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(networkError);
    const reconnecting: Array<{ attempt: number; nextRetryMs: number }> = [];
    const controller = new AbortController();

    const pending = subscribeAgentTask('task-2', {
      kind: undefined,
      signal: controller.signal,
      onStreamReconnecting: (info: { taskId: string; attempt: number; lastSeq: number; nextRetryMs: number }) => reconnecting.push(info),
    } as never).catch((err: unknown) => ({ aborted: (err as Error).name === 'AbortError' }));

    for (let i = 0; i < 8; i += 1) {
      await vi.advanceTimersByTimeAsync(60_000);
    }
    expect(reconnecting.length).toBeGreaterThanOrEqual(7);
    // onStreamReconnecting.attempt 是 1-based；attempt>=6 → 退避基数 2^5×1s=32s
    // 已触 30s 封顶 → 延迟必落在 [21000, 39000]（±30% 抖动窗）
    const capped = reconnecting.filter((r) => r.attempt >= 6);
    for (const r of capped) {
      expect(r.nextRetryMs).toBeGreaterThanOrEqual(21_000); // 30s -30%
      expect(r.nextRetryMs).toBeLessThanOrEqual(39_000); // 30s +30%
    }
    controller.abort();
    const outcome = await pending;
    expect((outcome as { aborted?: boolean }).aborted).toBe(true);
    fetchMock.mockRestore();
  });

  it('③HTTP 5xx 不重试：直接上抛普通 Error', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(
      () => Promise.resolve(new Response('backend exploded', { status: 500 }))
    );
    await expect(subscribeAgentTask('task-3', { kind: undefined } as never)).rejects.toThrow(
      /HTTP 500/
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockRestore();
  });

  it('④用户 abort：等待重连期被中止并上抛', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(networkError);
    const pending = subscribeAgentTask('task-4', {
      kind: undefined,
      signal: controller.signal,
    } as never);
    await vi.advanceTimersByTimeAsync(0); // 首次失败落定
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    fetchMock.mockRestore();
  });
});
