// M1-1 后端就绪感知层 — 全局 Context + 5s 轮询
// 挂在 App 根，下游用 useBackendStatus() 消费。
// r-server 不通时由摘要概览显示降级提示。
//
// Phase 3 增强：添加 Gateway (3002) 健康检查聚合
import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import type { BackendStatus } from '@/lib/electron';
import type { GatewayHealthStatus } from '@/lib/gateway-client';

// 增强的后端状态类型
export interface EnhancedBackendStatus extends BackendStatus {
  gatewayUp: boolean;
  gatewayHealth?: GatewayHealthStatus;
}

// 初始态：检测中
const INITIAL_STATUS: EnhancedBackendStatus = {
  rRuntime: false,
  pyRuntime: false,
  rServerUp: false,
  pyServerUp: false,
  plumberUp: false,
  isReady: false,
  downReason: '',
  loaded: false,
  gatewayUp: false,
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

async function probeGatewayHealth(): Promise<GatewayHealthStatus> {
  try {
    const response = await fetch('http://127.0.0.1:3005/health', {
      signal: AbortSignal.timeout(3000),
    });
    if (response.ok) {
      const data = await response.json();
      return {
        gateway: true,
        ...data,
      };
    }
    return { gateway: false, error: `HTTP ${response.status}` };
  } catch (e) {
    return {
      gateway: false,
      error: e instanceof Error ? e.message : 'Connection failed',
    };
  }
}

async function readBackendStatus(): Promise<EnhancedBackendStatus | null> {
  const desktopStatus = await window.biof3Desktop?.backend?.status();
  if (desktopStatus) {
    // 添加 Gateway 探测
    const gatewayHealth = await probeGatewayHealth();
    return {
      ...desktopStatus,
      gatewayUp: gatewayHealth.gateway,
      gatewayHealth,
    };
  }
  // Vite's renderer-only development mode has no preload bridge. Probe the
  // same local services so the real workspace UI remains available for visual
  // regression and accessibility acceptance; packaged builds never use this.
  if (!import.meta.env.DEV) return null;
  const [rServerUp, pyServerUp, gatewayUp] = await Promise.all([
    probeHealth('http://127.0.0.1:3001/api/health'),
    probeHealth('http://127.0.0.1:3004/api/health'),
    probeHealth('http://127.0.0.1:3005/health'),
  ]);
  const gatewayHealth = await probeGatewayHealth();
  return {
    rRuntime: rServerUp,
    pyRuntime: pyServerUp,
    rServerUp,
    pyServerUp,
    plumberUp: false,
    isReady: rServerUp,
    downReason: rServerUp ? null : '本地分析服务尚未就绪',
    loaded: true,
    gatewayUp,
    gatewayHealth,
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
