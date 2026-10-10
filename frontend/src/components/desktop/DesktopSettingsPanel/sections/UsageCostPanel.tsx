// ============================================================
// DesktopSettingsPanel — 用量/成本面板节（BLOCK-163 W3 P9/MDL-4）
//
// 数据源 = GET /api/ai/usage-mine?days=30（BLOCK-78 既有路由 + BLOCK-163
// additive models 按模型聚合）。只读消费面：调用次数/输入输出 tokens/
// 估算成本（¥）/缓存命中率/按模型 TOP 表。cost_status=partial 时如实标注
// 「部分调用成本未知」。
// ============================================================

import React, { useEffect, useState } from 'react';
import { getPlatformApiPrefix, getToken } from '@/lib/authClient';

interface ModelUsageRow {
  model: string;
  calls: number;
  prompt_tokens: number;
  completion_tokens: number;
  estimated_cost_cny: number;
}

interface UsageMineResponse {
  status: string;
  days?: number;
  calls?: number;
  prompt_tokens?: number;
  completion_tokens?: number;
  cache_read_tokens?: number;
  estimated_cost_cny?: number;
  cache_hit_rate?: number;
  cost_status?: string;
  unknown_cost_calls?: number;
  avg_latency?: number;
  models?: ModelUsageRow[];
  error?: string;
}

function fmtTokens(n?: number): string {
  const v = Number(n || 0);
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}k`;
  return String(v);
}

export function UsageCostPanel(): React.ReactElement {
  const [data, setData] = useState<UsageMineResponse | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    const token = getToken();
    void fetch(`${getPlatformApiPrefix()}/ai/usage-mine?days=30`, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    }).then(async (response) => {
      const json = (await response.json()) as UsageMineResponse;
      if (!response.ok || json?.status !== 'ok') throw new Error(json?.error || '用量读取失败');
      if (!cancelled) setData(json);
    }).catch((reason) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const costStatusNote = data?.cost_status === 'partial'
    ? `（${data.unknown_cost_calls} 次调用成本未知，估算为部分口径）`
    : '';

  return (
    <div className="petri-usage-resource">
      <div className="petri-resource-heading">
        <div>
          <strong>模型用量与成本（近 30 天）</strong>
          <p>
            调用次数、tokens 与估算成本（¥，按模型定价表；未知定价渠道如实标注）。
            数据源 = ai_usage 台账（BLOCK-37 模型 I/O 台账同源）。
          </p>
        </div>
      </div>
      {error ? (
        <p className="petri-field__hint">{error}</p>
      ) : !data ? (
        <p className="petri-field__hint">加载中…</p>
      ) : (
        <>
          <div className="petri-metric-grid">
            <div>
              <small>调用次数</small>
              <strong>{data.calls ?? 0}</strong>
              <small>平均延迟 {data.avg_latency ? `${Math.round(Number(data.avg_latency))} ms` : '—'}</small>
            </div>
            <div>
              <small>输入 tokens</small>
              <strong>{fmtTokens(data.prompt_tokens)}</strong>
              <small>缓存命中 {Math.round((data.cache_hit_rate || 0) * 100)}%</small>
            </div>
            <div>
              <small>输出 tokens</small>
              <strong>{fmtTokens(data.completion_tokens)}</strong>
            </div>
            <div>
              <small>估算成本</small>
              <strong>¥{Number(data.estimated_cost_cny || 0).toFixed(2)}</strong>
              <small>{costStatusNote || '全量估算'}</small>
            </div>
          </div>
          {Array.isArray(data.models) && data.models.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <small style={{ color: 'var(--petri-text-tertiary)' }}>按模型（TOP 20）</small>
              <div className="petri-metric-grid" style={{ marginTop: 4 }}>
                {data.models.map((row) => (
                  <div key={row.model}>
                    <small>{row.model} · {row.calls} 次</small>
                    <strong>¥{Number(row.estimated_cost_cny || 0).toFixed(2)}</strong>
                    <small>{fmtTokens(row.prompt_tokens)} in / {fmtTokens(row.completion_tokens)} out</small>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
