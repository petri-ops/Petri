// M1-1 后端就绪感知层 — 全局 Context + 5s 轮询
// 挂在 App 根，下游用 useBackendStatus() 消费。
// biof3-server 不通时由摘要概览显示降级提示。
//
// （BLOCK-30 P2：曾有的 Gateway 健康聚合随 gateway 摘除）
import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import type { BackendStatus } from '@/lib/electron';

// 增强的后端状态类型（BLOCK-30 P2：gateway 字段随 gateway 摘除，回归 BackendStatus 本体）
export type EnhancedBackendStatus = BackendStatus;

// 初始态：检测中
const INITIAL_STATUS: EnhancedBackendStatus = {
  rRuntime: false,
  pyRuntime: false,
  rServerUp: false,
  isReady: false,
  downReason: '',
  loaded: false,
};

const Ctx = createContext<EnhancedBackendStatus>(INITIAL_STATUS);

async function probeHealth(url: string): Promise<boolean> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 2000);
  try {
    return await fetch(url, { signal: controller.signal }).then((response) => response.ok);
  } catch {
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function readBackendStatus(): Promise<EnhancedBackendStatus | null> {
  const desktopStatus = await window.biof3Desktop?.backend?.status();
  if (desktopStatus) {
    return { ...desktopStatus };
  }
  // Vite's renderer-only development mode has no preload bridge. Probe the
  // same local services so the real workspace UI remains available for visual
  // regression and accessibility acceptance; packaged builds never use this.
  if (!import.meta.env.DEV) return null;
  // BLOCK-30 P1: py-server HTTP 探针已摘除（Python 执行并入 biof3-server），
  // 渲染进程无从探测运行时安装态，pyRuntime 恒 false（仅视觉回归路径）。
  const rServerUp = await probeHealth('http://127.0.0.1:3001/api/health');
  return {
    rRuntime: rServerUp,
    pyRuntime: false,
    rServerUp,
    isReady: rServerUp,
    downReason: rServerUp ? null : '本地分析服务尚未就绪',
    loaded: true,
  };
}

export function useBackendStatus(): EnhancedBackendStatus {
  return useContext(Ctx);
}

export function BackendStatusProvider({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  const [status, setStatus] = useState<EnhancedBackendStatus>(INITIAL_STATUS);
  const [loaded, setLoaded] = useState(false);

  const tick = useCallback(async () => {
    try {
      const s = await readBackendStatus();
      if (s) {
        setStatus(s);
        setLoaded(true);
      }
    } catch {
      // IPC 失败时保持上次状态，不闪烁
    }
  }, []);

  useEffect(() => {
    let alive = true;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    // 启动期高频探测（1s）：后端双服务稳态 ~2.6s 就绪，高频能让 UI 尽快
    // 感知就绪、避免"后端已起但引导页还在转圈"的体感延迟；就绪后降频到
    // 5s 仅作健康保活，避免无谓 IPC 占用。
    const safeTick = async () => {
      let nextDelay = 1000;
      try {
        const s = await readBackendStatus();
        if (alive && s) {
          setStatus(s);
          setLoaded(true);
          nextDelay = s.isReady ? 5000 : 1000;
        }
      } catch {
        // 忽略
      } finally {
        if (alive) timeoutId = setTimeout(safeTick, nextDelay);
      }
    };
    void safeTick();
    return () => {
      alive = false;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, []);

  return <Ctx.Provider value={{ ...status, loaded }}>{children}</Ctx.Provider>;
}
