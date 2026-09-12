import React, { useCallback, useEffect, useState } from 'react';
import { getPlatformApiPrefix, getToken } from '@/lib/authClient';

interface MobileDevice {
  id: string;
  name: string;
  createdAt: string;
  lastSeenAt: string;
  revoked: boolean;
}

interface MobileStatus {
  ok: boolean;
  enabled: boolean;
  port: number;
  restartHint: string;
  lanAddresses: string[];
  activeDevices: number;
  devices: MobileDevice[];
  pairingPending: number;
}

interface PairingInfo {
  token: string;
  expiresAt: number;
  urls: string[];
  primaryUrl: string;
}

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

/**
 * UI-354 · 手机远程面板本体（设置区与顶栏弹层共用）。
 * 移动面本体是 mobile-gateway 独立实例（默认关闭）；本面板负责
 * 开关（重启生效，诚实提示）/ 配对二维码（服务端渲染 SVG）/ 设备吊销。
 */
export function MobileSyncPanel(): React.ReactElement {
  const [status, setStatus] = useState<MobileStatus | null>(null);
  const [pairing, setPairing] = useState<PairingInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`${getPlatformApiPrefix()}/mobile/status`, { headers: authHeaders() });
      const data = await response.json();
      if (data.ok) {
        setStatus(data);
        setError(null);
      }
    } catch {
      setError('无法读取手机远程状态');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // 配对码有效期到点自动清场（一次性 + 5 分钟 TTL 在后端强制）。
  useEffect(() => {
    if (!pairing) return;
    const wait = Math.max(0, pairing.expiresAt - Date.now());
    const timer = window.setTimeout(() => setPairing(null), wait);
    return () => window.clearTimeout(timer);
  }, [pairing]);

  const toggleEnabled = useCallback(async () => {
    if (!status) return;
    setBusy(true);
    try {
      const response = await fetch(`${getPlatformApiPrefix()}/mobile/config`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ enabled: !status.enabled }),
      });
      const data = await response.json();
      if (data.ok) {
        setStatus((prev) => (prev ? { ...prev, enabled: data.config.enabled, port: data.config.port } : prev));
        setPairing(null);
      }
    } catch {
      setError('开关设置失败');
    } finally {
      setBusy(false);
    }
  }, [status]);

  const createPairing = useCallback(async () => {
    setBusy(true);
    try {
      const response = await fetch(`${getPlatformApiPrefix()}/mobile/pairing/token`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({}),
      });
      const data = await response.json();
      if (data.ok) setPairing(data);
    } catch {
      setError('配对码生成失败');
    } finally {
      setBusy(false);
    }
  }, []);

  const revokeDevice = useCallback(async (id: string) => {
    setBusy(true);
    try {
      await fetch(`${getPlatformApiPrefix()}/mobile/devices/${encodeURIComponent(id)}/revoke`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({}),
      });
      await refresh();
    } catch {
      setError('吊销失败');
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  return (
    <div data-testid="mobile-sync-panel">
      <p className="gewu-field__hint">
        手机扫码后用浏览器直达本机工作区（同 WiFi）。默认关闭，内容只在你的局域网内传输。
        {status ? ` 端口 ${status.port}。` : ''}
      </p>

      {error && <p className="gewu-field__hint" role="alert">{error}</p>}

      {status && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button type="button" disabled={busy} onClick={toggleEnabled}>
            {status.enabled ? '关闭手机远程' : '开启手机远程'}
          </button>
          {status.enabled && (
            <button type="button" disabled={busy} onClick={createPairing}>
              生成配对二维码
            </button>
          )}
          <span className="gewu-field__hint">
            {status.enabled
              ? `已启用 · 在线设备 ${status.activeDevices}`
              : '未启用（开启后需重启桌面端生效）'}
          </span>
        </div>
      )}

      {pairing && (
        <div style={{ marginTop: 10 }}>
          <img
            src={`${getPlatformApiPrefix()}/mobile/pairing/qr.svg?token=${encodeURIComponent(pairing.token)}`}
            alt="手机配对二维码"
            width={180}
            height={180}
            style={{ display: 'block', borderRadius: 8, border: '1px solid var(--gewu-line, #2a303b)' }}
          />
          <p className="gewu-field__hint">一次性配对码，5 分钟内有效、仅可使用一次。手机相机扫码打开移动页。</p>
          <code className="gewu-field__hint">{pairing.primaryUrl}</code>
        </div>
      )}

      {status && status.devices.length > 0 && (
        <ul style={{ listStyle: 'none', margin: '10px 0 0', padding: 0 }}>
          {status.devices.map((device) => (
            <li key={device.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '4px 0' }}>
              <span className="gewu-field__hint">
                {device.name}
                {device.revoked ? '（已吊销）' : ''}
                {' · 最近活跃 '}
                {new Date(device.lastSeenAt).toLocaleString()}
              </span>
              {!device.revoked && (
                <button type="button" disabled={busy} onClick={() => { void revokeDevice(device.id); }}>
                  吊销
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** 设置区壳（「计算与数据」分区内的「手机远程」小节标题 + 面板）。 */
export function MobileSync(): React.ReactElement {
  return (
    <div>
      <h4>手机远程</h4>
      <MobileSyncPanel />
    </div>
  );
}
