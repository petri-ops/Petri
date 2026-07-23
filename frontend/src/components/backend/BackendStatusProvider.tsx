// M1-1 后端就绪感知层 — 全局 Context + 5s 轮询
// 挂在 App 根，下游用 useBackendStatus() 消费。
// r-server 不通时由摘要概览显示降级提示。
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

async function readBackendStatus(): Promise<BackendStatus | null> {
  const desktopStatus = await window.biof3Desktop?.backend?.status();
  if (desktopStatus) return desktopStatus;
  // Vite's renderer-only development mode has no preload bridge. Probe the
  // same local services so the real workspace UI remains available for visual
  // regression and accessibility acceptance; packaged builds never use this.
  if (!import.meta.env.DEV) return null;
  const [rServerUp, pyServerUp] = await Promise.all([
    fetch('http://127.0.0.1:3001/api/health').then((response) => response.ok).catch(() => false),
    fetch('http://127.0.0.1:3004/api/health').then((response) => response.ok).catch(() => false),
  ]);
  return {
    rRuntime: rServerUp,
    pyRuntime: pyServerUp,
    rServerUp,
    pyServerUp,
    plumberUp: false,
    isReady: rServerUp,
    downReason: rServerUp ? null : '本地分析服务尚未就绪',
  };
}

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
      const s = await readBackendStatus();
      if (s) setStatus(s);
    } catch {
      // IPC 失败时保持上次状态，不闪烁
    }
  }, []);

  useEffect(() => {
    let alive = true;
    const safeTick = async () => {
      try {
        const s = await readBackendStatus();
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
