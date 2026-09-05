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
  r?: string;
  rversion?: string;
  python?: string;
  pythonversion?: string;
  scheduler?: string;
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

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function describeProbe(info: TargetProbeInfo | null): string {
  if (!info || !info.os) return '未探测';
  const runtimes = [
    info.r && info.r !== 'missing' ? `R ${info.rversion || '?'}` : null,
    info.python && info.python !== 'missing' ? `Python ${info.pythonversion || '?'}` : null,
  ].filter(Boolean);
  return `${info.os} · ${runtimes.length ? runtimes.join(' / ') : '无 R/Python'}${info.scheduler && info.scheduler !== 'none' ? ` · ${info.scheduler}` : ''}`;
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

  const load = useCallback(async () => {
    try {
      const response = await fetch(`${getPlatformApiPrefix()}/remote-targets`, { headers: authHeaders() });
      const payload = await response.json();
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || '目标列表不可用');
      setData({ registered: payload.registered || [], discovered: payload.discovered || [] });
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const register = async (alias: string) => {
    if (!alias.trim()) return;
    setBusyId('__input__');
    try {
      const response = await fetch(`${getPlatformApiPrefix()}/remote-targets`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ alias: alias.trim() }),
      });
      const payload = await response.json();
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
      const payload = await response.json();
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
            <span className="gewu-field__hint" style={{ flex: 1, textAlign: 'right' }}>
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
      <p className="gewu-field__hint" data-testid="remote-target-default-summary">
        当前默认执行目标：{defaultTargetId
          ? (data.registered.find((t) => t.id === defaultTargetId)?.alias || '已指定目标')
          : '本机'}{defaultTargetId ? '（分析自动提交到该节点）' : '（分析在本机执行）'}
      </p>
      {data.discovered.length > 0 && (
        <p className="gewu-field__hint">
          从 ~/.ssh/config 发现：{data.discovered.map((item) => item.alias).join('、')}（输入上方别名即可添加）
        </p>
      )}
      {error && <p className="gewu-field__hint" role="alert" data-testid="remote-targets-error">{error}</p>}
    </div>
  );
}
