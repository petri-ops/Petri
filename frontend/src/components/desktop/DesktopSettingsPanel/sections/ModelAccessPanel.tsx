/**
 * ModelAccessPanel — BLOCK-346 T4 接线。
 *
 * 现状补口：后端 `GET/PUT /api/ai/model-access`（模型允许清单 + 逐模型理由账本）与
 * `GET /api/ai/reason-codes`（原因码词表）早已存在，但前端**零调用** —— 白名单只能
 * 手改 JSON 存储，原因码只能看到裸码值。本面板把两个只读/可写面接出来。
 *
 * 边界：白名单空=全放行（后端语义），面板如实标注「开放」；理由账本只做可解释，
 * 不参与判定（后端注释明示），面板不暗示它会改变放行结果。
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { getPlatformApiPrefix, getToken } from '@/lib/authClient';

interface ModelAccessState {
  mode: 'open' | 'allowlist';
  allowedModels: string[];
  reasonNotes: Record<string, string>;
}

interface ReasonCode {
  code?: string;
  category?: string;
  template?: string;
  description?: string;
}

function headers(): Record<string, string> {
  const out: Record<string, string> = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) out.Authorization = `Bearer ${token}`;
  return out;
}

/** textarea(每行 model=理由) → reasonNotes；非法行忽略并计数。 */
function parseNotes(text: string): { notes: Record<string, string>; invalid: number } {
  const notes: Record<string, string> = {};
  let invalid = 0;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const at = line.indexOf('=');
    if (at <= 0) { invalid += 1; continue; }
    const model = line.slice(0, at).trim();
    const note = line.slice(at + 1).trim();
    if (!model) { invalid += 1; continue; }
    notes[model] = note;
  }
  return { notes, invalid };
}

function notesToText(notes: Record<string, string>): string {
  return Object.entries(notes).map(([m, n]) => `${m}=${n}`).join('\n');
}

