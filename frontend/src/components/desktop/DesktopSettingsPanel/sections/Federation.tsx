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

  return (
    <div className={styles.fedPanel} data-testid="federation-panel">
      <p className={styles.fedHint}>
        把另一台电脑上的格物添加为协作节点，之后可以把分析任务或 AI 工作委托给它执行。
        在对端格物打开「手机连接」面板生成配对码，把配对链接粘贴到这里。
      </p>

      {error && <p className={styles.errorText} role="alert">{error}</p>}
      {notice && <p className="gewu-field__hint" role="status">{notice}</p>}

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
          还没有协作节点 · 在另一台电脑的格物里生成配对码开始
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
