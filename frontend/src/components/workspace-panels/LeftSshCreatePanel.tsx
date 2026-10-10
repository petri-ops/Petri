// ============================================================
// UI-327 — 左栏行内 SSH 创建向导（globe 切换）。
// 步骤① connect：别名（~/.ssh/config）或 IP+密码（一次性装公钥，密码不存储）。
// 步骤② pick：终端式路径输入——打字即出候选目录（下方列表）、Tab 补全、
//        方向键选择、Enter 采纳；从 / 或 $HOME 开始均可。
// 全部远端访问走 ctx（连接/浏览/注册/创建），导航由 ctx.sshCreateAt 完成。
// ============================================================
import React, { useState, useRef, useEffect } from 'react';
import { Icon } from '@/components/icons/Icon';
import type { LeftPanelContext } from './LeftPanel';
import styles from '@/pages/project-workspace.module.css';

type SshCreateMode = 'alias' | 'password';

/** 最长公共前缀（Tab 多候选时补全到公共段）。 */
function longestCommonPrefix(paths: string[]): string {
  if (paths.length === 0) return '';
  let prefix = paths[0];
  for (const p of paths.slice(1)) {
    let i = 0;
    while (i < prefix.length && i < p.length && prefix[i] === p[i]) i += 1;
    prefix = prefix.slice(0, i);
  }
  return prefix;
}

