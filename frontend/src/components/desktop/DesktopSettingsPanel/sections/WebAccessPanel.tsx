import { useCallback, useEffect, useState } from 'react';
import { getPlatformApiPrefix, getToken } from '@/lib/authClient';
import styles from './SettingsQuickwins.module.css';

/**
 * WebAccessPanel — 联网检索与抓取的授权面（BLOCK-247 / Q2b）。
 *
 * 诚实边界（与后端 `web-search-config` / `web-fetch-policy` 同一口径）：
 *  · **默认关**：未开启时 `web_search` / `web_fetch` 直接拒绝（模型会拿到可读的
 *    拒绝原因，而不是空结果或假装搜过）。
 *  · **即时生效**：与「网络代理」不同，这里改完立刻生效（没有"需重启后端"话术）。
 *  · **只认自建检索实例**：SearXNG 不需要密钥；厂商搜索 API 暂不在本面（避免把
 *    凭据塞进普通配置文件）。
 *  · **抓取有硬边界**：拒绝本机/内网/保留地址、逐跳校验重定向、只收文本类内容、
 *    超时与字节上限都会如实标注在结果里（界面上也照抄这些约束，别写成"抓任意网页"）。
 */

interface WebAccessEffective {
  enabled: boolean;
  provider: string;
  searxngBaseUrl: string;
  maxResults: number;
  timeoutMs: number;
  fetchMaxBytes: number;
  allowedHosts: string;
  blockedHosts: string;
}

interface WebAccessSnapshot {
  effective: WebAccessEffective;
  stored: Partial<WebAccessEffective>;
  allowedHosts: string[];
  blockedHosts: string[];
  capabilities: { search: boolean; fetch: boolean };
  diagnostics: Array<{ code?: string; path?: string; message?: string }>;
}

const EMPTY: WebAccessEffective = {
  enabled: false,
  provider: 'none',
  searxngBaseUrl: '',
  maxResults: 5,
  timeoutMs: 10000,
  fetchMaxBytes: 1048576,
  allowedHosts: '',
  blockedHosts: '',
};

