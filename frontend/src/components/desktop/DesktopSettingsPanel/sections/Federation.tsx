import React, { useCallback, useEffect, useState } from 'react';
import { getPlatformApiPrefix, getToken } from '@/lib/authClient';
import styles from './Federation.module.css';

interface FederationPeer {
  peerId: string;
  name: string;
  baseUrl: string;
  platform: string | null;
  arch: string | null;
  gewuVersion: string | null;
  executors: { r?: boolean; python?: boolean } | null;
  protocol: number;
  addedAt: string;
  lastSeenAt: string;
  lastProbe: { ok: boolean; at: string; latencyMs: number | null; error: string | null } | null;
}

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

// 与 MobileSync 同语义：配对码后端 TTL 5 分钟，面板挂载即自动出码并按 4 分钟常驻续码。
const PAIRING_AUTO_REFRESH_MS = 4 * 60 * 1000;

function platformLabel(peer: FederationPeer): string {
  const p = peer.platform === 'darwin' ? 'macOS'
    : peer.platform === 'win32' ? 'Windows'
      : peer.platform === 'linux' ? 'Linux'
        : peer.platform || '未知系统';
  const runners = peer.executors
    ? [peer.executors.r ? 'R' : null, peer.executors.python ? 'Python' : null].filter(Boolean).join(' · ')
    : '';
  return [p, runners].filter(Boolean).join(' · ');
}

/**
 * BLOCK-85 格物联邦 — 协作节点面板（P1 联邦通道）。
 * 指挥席侧：粘贴对端格物的配对链接 → 兑换会话+握手 → 存为协作节点；
 * 之后（P2/P3）可把分析作业 / Agent 工作委托给它。
 */