export function ModelAccessPanel(): React.ReactElement {
  const [state, setState] = useState<ModelAccessState | null>(null);
  const [modelsText, setModelsText] = useState('');
  const [notesText, setNotesText] = useState('');
  const [codes, setCodes] = useState<ReasonCode[]>([]);
  const [codesOpen, setCodesOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const applyState = useCallback((next: ModelAccessState) => {
    setState(next);
    setModelsText(next.allowedModels.join('\n'));
    setNotesText(notesToText(next.reasonNotes));
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(`${getPlatformApiPrefix()}/ai/model-access`, { headers: headers() });
        const body: unknown = await response.json();
        if (cancelled || !response.ok || !body || typeof body !== 'object') return;
        const record = body as Record<string, unknown>;
        applyState({
          mode: record.mode === 'allowlist' ? 'allowlist' : 'open',
          allowedModels: Array.isArray(record.allowedModels) ? record.allowedModels.map(String) : [],
          reasonNotes: (record.reasonNotes && typeof record.reasonNotes === 'object')
            ? record.reasonNotes as Record<string, string>
            : {},
        });
      } catch {
        if (!cancelled) setError('读取模型允许清单失败');
      }
    })();
    return () => { cancelled = true; };
  }, [applyState]);

  const loadCodes = useCallback(async () => {
    try {
      const response = await fetch(`${getPlatformApiPrefix()}/ai/reason-codes`, { headers: headers() });
      const body: unknown = await response.json();
      const record = body && typeof body === 'object' ? body as Record<string, unknown> : {};
      if (Array.isArray(record.reasons)) setCodes(record.reasons as ReasonCode[]);
    } catch {
      setError('读取原因码词表失败');
    }
  }, []);

  const toggleCodes = useCallback(() => {
    setCodesOpen((open) => {
      const next = !open;
      if (next && codes.length === 0) void loadCodes();
      return next;
    });
  }, [codes.length, loadCodes]);

  const save = useCallback(async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const allowedModels = modelsText.split('\n').map((m) => m.trim()).filter(Boolean);
      const { notes, invalid } = parseNotes(notesText);
      const response = await fetch(`${getPlatformApiPrefix()}/ai/model-access`, {
        method: 'PUT',
        headers: headers(),
        body: JSON.stringify({ allowedModels, reasonNotes: notes }),
      });
      const body: unknown = await response.json();
      const record = body && typeof body === 'object' ? body as Record<string, unknown> : {};
      if (!response.ok || record.status !== 'ok') {
        const detail = Array.isArray(record.diagnostics)
          ? (record.diagnostics as Array<{ message?: string }>).map((d) => d.message).filter(Boolean).join('；')
          : '';
        setError(detail || (typeof record.error === 'string' ? record.error : `HTTP ${response.status}`));
        return;
      }
      applyState({
        mode: record.mode === 'allowlist' ? 'allowlist' : 'open',
        allowedModels: Array.isArray(record.allowedModels) ? record.allowedModels.map(String) : [],
        reasonNotes: (record.reasonNotes && typeof record.reasonNotes === 'object')
          ? record.reasonNotes as Record<string, string>
          : {},
      });
      setMessage(invalid > 0 ? `已保存（${invalid} 行理由格式无效已忽略，格式：模型=理由）` : '已保存');
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败');
    } finally {
      setBusy(false);
    }
  }, [applyState, modelsText, notesText]);

  const grouped = useMemo(() => {
    const map = new Map<string, ReasonCode[]>();
    for (const code of codes) {
      const key = code.category || 'other';
      map.set(key, [...(map.get(key) || []), code]);
    }
    return [...map.entries()];
  }, [codes]);

  return (
    <div className="petri-field" data-testid="model-access-panel">
      <label className="petri-field__label">模型允许清单</label>
      <p className="petri-field__hint" data-testid="model-access-mode">
        {state
          ? (state.mode === 'allowlist'
            ? `白名单模式：仅 ${state.allowedModels.length} 个模型可用，其余在选择器中禁用并标注理由`
            : '开放模式：所有已配置模型均可用（留空即开放）')
          : '读取中…'}
      </p>
      <textarea
        className="petri-input"
        data-testid="model-access-models"
        rows={3}
        spellCheck={false}
        placeholder="每行一个模型名（如 doubao-seed-1.6）；留空=开放"
        value={modelsText}
        onChange={(e) => setModelsText(e.target.value)}
      />
      <p className="petri-field__hint">理由账本（每行 <code>模型=理由</code>，只做可解释，不参与放行判定）</p>
      <textarea
        className="petri-input"
        data-testid="model-access-notes"
        rows={3}
        spellCheck={false}
        placeholder="glm-4.6=预算内默认"
        value={notesText}
        onChange={(e) => setNotesText(e.target.value)}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          type="button"
          className="petri-btn petri-btn--ghost petri-btn--sm"
          data-testid="model-access-save"
          disabled={busy}
          onClick={() => void save()}
        >
          {busy ? '保存中…' : '保存'}
        </button>
        <button
          type="button"
          className="petri-btn petri-btn--ghost petri-btn--sm"
          data-testid="model-access-codes-toggle"
          onClick={toggleCodes}
        >
          {codesOpen ? '收起原因码词表' : '查看原因码词表'}
        </button>
        {message && <span className="petri-field__hint" data-testid="model-access-message">{message}</span>}
      </div>
      {error && <p className="petri-field__hint" role="alert" data-testid="model-access-error">{error}</p>}
      {codesOpen && (
        <div className="petri-field__hint" data-testid="reason-codes-list">
          {codes.length === 0 ? '读取中…' : grouped.map(([category, list]) => (
            <div key={category} style={{ marginTop: 6 }}>
              <strong>{category}</strong>
              <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
                {list.map((code) => (
                  <li key={code.code}>
                    <code>{code.code}</code>
                    {' — '}
                    {code.description || code.template || ''}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
