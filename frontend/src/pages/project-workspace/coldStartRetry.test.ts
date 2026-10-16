import { describe, expect, it, vi } from 'vitest';
import { retryOnThrow, type RetryOutcome } from './coldStartRetry';

// BLOCK-185 冷启动退避重试原语回归锚：把「抛错才续跑、成功/不存在即停、取消即停」
// 钉成机械门禁（冷启动 fetch 竞态复发类，welcome.tsx UI-373/UI-369 同族）。
// 注：attempt mock 用 Promise.resolve/reject 而非 async（retryOnThrow 契约要 Promise，
// 但无 await 的 async 触发 require-await lint）。
describe('retryOnThrow (BLOCK-185 冷启动退避)', () => {
  it('首次成功即返回，不重试', async () => {
    const attempt = vi.fn((): Promise<RetryOutcome<number>> =>
      Promise.resolve({ status: 'resolved', value: 42 }));
    const out = await retryOnThrow(attempt, { delaysMs: [0, 10, 20] });
    expect(out).toEqual({ status: 'resolved', value: 42 });
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it('前两次抛错（后端未就绪）第三次成功 → 续跑后返回 resolved', async () => {
    let n = 0;
    const attempt = vi.fn((): Promise<RetryOutcome<string>> => {
      n += 1;
      if (n < 3) return Promise.reject(new Error('ECONNREFUSED'));
      return Promise.resolve({ status: 'resolved', value: 'ok' });
    });
    const out = await retryOnThrow(attempt, { delaysMs: [0, 1, 1] });
    expect(out).toEqual({ status: 'resolved', value: 'ok' });
    expect(attempt).toHaveBeenCalledTimes(3);
  });

  it('not-found（取回但确认不存在）即刻停，不再退避重试', async () => {
    const attempt = vi.fn((): Promise<RetryOutcome<null>> =>
      Promise.resolve({ status: 'not-found' }));
    const out = await retryOnThrow(attempt, { delaysMs: [0, 10, 20, 40] });
    expect(out).toEqual({ status: 'not-found' });
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it('全程抛错 → 序列耗尽返回 exhausted', async () => {
    const attempt = vi.fn((): Promise<RetryOutcome<number>> => Promise.reject(new Error('down')));
    const out = await retryOnThrow(attempt, { delaysMs: [0, 1, 1] });
    expect(out).toEqual({ status: 'exhausted' });
    expect(attempt).toHaveBeenCalledTimes(3);
  });

  it('shouldContinue 返回 false（被后续请求取代）→ 立即中止', async () => {
    const attempt = vi.fn((): Promise<RetryOutcome<number>> =>
      Promise.resolve({ status: 'resolved', value: 1 }));
    const out = await retryOnThrow(attempt, { delaysMs: [0, 10], shouldContinue: () => false });
    expect(out).toEqual({ status: 'exhausted' });
    expect(attempt).not.toHaveBeenCalled();
  });

  it('退避等待后 isCancelled 置真（组件卸载）→ 中止不发起本轮', async () => {
    let cancelled = false;
    const attempt = vi.fn((): Promise<RetryOutcome<number>> => {
      cancelled = true;
      return Promise.reject(new Error('first throw to force a wait before next attempt'));
    });
    const out = await retryOnThrow(attempt, {
      delaysMs: [0, 5, 50],
      isCancelled: () => cancelled,
    });
    expect(out).toEqual({ status: 'exhausted' });
    // 第一次 attempt 抛错并置 cancelled；第二轮等待后 isCancelled 命中 → 不再调 attempt
    expect(attempt).toHaveBeenCalledTimes(1);
  });
});
