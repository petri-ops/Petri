// ============================================================
// useInvalidationStream — CK-03（C-02 轮询→SSE 第一批）全局失效通知订阅。
//
// 语义：订阅 GET /api/events（失效信号通道，数据面零改动）。收到
// invalidate(domain) 后调用当前回调——消费方在自己的 effect 里把回调指向
// refresh 函数即可实现「事件驱动刷新 + 低频轮询兜底」。
//
// 实现形态：fetch + ReadableStream 手动解析 SSE（沿用 agent 任务流的
// desktop-local Authorization header 惯例——EventSource 无法携带自定义头）。
// 断线自动重连（指数退避 1s→8s 封顶）；卸载即中止。
// 诚实边界：重连窗口内的变更靠消费方的低频兜底轮询兜住。
// ============================================================
import { useEffect, useRef } from 'react';
import { getApiPrefix, getToken } from '@/lib/authClient';

export type InvalidationHandler = (info: { domain: string; at: string; payload?: Record<string, unknown> }) => void;

export function useInvalidationStream(enabled: boolean, handler: InvalidationHandler): void {
  // latest-ref：回调每渲染都换新（多为消费方 useCallback 的 refresh），流层用
  // ref 读取避免「回调变 → 重连」风暴。
  const handlerRef = useRef(handler);
  useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useEffect(() => {
    if (!enabled) return undefined;
    const controller = new AbortController();
    let stopped = false;
    let attempt = 0;
    let retryTimer: number | undefined;

    const connect = async (): Promise<void> => {
      while (!stopped) {
        try {
          const token = getToken();
          const resp = await fetch(getApiPrefix() + '/events', {
            headers: {
              Accept: 'text/event-stream',
              ...(token ? { Authorization: 'Bearer ' + token } : {}),
            },
            signal: controller.signal,
          });
          if (!resp.ok || !resp.body) throw new Error('events_http_' + resp.status);
          attempt = 0; // 连接成功：重置退避
          const reader = resp.body.getReader();
          const decoder = new TextDecoder();
          let buf = '';
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            let idx;
            while ((idx = buf.indexOf('\n\n')) !== -1) {
              const raw = buf.slice(0, idx);
              buf = buf.slice(idx + 2);
              for (const line of raw.split('\n')) {
                const m = line.match(/^data:\s?(.*)$/);
                if (!m || m[1] === '[DONE]') continue;
                try {
                  const obj = JSON.parse(m[1]) as { type?: string; domain?: string; at?: string };
                  if (obj.type === 'invalidate' && obj.domain) {
                    handlerRef.current({ domain: obj.domain, at: obj.at || '', payload: obj });
                  }
                } catch { /* 忽略坏帧 */ }
              }
            }
          }
          // 服务端关闭（部署重启等）→ 走重连
        } catch {
          if (controller.signal.aborted || stopped) return;
        }
        // 指数退避重连：1s → 2s → 4s → 8s 封顶
        attempt = Math.min(attempt + 1, 4);
        const delay = 1000 * Math.pow(2, attempt - 1);
        await new Promise<void>((resolve) => {
          retryTimer = window.setTimeout(resolve, delay);
        });
      }
    };

    void connect();
    return () => {
      stopped = true;
      if (retryTimer) window.clearTimeout(retryTimer);
      controller.abort();
    };
  }, [enabled]);
}
