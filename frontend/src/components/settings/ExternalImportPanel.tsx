import { useCallback, useMemo, useState } from 'react';
import { getApiPrefix } from '@/components/copilot/copilotClient/apiBase';

/**
 * BLOCK-264（C-35）— 外部 Agent 配置导入应用面（设置页「常规」节）。
 *
 * 链路：粘贴配置 → preview（只读）→ 勾选键 → 两步确认 apply（服务端重推导）→
 * 可按 applyId 回滚。凭据键永远不会出现在 patch（后端结构性排除），面板再展示
 * credentialsDetected 供知情。
 */

interface PreviewResult {
  ok: boolean;
  patch?: Record<string, unknown>;
  credentialsDetected?: string[];
  unsupported?: { what: string }[];
  notes?: { what: string; value?: unknown; hint?: string }[];
  diagnostics?: { code: string; message?: string }[];
  error?: string;
}

interface ApplyResult {
  ok: boolean;
  status?: string;
  appliedKeys?: string[];
  applyId?: string | null;
  rollbackAvailable?: boolean;
  note?: string;
  error?: string;
}

const SOURCE_OPTIONS = [
  { id: 'codex', label: 'Codex（TOML）' },
  { id: 'zcode', label: 'ZCode（JSON）' },
] as const;

export function ExternalImportPanel({ apiBase }: { apiBase?: string } = {}) {
  const base = apiBase ?? getApiPrefix();
  const [source, setSource] = useState<string>('codex');
  const [content, setContent] = useState('');
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [applyResult, setApplyResult] = useState<ApplyResult | null>(null);
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  const patchKeys = useMemo(() => (preview?.patch ? Object.keys(preview.patch) : []), [preview]);

  // 输入变化即失效预览结果（render 期对 key 做受控重置，避免 effect 内同步 setState 级联）
  const [inputKey, setInputKey] = useState('');
  const currentKey = `${source}\u0000${content}`;
  if (inputKey !== currentKey) {
    setInputKey(currentKey);
    setPreview(null);
    setApplyResult(null);
    setArmed(false);
    setSelected(new Set());
    setMessage('');
  }

  const callApi = useCallback(async (path: string, body: unknown) => {
    const resp = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: resp.status, data: (await resp.json()) as Record<string, unknown> };
  }, [base]);

  const handlePreview = async () => {
    setBusy(true);
    setMessage('');
    setApplyResult(null);
    setArmed(false);
    try {
      const { status, data } = await callApi('/import/external-agent/preview', { source, content });
      if (status !== 200) {
        setPreview({ ok: false, error: typeof data.error === 'string' ? data.error : 'preview_failed' });
        return;
      }
      const result = data as unknown as PreviewResult;
      setPreview(result);
      setSelected(new Set(result.patch ? Object.keys(result.patch) : []));
    } catch {
      setPreview({ ok: false, error: 'network_error' });
    } finally {
      setBusy(false);
    }
  };

  const handleApply = async () => {
    setBusy(true);
    setMessage('');
    try {
      const { status, data } = await callApi('/import/external-agent/apply', {
        source,
        content,
        selectedKeys: patchKeys.filter((k) => selected.has(k)),
      });
      const result = data as unknown as ApplyResult;
      const okApply = status === 200 && !data.error;
      const errText = typeof result.error === 'string' ? result.error : 'apply_failed';
      setApplyResult(okApply ? { ...result, ok: true } : { ok: false, error: errText });
      setArmed(false);
    } catch {
      setApplyResult({ ok: false, error: 'network_error' });
    } finally {
      setBusy(false);
    }
  };

  const handleRollback = async () => {
    if (!applyResult?.applyId) return;
    setBusy(true);
    try {
      const { status, data } = await callApi('/import/external-agent/rollback', { applyId: applyResult.applyId });
      if (status === 200) {
        const restored = Array.isArray(data.restoredKeys) ? (data.restoredKeys as string[]).join('、') : '';
        setMessage(`已回滚（${restored || '无键'}）`);
        setApplyResult(null);
      } else {
        const rbErr = typeof data.error === 'string' ? data.error : String(status);
        setMessage(`回滚失败：${rbErr}`);
      }
    } catch {
      setMessage('回滚失败：network_error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section data-external-import-panel aria-label="外部配置导入">
      <h4>从外部 Agent 导入配置</h4>
      <p className="petr-hint">只读预览 → 勾选确认 → 应用（可回滚）；凭据永不导入。</p>

      <div>
        {SOURCE_OPTIONS.map((opt) => (
          <label key={opt.id}>
            <input
              type="radio"
              name="external-import-source"
              value={opt.id}
              checked={source === opt.id}
              onChange={() => setSource(opt.id)}
            />
            {opt.label}
          </label>
        ))}
      </div>

      <textarea
        data-external-import-content
        rows={5}
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder='粘贴配置内容，例如 Codex 的 config.toml 片段'
        spellCheck={false}
      />

      <button type="button" className="petri-btn petri-btn--ghost petri-btn--sm" onClick={() => void handlePreview()} disabled={busy || !content.trim()}>
        预览（不写盘）
      </button>

      {preview && !preview.ok && (
        <p data-external-import-error role="alert">无法解析：{preview.error}</p>
      )}

      {preview?.ok && (
        <div data-external-import-preview>
          {patchKeys.length === 0 && <p>没有可映射的键。</p>}
          {patchKeys.map((key) => (
            <label key={key} data-external-import-key={key}>
              <input
                type="checkbox"
                checked={selected.has(key)}
                onChange={(e) => {
                  const next = new Set(selected);
                  if (e.target.checked) next.add(key);
                  else next.delete(key);
                  setSelected(next);
                }}
              />
              <code>{key}</code> = <code>{String(preview.patch?.[key])}</code>
            </label>
          ))}
          {(preview.credentialsDetected?.length ?? 0) > 0 && (
            <p data-external-import-credentials>检测到凭据键（{preview.credentialsDetected!.length} 个）——已排除，永不导入。</p>
          )}
          {(preview.unsupported?.length ?? 0) > 0 && (
            <p>不支持的键：{preview.unsupported!.map((u) => u.what).join('、')}</p>
          )}

          {!armed ? (
            <button type="button" className="petri-btn petri-btn--sm" onClick={() => setArmed(true)} disabled={busy || selected.size === 0}>
              应用所选（{selected.size}）
            </button>
          ) : (
            <span data-external-import-confirm>
              <span>确认写入 {selected.size} 个键？</span>
              <button type="button" className="petri-btn petri-btn--sm" onClick={() => void handleApply()} disabled={busy}>
                确认应用
              </button>
              <button type="button" className="petri-btn petri-btn--ghost petri-btn--sm" onClick={() => setArmed(false)} disabled={busy}>
                取消
              </button>
            </span>
          )}
        </div>
      )}

      {applyResult?.ok && (
        <div data-external-import-applied>
          <p>
            已应用：{(applyResult.appliedKeys || []).join('、') || '（无）'}
            {applyResult.rollbackAvailable ? '（可回滚）' : ''}
          </p>
          {applyResult.rollbackAvailable && applyResult.applyId && (
            <button type="button" className="petri-btn petri-btn--ghost petri-btn--sm" onClick={() => void handleRollback()} disabled={busy}>
              回滚这次导入
            </button>
          )}
        </div>
      )}
      {applyResult && !applyResult.ok && (
        <p data-external-import-error role="alert">应用失败：{applyResult.error}</p>
      )}
      {message && <p data-external-import-message>{message}</p>}
    </section>
  );
}
