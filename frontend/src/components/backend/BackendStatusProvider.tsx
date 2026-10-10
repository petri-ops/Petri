// M1-1 后端就绪感知层 — 全局 Context + 5s 轮询
// 挂在 App 根，下游用 useBackendStatus() 消费。
// petri-server 不通时由摘要概览显示降级提示。
//
// （BLOCK-30 P2：曾有的 Gateway 健康聚合随 gateway 摘除）
import React, { createContext, useContext, useEffect, useState } from 'react';
import type { BackendStatus } from '@/lib/electron';
import { getPlatformApiPrefix } from '@/lib/env';
import { getToken } from '@/lib/authClient';

// 增强的后端状态类型（BLOCK-30 P2：gateway 字段随 gateway 摘除，回归 BackendStatus 本体）
export type EnhancedBackendStatus = BackendStatus;

// 初始态：检测中
const INITIAL_STATUS: EnhancedBackendStatus = {
  rRuntime: false,
  pyRuntime: false,
  rServerUp: false,
  serverUp: false,
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

// /api/runtime/status 响应形状（与投影桥 projectionDataBridges.runtimeBridge 同源）。
export interface RuntimeStatusPayload {
  ok?: boolean;
  runtime?: {
    r?: { installed?: boolean };
    python?: { installed?: boolean };
  };
}

/** 把 /api/runtime/status 载荷 + health 探测结果映射为 BackendStatus。
 *  诚实语义：installed 只有 true/false 两种回答；载荷不可达 = null（未知），
 *  消费端（useRuntimeDemandBanner 等）以 `=== false` 判缺失，未知不弹横幅。 */
export function mapRuntimeStatusPayload(
  payload: RuntimeStatusPayload | null,
  serverUp: boolean,
): EnhancedBackendStatus {
  const rInstalled = payload?.runtime?.r?.installed;
  const pyInstalled = payload?.runtime?.python?.installed;
  return {
    rRuntime: typeof rInstalled === 'boolean' ? rInstalled : null,
    pyRuntime: typeof pyInstalled === 'boolean' ? pyInstalled : null,
    rServerUp: serverUp,
    serverUp,
    isReady: serverUp,
    downReason: serverUp ? null : '本地分析服务尚未就绪',
    loaded: true,
  };
}

async function fetchRuntimeStatus(base: string): Promise<RuntimeStatusPayload | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 3000);
  try {
    const headers: Record<string, string> = {};
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    const response = await fetch(`${base}/runtime/status`, { headers, signal: controller.signal });
    return (await response.json()) as RuntimeStatusPayload;
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function readBackendStatus(): Promise<EnhancedBackendStatus | null> {
  const desktopStatus = await window.petriDesktop?.backend?.status();
  if (desktopStatus) {
    return { ...desktopStatus };
  }
  // Vite's renderer-only development mode has no preload bridge（含投影：手机
  // 浏览器里 shim 调用 resolve undefined，走此分支）。经平台前缀打 REST——
  // 投影 = /api（gateway 同源），桌面 dev renderer = http://localhost:3001/api。
  // packaged builds never use this.
  if (!import.meta.env.DEV) return null;
  // UI-406 修复：曾把 health 探测结果当作 rRuntime、pyRuntime 写死 false
  //（BLOCK-30 P1 py-server 摘除后的遗产）——手机投影里 127.0.0.1 探针恒不通，
  // 工作台假弹「R 与 Python 运行时均未安装」。现消费 /api/runtime/status
  //（BLOCK-86 权威探测，与桌面 IPC backend:status 同源真相）。
  const base = getPlatformApiPrefix();
  const [serverUp, payload] = await Promise.all([
    probeHealth(`${base}/health`),
    fetchRuntimeStatus(base),
  ]);
  return mapRuntimeStatusPayload(payload, serverUp);
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
        if (alive) timeoutId = setTimeout(() => void safeTick(), nextDelay);
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
