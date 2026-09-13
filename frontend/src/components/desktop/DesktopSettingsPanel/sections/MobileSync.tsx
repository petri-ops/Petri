import React, { useCallback, useEffect, useRef, useState } from 'react';
import { getPlatformApiPrefix, getToken } from '@/lib/authClient';
import styles from './MobileSync.module.css';

// 配对码后端 TTL 5 分钟；面板按固定 4 分钟自动续码，保持「打开即可扫」。
const PAIRING_AUTO_REFRESH_MS = 4 * 60 * 1000;

function formatRelativeTime(iso: string): string {
  const delta = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(delta) || delta < 0) return '刚刚';
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}

function linkHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

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
  const [copied, setCopied] = useState(false);
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

  // 修订 4：复制配对链接（不再裸露展示长 token URL）。
  const copyLink = useCallback(async () => {
    if (!pairing) return;
    try {
      await navigator.clipboard.writeText(pairing.primaryUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setError('复制失败，请手动复制');
    }
  }, [pairing]);

  return (
    <div className={styles.msPanel} data-testid="mobile-sync-panel">
      <div className={styles.topRow}>
        <span className={styles.statusPill}>
          <span className={`${styles.statusDot} ${status?.enabled ? styles.statusDotOn : ''}`} />
          {status?.enabled ? '手机远程已开启' : '手机远程未开启'}
        </span>
        {status && (
          <button
            type="button"
            className="gewu-btn gewu-btn--ghost gewu-btn--sm"
            disabled={busy}
            onClick={toggleEnabled}
          >
            {status.enabled ? '关闭' : '开启'}
          </button>
        )}
      </div>
      {!status && <p className="gewu-field__hint">正在读取状态…</p>}
      {status && !status.enabled && (
        <p className="gewu-field__hint">开启后需重启桌面端生效。内容只在你的局域网内传输，端口 {status.port}。</p>
      )}
      {error && <p className="gewu-field__hint" role="alert">{error}</p>}

      {status?.enabled && (
        <>
          <div className={styles.qrCard}>
            <div className={styles.qrImageWrap}>
              {pairing ? (
                <img
                  data-testid="mobile-pairing-qr"
                  className={styles.qrImage}
                  src={`${getPlatformApiPrefix()}/mobile/pairing/qr.svg?token=${encodeURIComponent(pairing.token)}`}
                  alt="手机配对二维码"
                />
              ) : (
                <div className={styles.qrImage} aria-label="二维码生成中" />
              )}
            </div>
            <p className={styles.qrHint}>
              手机扫码直达工作区
              <br />
              已配对手机重扫直接进入，不会新增设备
            </p>
            {pairing && (
              <div className={styles.linkRow}>
                <span className={styles.linkHost} title={pairing.primaryUrl}>{linkHost(pairing.primaryUrl)}</span>
                <button
                  type="button"
                  data-testid="mobile-copy-link"
                  className="gewu-btn gewu-btn--ghost gewu-btn--sm"
                  onClick={() => { void copyLink(); }}
                >
                  {copied ? '已复制' : '复制链接'}
                </button>
              </div>
            )}
          </div>

          <div className={styles.sectionHead}>
            <span>活跃设备 {status.activeDevices}</span>
            {status.devices.some((device) => !device.revoked) && (
              <button
                type="button"
                data-testid="mobile-revoke-all"
                className="gewu-btn gewu-btn--danger-ghost gewu-btn--sm"
                disabled={busy}
                onClick={() => { void revokeAllDevices(); }}
              >
                全部吊销
              </button>
            )}
          </div>

          {(() => {
            const activeDevices = status.devices.filter((device) => !device.revoked);
            if (activeDevices.length === 0) {
              return <p className={styles.emptyHint}>还没有设备连接 · 手机扫码后这里会显示</p>;
            }
            return (
              <ul className={styles.deviceList}>
                {activeDevices.map((device) => (
                  <li key={device.id} className={styles.deviceRow} data-testid="mobile-device-row">
                    <span className={styles.deviceName}>{device.name}</span>
                    <span className={styles.deviceMeta}>{formatRelativeTime(device.lastSeenAt)}</span>
                    <button
                      type="button"
                      className="gewu-btn gewu-btn--danger-ghost gewu-btn--sm"
                      disabled={busy}
                      onClick={() => { void revokeDevice(device.id); }}
                    >
                      吊销
                    </button>
                  </li>
                ))}
              </ul>
            );
          })()}
        </>
      )}

      {tunnel && (
        <div className={styles.tunnelSection} data-testid="mobile-tunnel-section">
          <div className={styles.tunnelHead}>
            <h4 className={styles.tunnelTitle}>真远程</h4>
            <span
              className={[
                styles.tunnelBadge,
                tunnel.state === 'connected' ? styles.tunnelBadgeOn : '',
                tunnel.state === 'reconnecting' || tunnel.state === 'connecting' ? styles.tunnelBadgeWarn : '',
              ].join(' ')}
            >
              {tunnel.state === 'connected' ? '● 已连接 · 公网可用'
                : tunnel.state === 'connecting' ? '连接中'
                  : tunnel.state === 'reconnecting' ? `重连中${tunnel.lastError ? ` · ${tunnel.lastError}` : ''}`
                    : '未启用'}
            </span>
          </div>
          <p className={styles.tunnelHint}>
            通过你自己的 SSH 服务器中转，不在同一 WiFi 也能用。桌面端只发出站连接。
          </p>
          <input
            type="text"
            className={styles.tunnelInput}
            value={tunnelHost}
            onChange={(event) => setTunnelHost(event.target.value)}
            placeholder="SSH 主机别名（如 aliyun）"
          />
          <input
            type="text"
            className={styles.tunnelInput}
            value={tunnelPublicUrl}
            onChange={(event) => setTunnelPublicUrl(event.target.value)}
            placeholder="公网地址（反代配置好后填）"
          />
          <div className={styles.tunnelActions}>
            <button
              type="button"
              className="gewu-btn gewu-btn--primary gewu-btn--sm"
              disabled={busy}
              onClick={() => { void saveTunnel({}); }}
            >
              保存配置
            </button>
            <button
              type="button"
              className="gewu-btn gewu-btn--ghost gewu-btn--sm"
              disabled={busy}
              onClick={() => { void saveTunnel({ enabled: !tunnel.enabled }); }}
            >
              {tunnel.enabled ? '停用隧道' : '启用隧道'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
