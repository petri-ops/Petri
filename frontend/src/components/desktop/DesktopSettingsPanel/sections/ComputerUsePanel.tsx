/**
 * ComputerUsePanel — BLOCK-229 E7 电脑控制 sidecar 状态面。
 *
 * 只读状态 + 显式「测试连接」（真实 probe）。不做任何点击/输入；
 * 控制动作仍由 computer_* 工具在完全访问档 + ackToken 两段确认下执行。
 */

import React, { useCallback, useEffect, useState } from 'react';
import { getPlatformApiPrefix, getToken } from '@/lib/authClient';

interface ComputerUseStatus {
  supported: boolean;
  built: boolean;
  running: boolean;
  platform: string;
  permissionNote?: string;
  binaryPath?: string;
}

function headers(): Record<string, string> {
  const out: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) out.Authorization = `Bearer ${token}`;
  return out;
}

function flag(value: boolean): string {
  return value ? '是' : '否';
}

export function ComputerUsePanel(): React.ReactElement {
  const [status, setStatus] = useState<ComputerUseStatus | null>(null);
  const [probe, setProbe] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(`${getPlatformApiPrefix()}/computer-use/status`, { headers: headers() });
        const body: unknown = await response.json();
        if (!cancelled && response.ok && body && typeof body === 'object' && (body as { ok?: boolean }).ok) {
          setStatus(body as ComputerUseStatus);
        }
      } catch {
        // 状态读取失败保持空态，不阻塞设置页。
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const test = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`${getPlatformApiPrefix()}/computer-use/probe`, {
        method: 'POST',
        headers: headers(),
      });
      const body: unknown = await response.json();
      const record = body && typeof body === 'object' ? body as Record<string, unknown> : {};
      if (!response.ok || record.ok !== true) {
        setProbe(null);
        const message = typeof record.message === 'string'
          ? record.message
          : typeof record.error === 'string'
            ? record.error
            : `HTTP ${response.status}`;
        setError(message);
      } else {
        setProbe(record.probe as Record<string, unknown> || null);
        setStatus((current) => (current ? { ...current, running: true } : current));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '测试连接失败');
    } finally {
      setBusy(false);
    }
  }, []);

  // BLOCK-264（C-38）— 画中画：置顶小窗实时看自动化过程（会话级隐藏可再开）
  const openPip = useCallback(async () => {
    setBusy(true);
    try {
      const { getBridge } = await import('@/lib/desktopBridge');
      const bridge = getBridge('app');
      if (bridge && typeof bridge.openComputerUsePip === 'function') {
        await bridge.openComputerUsePip();
      } else {
        setError('画中画仅在桌面端可用');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '画中画打开失败');
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <div className="petri-field" data-testid="computer-use-panel">
      <label className="petri-field__label">电脑控制（sidecar）</label>
      {status ? (
        <>
          <p className="petri-field__hint" data-testid="computer-use-status">
            平台 {status.platform} · 支持 {flag(status.supported)} · 已构建 {flag(status.built)} · 运行中 {flag(status.running)}
          </p>
          <p className="petri-field__hint">{status.permissionNote}</p>
        </>
      ) : (
        <p className="petri-field__hint">状态读取中…</p>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button type="button" className="petri-btn petri-btn--ghost petri-btn--sm" disabled={busy} onClick={() => void test()}>
          {busy ? '测试中…' : '测试连接'}
        </button>
        <button type="button" className="petri-btn petri-btn--ghost petri-btn--sm" disabled={busy} onClick={() => void openPip()} data-testid="computer-use-pip-open">
          画中画
        </button>
        {probe && (
          <span className="petri-field__hint" data-testid="computer-use-probe">
            probe 通过：{Array.isArray(probe.verbs) ? (probe.verbs as string[]).join(' / ') : 'ok'}
          </span>
        )}
      </div>
      {error && <p className="petri-field__hint" role="alert" data-testid="computer-use-error">{error}</p>}
      <p className="petri-field__hint">控制类工具需「完全访问」档并通过确认 token；本面板不会执行点击或输入。</p>
    </div>
  );
}
