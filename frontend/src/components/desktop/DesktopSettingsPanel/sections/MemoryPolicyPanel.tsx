/**
 * MemoryPolicyPanel — BLOCK-346 T4 追加（零消费端点接线）。
 *
 * 现状补口：`GET|PUT /api/ai/memory-policy` 与 `POST /api/ai/memory-wipe` 后端齐备
 * 但前端零调用 —— 记忆压缩策略只能改 JSON 文件，「改了到底生效没有」也不可见
 * （后端 `effectiveSnapshot()` 专门返回 sources 就是为这个）。
 *
 * 边界：
 * - `readonlyKeys`（如 embeddingModel）只读：换模型会让已存向量全部失效，后端会拒写，前端直接 disabled。
 * - 清空记忆是破坏性操作，需二次点击确认（首次点击只切文案，不发送请求）。
 */

import React, { useCallback, useEffect, useState } from 'react';
import { getPlatformApiPrefix, getToken } from '@/lib/authClient';

interface Snapshot {
  path?: string;
  values: Record<string, unknown>;
  sources: Record<string, string>;
  defaults: Record<string, unknown>;
  readonlyKeys: string[];
}

function headers(json = false): Record<string, string> {
  const out: Record<string, string> = {};
  if (json) out['Content-Type'] = 'application/json';
  const token = getToken();
  if (token) out.Authorization = `Bearer ${token}`;
  return out;
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
}

function toInput(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return value;
  return '';
}

function parseInput(raw: string, fallback: unknown): unknown {
  const text = raw.trim();
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (text !== '' && !Number.isNaN(Number(text)) && typeof fallback === 'number') return Number(text);
  return text === '' ? fallback : text;
}

