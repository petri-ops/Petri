// ============================================================
// DesktopSettingsPanel — 记忆治理面板节（BLOCK-163 W3 P10/KNW-5）
//
// 数据源 = /api/ai/facts + /api/ai/summary + /api/ai/memory-stats（既有管理
// API，纯只读消费 + 单条删除 + 摘要清除）。治理语义：单条遗忘（事实）/
// 摘要清除（跨会话归档）——删除即从后续注入消失，不可恢复如实提示。
// ============================================================

import React, { useEffect, useState } from 'react';
import { getPlatformApiPrefix, getToken } from '@/lib/authClient';

interface FactRow {
  id: string | number;
  content: string;
  category?: string;
  pinned?: number;
  created_at?: string;
}

interface MemoryStats {
  status?: string;
  facts?: number;
  memories?: number;
}

function authHeaders(contentType?: string): Record<string, string> {
  const token = getToken();
  return {
    ...(contentType ? { 'content-type': contentType } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: authHeaders() });
  return (await response.json()) as T;
}

export function MemoryPanel(): React.ReactElement {
  const [facts, setFacts] = useState<FactRow[] | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [stats, setStats] = useState<MemoryStats | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let cancelled = false;
    const headers = authHeaders();
    void fetchJson<{ facts?: FactRow[] }>(`${getPlatformApiPrefix()}/ai/facts`)
      .then((data) => {
        if (!cancelled) setFacts(Array.isArray(data.facts) ? data.facts : []);
      })
      .catch(() => { if (!cancelled) setFacts([]); });
    void fetchJson<{ summary?: string }>(`${getPlatformApiPrefix()}/ai/summary`)
      .then((data) => {
        if (!cancelled) setSummary(typeof data.summary === 'string' ? data.summary : null);
      })
      .catch(() => { if (!cancelled) setSummary(null); });
    void fetchJson<MemoryStats>(`${getPlatformApiPrefix()}/ai/memory-stats`)
      .then((data) => {
        if (!cancelled && data?.status === 'ok') setStats(data);
      })
      .catch(() => { if (!cancelled) setStats(null); });
    return () => {
      cancelled = true;
    };
  }, []);

  async function deleteFact(id: string | number): Promise<void> {
    try {
      const response = await fetch(`${getPlatformApiPrefix()}/ai/facts/${encodeURIComponent(String(id))}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      if (!response.ok) throw new Error('删除失败');
      setFacts((prev) => (prev ?? []).filter((f) => f.id !== id));
      setNotice('该条事实已遗忘（后续注入不再包含）');
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  async function clearSummary(): Promise<void> {
    if (!confirm('确定清除跨会话对话摘要？清除后后续注入不再携带历史摘要（不可恢复）。')) return;
    try {
      const response = await fetch(`${getPlatformApiPrefix()}/ai/summary`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      if (!response.ok) throw new Error('清除失败');
      setSummary(null);
      setNotice('摘要已清除');
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  return (
    <div className="gewu-usage-resource">
      <div className="gewu-resource-heading">
        <div>
          <strong>Agent 记忆治理</strong>
          <p>
            跨会话注入的三层记忆：事实（自动抽取）、对话摘要（归档）、语义向量记忆。
            单条遗忘/清除后，后续注入不再包含（不可恢复，删除前请确认）。
          </p>
        </div>
      </div>

      {error && <p className="gewu-field__result gewu-field__result--err">{error}</p>}
      {notice && <p className="gewu-field__result gewu-field__result--ok">{notice}</p>}
      {stats && (
        <p className="gewu-field__hint">
          当前规模：{stats.facts ?? '—'} 条事实 · {stats.memories ?? '—'} 条向量记忆
        </p>
      )}

      <div className="gewu-resource-heading">
        <div><strong>已知事实（自动抽取）</strong></div>
      </div>
      {facts === null ? (
        <p className="gewu-field__hint">加载中…</p>
      ) : facts.length === 0 ? (
        <p className="gewu-field__hint">暂无事实——随着对话积累自动抽取。</p>
      ) : (
        <div style={{ display: 'grid', gap: 6 }}>
          {facts.map((fact) => (
            <div
              key={String(fact.id)}
              data-testid={`memory-fact-${fact.id}`}
              style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', border: '1px solid var(--gewu-border, rgba(128,128,128,0.25))', borderRadius: 6 }}
            >
              <code style={{ flex: 1, fontSize: 'var(--gewu-font-size-caption, 12px)' }}>
                {fact.category ? `[${fact.category}] ` : ''}{fact.content}
              </code>
              <button
                type="button"
                className="gewu-btn gewu-btn--danger-ghost gewu-btn--sm"
                title="单条遗忘：后续注入不再包含此事实"
                onClick={() => void deleteFact(fact.id)}
              >
                遗忘
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="gewu-resource-heading" style={{ marginTop: 12 }}>
        <div><strong>跨会话对话摘要（归档）</strong></div>
        {summary ? (
          <button type="button" className="gewu-btn gewu-btn--danger-ghost gewu-btn--sm" onClick={() => void clearSummary()}>
            清除摘要
          </button>
        ) : null}
      </div>
      {summary ? (
        <p style={{ fontSize: 'var(--gewu-font-size-caption, 12px)', color: 'var(--gewu-text-secondary)', whiteSpace: 'pre-wrap', maxHeight: 120, overflow: 'auto' }}>
          {summary}
        </p>
      ) : (
        <p className="gewu-field__hint">暂无归档摘要。</p>
      )}
    </div>
  );
}
