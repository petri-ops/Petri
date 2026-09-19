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
  identity?: { displayName?: string; device?: string } | null;
}

// BLOCK-88 P3：项目授权（宿主 grants 清单投影，含项目名）。
interface FederationGrant {
  engineer: string;
  projectId: string;
  projectName: string | null;
  grantedAt: string;
}

// BLOCK-88 P1：协作成员 = 本机会话中带工程师声明身份的访客（D2）。
interface FederationMember {
  id: string;
  name: string;
  createdAt: string;
  lastSeenAt: string;
  identity: { displayName?: string; device?: string };
}

// 署名持久化键：本机工程师署名是展示性声明（D1-A），存 localStorage 即可。
const ENGINEER_NAME_KEY = 'gewu-engineer-name';
const MEMBERS_REFRESH_MS = 30 * 1000;
// 访客活跃判定：lastSeenAt 在窗口内视为在线（gateway 每请求刷新该字段）。
const MEMBER_ONLINE_WINDOW_MS = 2 * 60 * 1000;

function deviceLabel(): string {
  const ua = navigator.userAgent;
  if (/Mac/i.test(ua)) return 'macOS';
  if (/Win/i.test(ua)) return 'Windows';
  if (/Linux/i.test(ua)) return 'Linux';
  return navigator.platform || '';
}

