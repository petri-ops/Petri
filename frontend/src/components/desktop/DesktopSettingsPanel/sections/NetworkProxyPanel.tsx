import { useCallback, useEffect, useState } from 'react';
import { getPlatformApiPrefix, getToken } from '@/lib/authClient';
import styles from './SettingsQuickwins.module.css';

/**
 * NetworkProxyPanel — 网络代理与自签 CA（BLOCK-202 W3 / P0-4）。
 *
 * 诚实边界（与后端 `network-config` 同一口径）：
 *  · 代理与 CA 只在**后端进程启动时**被 Node 读取，所以保存后必须提示「需重启后端生效」，
 *    界面同时并列「已配置」与「已应用」两份事实，不谎称即时生效；
 *  · NO_PROXY 由后端强制并入 localhost / 127.0.0.1 / ::1——**本地回环永不走代理**，
 *    网关与隧道自检不受影响；UI 只显示结果，不提供关掉回环豁免的开关；
 *  · 只存 CA 文件路径，不存证书内容；文件不存在时后端回诊断，本面板原样展示。
 */

interface NetworkSnapshot {
  configured: { httpProxy: string; httpsProxy: string; noProxy: string; caFile: string };
  applied: { httpProxy: string; httpsProxy: string; noProxy: string; caFile: string; noProxyEffective?: string } | null;
  noProxyEffective: string;
  restartRequired: boolean;
  diagnostics: Array<{ code?: string; path?: string; message?: string }>;
}

const EMPTY = { httpProxy: '', httpsProxy: '', noProxy: '', caFile: '' };

function authHeader(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function NetworkProxyPanel(): React.ReactElement {
  const [snapshot, setSnapshot] = useState<NetworkSnapshot | null>(null);
  const [form, setForm] = useState({ ...EMPTY });
  const [notice, setNotice] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<Array<{ path?: string; message?: string }>>([]);
  const [busy, setBusy] = useState(false);

  const applySnapshot = useCallback((next: NetworkSnapshot) => {
    setSnapshot(next);
    setForm({ ...EMPTY, ...next.configured });
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(`${getPlatformApiPrefix()}/network`, { headers: authHeader() });
        const data = (await response.json().catch(() => ({}))) as { status?: string; network?: NetworkSnapshot };
        if (!cancelled && response.ok && data.network) applySnapshot(data.network);
        else if (!cancelled) setNotice('加载失败');
      } catch {
        if (!cancelled) setNotice('加载失败');
      }
    })();
    return () => { cancelled = true; };
  }, [applySnapshot]);

  const save = useCallback(async (): Promise<void> => {
    setBusy(true);
    setNotice(null);
    setDiagnostics([]);
    try {
      const response = await fetch(`${getPlatformApiPrefix()}/network`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify(form),
      });
      const data = (await response.json().catch(() => ({}))) as {
        status?: string; network?: NetworkSnapshot; diagnostics?: Array<{ path?: string; message?: string }>; error?: string;
      };
      if (response.ok && data.status === 'ok' && data.network) {
        applySnapshot(data.network);
        setNotice('已保存。代理与 CA 需重启后端生效（当前生效值见下方）。');
      } else {
        setDiagnostics(data.diagnostics || [{ message: data.error || `HTTP ${response.status}` }]);
      }
    } catch (error) {
      setDiagnostics([{ message: error instanceof Error ? error.message : String(error) }]);
    } finally {
      setBusy(false);
    }
  }, [form, applySnapshot]);

  return (
    <div className={styles.panel} data-testid="network-proxy-panel">
      <div className="petri-settings-section__heading">
        <h4>网络代理与自签 CA</h4>
        <p>
          企业代理或自签证书场景使用。<strong>保存后需重启后端生效</strong>；本地回环
          （localhost / 127.0.0.1 / ::1）始终绕过代理，网关与隧道自检不受影响。
        </p>
      </div>

      {snapshot?.restartRequired && (
        <div className={styles.banner} data-tone="conflict" data-testid="network-restart-required">
          配置已改变但尚未生效：请重启后端（设置页不会谎称已生效）。
        </div>
      )}

      <div className={styles.field}>
        <label htmlFor="network-http-proxy">HTTP 代理</label>
        <input
          id="network-http-proxy"
          data-testid="network-http-proxy"
          value={form.httpProxy}
          placeholder="http://127.0.0.1:7890"
          onChange={(event) => setForm((prev) => ({ ...prev, httpProxy: event.target.value }))}
        />
      </div>
      <div className={styles.field}>
        <label htmlFor="network-https-proxy">HTTPS 代理</label>
        <input
          id="network-https-proxy"
          data-testid="network-https-proxy"
          value={form.httpsProxy}
          placeholder="http://127.0.0.1:7890"
          onChange={(event) => setForm((prev) => ({ ...prev, httpsProxy: event.target.value }))}
        />
      </div>
      <div className={styles.field}>
        <label htmlFor="network-no-proxy">NO_PROXY 追加项</label>
        <input
          id="network-no-proxy"
          data-testid="network-no-proxy"
          value={form.noProxy}
          placeholder=".internal.example.com,10.0.0.0/8"
          onChange={(event) => setForm((prev) => ({ ...prev, noProxy: event.target.value }))}
        />
        <span className={styles.hint}>生效值（含强制回环豁免）：{snapshot?.noProxyEffective || 'localhost,127.0.0.1,::1'}</span>
      </div>
      <div className={styles.field}>
        <label htmlFor="network-ca-file">自签 CA 文件（PEM 绝对路径）</label>
        <input
          id="network-ca-file"
          data-testid="network-ca-file"
          value={form.caFile}
          placeholder="/path/to/ca.crt"
          onChange={(event) => setForm((prev) => ({ ...prev, caFile: event.target.value }))}
        />
        <span className={styles.hint}>只保存路径，不保存证书内容；文件不存在时不会设置 NODE_EXTRA_CA_CERTS。</span>
      </div>

      <div className={styles.actions}>
        <button type="button" className="petri-btn petri-btn--primary petri-btn--sm" disabled={busy} onClick={() => void save()}>
          {busy ? '保存中…' : '保存网络配置'}
        </button>
        {snapshot?.applied && (
          <span className={styles.toolbarMeta} data-testid="network-applied">
            已应用：{snapshot.applied.httpsProxy || snapshot.applied.httpProxy || '直连'} · NO_PROXY={snapshot.applied.noProxyEffective || '—'}
          </span>
        )}
      </div>
      {notice && <p className={styles.hint} data-testid="network-notice">{notice}</p>}
      {diagnostics.length > 0 && (
        <div className={styles.diagnostics} data-testid="network-diagnostics">
          {diagnostics.map((row, index) => (
            <span key={`${row.path || 'diag'}-${index}`} className={styles.diagnosticRow}>
              {[row.path, row.message].filter(Boolean).join('：')}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
