// ============================================================
// DesktopSettingsPanel — RemoteTargets section (BLOCK-57)
//
// 远程执行目标管理：列表（注册 + ~/.ssh/config 发现候选）、注册、
// 探测、移除。本机永远是默认执行位置——这里只追加「可选目标」。
// 数据面 = /api/remote-targets REST（token 认证同 UsageResourcePanel）。
// ============================================================

import React, { useCallback, useEffect, useState } from 'react';
import { getPlatformApiPrefix } from '@/lib/authClient';
import { getToken } from '@/lib/authClient';

interface TargetProbeInfo {
  os?: string;
  /** BLOCK-96 F1 — 首连握手毫秒数（仅 >2000 时由服务端记录） */
  handshakeMs?: number;
}

interface RegisteredTarget {
  id: string;
  alias: string;
  label: string;
  status: string;
  lastProbeAt: number | null;
  lastProbe: TargetProbeInfo | null;
}

interface DiscoveredTarget {
  id: null;
  alias: string;
  hostName: string | null;
  user: string | null;
  port: string | null;
  discovered: true;
}

interface TargetsResponse {
  registered: RegisteredTarget[];
  discovered: DiscoveredTarget[];
}

// UI-422 — 联邦节点作为执行位置（BLOCK-85 P2.5 后端 `fed:<peerId>` 语义的产品面）：
// 数据面 = GET /api/federation/peers（与联邦面板同源），选择写同一个
// gewu.executionTargetId 存储键（fed: 前缀），useChatStream 发送链零改动。
interface FedPeer {
  peerId: string;
  name: string;
  platform: string;
  arch: string;
  lastSeenAt: string;
  lastProbe: { ok: boolean; at: string; latencyMs: number | null; error: string | null } | null;
}

// 与 Federation.tsx 同语义：lastSeenAt/lastProbe.at 在窗口内视为在线。
const FED_ONLINE_WINDOW_MS = 2 * 60 * 1000;