export function MemoryPolicyPanel(): React.ReactElement {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [wiping, setWiping] = useState(false);
  const [confirmWipe, setConfirmWipe] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const apply = useCallback((next: Snapshot) => {
    setSnapshot(next);
    const nextDraft: Record<string, string> = {};
    for (const [k, v] of Object.entries(next.values)) nextDraft[k] = toInput(v);
    setDraft(nextDraft);
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch(`${getPlatformApiPrefix()}/ai/memory-policy`, { headers: headers() });
        const body: unknown = await response.json();
        const record = asRecord(body);
        if (!response.ok || record.status !== 'ok') {
          setError(typeof record.error === 'string' ? record.error : `HTTP ${response.status}`);
          return;
        }
        apply({
          path: typeof record.path === 'string' ? record.path : undefined,
          values: asRecord(record.values),
          sources: asRecord(record.sources) as Record<string, string>,
          defaults: asRecord(record.defaults),
          readonlyKeys: Array.isArray(record.readonlyKeys) ? record.readonlyKeys.map(String) : [],
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : '读取记忆策略失败');
      }
    })();
  }, [apply]);

  const save = useCallback(async () => {
    if (!snapshot) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      const values: Record<string, unknown> = {};
      for (const [k, raw] of Object.entries(draft)) {
        values[k] = parseInput(raw, snapshot.values[k]);
      }
      const response = await fetch(`${getPlatformApiPrefix()}/ai/memory-policy`, {
        method: 'PUT',
        headers: headers(true),
        body: JSON.stringify(values),
      });
      const body: unknown = await response.json();
      const record = asRecord(body);
      if (!response.ok || record.status !== 'ok') {
        const diagnostics = Array.isArray(record.diagnostics)
          ? (record.diagnostics as Array<{ message?: string }>).map((d) => d.message).filter(Boolean).join('；')
          : '';
        setError(diagnostics || (typeof record.error === 'string' ? record.error : `HTTP ${response.status}`));
        return;
      }
      setNotice('已保存；重新读取以确认生效来源');
      const reread = await fetch(`${getPlatformApiPrefix()}/ai/memory-policy`, { headers: headers() });
      const rereadBody: unknown = await reread.json();
      const rereadRecord = asRecord(rereadBody);
      if (reread.ok && rereadRecord.status === 'ok') {
        apply({
          path: typeof rereadRecord.path === 'string' ? rereadRecord.path : undefined,
          values: asRecord(rereadRecord.values),
          sources: asRecord(rereadRecord.sources) as Record<string, string>,
          defaults: asRecord(rereadRecord.defaults),
          readonlyKeys: Array.isArray(rereadRecord.readonlyKeys) ? rereadRecord.readonlyKeys.map(String) : [],
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败');
    } finally {
      setBusy(false);
    }
  }, [apply, draft, snapshot]);

  const wipe = useCallback(async () => {
    if (!confirmWipe) { setConfirmWipe(true); setNotice('再次点击「确认清空」才会真正删除'); return; }
    setWiping(true); setError(null); setNotice(null);
    try {
      const response = await fetch(`${getPlatformApiPrefix()}/ai/memory-wipe`, {
        method: 'POST',
        headers: headers(true),
      });
      const body: unknown = await response.json();
      const record = asRecord(body);
      if (!response.ok || record.status !== 'ok') {
        setError(typeof record.error === 'string' ? record.error : `HTTP ${response.status}`);
        return;
      }
      const removed = typeof record.removed === 'number' ? record.removed : 0;
      setNotice(`已清空当前项目范围的记忆（删除 ${removed} 条记录）`);
      setConfirmWipe(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : '清空失败');
    } finally {
      setWiping(false);
    }
  }, [confirmWipe]);

  if (!snapshot) {
    return (
      <div className="petri-field" data-testid="memory-policy-panel">
        <label className="petri-field__label">记忆压缩策略</label>
        <p className="petri-field__hint">{error || '读取中…'}</p>
      </div>
    );
  }

  const keys = Object.keys(snapshot.values);

  return (
    <div className="petri-field" data-testid="memory-policy-panel">
      <label className="petri-field__label">记忆压缩策略</label>
      <p className="petri-field__hint">
        生效来源标注为「文件」表示已覆盖默认值；「默认」表示沿用内置常量（改后保存即写入）。
        {snapshot.path ? ` 存储：${snapshot.path}` : ''}
      </p>
      <div style={{ display: 'grid', gap: 6 }}>
        {keys.map((key) => {
          const readonly = snapshot.readonlyKeys.includes(key);
          const source = snapshot.sources[key] || 'default';
          return (
            <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ minWidth: 220 }}>
                <code>{key}</code>
                <span className="petri-field__hint">（{source === 'file' ? '文件' : '默认'}{readonly ? ' · 只读' : ''}）</span>
              </span>
              <input
                className="petri-input"
                data-testid={`memory-policy-${key}`}
                value={draft[key] ?? ''}
                disabled={readonly}
                onChange={(e) => setDraft((prev) => ({ ...prev, [key]: e.target.value }))}
                style={{ maxWidth: 180 }}
              />
            </div>
          );
        })}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
        <button
          type="button"
          className="petri-btn petri-btn--ghost petri-btn--sm"
          data-testid="memory-policy-save"
          disabled={busy}
          onClick={() => void save()}
        >
          {busy ? '保存中…' : '保存'}
        </button>
        <button
          type="button"
          className="petri-btn petri-btn--ghost petri-btn--sm"
          data-testid="memory-wipe"
          disabled={wiping}
          onClick={() => void wipe()}
        >
          {wiping ? '清空中…' : (confirmWipe ? '确认清空（不可恢复）' : '清空本项目记忆')}
        </button>
        {confirmWipe && !wiping && <span className="petri-field__hint">破坏性操作：再点一次才执行</span>}
        {notice && <span className="petri-field__hint" data-testid="memory-policy-notice">{notice}</span>}
      </div>
      {error && <p className="petri-field__hint" role="alert" data-testid="memory-policy-error">{error}</p>}
    </div>
  );
}
