// ============================================================
// UI-327 — 左栏行内 SSH 创建向导（globe 切换）：先连接主机，再浏览远端目录选路径。
// 步骤① connect：别名（~/.ssh/config）或 IP+密码（一次性装公钥，密码不存储）。
// 步骤② pick：远端目录浏览器（$HOME 起点 / 上级 / 逐层进入）→ 在此目录创建项目。
// 表单态本地持有；连接/浏览/注册/创建全部走 ctx（单一链路，导航由 ctx.sshCreateAt 完成）。
// ============================================================
import React, { useState } from 'react';
import { Icon } from '@/components/icons/Icon';
import type { LeftPanelContext } from './LeftPanel';
import styles from '@/pages/project-workspace.module.css';

type SshCreateMode = 'alias' | 'password';

export function SshCreateInlinePanel({ ctx, onClose }: { ctx: LeftPanelContext; onClose: () => void }): React.ReactElement {
  const [step, setStep] = useState<'connect' | 'pick'>('connect');
  const [mode, setMode] = useState<SshCreateMode>('alias');
  const [alias, setAlias] = useState('');
  const [ip, setIp] = useState('');
  const [port, setPort] = useState('22');
  const [username, setUsername] = useState('root');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // pick 步骤状态
  const [connectedAlias, setConnectedAlias] = useState('');
  const [currentPath, setCurrentPath] = useState('');
  const [dirs, setDirs] = useState<Array<{ name: string; path: string }>>([]);
  const [dirsLoading, setDirsLoading] = useState(false);

  const inputStyle: React.CSSProperties = {
    width: '100%',
    boxSizing: 'border-box',
    marginBottom: 6,
    padding: '4px 8px',
    fontSize: 12,
  };

  const loadDirs = async (target: { alias: string; path: string }): Promise<void> => {
    setDirsLoading(true);
    setError('');
    try {
      const r = await ctx.sshListDirs(target.alias, target.path);
      if (!r.ok) {
        setError(r.retryable ? `${r.error}（可重试）` : (r.error || '浏览失败'));
        return;
      }
      setCurrentPath(r.path || target.path);
      setDirs(r.dirs || []);
    } finally {
      setDirsLoading(false);
    }
  };

  const handleConnect = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (busy) return;
    setError('');
    setBusy(true);
    try {
      let effectiveAlias = alias.trim();
      if (mode === 'password') {
        if (!ip.trim() || !port.trim() || !username.trim() || !password) {
          setError('请完整填写 IP、端口、用户名与密码');
          return;
        }
        const reg = await ctx.sshRegisterHost({ ip: ip.trim(), port: port.trim(), username: username.trim(), password });
        if (!reg.ok || !reg.alias) {
          setError(reg.error || '主机注册失败');
          return;
        }
        effectiveAlias = reg.alias;
        setConnectedAlias(reg.alias);
      } else {
        setConnectedAlias(effectiveAlias);
      }
      // 连通性检测 + 取远端 $HOME 作为浏览起点（失败如实呈现，可重试）
      const conn = await ctx.sshConnectHost(effectiveAlias);
      if (!conn.ok) {
        setError(conn.retryable ? `${conn.error}（可重试）` : (conn.error || '连接失败'));
        return;
      }
      setStep('pick');
      await loadDirs({ alias: effectiveAlias, path: conn.home || '/' });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleCreate = async (): Promise<void> => {
    if (busy || !currentPath) return;
    setBusy(true);
    setError('');
    try {
      const r = await ctx.sshCreateAt({ alias: connectedAlias, remotePath: currentPath });
      if (!r.ok) {
        setError(r.error || '创建失败');
        return;
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const parentPath = currentPath.replace(/\/[^/]*$/, '') || '/';

  return (
    <div
      style={{ padding: '8px 12px 10px', borderBottom: '1px solid var(--gewu-border, rgba(128,128,128,0.25))' }}
      data-testid="left-ssh-create-panel"
    >
      {step === 'connect' ? (
        <form onSubmit={(e) => void handleConnect(e)}>
          <div style={{ display: 'flex', gap: 6, marginBottom: 6 }} role="tablist" aria-label="SSH 连接方式">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'alias'}
              className={`gewu-btn gewu-btn--sm ${mode === 'alias' ? '' : 'gewu-btn--ghost'}`}
              onClick={() => { setMode('alias'); setError(''); }}
            >
              别名
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'password'}
              className={`gewu-btn gewu-btn--sm ${mode === 'password' ? '' : 'gewu-btn--ghost'}`}
              onClick={() => { setMode('password'); setError(''); }}
              title="密码只用于一次性安装本机公钥到服务器，之后免密连接；密码不会被保存"
            >
              IP + 密码
            </button>
          </div>
          {mode === 'alias' ? (
            <input
              className={styles.treeRenameInput}
              style={inputStyle}
              type="text"
              value={alias}
              onChange={(e) => setAlias(e.target.value)}
              placeholder="SSH 主机别名（如 aliyun）"
              aria-label="SSH 主机别名"
              autoFocus
            />
          ) : (
            <>
              <input
                className={styles.treeRenameInput}
                style={{ ...inputStyle, marginBottom: 4 }}
                type="text"
                value={ip}
                onChange={(e) => setIp(e.target.value)}
                placeholder="主机 IP 或域名"
                aria-label="主机 IP 或域名"
                autoFocus
              />
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  className={styles.treeRenameInput}
                  style={inputStyle}
                  type="text"
                  inputMode="numeric"
                  value={port}
                  onChange={(e) => setPort(e.target.value.replace(/[^0-9]/g, ''))}
                  placeholder="端口"
                  aria-label="SSH 端口"
                />
                <input
                  className={styles.treeRenameInput}
                  style={inputStyle}
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="用户名"
                  aria-label="SSH 用户名"
                />
              </div>
              <input
                className={styles.treeRenameInput}
                style={inputStyle}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="密码（仅用于首次装公钥，不保存）"
                aria-label="SSH 密码（仅用于首次安装公钥，不会被保存）"
              />
            </>
          )}
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <button type="submit" className="gewu-btn gewu-btn--sm" disabled={busy}>
              {busy ? '连接中…' : '连接'}
            </button>
            <button type="button" className="gewu-btn gewu-btn--ghost gewu-btn--sm" onClick={onClose} disabled={busy}>
              取消
            </button>
          </div>
        </form>
      ) : (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
            <span
              data-testid="ssh-connected-chip"
              title={`已连接 ${connectedAlias}`}
              style={{ fontSize: 11, padding: '1px 8px', borderRadius: 8, border: '1px solid currentColor', opacity: 0.85, whiteSpace: 'nowrap' }}
            >
              {connectedAlias}
            </span>
            <button
              type="button"
              className="gewu-btn gewu-btn--ghost gewu-btn--sm"
              onClick={() => void loadDirs({ alias: connectedAlias, path: parentPath })}
              disabled={dirsLoading || currentPath === '/'}
              title="返回上级目录"
            >
              上级
            </button>
            <button
              type="button"
              className="gewu-btn gewu-btn--ghost gewu-btn--sm"
              onClick={() => void loadDirs({ alias: connectedAlias, path: currentPath })}
              disabled={dirsLoading}
              title="刷新"
              aria-label="刷新目录"
            >
              <Icon name="repeat" size={12} />
            </button>
          </div>
          <div
            style={{ maxHeight: 200, overflowY: 'auto', border: '1px solid var(--gewu-border, rgba(128,128,128,0.25))', borderRadius: 6, marginBottom: 6 }}
            data-testid="ssh-dir-browser"
          >
            {dirsLoading ? (
              <p style={{ padding: '8px 10px', fontSize: 12, opacity: 0.7, margin: 0 }}>读取目录…</p>
            ) : dirs.length === 0 ? (
              <p style={{ padding: '8px 10px', fontSize: 12, opacity: 0.7, margin: 0 }}>此目录下没有子目录</p>
            ) : (
              dirs.map((d) => (
                <button
                  key={d.path}
                  type="button"
                  onClick={() => void loadDirs({ alias: connectedAlias, path: d.path })}
                  title={d.path}
                  style={{ display: 'block', width: '100%', textAlign: 'left', padding: '4px 10px', fontSize: 12, background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}
                >
                  {d.name}/
                </button>
              ))
            )}
          </div>
          <p
            data-testid="ssh-selected-path"
            style={{ fontSize: 11, opacity: 0.75, margin: '0 0 6px', wordBreak: 'break-all' }}
            title={currentPath}
          >
            {currentPath}
          </p>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <button
              type="button"
              className="gewu-btn gewu-btn--sm"
              onClick={() => void handleCreate()}
              disabled={busy || dirsLoading || !currentPath}
              title={`在 ${currentPath} 创建远程项目`}
            >
              {busy ? '创建中…' : '在此目录创建项目'}
            </button>
            <button type="button" className="gewu-btn gewu-btn--ghost gewu-btn--sm" onClick={onClose} disabled={busy}>
              取消
            </button>
          </div>
        </div>
      )}
      {error && (
        <p className={styles.leftCreateError} role="alert" style={{ marginTop: 6 }}>{error}</p>
      )}
    </div>
  );
}
