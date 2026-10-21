/**
 * DesktopShellProvider — BLOCK-223 桌面外壳渲染侧宿主（通知偏好 / 退出摘要）。
 *
 * 职责：
 *  - 读 `/api/user/prefs` 的两项桌面偏好（真值在服务端，localStorage 不参与），
 *    变更时写回服务端并把镜像推给主进程（主进程只持镜像，不读磁盘）；
 *  - 订阅主进程的 `app:quit-requested`，挂出退出摘要弹窗；
 *  - 订阅通知点击（当前只广播 DOM 事件，供后续会话跳转消费）。
 *
 * 数量与文案由主进程单源产出（rows），渲染侧不维护第二份标签表。
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { getBridge } from '@/lib/desktopBridge';
import { getPlatformApiPrefix, getToken } from '@/lib/authClient';
import { normalizeQuietHours } from '@/lib/quiet-hours';
import { QuitSummaryDialog, type QuitDecision, type QuitSummaryRequest } from './QuitSummaryDialog';

export interface ShellPrefs {
  closeToTray: boolean;
  notifyOnTurnEnd: boolean;
  /** BLOCK-226 — 免打扰时段（空=关闭；HH:MM-HH:MM，支持跨午夜）。 */
  quietHours: string;
}

const DEFAULT_SHELL_PREFS: ShellPrefs = Object.freeze({
  closeToTray: false,
  notifyOnTurnEnd: true,
  quietHours: '',
});

/** 服务端 prefs 对象 → 桌面偏好（缺省语义与注册表一致）。 */
export function normalizeShellPrefs(raw: unknown): ShellPrefs {
  const source = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    closeToTray: source.closeToTray === true,
    notifyOnTurnEnd: source.notifyOnTurnEnd !== false,
    quietHours: normalizeQuietHours(source.quietHours),
  };
}

interface DesktopShellContextValue {
  prefs: ShellPrefs;
  updatePref: (patch: Partial<ShellPrefs>) => Promise<void>;
  syncError: string | null;
  bridgeAvailable: boolean;
  quitRequest: QuitSummaryRequest | null;
  respondQuit: (action: QuitDecision) => Promise<void>;
}

const DesktopShellContext = createContext<DesktopShellContextValue | null>(null);

export function useDesktopShellContext(): DesktopShellContextValue | null {
  return useContext(DesktopShellContext);
}

function prefsUrl(): string {
  return `${getPlatformApiPrefix()}/user/prefs`;
}

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

export function DesktopShellProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const bridge = getBridge('app');
  const bridgeAvailable = Boolean(bridge && typeof bridge.setShellPrefs === 'function');
  const [prefs, setPrefs] = useState<ShellPrefs>(DEFAULT_SHELL_PREFS);
  const [loaded, setLoaded] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [quitRequest, setQuitRequest] = useState<QuitSummaryRequest | null>(null);
  const [quitError, setQuitError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(prefsUrl(), { headers: authHeaders() });
        if (response.ok) {
          const body: unknown = await response.json();
          const rawPrefs = body && typeof body === 'object'
            ? (body as Record<string, unknown>).prefs
            : null;
          if (!cancelled) setPrefs(normalizeShellPrefs(rawPrefs));
        }
      } catch {
        // 读失败保持默认值；主进程镜像用默认值，不阻塞界面。
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!loaded || !bridgeAvailable) return;
    void bridge?.setShellPrefs(prefs);
  }, [bridge, bridgeAvailable, loaded, prefs]);

  useEffect(() => {
    if (!bridgeAvailable || typeof bridge?.onQuitRequested !== 'function') return undefined;
    return bridge.onQuitRequested((payload) => {
      setQuitError(null);
      setQuitRequest(payload);
    });
  }, [bridge, bridgeAvailable]);

  useEffect(() => {
    if (!bridgeAvailable || typeof bridge?.onNotificationClicked !== 'function') return undefined;
    return bridge.onNotificationClicked((payload) => {
      try {
        window.dispatchEvent(new CustomEvent('petri:notification-clicked', { detail: payload }));
      } catch {}
    });
  }, [bridge, bridgeAvailable]);

  const updatePref = useCallback(async (patch: Partial<ShellPrefs>) => {
    setPrefs((prev) => ({ ...prev, ...patch }));
    setSyncError(null);
    try {
      const response = await fetch(prefsUrl(), {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify(patch),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
    } catch {
      setSyncError('本机已生效，但未能同步到服务端；服务端偏好读取失败时可能回落默认值。');
    }
  }, []);

  const respondQuit = useCallback(async (action: QuitDecision) => {
    if (action === 'cancel') {
      setQuitRequest(null);
      setQuitError(null);
      try { await bridge?.respondQuitDecision('cancel'); } catch {}
      return;
    }
    if (action === 'tray') {
      try {
        const result = await bridge?.respondQuitDecision('tray');
        if (result && result.ok === false) {
          setQuitError('托盘不可用，未能最小化。可以取消后继续工作，或停止并退出。');
          return;
        }
        setQuitRequest(null);
        setQuitError(null);
      } catch {
        setQuitError('最小化失败，请重试或选择停止并退出。');
      }
      return;
    }
    setQuitRequest(null);
    setQuitError(null);
    try { await bridge?.respondQuitDecision('quit'); } catch {}
  }, [bridge]);

  const value = useMemo<DesktopShellContextValue>(() => ({
    prefs,
    updatePref,
    syncError,
    bridgeAvailable,
    quitRequest,
    respondQuit,
  }), [prefs, updatePref, syncError, bridgeAvailable, quitRequest, respondQuit]);

  return (
    <DesktopShellContext.Provider value={value}>
      {children}
      <QuitSummaryDialog
        request={quitRequest}
        error={quitError}
        onDecision={(action) => { void respondQuit(action); }}
      />
    </DesktopShellContext.Provider>
  );
}
