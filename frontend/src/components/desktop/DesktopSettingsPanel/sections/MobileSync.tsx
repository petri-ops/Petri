import React, { useCallback, useEffect, useRef, useState } from 'react';
import { getPlatformApiPrefix, getToken } from '@/lib/authClient';

// 配对码后端 TTL 5 分钟；面板按固定 4 分钟自动续码，保持「打开即可扫」。
const PAIRING_AUTO_REFRESH_MS = 4 * 60 * 1000;

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

interface TunnelStatus {
  configured: boolean;
  enabled: boolean;
  state: 'disabled' | 'connecting' | 'connected' | 'reconnecting';
  host: string;
  remotePort: number;
  localPort: number;
  publicUrl: string;
  lastError: string;
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
  const [tunnel, setTunnel] = useState<TunnelStatus | null>(null);
  const [tunnelHost, setTunnelHost] = useState('');
  const [tunnelPublicUrl, setTunnelPublicUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revokedExpanded, setRevokedExpanded] = useState(false);
  const statusRef = useRef<MobileStatus | null>(null);
  statusRef.current = status;

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
    try {
      const response = await fetch(`${getPlatformApiPrefix()}/mobile/tunnel`, { headers: authHeaders() });
      const data = await response.json();
      if (data.ok) {
        setTunnel(data.tunnel);
        setTunnelHost((prev) => prev || data.tunnel.host || '');
        setTunnelPublicUrl((prev) => prev || data.tunnel.publicUrl || '');
      }
    } catch {
      /* 隧道状态读取失败不阻塞主面板 */
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // 加映 4：面板打开且已启用 → 自动生成并常驻续码（不再要求手动点击）；
  // 卸载/停用即停。手动「重新生成」按钮保留为即时换码入口。
  useEffect(() => {
    if (!status?.enabled) return undefined;
    let cancelled = false;
    let timer: number | undefined;
    const generate = async () => {
      if (cancelled) return;
      try {
        const response = await fetch(`${getPlatformApiPrefix()}/mobile/pairing/token`, {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({}),
        });
        const data = await response.json();
        if (!cancelled && data.ok) setPairing(data);
      } catch {
        /* 静默：下一轮续码或手动重试 */
      }
      if (!cancelled) timer = window.setTimeout(generate, PAIRING_AUTO_REFRESH_MS);
    };
    void generate();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [status?.enabled]);

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

  // 加映 4：一键吊销全部活跃设备（逐个调用既有吊销端点，权限语义不变）。
  const revokeAllDevices = useCallback(async () => {
    const active = (statusRef.current?.devices ?? []).filter((device) => !device.revoked);
    if (active.length === 0) return;
    setBusy(true);
    try {
      for (const device of active) {
        await fetch(`${getPlatformApiPrefix()}/mobile/devices/${encodeURIComponent(device.id)}/revoke`, {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({}),
        });
      }
      await refresh();
    } catch {
      setError('批量吊销失败');
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  // P3 — 反向隧道配置保存（enabled 切换 + host/publicUrl 编辑）。
  const saveTunnel = useCallback(async (patch: { enabled?: boolean }) => {
    setBusy(true);
    try {
      const response = await fetch(`${getPlatformApiPrefix()}/mobile/tunnel/config`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          ...patch,
          host: tunnelHost.trim(),
          publicUrl: tunnelPublicUrl.trim(),
        }),
      });
      const data = await response.json();
      if (data.ok) {
        setTunnel(data.tunnel);
        setTunnelHost(data.tunnel.host || '');
        setTunnelPublicUrl(data.tunnel.publicUrl || '');
        await refresh();
      } else {
        setError(data.message || '隧道配置保存失败');
      }
    } catch {
      setError('隧道配置保存失败');
    } finally {
      setBusy(false);
    }
  }, [tunnelHost, tunnelPublicUrl, refresh]);

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
              重新生成配对码
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
            data-testid="mobile-pairing-qr"
            src={`${getPlatformApiPrefix()}/mobile/pairing/qr.svg?token=${encodeURIComponent(pairing.token)}`}
            alt="手机配对二维码"
            width={180}
            height={180}
            style={{ display: 'block', borderRadius: 8, border: '1px solid var(--gewu-line, #2a303b)' }}
          />
          <p className="gewu-field__hint">已启用状态下面板常驻出码（自动续期）。一次性配对码，5 分钟内有效、仅可使用一次；已配对手机重扫码直接复用原会话，不会新增记录。</p>
          <code className="gewu-field__hint">{pairing.primaryUrl}</code>
        </div>
      )}