function relTime(iso: string): string {
  const delta = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(delta) || delta < 0) return '刚刚';
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
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
  const [members, setMembers] = useState<FederationMember[] | null>(null);
  const [grants, setGrants] = useState<FederationGrant[] | null>(null);
  const [hostProjects, setHostProjects] = useState<{ id: string; name: string }[]>([]);
  const [grantSelections, setGrantSelections] = useState<Record<string, string>>({});
  const [grantBusy, setGrantBusy] = useState(false);
  const [pairUrl, setPairUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [invite, setInvite] = useState<{ token: string; primaryUrl: string } | null>(null);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteCopied, setInviteCopied] = useState(false);
  const [myName, setMyName] = useState(() => {
    try { return localStorage.getItem(ENGINEER_NAME_KEY) || ''; } catch { return ''; }
  });

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`${getPlatformApiPrefix()}/federation/peers`, { headers: authHeaders() });
      const data = await response.json();
      if (data.ok) setPeers(data.peers);
    } catch {
      setError('无法读取协作节点列表');
    }
  }, []);

  const refreshGrants = useCallback(async () => {
    try {
      const [g, p] = await Promise.all([
        fetch(`${getPlatformApiPrefix()}/federation/grants`, { headers: authHeaders() }),
        fetch(`${getPlatformApiPrefix()}/data/projects`, { headers: authHeaders() }),
      ]);
      const gd = await g.json();
      if (gd.ok) setGrants(gd.grants);
      const pd = await p.json();
      if (pd.projects) setHostProjects(pd.projects.map((x: { id: string; name: string }) => ({ id: x.id, name: x.name })));
    } catch {
      /* 授权面读取失败静默（下次刷新再试） */
    }
  }, []);

  const refreshMembers = useCallback(async () => {
    try {
      const response = await fetch(`${getPlatformApiPrefix()}/federation/members`, { headers: authHeaders() });
      const data = await response.json();
      if (data.ok) setMembers(data.members);
    } catch {
      /* 成员列表读取失败静默（下次轮询/操作后再试） */
    }
  }, []);

  useEffect(() => {
    void refresh();
    void refreshMembers();
    void refreshGrants();
    const timer = window.setInterval(() => {
      void refreshMembers();
    }, MEMBERS_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [refresh, refreshMembers, refreshGrants]);

  const addPeer = useCallback(async () => {
    if (!pairUrl.trim()) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const trimmedName = myName.trim();
      const response = await fetch(`${getPlatformApiPrefix()}/federation/peers/pair`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          url: pairUrl.trim(),
          identity: trimmedName ? { displayName: trimmedName, device: deviceLabel() } : undefined,
        }),
      });
      const data = await response.json();
      if (data.ok) {
        setPairUrl('');
        const signed = trimmedName ? `（以「${trimmedName}」署名）` : '';
        setNotice(`已添加协作节点「${data.peer?.name ?? '?'}」${signed}`);
        await refresh();
        await refreshMembers();
      } else {
        setError(data.message || '配对失败');
      }
    } catch {
      setError('配对请求失败');
    } finally {
      setBusy(false);
    }
  }, [pairUrl, myName, refresh, refreshMembers]);

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

  const grantProject = useCallback(async (engineer: string, projectId: string) => {
    setGrantBusy(true);
    try {
      await fetch(`${getPlatformApiPrefix()}/federation/grants`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ engineer, projectId }),
      });
      await refreshGrants();
    } finally {
      setGrantBusy(false);
    }
  }, [refreshGrants]);

  const revokeGrant = useCallback(async (engineer: string, projectId: string) => {
    setGrantBusy(true);
    try {
      await fetch(`${getPlatformApiPrefix()}/federation/grants?engineer=${encodeURIComponent(engineer)}&projectId=${encodeURIComponent(projectId)}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      await refreshGrants();
    } finally {
      setGrantBusy(false);
    }
  }, [refreshGrants]);

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
          value={myName}
          maxLength={40}
          onChange={(event) => {
            setMyName(event.target.value);
            try { localStorage.setItem(ENGINEER_NAME_KEY, event.target.value); } catch { /* 隐私模式等存储不可用 */ }
          }}
          placeholder="我的工程师署名（可选，显示给对方）"
          data-testid="federation-engineer-name"
        />
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

      <div className={styles.addCard} data-testid="federation-members">
        <h4 className={styles.addTitle}>协作成员</h4>
        {members && members.length === 0 && (
          <p className={styles.fedHint} data-testid="federation-member-empty">
            还没有访客工程师 · 对方把本机配对码粘贴到他们的格物里并署名后，会出现在这里
          </p>
        )}
        {members && members.length > 0 && (
          <ul className={styles.peerList}>
            {members.map((member) => {
              const online = Date.now() - new Date(member.lastSeenAt).getTime() < MEMBER_ONLINE_WINDOW_MS;
              return (
                <li key={member.id} className={styles.peerCard} data-testid="federation-member-row">
                  <span className={`${styles.peerDot} ${online ? styles.peerDotOn : ''}`} />
                  <div className={styles.peerMain}>
                    <span className={styles.peerName}>{member.identity.displayName || member.name}</span>
                    <span className={styles.peerMeta}>
                      {[member.identity.device, online ? '在线' : `活跃于 ${relTime(member.lastSeenAt)}`]
                        .filter(Boolean).join(' · ')}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <p className={styles.fedHint}>成员署名为对方声明身份，未经验证；吊销访客可在「我的设备」中操作。</p>
      </div>

      <div className={styles.addCard} data-testid="federation-grants">
        <h4 className={styles.addTitle}>项目授权</h4>
        <p className={styles.fedHint}>
          默认零授权：访客工程师默认碰不到本机任何项目，按项目逐个授权、可随时吊销；委托越权会被诚实拒绝。
        </p>
        {(() => {
          const engineerNames = [...new Set([
            ...(members || []).map((m) => m.identity.displayName).filter((n): n is string => !!n),
            ...(grants || []).map((g) => g.engineer),
          ])];
          if (engineerNames.length === 0) {
            return <p className={styles.fedHint} data-testid="federation-grants-empty">还没有访客工程师 · 配对署名后可按项目授权</p>;
          }
          return engineerNames.map((name) => {
            const mine = (grants || []).filter((g) => g.engineer === name);
            const grantedIds = new Set(mine.map((g) => g.projectId));
            const candidates = hostProjects.filter((p) => !grantedIds.has(p.id));
            return (
              <div key={name} className={styles.grantRow} data-testid="federation-grant-row">
                <span className={styles.grantEngineer}>{name}</span>
                <div className={styles.grantChips}>
                  {mine.length === 0 && <span className={styles.fedHint}>未授权任何项目</span>}
                  {mine.map((g) => (
                    <span key={g.projectId} className={styles.grantChip}>
                      {g.projectName || g.projectId}
                      <button
                        type="button"
                        className={styles.grantRevoke}
                        disabled={grantBusy}
                        title="吊销授权"
                        aria-label={`吊销 ${name} 对 ${g.projectName || g.projectId} 的授权`}
                        data-testid="federation-grant-revoke"
                        onClick={() => { void revokeGrant(name, g.projectId); }}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
                {candidates.length > 0 && (
                  <div className={styles.grantAddRow}>
                    <select
                      className={styles.grantSelect}
                      value={grantSelections[name] || ''}
                      onChange={(e) => setGrantSelections((s) => ({ ...s, [name]: e.target.value }))}
                      data-testid="federation-grant-select"
                      aria-label={`为 ${name} 选择要授权的项目`}
                    >
                      <option value="">选择项目…</option>
                      {candidates.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="gewu-btn gewu-btn--ghost gewu-btn--sm"
                      disabled={grantBusy || !grantSelections[name]}
                      data-testid="federation-grant-submit"
                      onClick={() => {
                        const pid = grantSelections[name];
                        if (pid) void grantProject(name, pid);
                      }}
                    >
                      授权
                    </button>
                  </div>
                )}
              </div>
            );
          });
        })()}
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
                    {peer.identity?.displayName ? ` · 署名 ${peer.identity.displayName}` : ''}
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