function fedProbeText(peer: FedPeer): string {
  const probe = peer.lastProbe;
  if (!probe) return '未探活';
  const delta = Date.now() - new Date(probe.at).getTime();
  const fresh = Number.isFinite(delta) && delta >= 0 && delta < FED_ONLINE_WINDOW_MS;
  if (probe.ok && fresh) return `已连通 ${probe.latencyMs != null ? `${probe.latencyMs}ms` : ''}`.trim();
  if (probe.ok) return `已连通 ${probe.latencyMs != null ? `${probe.latencyMs}ms` : ''}（${relTime(probe.at)}探活）`.trim();
  return '上次探活失败';
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
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function describeProbe(info: TargetProbeInfo | null): string {
  // BLOCK-96 F6 — 领域运行时徽标（R/Python/slurm）退役：运行时在位改由已装包
  // requires.runtimes 契约驱动（BLOCK-86），目标管理页只保留通用连通性信息。
  if (!info || !info.os) return '未探测';
  // BLOCK-96 F1 — 首连握手 >2s：疑似 IPv6(::1) 地址族黑洞（ConnectTimeout 封不住）。
  if (info.handshakeMs && info.handshakeMs > 2000) {
    return `${info.os} · 首连 ${(info.handshakeMs / 1000).toFixed(1)}s ⚠`;
  }
  return info.os;
}

const DEFAULT_TARGET_STORAGE_KEY = 'gewu.executionTargetId';
// BLOCK-61 读旧兼容：历史 key biof3.executionTargetId
const LEGACY_TARGET_STORAGE_KEY = 'biof3.executionTargetId';

export function RemoteTargets(): React.ReactElement {
  const [data, setData] = useState<TargetsResponse>({ registered: [], discovered: [] });
  const [error, setError] = useState('');
  const [aliasInput, setAliasInput] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  // 默认执行目标（BLOCK-57 UI-290 加映二：选择从 composer 迁至设置页；本机永远可选）
  const [defaultTargetId, setDefaultTargetId] = useState<string>(() => {
    try {
      return (
        window.localStorage.getItem(DEFAULT_TARGET_STORAGE_KEY)
        ?? window.localStorage.getItem(LEGACY_TARGET_STORAGE_KEY)
        ?? ''
      );
    } catch { return ''; }
  });

  const setDefaultTarget = (id: string) => {
    setDefaultTargetId(id);
    try {
      if (id) window.localStorage.setItem(DEFAULT_TARGET_STORAGE_KEY, id);
      else window.localStorage.removeItem(DEFAULT_TARGET_STORAGE_KEY);
    } catch { /* 隐私模式等场景允许失败 */ }
  };

  // BLOCK-105 §7 Batch-6 — remote-targets/federation REST 信封 wire 形状（JSON 解析出站边界契约文档）。
  type RemoteEnvelope = {
    ok?: unknown;
    error?: string;
    detail?: string;
    registered?: RegisteredTarget[];
    discovered?: DiscoveredTarget[];
    peers?: FedPeer[];
  } | null;

  const load = useCallback(async () => {
    try {
      const response = await fetch(`${getPlatformApiPrefix()}/remote-targets`, { headers: authHeaders() });
      const payload = (await response.json()) as RemoteEnvelope;
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || '目标列表不可用');
      setData({ registered: payload.registered || [], discovered: payload.discovered || [] });
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // UI-422 — 联邦节点列表（失败诚实空态：联邦面板不可用不阻塞 SSH 目标管理）
  const [fedPeers, setFedPeers] = useState<FedPeer[]>([]);
  const [fedError, setFedError] = useState('');

  const loadFederation = useCallback(async () => {
    try {
      const response = await fetch(`${getPlatformApiPrefix()}/federation/peers`, { headers: authHeaders() });
      const payload = (await response.json()) as RemoteEnvelope;
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || '联邦节点列表不可用');
      setFedPeers(payload.peers || []);
      setFedError('');
    } catch (reason) {
      setFedError(reason instanceof Error ? reason.message : String(reason));
    }
  }, []);

  useEffect(() => { void loadFederation(); }, [loadFederation]);

  const probeFederation = async (peerId: string) => {
    setBusyId(`fed:${peerId}`);
    try {
      const response = await fetch(`${getPlatformApiPrefix()}/federation/peers/${encodeURIComponent(peerId)}/probe`, {
        method: 'POST',
        headers: authHeaders(),
      });
      const payload = (await response.json()) as RemoteEnvelope;
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || '探活失败');
      await loadFederation();
    } catch (reason) {
      setFedError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusyId(null);
    }
  };

  const register = async (alias: string) => {
    if (!alias.trim()) return;
    setBusyId('__input__');
    try {
      const response = await fetch(`${getPlatformApiPrefix()}/remote-targets`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ alias: alias.trim() }),
      });
      const payload = (await response.json()) as RemoteEnvelope;
      if (!response.ok || !payload?.ok) throw new Error(payload?.error === 'alias_already_registered' ? '该别名已注册' : payload?.error === 'invalid_alias' ? '别名不合法' : (payload?.error || '注册失败'));
      setAliasInput('');
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusyId(null);
    }
  };

  const probe = async (id: string) => {
    setBusyId(id);
    try {
      const response = await fetch(`${getPlatformApiPrefix()}/remote-targets/${encodeURIComponent(id)}/probe`, {
        method: 'POST',
        headers: authHeaders(),
      });
      const payload = (await response.json()) as RemoteEnvelope;
      if (!response.ok || !payload?.ok) throw new Error(payload?.detail || payload?.error || '探测失败');
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (id: string) => {
    setBusyId(id);
    try {
      const response = await fetch(`${getPlatformApiPrefix()}/remote-targets/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      if (!response.ok) throw new Error('移除失败');
      if (defaultTargetId === id) setDefaultTarget('');
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="gewu-remote-targets" data-testid="remote-targets-panel">
      <h4>远程执行目标（SSH）</h4>
      <p className="gewu-field__hint">
        把分析任务提交到你自己的服务器直跑：凭据完全复用本机 SSH 配置（只认 key，Gewu 不存任何密钥）。
        首次使用请先在终端 ssh 该主机一次完成指纹确认。不添加任何目标时，一切照常在本机执行。
      </p>
      {data.registered.length === 0 && <p className="gewu-field__hint">尚无已注册目标。</p>}
      <ul style={{ listStyle: 'none', margin: '8px 0', padding: 0 }}>
        {data.registered.map((target) => (
          <li key={target.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--gewu-border, #ddd)' }} data-testid="remote-target-row">
            <strong>{target.alias}</strong>
            {target.label ? <span>{target.label}</span> : null}
            <span
              style={{
                fontSize: 12,
                padding: '1px 8px',
                borderRadius: 999,
                background: target.status === 'ready' ? 'var(--gewu-status-success-bg)' : target.status === 'unreachable' ? 'var(--gewu-warning-bg)' : 'transparent',
              }}
              data-testid={`remote-target-status-${target.status}`}
            >
              {target.status === 'ready' ? '就绪' : target.status === 'unreachable' ? '不可达' : '未探测'}
            </span>
            <span
              className="gewu-field__hint"
              style={{ flex: 1, textAlign: 'right' }}
              title={
                target.lastProbe?.handshakeMs && target.lastProbe.handshakeMs > 2000
                  ? '首连握手偏慢：疑似 IPv6 地址族黑洞（::1 先挂满超时才回落 IPv4）。可在该主机的 ~/.ssh/config 中加一行 `AddressFamily inet` 立即缓解。'
                  : undefined
              }
            >
              {describeProbe(target.lastProbe)}
            </span>
            <button
              type="button"
              disabled={busyId === target.id}
              onClick={() => { setDefaultTarget(target.id); }}
              data-testid={`remote-target-default-${target.id}`}
            >
              {defaultTargetId === target.id ? '★ 默认' : '设为默认'}
            </button>
            <button type="button" disabled={busyId === target.id} onClick={() => { void probe(target.id); }}>
              {busyId === target.id ? '探测中…' : '探测'}
            </button>
            <button type="button" disabled={busyId === target.id} onClick={() => { void remove(target.id); }}>
              移除
            </button>
          </li>
        ))}
      </ul>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
        <input
          value={aliasInput}
          placeholder="SSH 主机别名（~/.ssh/config 中的 Host）"
          onChange={(event) => setAliasInput(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') void register(aliasInput); }}
          style={{ flex: 1 }}
          data-testid="remote-target-alias-input"
        />
        <button type="button" disabled={busyId === '__input__' || !aliasInput.trim()} onClick={() => { void register(aliasInput); }}>
          添加目标
        </button>
      </div>
      {data.discovered.length > 0 && (
        <p className="gewu-field__hint">
          从 ~/.ssh/config 发现：{data.discovered.map((item) => item.alias).join('、')}（输入上方别名即可添加）
        </p>
      )}

      {/* UI-422 — 联邦节点：作业经 `fed:<peerId>` 发到对端格物执行，真值留在对端 */}
      <h4 style={{ marginTop: 16 }}>联邦节点（发到对端格物执行）</h4>
      <p className="gewu-field__hint">
        把分析任务发给已配对的对端格物执行：作业在对端跑、产物真值留在对端，本端实时查看状态与结果。
        配对入口在左栏「联邦」面板；不选择时一切照常在本机执行。
      </p>
      {fedPeers.length === 0 && (
        <p className="gewu-field__hint" data-testid="federation-peers-empty">
          尚无已配对联邦节点——在左栏「联邦」面板添加协作节点后，可把任务发到对端执行。
        </p>
      )}
      <ul style={{ listStyle: 'none', margin: '8px 0', padding: 0 }}>
        {fedPeers.map((peer) => {
          const targetId = `fed:${peer.peerId}`;
          const isDefault = defaultTargetId === targetId;
          return (
            <li
              key={peer.peerId}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--gewu-border, #ddd)' }}
              data-testid="federation-peer-row"
            >
              <strong>{peer.name}</strong>
              <span className="gewu-field__hint">{peer.platform}/{peer.arch}</span>
              <span
                style={{
                  fontSize: 12,
                  padding: '1px 8px',
                  borderRadius: 999,
                  background: peer.lastProbe?.ok ? 'var(--gewu-status-success-bg)' : 'var(--gewu-warning-bg)',
                }}
                data-testid={`federation-peer-status-${peer.peerId}`}
              >
                {fedProbeText(peer)}
              </span>
              <span style={{ flex: 1 }} />
              <button
                type="button"
                disabled={busyId === targetId}
                onClick={() => { setDefaultTarget(targetId); }}
                data-testid={`federation-peer-default-${peer.peerId}`}
              >
                {isDefault ? '★ 默认' : '设为默认'}
              </button>
              <button type="button" disabled={busyId === targetId} onClick={() => { void probeFederation(peer.peerId); }}>
                {busyId === targetId ? '探活中…' : '探活'}
              </button>
            </li>
          );
        })}
      </ul>
      {fedError && <p className="gewu-field__hint" role="alert" data-testid="federation-peers-error">{fedError}</p>}

      <p className="gewu-field__hint" data-testid="remote-target-default-summary">
        当前默认执行目标：{(() => {
          if (!defaultTargetId) return '本机（分析在本机执行）';
          if (defaultTargetId.startsWith('fed:')) {
            const peer = fedPeers.find((p) => p.peerId === defaultTargetId.slice(4));
            return `${peer ? `联邦节点 ${peer.name}` : '联邦节点（未在注册表）'}（分析自动提交到该节点）`;
          }
          const alias = data.registered.find((t) => t.id === defaultTargetId)?.alias;
          return `${alias || '已指定目标'}（分析自动提交到该节点）`;
        })()}
        {defaultTargetId && (
          <button
            type="button"
            style={{ marginLeft: 8 }}
            onClick={() => { setDefaultTarget(''); }}
            data-testid="remote-target-default-clear"
          >
            恢复本机执行
          </button>
        )}
      </p>
      {error && <p className="gewu-field__hint" role="alert" data-testid="remote-targets-error">{error}</p>}
    </div>
  );
}