function authHeader(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function WebAccessPanel(): React.ReactElement {
  const [snapshot, setSnapshot] = useState<WebAccessSnapshot | null>(null);
  const [form, setForm] = useState<WebAccessEffective>({ ...EMPTY });
  const [notice, setNotice] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<Array<{ path?: string; message?: string }>>([]);
  const [busy, setBusy] = useState(false);

  const applySnapshot = useCallback((next: WebAccessSnapshot) => {
    setSnapshot(next);
    setForm({ ...EMPTY, ...next.effective });
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(`${getPlatformApiPrefix()}/web-access`, { headers: authHeader() });
        const data = (await response.json().catch(() => ({}))) as { status?: string; webAccess?: WebAccessSnapshot };
        if (!cancelled && response.ok && data.webAccess) applySnapshot(data.webAccess);
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
      const response = await fetch(`${getPlatformApiPrefix()}/web-access`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify(form),
      });
      const data = (await response.json().catch(() => ({}))) as {
        status?: string; webAccess?: WebAccessSnapshot; diagnostics?: Array<{ path?: string; message?: string }>; error?: string;
      };
      if (response.ok && data.status === 'ok' && data.webAccess) {
        applySnapshot(data.webAccess);
        setNotice('已保存并即时生效。');
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
    <div className={styles.panel} data-testid="web-access-panel">
      <div className="petri-settings-section__heading">
        <h4>联网检索与抓取</h4>
        <p>
          默认<strong>关闭</strong>。开启后 agent 才能使用 <code>web_search</code> / <code>web_fetch</code>；
          每次出网都会记录到审计（访问了哪个主机、拿到多少字节）。抓取拒绝本机与内网地址，
          重定向逐跳复检，只接受文本类内容。
        </p>
      </div>

      <div className={styles.field}>
        <label htmlFor="web-access-enabled">
          <input
            id="web-access-enabled"
            data-testid="web-access-enabled"
            type="checkbox"
            checked={form.enabled}
            onChange={(event) => setForm((prev) => ({ ...prev, enabled: event.target.checked }))}
          />
          {' '}允许联网检索与抓取
        </label>
        <span className={styles.hint}>
          当前：{snapshot?.capabilities.fetch ? '抓取可用' : '抓取不可用'} ·
          {' '}{snapshot?.capabilities.search ? '检索可用' : '检索不可用（未配置检索后端）'}
        </span>
      </div>

      <div className={styles.field}>
        <label htmlFor="web-access-provider">检索后端</label>
        <select
          id="web-access-provider"
          data-testid="web-access-provider"
          value={form.provider}
          onChange={(event) => setForm((prev) => ({ ...prev, provider: event.target.value }))}
        >
          <option value="none">不使用（仅允许抓取）</option>
          <option value="searxng">SearXNG（自建实例，无需密钥）</option>
        </select>
      </div>

      <div className={styles.field}>
        <label htmlFor="web-access-base-url">SearXNG 实例地址</label>
        <input
          id="web-access-base-url"
          data-testid="web-access-base-url"
          value={form.searxngBaseUrl}
          placeholder="http://127.0.0.1:8080"
          onChange={(event) => setForm((prev) => ({ ...prev, searxngBaseUrl: event.target.value }))}
        />
        <span className={styles.hint}>实例需开启 JSON 输出（search.formats 含 json），否则检索会返回可读错误而不是空结果。</span>
      </div>

      <div className={styles.field}>
        <label htmlFor="web-access-max-results">检索条数上限（1–20）</label>
        <input
          id="web-access-max-results"
          data-testid="web-access-max-results"
          type="number"
          min={1}
          max={20}
          value={form.maxResults}
          onChange={(event) => setForm((prev) => ({ ...prev, maxResults: Number(event.target.value) }))}
        />
      </div>

      <div className={styles.field}>
        <label htmlFor="web-access-timeout">单次请求超时（毫秒，1000–30000）</label>
        <input
          id="web-access-timeout"
          data-testid="web-access-timeout"
          type="number"
          min={1000}
          max={30000}
          step={500}
          value={form.timeoutMs}
          onChange={(event) => setForm((prev) => ({ ...prev, timeoutMs: Number(event.target.value) }))}
        />
      </div>

      <div className={styles.field}>
        <label htmlFor="web-access-max-bytes">单页抓取字节上限（64KB–4MB）</label>
        <input
          id="web-access-max-bytes"
          data-testid="web-access-max-bytes"
          type="number"
          min={65536}
          max={4194304}
          step={65536}
          value={form.fetchMaxBytes}
          onChange={(event) => setForm((prev) => ({ ...prev, fetchMaxBytes: Number(event.target.value) }))}
        />
      </div>

      <div className={styles.field}>
        <label htmlFor="web-access-allowed">访问白名单（逗号分隔域名，留空=不限制）</label>
        <input
          id="web-access-allowed"
          data-testid="web-access-allowed"
          value={form.allowedHosts}
          placeholder="example.org,docs.example.org"
          onChange={(event) => setForm((prev) => ({ ...prev, allowedHosts: event.target.value }))}
        />
      </div>

      <div className={styles.field}>
        <label htmlFor="web-access-blocked">访问黑名单（优先于白名单）</label>
        <input
          id="web-access-blocked"
          data-testid="web-access-blocked"
          value={form.blockedHosts}
          placeholder="tracker.example.net"
          onChange={(event) => setForm((prev) => ({ ...prev, blockedHosts: event.target.value }))}
        />
      </div>

      <div className={styles.actions}>
        <button type="button" className="petri-btn petri-btn--primary petri-btn--sm" disabled={busy} onClick={() => void save()}>
          {busy ? '保存中…' : '保存联网设置'}
        </button>
      </div>
      {notice && <p className={styles.hint} data-testid="web-access-notice">{notice}</p>}
      {diagnostics.length > 0 && (
        <div className={styles.diagnostics} data-testid="web-access-diagnostics">
          {diagnostics.map((row, index) => (
            <span key={`${row.path || 'diag'}-${index}`} className={styles.diagnosticRow}>
              {[row.path, row.message].filter(Boolean).join('：')}
            </span>
          ))}
        </div>
      )}
      {snapshot && snapshot.diagnostics.length > 0 && (
        <div className={styles.diagnostics} data-testid="web-access-config-diagnostics">
          {snapshot.diagnostics.map((row, index) => (
            <span key={`${row.path || 'cfg'}-${index}`} className={styles.diagnosticRow}>
              {[row.path, row.message].filter(Boolean).join('：')}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