export function FederationPanel(): React.ReactElement {
  const [peers, setPeers] = useState<FederationPeer[] | null>(null);
  const [pairUrl, setPairUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [invite, setInvite] = useState<{ token: string; primaryUrl: string } | null>(null);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteCopied, setInviteCopied] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`${getPlatformApiPrefix()}/federation/peers`, { headers: authHeaders() });
      const data = await response.json();
      if (data.ok) setPeers(data.peers);
    } catch {
      setError('无法读取协作节点列表');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const addPeer = useCallback(async () => {
    if (!pairUrl.trim()) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`${getPlatformApiPrefix()}/federation/peers/pair`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ url: pairUrl.trim() }),
      });
      const data = await response.json();
      if (data.ok) {
        setPairUrl('');
        setNotice(`已添加协作节点「${data.peer?.name ?? '?'}」`);
        await refresh();
      } else {
        setError(data.message || '配对失败');
      }
    } catch {
      setError('配对请求失败');
    } finally {
      setBusy(false);
    }
  }, [pairUrl, refresh]);

  const probePeer = useCallback(async (peerId: string) => {
    setBusy(true);
    setError(null);
    try {
      await fetch(`${getPlatformApiPrefix()}/federation/peers/${encodeURIComponent(peerId)}/probe`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({}),
      });
      await refresh();
    } catch {
      setError('探测失败');
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const openProjection = useCallback(async (peerId: string) => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`${getPlatformApiPrefix()}/federation/peers/${encodeURIComponent(peerId)}/projection-url`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({}),
      });
      const data = await response.json();
      if (data.ok && data.url) {
        window.open(data.url, '_blank', 'noopener');
      } else {
        setError(data.message || '无法获取对端界面链接');
      }
    } catch {
      setError('获取界面链接失败');
    } finally {
      setBusy(false);
    }
  }, []);

  const removePeer = useCallback(async (peerId: string) => {
    setBusy(true);
    try {
      await fetch(`${getPlatformApiPrefix()}/federation/peers/${encodeURIComponent(peerId)}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      await refresh();
    } catch {
      setError('移除失败');
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  // UI-358 修订 3：出码能力上收协作成员 tab——手机连接与协作节点共用同一
  // 配对机制（mobile-gateway token），「在另一台电脑生成配对码」不该依赖对方
  // 碰巧打开「我的设备」tab。一个码两种用途：手机扫码=本机工作区会话；
  // 粘贴到对端格物=本机成为对端的协作节点。
  // 用户复看追加：默认自动生成 + 4 分钟常驻续码（同「我的设备」体验），置于粘贴卡上方。
  const generateInvite = useCallback(async () => {
    setInviteBusy(true);
    try {
      const response = await fetch(`${getPlatformApiPrefix()}/mobile/pairing/token`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({}),
      });
      const data = await response.json();
      if (data.ok && data.primaryUrl) {
        setInvite({ token: data.token, primaryUrl: data.primaryUrl });
        setInviteCopied(false);
      } else {
        setError(data.message || '生成配对码失败');
      }
    } catch {
      setError('生成配对码请求失败');
    } finally {
      setInviteBusy(false);
    }
  }, []);

  useEffect(() => {
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
        if (!cancelled && data.ok && data.primaryUrl) {
          setInvite({ token: data.token, primaryUrl: data.primaryUrl });
        }
      } catch {
        /* 静默：下一轮续码或手动「重新生成」 */
      }
      if (!cancelled) timer = window.setTimeout(generate, PAIRING_AUTO_REFRESH_MS);
    };
    void generate();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, []);

  const copyInvite = useCallback(async () => {
    if (!invite) return;
    try {
      await navigator.clipboard.writeText(invite.primaryUrl);
      setInviteCopied(true);
    } catch {
      setError('复制失败，请手动选中链接复制');
    }
  }, [invite]);

  return (
    <div className={styles.fedPanel} data-testid="federation-panel">
      <p className={styles.fedHint}>
        把另一台电脑上的格物添加为协作节点，之后可以把分析任务或 AI 工作委托给它执行。
        粘贴对端的配对链接；对端没有现成配对码时，让对方在「联邦 · 本机配对码」生成。
      </p>

      {error && <p className={styles.errorText} role="alert">{error}</p>}
      {notice && <p className="gewu-field__hint" role="status">{notice}</p>}

      <div className={styles.addCard} data-testid="federation-invite">
        <h4 className={styles.addTitle}>本机配对码</h4>
        {invite ? (
          <>
            <div className={styles.inviteQrWrap}>
              <img
                data-testid="federation-invite-qr"
                className={styles.inviteQr}
                alt="本机配对二维码"
                src={`${getPlatformApiPrefix()}/mobile/pairing/qr.svg?token=${encodeURIComponent(invite.token)}`}
              />
            </div>
            <div className={styles.inviteLinkRow}>
              <span
                className={styles.inviteLink}
                data-testid="federation-invite-link"
                title={invite.primaryUrl}
              >
                {invite.primaryUrl}
              </span>
              <button
                type="button"
                className="gewu-btn gewu-btn--ghost gewu-btn--sm"
                onClick={() => { void copyInvite(); }}
                data-testid="federation-invite-copy"
              >
                {inviteCopied ? '已复制' : '复制链接'}
              </button>
              <button
                type="button"
                className="gewu-btn gewu-btn--ghost gewu-btn--sm"
                disabled={inviteBusy}
                onClick={() => { void generateInvite(); }}
                data-testid="federation-invite-regen"
              >
                重新生成
              </button>
            </div>
            <p className={styles.fedHint}>
              一个码两种用途：手机扫码＝进入本机工作区；粘贴到另一台格物＝添加本机为协作节点。自动续码，也可点「重新生成」立即换新。
            </p>
          </>
        ) : (
          <p className={styles.fedHint} data-testid="federation-invite-loading">配对码生成中…</p>
        )}
      </div>

      <div className={styles.addCard}>
        <h4 className={styles.addTitle}>添加协作节点</h4>
        <input
          type="text"
          className={styles.addInput}
          value={pairUrl}
          onChange={(event) => setPairUrl(event.target.value)}
          placeholder="粘贴对端配对链接（http://…:3005/pair?token=…）"
          data-testid="federation-pair-input"
        />
        <div className={styles.addRow}>
          <button
            type="button"
            className="gewu-btn gewu-btn--primary gewu-btn--sm"
            disabled={busy || !pairUrl.trim()}
            onClick={() => { void addPeer(); }}
            data-testid="federation-pair-submit"
          >
            配对
          </button>
        </div>
      </div>

      {peers && peers.length === 0 && (
        <div className={styles.emptyState} data-testid="federation-empty">
          还没有协作节点 · 把本机配对码发给对方，或把对方的链接粘贴到上面
        </div>
      )}

      {peers && peers.length > 0 && (
        <ul className={styles.peerList}>
          {peers.map((peer) => {
            const probeOk = peer.lastProbe?.ok === true;
            const probeBad = peer.lastProbe && !peer.lastProbe.ok;
            return (
              <li key={peer.peerId} className={styles.peerCard} data-testid="federation-peer-row">
                <span className={`${styles.peerDot} ${probeOk ? styles.peerDotOn : ''} ${probeBad ? styles.peerDotOff : ''}`} />
                <div className={styles.peerMain}>
                  <span className={styles.peerName}>{peer.name}</span>
                  <span className={styles.peerMeta}>
                    {platformLabel(peer)}
                    {peer.gewuVersion ? ` · v${peer.gewuVersion}` : ''}
                    {probeOk && peer.lastProbe?.latencyMs != null ? ` · ${peer.lastProbe.latencyMs}ms` : ''}
                    {probeBad ? ` · ${peer.lastProbe?.error || '离线'}` : ''}
                  </span>
                </div>
                <button
                  type="button"
                  className="gewu-btn gewu-btn--ghost gewu-btn--sm"
                  disabled={busy}
                  onClick={() => { void openProjection(peer.peerId); }}
                  data-testid="federation-open-ui"
                >
                  界面
                </button>
                <button
                  type="button"
                  className="gewu-btn gewu-btn--ghost gewu-btn--sm"
                  disabled={busy}
                  onClick={() => { void probePeer(peer.peerId); }}
                >
                  测连
                </button>
                <button
                  type="button"
                  className="gewu-btn gewu-btn--danger-ghost gewu-btn--sm"
                  disabled={busy}
                  onClick={() => { void removePeer(peer.peerId); }}
                >
                  移除
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