      {status && (() => {
        const activeDevices = status.devices.filter((device) => !device.revoked);
        const revokedDevices = status.devices.filter((device) => device.revoked);
        return (
          <>
            {activeDevices.length > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
                <span className="gewu-field__hint">活跃设备 {activeDevices.length}</span>
                <button
                  type="button"
                  data-testid="mobile-revoke-all"
                  disabled={busy}
                  onClick={() => { void revokeAllDevices(); }}
                >
                  全部吊销
                </button>
              </div>
            )}
            <ul style={{ listStyle: 'none', margin: '4px 0 0', padding: 0 }}>
              {activeDevices.map((device) => (
                <li key={device.id} data-testid="mobile-device-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '4px 0' }}>
                  <span className="gewu-field__hint">
                    {device.name}
                    {' · 最近活跃 '}
                    {new Date(device.lastSeenAt).toLocaleString()}
                  </span>
                  <button type="button" disabled={busy} onClick={() => { void revokeDevice(device.id); }}>
                    吊销
                  </button>
                </li>
              ))}
            </ul>
            {revokedDevices.length > 0 && (
              <div style={{ marginTop: 6 }}>
                <button
                  type="button"
                  data-testid="mobile-revoked-toggle"
                  style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
                  className="gewu-field__hint"
                  onClick={() => setRevokedExpanded((prev) => !prev)}
                >
                  {revokedExpanded ? '▾' : '▸'} 已吊销 {revokedDevices.length} 台（历史记录）
                </button>
                {revokedExpanded && (
                  <ul style={{ listStyle: 'none', margin: '4px 0 0', padding: 0 }}>
                    {revokedDevices.map((device) => (
                      <li key={device.id} style={{ padding: '2px 0' }}>
                        <span className="gewu-field__hint" style={{ opacity: 0.65 }}>
                          {device.name}
                          {' · 最近活跃 '}
                          {new Date(device.lastSeenAt).toLocaleString()}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </>
        );
      })()}

      {tunnel && (
        <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--gewu-line, #2a303b)' }} data-testid="mobile-tunnel-section">
          <h4>真远程（反向隧道）</h4>
          <p className="gewu-field__hint">
            通过你自己的 SSH 服务器（如 aliyun）中转，不在同一 WiFi 也能用。桌面端只发出站连接；
            服务器侧需一次性配置反代（HTTPS），见部署指引。
          </p>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginTop: 6 }}>
            <input
              type="text"
              value={tunnelHost}
              onChange={(event) => setTunnelHost(event.target.value)}
              placeholder="SSH 主机别名（~/.ssh/config 的 Host，如 aliyun）"
              style={{ flex: '1 1 180px', minWidth: 0 }}
            />
            <button type="button" disabled={busy} onClick={() => { void saveTunnel({ enabled: !tunnel.enabled }); }}>
              {tunnel.enabled ? '停用隧道' : '启用隧道'}
            </button>
            <span className="gewu-field__hint">
              {tunnel.state === 'connected' ? '✓ 已连接·公网可用'
                : tunnel.state === 'connecting' ? '连接中…'
                  : tunnel.state === 'reconnecting' ? `断开，重连中${tunnel.lastError ? `（${tunnel.lastError}）` : ''}`
                    : '未启用'}
            </span>
          </div>
          <input
            type="text"
            value={tunnelPublicUrl}
            onChange={(event) => setTunnelPublicUrl(event.target.value)}
            placeholder="公网地址（如 https://112.120.48.126，服务器反代配置好后填）"
            style={{ width: '100%', marginTop: 6 }}
          />
          <button
            type="button"
            disabled={busy}
            style={{ marginTop: 6 }}
            onClick={() => { void saveTunnel({}); }}
          >
            保存隧道配置
          </button>
        </div>
      )}
    </div>
  );
}
