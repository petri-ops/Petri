// M1-1 后端就绪感知层 — 全局 Context + 5s 轮询
// 挂在 App 根，下游用 useBackendStatus() 消费。
// r-server 不通时由 BackendDownBanner 显示降级提示。
import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import type { BackendStatus } from '@/lib/electron';

// 初始态：检测中
const INITIAL_STATUS: BackendStatus = {
  rRuntime: false,
  pyRuntime: false,
  rServerUp: false,
  pyServerUp: false,
  plumberUp: false,
  isReady: false,
  downReason: '',
};

const Ctx = createContext<BackendStatus>(INITIAL_STATUS);

export function useBackendStatus(): BackendStatus {
  return useContext(Ctx);
}

export function BackendStatusProvider({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  const [status, setStatus] = useState<BackendStatus>(INITIAL_STATUS);

  const tick = useCallback(async () => {
    try {
      const s = await window.biof3Desktop?.backend?.status();
      if (s) setStatus(s);
    } catch {
      // IPC 失败时保持上次状态，不闪烁
    }
  }, []);

  useEffect(() => {
    let alive = true;
    const safeTick = async () => {
      try {
        const s = await window.biof3Desktop?.backend?.status();
        if (alive && s) setStatus(s);
      } catch {
        // 忽略
      }
    };
    safeTick();
    const id = setInterval(safeTick, 5000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  return <Ctx.Provider value={status}>{children}</Ctx.Provider>;
}
