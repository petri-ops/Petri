import React, { useCallback, useEffect, useRef, useState } from 'react';
import { getBridge } from '@/lib/desktopBridge';
import type { InstallDeepLinkExpected, InstallDeepLinkPreview } from '@/lib/electron';

/**
 * BLOCK-242 — petri-install:// 深链安装预览弹层。
 *
 * 只读预览（名称/来源/下载地址/大小/SHA-256/风险/替换警告），用户显式确认后
 * 才经主进程安装；OS 推送与扩展页「从链接安装」共用同一流程。
 */

const RISK_LABELS: Record<string, string> = {
  unverified_source: '来源未验证（安装前请自行核对）',
  no_size_declared: '未声明文件大小',
  installs_mcp_servers: '将写入 MCP 配置',
  test_loopback_source: '本地测试来源（loopback）',
};

function reasonLabel(reason: string): string {
  if (reason.startsWith('replaces_pack:')) return `将替换已安装领域包 ${reason.slice('replaces_pack:'.length)}`;
  if (reason.startsWith('replaces_mcp:')) return `将替换已有 MCP 配置 ${reason.slice('replaces_mcp:'.length)}`;
  return RISK_LABELS[reason] || reason;
}

function formatBytes(value: number | null): string {
  if (typeof value !== 'number' || value <= 0) return '未声明';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

export function InstallDeepLinkDialog(): React.ReactElement | null {
  const [open, setOpen] = useState(false);
  const [urlInput, setUrlInput] = useState('');
  const [preview, setPreview] = useState<InstallDeepLinkPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState('');
  const [allowReplace, setAllowReplace] = useState(false);
  const lastHandled = useRef<{ url: string; at: number } | null>(null);

  const load = useCallback(async (url: string) => {
    const target = String(url || '').trim();
    if (!target) return;
    const bridge = getBridge('installDeepLink');
    if (!bridge) {
      setError('桌面桥不可用（仅桌面版支持从链接安装）。');
      setOpen(true);
      return;
    }
    setOpen(true);
    setLoading(true);
    setError('');
    setResult('');
    setAllowReplace(false);
    try {
      const response = await bridge.preview(target);
      if (response?.ok) {
        setPreview(response.preview);
      } else {
        setPreview(null);
        setError(`${(response && response.error) || 'preview_failed'}${response?.message ? `：${response.message}` : ''}`);
      }
    } catch (e) {
      setPreview(null);
      setError(e instanceof Error ? e.message : '预览失败。');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const bridge = getBridge('installDeepLink');
    if (!bridge) return () => undefined;
    const handle = (url: string) => {
      const now = Date.now();
      if (lastHandled.current && lastHandled.current.url === url && now - lastHandled.current.at < 5000) return;
      lastHandled.current = { url, at: now };
      void load(url);
    };
    const off = bridge.onDeepLink((payload) => {
      if (payload && typeof payload.url === 'string') handle(payload.url);
    });
    void bridge.pending()
      .then((payload) => {
        if (payload && typeof payload.url === 'string') handle(payload.url);
      })
      .catch(() => undefined);
    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent<{ url?: string }>).detail;
      setOpen(true);
      if (detail && detail.url) void load(detail.url);
    };
    window.addEventListener('petri:open-install-deep-link', onOpen);
    return () => {
      if (typeof off === 'function') off();
      window.removeEventListener('petri:open-install-deep-link', onOpen);
    };
  }, [load]);

  const install = async () => {
    if (!preview) return;
    const bridge = getBridge('installDeepLink');
    if (!bridge) return;
    const expected: InstallDeepLinkExpected | undefined = preview.kind === 'pack' && preview.pack
      ? {
        archive: {
          url: preview.pack.archive.url,
          sha256: preview.pack.archive.sha256,
          sizeBytes: preview.pack.archive.sizeBytes,
        },
      }
      : undefined;
    setInstalling(true);
    setError('');
    try {
      const response = await bridge.confirm({
        url: preview.link,
        expected,
        allowReplaceMcp: allowReplace,
      });
      if (response?.ok) {
        const name = preview.kind === 'pack'
          ? `领域包 ${response.packId || preview.pack?.packId || ''}`
          : `MCP 配置 ${response.serverId || preview.server?.id || ''}`;
        const restarted = response.requiresRestart ? '；需要重启应用后生效' : '';
        const mcp = response.mcpInstalled?.length ? `；已写入 MCP ${response.mcpInstalled.join('、')}` : '';
        const partial = response.partial ? '；部分 MCP 写入失败，请查看 MCP 货架' : '';
        setResult(`安装完成：${name}${mcp}${restarted}${partial}`);
        setPreview(null);
      } else {
        setError(`${(response && response.error) || 'install_failed'}${response?.message ? `：${response.message}` : ''}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '安装失败。');
    } finally {
      setInstalling(false);
    }
  };

  if (!open) return null;

  const hasMcpReplace = Boolean(preview && preview.requiresReplace.mcp.length > 0);
  const blocked = Boolean(error && !preview);

  return (
    <div
      data-testid="install-deep-link-dialog"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 90,
        display: 'grid',
        placeItems: 'center',
        background: 'var(--petri-overlay, rgba(4, 9, 20, 0.55))',
      }}
    >
      <div
        style={{
          width: 'min(640px, calc(100vw - 32px))',
          maxHeight: 'calc(100vh - 64px)',
          overflow: 'auto',
          padding: 20,
          border: '1px solid var(--petri-border-card)',
          borderRadius: 12,
          background: 'var(--petri-bg-elevated)',
          color: 'var(--petri-text)',
          boxShadow: 'var(--petri-shadow-float)',
        }}
      >
        <h2 style={{ margin: '0 0 10px', fontSize: 16 }}>从链接安装</h2>

        {!preview && (
          <div style={{ display: 'grid', gap: 8 }}>
            <label style={{ display: 'grid', gap: 4, fontSize: 12, color: 'var(--petri-text-tertiary)' }}>
              <span>安装链接（petri-install://）</span>
              <input
                data-testid="install-deep-link-url"
                value={urlInput}
                onChange={(event) => setUrlInput(event.target.value)}
                placeholder="petri-install://pack?manifest=https%3A%2F%2F..."
                style={{ minHeight: 30, padding: '0 8px', border: '1px solid var(--petri-border-input)', borderRadius: 6, background: 'var(--petri-input-bg)', color: 'var(--petri-text)' }}
              />
            </label>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" className="petri-btn petri-btn--ghost petri-btn--sm" onClick={() => setOpen(false)} data-testid="install-deep-link-cancel">
                取消
              </button>
              <button
                type="button"
                className="petri-btn petri-btn--primary petri-btn--sm"
                disabled={loading || !urlInput.trim()}
                onClick={() => void load(urlInput)}
                data-testid="install-deep-link-preview-button"
              >
                {loading ? '预览中…' : '预览'}
              </button>
            </div>
          </div>
        )}

        {preview && (
          <div style={{ display: 'grid', gap: 8, fontSize: 13 }} data-testid="install-deep-link-preview">
            <div><strong>{preview.kind === 'pack' ? '领域包' : 'MCP 配置'}</strong>
              {preview.kind === 'pack' && preview.pack ? ` · ${preview.pack.name}（${preview.pack.packId}）` : ''}
              {preview.kind === 'mcp' && preview.server ? ` · ${preview.server.name}（${preview.server.id}）` : ''}
            </div>
            {preview.kind === 'pack' && preview.pack && (
              <>
                <div>来源：{preview.source.host || '未知'} · <span title={preview.source.url || ''}>{preview.source.url}</span></div>
                <div>下载地址：<span title={preview.pack.archive.url}>{preview.pack.archive.url}</span></div>
                <div>大小：{formatBytes(preview.pack.archive.sizeBytes)} · SHA-256：<code title={preview.pack.archive.sha256}>{preview.pack.archive.sha256.slice(0, 16)}…</code></div>
                {preview.pack.mcpServers.length > 0 && (
                  <div>随包写入 MCP：{preview.pack.mcpServers.map((server) => server.id).join('、')}</div>
                )}
              </>
            )}
            {preview.kind === 'mcp' && preview.server && (
              <div>
                {preview.server.transport === 'http' ? `URL：${preview.server.url}` : `命令：${preview.server.command} ${(preview.server.args || []).join(' ')}`}
              </div>
            )}
            <div style={{ color: 'var(--petri-warning)' }}>
              风险：{preview.risk.reasons.map(reasonLabel).join('；') || '无'}
            </div>
            {hasMcpReplace && (
              <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <input
                  type="checkbox"
                  checked={allowReplace}
                  onChange={(event) => setAllowReplace(event.target.checked)}
                  data-testid="install-deep-link-replace-mcp"
                />
                <span>允许替换已有 MCP 配置（{preview.requiresReplace.mcp.join('、')}）</span>
              </label>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" className="petri-btn petri-btn--ghost petri-btn--sm" onClick={() => { setPreview(null); setOpen(false); }} data-testid="install-deep-link-cancel">
                取消
              </button>
              <button
                type="button"
                className="petri-btn petri-btn--primary petri-btn--sm"
                disabled={installing || (hasMcpReplace && !allowReplace)}
                onClick={() => void install()}
                data-testid="install-deep-link-install"
              >
                {installing ? '安装中…' : '安装'}
              </button>
            </div>
          </div>
        )}

        {loading && !preview && <p style={{ color: 'var(--petri-text-tertiary)' }}>正在读取 manifest（只读预览）…</p>}
        {error && <p role="alert" data-testid="install-deep-link-error" style={{ color: 'var(--petri-danger)' }}>{error}</p>}
        {result && (
          <div style={{ display: 'grid', gap: 8 }}>
            <p data-testid="install-deep-link-result">{result}</p>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button type="button" className="petri-btn petri-btn--primary petri-btn--sm" onClick={() => { setOpen(false); setResult(''); }}>完成</button>
            </div>
          </div>
        )}
        {blocked && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
            <button type="button" className="petri-btn petri-btn--ghost petri-btn--sm" onClick={() => { setError(''); setOpen(false); }}>关闭</button>
          </div>
        )}
      </div>
    </div>
  );
}