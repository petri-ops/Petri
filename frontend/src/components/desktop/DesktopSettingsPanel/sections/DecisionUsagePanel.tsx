// ============================================================
// DesktopSettingsPanel — Decision usage panel section (BLOCK-116 W2)
//
// 决策原语观测面：按接点聚合调用量/均延迟/降级率（近 7 天）。
// 数据源=GET /ai/decisions/summary（decision_log 聚合，BLOCK-79 用量面板同款模式）。
// 口径诚实：available=false（DB 不可用）时显示不可用而非伪造空统计；
// 零记录显示空态。阈值的语义与校准证据绑定见 helpers/decision-thresholds.js。
// ============================================================

import React, { useEffect, useState } from 'react';
import { getPlatformApiPrefix, getToken } from '@/lib/authClient';

interface DecisionPointRow {
  point: string;
  calls: number;
  avgLatencyMs: number;
  degradedCount: number;
  degradedRate: number;
  lastAt: string | null;
}

interface SummaryResponse {
  status: string;
  available: boolean;
  days?: number;
  points?: DecisionPointRow[];
  error?: string;
}

interface DecisionRecord {
  at: string;
  point: string;
  choice: string | null;
  confidence: number | null;
  threshold: number | null;
  degraded: boolean;
  reason: string | null;
  model: string | null;
  latencyMs: number | null;
  statePreview: string | null;
}

interface RecentResponse {
  status: string;
  available: boolean;
  decisions?: DecisionRecord[];
  error?: string;
}

export function DecisionUsagePanel(): React.ReactElement {
  const [points, setPoints] = useState<DecisionPointRow[] | null>(null);
  const [recent, setRecent] = useState<DecisionRecord[] | null>(null);
  const [showRecent, setShowRecent] = useState(false);
  const [error, setError] = useState('');
  const [available, setAvailable] = useState(true);

  useEffect(() => {
    const token = getToken();
    void fetch(`${getPlatformApiPrefix()}/ai/decisions/summary?days=7`, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    }).then(async (response) => {
      const data = (await response.json()) as SummaryResponse;
      if (!response.ok || data?.status !== 'ok') throw new Error(data?.error || '决策观测不可用');
      setAvailable(data.available !== false);
      setPoints(Array.isArray(data.points) ? data.points : []);
      setError('');
    }).catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
    // BLOCK-116 P3 — 最近决策逐条回放（可折叠，默认收起）
    void fetch(`${getPlatformApiPrefix()}/ai/decisions/recent?limit=20`, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    }).then(async (response) => {
      const data = (await response.json()) as RecentResponse;
      if (!response.ok || data?.status !== 'ok') throw new Error(data?.error || '最近决策不可用');
      setRecent(Array.isArray(data.decisions) ? data.decisions : []);
    }).catch(() => setRecent(null));
  }, []);

  const formatLatency = (ms: number | undefined) =>
    ms != null && Number.isFinite(Number(ms)) ? `${Number(ms)} ms` : '—';

  return (
    <div className="petri-usage-resource">
      <div className="petri-resource-heading">
        <div>
          <strong>决策原语调用（近 7 天）</strong>
          <p>接点级调用量、平均延迟与降级率。降级=决策 API 不可用回退既有行为；记录为 best-effort。</p>
        </div>
      </div>
      {error ? (
        <p className="petri-field__hint">{error}</p>
      ) : !available ? (
        <p className="petri-field__hint">决策台账暂不可用（数据库未就绪）。</p>
      ) : !points || points.length === 0 ? (
        <p className="petri-field__hint">暂无决策调用记录（各接点默认关闭时只有显式开启后才产生记录）。</p>
      ) : (
        <div className="petri-metric-grid">
          {points.map((row) => (
            <div key={row.point}>
              <small>{row.point} · {row.calls} 次调用</small>
              <strong>{formatLatency(row.avgLatencyMs)}</strong>
              <small>降级 {row.degradedCount} 次（{Math.round(row.degradedRate * 100)}%）</small>
            </div>
          ))}
        </div>
      )}
      <p className="petri-field__hint">阈值与校准证据的绑定关系见 helpers/decision-thresholds.js；调整阈值必须先重校准。</p>
      {/* BLOCK-116 P3 — 最近决策逐条回放（可折叠；默认收起） */}
      <div className="petri-resource-heading">
        <div><strong>最近决策（20 条）</strong><p>逐条回放：接点 · 判定 · 置信度 · 降级标记</p></div>
        <button type="button" className="petri-btn petri-btn--ghost petri-btn--sm" onClick={() => setShowRecent((v) => !v)}>
          {showRecent ? '收起' : '展开'}
        </button>
      </div>
      {showRecent && (
        recent && recent.length > 0 ? (
          <div className="petri-metric-grid">
            {recent.map((row, idx) => (
              <div key={`${row.at}-${idx}`}>
                <small>{row.point}{row.degraded ? ' · 降级' : ''}</small>
                <strong>{row.choice ?? '—'}{row.confidence != null ? ` · ${row.confidence}` : ''}</strong>
                <small>{new Date(row.at).toLocaleTimeString()}{row.latencyMs != null ? ` · ${row.latencyMs} ms` : ''}</small>
              </div>
            ))}
          </div>
        ) : (
          <p className="petri-field__hint">暂无最近决策记录。</p>
        )
      )}
    </div>
  );
}
