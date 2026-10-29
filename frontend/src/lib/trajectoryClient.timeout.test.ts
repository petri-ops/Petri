import { describe, expect, it, vi } from 'vitest';
import { fetchTrajectory } from './trajectoryClient';

function hangingFetch(): typeof fetch {
  return vi.fn((_url: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new Error('request_aborted')), { once: true });
  }));
}

describe('trajectoryClient timeout (NEXT-02A)', () => {
  it('无响应会在有界时间内失败，不留下无限加载', async () => {
    await expect(fetchTrajectory({
      conversationId: 'conv_1',
      fetchImpl: hangingFetch(),
      timeoutMs: 10,
    })).rejects.toThrow('trajectory_timeout');
  });

  it('调用方主动取消不被误报为超时', async () => {
    const controller = new AbortController();
    const request = fetchTrajectory({
      conversationId: 'conv_1',
      fetchImpl: hangingFetch(),
      signal: controller.signal,
      timeoutMs: 10_000,
    });
    controller.abort();
    await expect(request).rejects.not.toThrow('trajectory_timeout');
  });
});