/** 把 `/a/b/` 形态输入拆成 listDir 父目录与候选过滤前缀。 */
function splitInput(input: string): { parent: string; stub: string } | null {
  const raw = input.replace(/\\/g, '/').replace(/\/{2,}/g, '/');
  if (!raw.startsWith('/')) return null;
  if (raw.endsWith('/')) return { parent: raw.replace(/\/+$/, '') || '/', stub: '' };
  const cut = raw.lastIndexOf('/');
  if (cut < 0) return null;
  return { parent: cut === 0 ? '/' : raw.slice(0, cut), stub: raw.slice(cut + 1) };
}

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

  // pick 步骤状态（终端式路径输入）
  const [connectedAlias, setConnectedAlias] = useState('');
  const [pathInput, setPathInput] = useState('/');
  const [candidates, setCandidates] = useState<string[]>([]);
  const [highlight, setHighlight] = useState(-1);
  const [candidatesLoading, setCandidatesLoading] = useState(false);
  const debounceRef = useRef<number | null>(null);
  const listTokenRef = useRef(0);

  const inputStyle: React.CSSProperties = {
    width: '100%',
    boxSizing: 'border-box',
    marginBottom: 6,
    padding: '4px 8px',
    fontSize: 12,
  };

  const createDisabled = busy || !pathInput.trim().startsWith('/');

  /** 拉取候选：对当前输入的父目录做 fs_list，过滤 basename 前缀。
   *  aliasOverride：连接瞬间 state 尚未滚动，显式传入避免读到陈旧空值。 */
  const fetchCandidates = async (input: string, aliasOverride?: string): Promise<string[]> => {
    const parsed = splitInput(input);
    if (!parsed) {
      setError('路径必须以 / 开头');
      return [];
    }
    const effectiveAlias = aliasOverride ?? connectedAlias;
    const token = ++listTokenRef.current;
    setCandidatesLoading(true);
    setError('');
    try {
      const r = await ctx.sshListDirs(effectiveAlias, parsed.parent);
      if (token !== listTokenRef.current) return [];
      if (!r.ok) {
        setError(r.retryable ? `${r.error}（可重试）` : (r.error || '浏览失败'));
        return [];
      }
      const dirs = r.dirs || [];
      const actualParent = r.path || parsed.parent;
      const cands = dirs
        .filter((d) => d.name.startsWith(parsed.stub))
        .map((d) => ({ path: `${actualParent.replace(/\/+$/, '')}/${d.name}/`, name: d.name }))
        .sort((a, b) => a.name.localeCompare(b.name));
      setCandidates(cands.map((c) => c.path));
      setHighlight(-1);
      return cands.map((c) => c.path);
    } finally {
      if (token === listTokenRef.current) setCandidatesLoading(false);
    }
  };

  const scheduleCandidates = (input: string): void => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => { void fetchCandidates(input); }, 300);
  };

  useEffect(() => () => { if (debounceRef.current) window.clearTimeout(debounceRef.current); }, []);

  const completeTo = (path: string): void => {
    setPathInput(path);
    setCandidates([]);
    setHighlight(-1);
    void fetchCandidates(path);
  };

  const handleTab = async (): Promise<void> => {
    const parsed = splitInput(pathInput);
    if (!parsed) { setError('路径必须以 / 开头'); return; }
    // bash 语义：先按「父目录 + basename 前缀」过滤已加载候选（state 可能是上一层
    // 的未过滤列表），过滤后为空再发起远端拉取；单候选直接补全，多候选补全到公共前缀。
    const prefix = `${parsed.parent === '/' ? '' : parsed.parent}/`;
    let cands = candidates.filter(
      (c) => c.startsWith(prefix) && c.slice(prefix.length).split('/')[0].startsWith(parsed.stub),
    );
    if (cands.length === 0) cands = await fetchCandidates(pathInput);
    if (cands.length === 0) return;
    if (cands.length === 1) { completeTo(cands[0]); return; }
    const lcp = longestCommonPrefix(cands);
    if (lcp.length > pathInput.length) {
      setPathInput(lcp);
      if (lcp.endsWith('/')) { setCandidates([]); void fetchCandidates(lcp); }
    }
  };

  const handlePathKeyDown = async (e: React.KeyboardEvent<HTMLInputElement>): Promise<void> => {
    if (e.key === 'Tab') {
      e.preventDefault();
      (window as unknown as { __tabCompleted?: boolean }).__tabCompleted = true;
      await handleTab();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (candidates.length > 0) setHighlight((h) => Math.min(h + 1, candidates.length - 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, -1));
      return;
    }
    if (e.key === 'Enter') {
      if (highlight >= 0 && highlight < candidates.length) {
        e.preventDefault();
        completeTo(candidates[highlight]);
      } else if (candidates.length === 1) {
        e.preventDefault();
        completeTo(candidates[0]);
      }
      return;
    }
    if (e.key === 'Escape') {
      setCandidates([]);
      setHighlight(-1);
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
      // 连通性检测 + 取远端 $HOME 作为输入起点
      const conn = await ctx.sshConnectHost(effectiveAlias);
      if (!conn.ok) {
        setError(conn.retryable ? `${conn.error}（可重试）` : (conn.error || '连接失败'));
        return;
      }
      const start = `${(conn.home || '/').replace(/\/+$/, '')}/`;
      setPathInput(start);
      setStep('pick');
      void fetchCandidates(start, effectiveAlias);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  /** 创建用规范化路径：去掉尾斜杠（根目录除外）。 */
  const normalizedCreatePath = pathInput === '/' ? '/' : pathInput.replace(/\/+$/, '') || '/';
  const parentPath = normalizedCreatePath === '/' ? '/' : normalizedCreatePath.replace(/\/[^/]*$/, '') || '/';

  const handleCreate = async (): Promise<void> => {
    if (createDisabled) return;
    setBusy(true);
    setError('');
    try {
      const r = await ctx.sshCreateAt({ alias: connectedAlias, remotePath: normalizedCreatePath });
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

  return (
    <div
      style={{ padding: '8px 12px 10px', borderBottom: '1px solid var(--petri-border, rgba(128,128,128,0.25))' }}
      data-testid="left-ssh-create-panel"
    >
      {step === 'connect' ? (
        <form onSubmit={(e) => void handleConnect(e)}>
          <div style={{ display: 'flex', gap: 6, marginBottom: 6 }} role="tablist" aria-label="SSH 连接方式">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'alias'}
              className={`petri-btn petri-btn--sm ${mode === 'alias' ? '' : 'petri-btn--ghost'}`}
              onClick={() => { setMode('alias'); setError(''); }}
            >
              别名
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'password'}
              className={`petri-btn petri-btn--sm ${mode === 'password' ? '' : 'petri-btn--ghost'}`}
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
            <button type="submit" className="petri-btn petri-btn--sm" disabled={busy}>
              {busy ? '连接中…' : '连接'}
            </button>
            <button type="button" className="petri-btn petri-btn--ghost petri-btn--sm" onClick={onClose} disabled={busy}>
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
              className="petri-btn petri-btn--ghost petri-btn--sm"
              onClick={() => { const p = parentPath === '/' ? '/' : `${parentPath}/`; setPathInput(p); void fetchCandidates(p); }}
              disabled={candidatesLoading || normalizedCreatePath === '/'}
              title="返回上级目录"
            >
              上级
            </button>
            <button
              type="button"
              className="petri-btn petri-btn--ghost petri-btn--sm"
              onClick={() => { void fetchCandidates(pathInput); }}
              disabled={candidatesLoading}
              title="刷新候选"
              aria-label="刷新候选"
            >
              <Icon name="repeat" size={12} />
            </button>
          </div>
          {/* UI-327 加映 — 创建按钮置于路径输入框右侧（用户裁决） */}
          <div style={{ display: 'flex', gap: 6, alignItems: 'stretch' }}>
            <input
              className={styles.treeRenameInput}
              style={{ flex: 1, minWidth: 0, boxSizing: 'border-box', marginBottom: 4, padding: '4px 8px', fontSize: 12, fontFamily: 'monospace' }}
              type="text"
              value={pathInput}
              onChange={(e) => { setPathInput(e.target.value); scheduleCandidates(e.target.value); }}
              onKeyDown={(e) => void handlePathKeyDown(e)}
              placeholder="/home/you/project（Tab 补全）"
              aria-label="远端路径（Tab 补全）"
              data-testid="ssh-path-input"
              autoFocus
            />
            <button
              type="button"
              className="petri-btn petri-btn--sm"
              style={{ marginBottom: 4, whiteSpace: 'nowrap' }}
              onClick={() => void handleCreate()}
              disabled={createDisabled}
              title={`在 ${normalizedCreatePath} 创建远程项目`}
            >
              {busy ? '创建中…' : '创建项目'}
            </button>
          </div>
          <div
            style={{ maxHeight: 180, overflowY: 'auto', border: '1px solid var(--petri-border, rgba(128,128,128,0.25))', borderRadius: 6, marginBottom: 4 }}
            data-testid="ssh-path-candidates"
          >
            {candidatesLoading ? (
              <p style={{ padding: '6px 10px', fontSize: 12, opacity: 0.7, margin: 0 }}>读取目录…</p>
            ) : candidates.length === 0 ? (
              <p style={{ padding: '6px 10px', fontSize: 12, opacity: 0.7, margin: 0 }}>无候选（继续输入或 Tab 刷新）</p>
            ) : (
              candidates.map((cand, idx) => (
                <button
                  key={cand}
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); completeTo(cand); }}
                  onMouseEnter={() => setHighlight(idx)}
                  title={cand}
                  style={{
                    display: 'block', width: '100%', textAlign: 'left', padding: '4px 10px', fontSize: 12,
                    background: idx === highlight ? 'var(--petri-accent-weak, rgba(128,0,255,0.12))' : 'none',
                    border: 'none', cursor: 'pointer', color: 'inherit', fontFamily: 'monospace',
                  }}
                >
                  {cand}
                </button>
              ))
            )}
          </div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 4 }}>
            <button type="button" className="petri-btn petri-btn--ghost petri-btn--sm" onClick={onClose} disabled={busy}>
              取消
            </button>
          </div>
          <p style={{ fontSize: 11, opacity: 0.65, margin: '6px 0 0' }}>Tab 补全 · ↓↑ 选候选 · Enter 采纳</p>
          {error && (
            <p className={styles.leftCreateError} role="alert" style={{ marginTop: 6 }}>{error}</p>
          )}
        </div>
      )}
      {step === 'connect' && error && (
        <p className={styles.leftCreateError} role="alert" style={{ marginTop: 6 }}>{error}</p>
      )}
    </div>
  );
}
