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
  status?: string;
  superseded_by?: string | null;
  created_at?: string;
}

interface MemoryAuditEvent {
  actor?: string;
  action?: string;
  factId?: string | null;
  detail?: string | null;
  createdAt?: string;
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
  const [audit, setAudit] = useState<MemoryAuditEvent[] | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let cancelled = false;
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
    // BLOCK-182 — 记忆全链审计最近 20 条（衰减/纠错/合并/替代可回放）。
    void fetchJson<{ events?: MemoryAuditEvent[] }>(`${getPlatformApiPrefix()}/ai/memory-audit?limit=20`)
      .then((data) => {
        if (!cancelled) setAudit(Array.isArray(data.events) ? data.events : []);
      })
      .catch(() => { if (!cancelled) setAudit([]); });
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

  // BLOCK-182 纠错流（免费直生效）：PUT 内容变化由后端自动 superseded 替代链+插入修正行。
  async function correctFact(id: string | number, current: string): Promise<void> {
    const corrected = prompt('纠正这条事实（旧条目将标记为「已替代」，修正版立即生效）：', current);
    if (corrected === null || corrected.trim() === '' || corrected.trim() === current.trim()) return;
    try {
      const response = await fetch(`${getPlatformApiPrefix()}/ai/facts/${encodeURIComponent(String(id))}`, {
        method: 'PUT',
        headers: authHeaders('application/json'),
        body: JSON.stringify({ content: corrected.trim() }),
      });
      if (!response.ok) throw new Error('纠正失败');
      setNotice('已纠正：旧条目标记为已替代（替代链可在下方审计中追溯），修正版立即生效');
      setError('');
      const data = await fetchJson<{ facts?: FactRow[] }>(`${getPlatformApiPrefix()}/ai/facts`);
      setFacts(Array.isArray(data.facts) ? data.facts : []);
      const events = await fetchJson<{ events?: MemoryAuditEvent[] }>(`${getPlatformApiPrefix()}/ai/memory-audit?limit=20`);
      setAudit(Array.isArray(events.events) ? events.events : []);
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
    <div className="petri-usage-resource">
      <div className="petri-resource-heading">
        <div>
          <strong>Agent 记忆治理</strong>
          <p>
            跨会话注入的三层记忆：事实（自动抽取）、对话摘要（归档）、语义向量记忆。
            单条遗忘/清除后，后续注入不再包含（不可恢复，删除前请确认）。
          </p>
        </div>
      </div>

      {error && <p className="petri-field__result petri-field__result--err">{error}</p>}
      {notice && <p className="petri-field__result petri-field__result--ok">{notice}</p>}
      {stats && (
        <p className="petri-field__hint">
          当前规模：{stats.facts ?? '—'} 条事实 · {stats.memories ?? '—'} 条向量记忆
        </p>
      )}

      <div className="petri-resource-heading">
        <div><strong>已知事实（自动抽取）</strong></div>
      </div>
      {facts === null ? (
        <p className="petri-field__hint">加载中…</p>
      ) : facts.length === 0 ? (
        <p className="petri-field__hint">暂无事实——随着对话积累自动抽取。</p>
      ) : (
        <div style={{ display: 'grid', gap: 6 }}>
          {facts.map((fact) => {
            const status = fact.status || 'active';
            const retired = status !== 'active';
            return (
              <div
                key={String(fact.id)}
                data-testid={`memory-fact-${fact.id}`}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', border: '1px solid var(--petri-border, rgba(128,128,128,0.25))', borderRadius: 6, opacity: retired ? 0.55 : 1 }}
              >
                <code style={{ flex: 1, fontSize: 'var(--petri-font-size-sm)' }}>
                  {fact.category ? `[${fact.category}] ` : ''}{fact.content}
                  {retired && (
                    <span style={{ marginLeft: 6, color: 'var(--petri-text-secondary)' }}>
                      （{status === 'superseded' ? '已替代' : '已衰减'}{fact.superseded_by ? ` → ${fact.superseded_by}` : ''}）
                    </span>
                  )}
                </code>
                {!retired && (
                  <button
                    type="button"
                    className="petri-btn petri-btn--ghost petri-btn--sm"
                    title="纠正：旧条目标记已替代，修正版立即生效（免费直生效）"
                    onClick={() => void correctFact(fact.id, fact.content)}
                  >
                    纠错
                  </button>
                )}
                <button
                  type="button"
                  className="petri-btn petri-btn--danger-ghost petri-btn--sm"
                  title="单条遗忘：后续注入不再包含此事实"
                  onClick={() => void deleteFact(fact.id)}
                >
                  遗忘
                </button>
              </div>
            );
          })}
        </div>
      )}

      <div className="petri-resource-heading" style={{ marginTop: 12 }}>
        <div><strong>记忆变更审计（最近 20 条）</strong></div>
      </div>
      {audit === null ? (
        <p className="petri-field__hint">加载中…</p>
      ) : audit.length === 0 ? (
        <p className="petri-field__hint">暂无审计记录。</p>
      ) : (
        <div style={{ display: 'grid', gap: 2 }}>
          {audit.map((ev, idx) => (
            <p key={idx} style={{ fontSize: 'var(--petri-font-size-sm)', color: 'var(--petri-text-secondary)', margin: 0 }}>
              [{ev.createdAt ? String(ev.createdAt).slice(0, 19).replace('T', ' ') : '—'}] {ev.actor} · {ev.action}{ev.factId ? ` · ${ev.factId}` : ''}
            </p>
          ))}
        </div>
      )}

      <div className="petri-resource-heading" style={{ marginTop: 12 }}>
        <div><strong>跨会话对话摘要（归档）</strong></div>
        {summary ? (
          <button type="button" className="petri-btn petri-btn--danger-ghost petri-btn--sm" onClick={() => void clearSummary()}>
            清除摘要
          </button>
        ) : null}
      </div>
      {summary ? (
        <p style={{ fontSize: 'var(--petri-font-size-sm)', color: 'var(--petri-text-secondary)', whiteSpace: 'pre-wrap', maxHeight: 120, overflow: 'auto' }}>
          {summary}
        </p>
      ) : (
        <p className="petri-field__hint">暂无归档摘要。</p>
      )}
    </div>
  );
}
