// ============================================================
// DesktopSettingsPanel — Usage & Resource panel section
//
// Extracted from src/components/desktop/DesktopSettingsPanel.tsx
// by BLOCK-9.2 PHASE 1. Original location: lines 84-125.
//
// 30-day usage aggregation + runtime resource snapshot. Self-contained
// (uses useRuntimeResourceSnapshot + getPlatformApiPrefix + getToken).
// BLOCK-79 P2 — 按供应商的输出速率统一展示面（统一在此一处，不散落）；
// 速率口径 = 端到端平均输出速率（含排队/首 token 前处理/网络，是真实解码
// 速度的下限，禁止称「解码速度」）；渠道未返回 usage 时显示「不可算」。
// ============================================================

import React, { useEffect, useState } from 'react';
import { useRuntimeResourceSnapshot } from '@/hooks/useRuntimeResourceSnapshot';
import { getPlatformApiPrefix, getToken } from '@/lib/authClient';
import { formatMetricBytes } from '../helpers';
import type { UsageSummary, ProviderUsageRow } from '../types';

export function UsageResourcePanel(): React.ReactElement {
  const { snapshot, loading, error, refresh } = useRuntimeResourceSnapshot();
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [usageError, setUsageError] = useState('');
  useEffect(() => {
    const token = getToken();
    void fetch(`${getPlatformApiPrefix()}/ai/usage-mine?days=30`, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    }).then(async (response) => {
      const data = await response.json();
      if (!response.ok || data?.status !== 'ok') throw new Error(data?.error || '用量不可用');
      setUsage(data);
      setUsageError('');
    }).catch((reason) => setUsageError(reason instanceof Error ? reason.message : String(reason)));
  }, []);
  const resourceLabel = snapshot?.state === 'ready' ? '资源正常' : snapshot?.state === 'warning' ? '需要注意' : snapshot ? '资源不足' : '检查中';
  const providers: ProviderUsageRow[] = Array.isArray(usage?.providers) ? usage!.providers : [];
  const formatLatency = (ms: number | undefined) =>
    ms != null && Number.isFinite(Number(ms)) ? `${(Number(ms) / 1000).toFixed(2)} s` : '—';
  return (
    <div className="gewu-usage-resource">
      <div className="gewu-metric-grid">
        <div><small>30 天调用</small><strong>{usage?.calls ?? '—'}</strong></div>
        <div><small>输入 / 输出 Token</small><strong>{usage ? `${usage.prompt_tokens || 0} / ${usage.completion_tokens || 0}` : '—'}</strong></div>
        <div><small>缓存命中</small><strong>{usage ? `${((usage.cache_hit_rate || 0) * 100).toFixed(1)}%` : '—'}</strong></div>
        <div><small>估算成本</small><strong>{usage ? `¥${Number(usage.estimated_cost_cny || 0).toFixed(4)}` : '—'}</strong></div>
      </div>
      <p className="gewu-field__hint">
        {usageError || (usage?.cost_status === 'partial' ? `${usage.unknown_cost_calls} 次调用缺少可靠价格，金额仅为部分估算。` : '成本来自已知价格表；供应商未返回价格时不会伪造金额。')}
      </p>
      {/* BLOCK-79 — 按供应商的输出速率（统一展示面） */}
      <div className="gewu-resource-heading">
        <div><strong>供应商速率（30 天）</strong><p>输出 tokens/s = 端到端平均输出速率（含首 token 前处理与网络，为解码速度下限）</p></div>
      </div>
      {providers.length === 0 ? (
        <p className="gewu-field__hint">暂无可统计的调用记录。</p>
      ) : (
        <div className="gewu-metric-grid">
          {providers.map((row) => {
            const speed = row.measurable && row.tokensPerSecond != null
              ? `${row.tokensPerSecond} tok/s`
              : '不可算（未返回用量）';
            return (
              <div key={row.provider}>
                <small>{row.provider} · {row.calls} 次调用</small>
                <strong title="端到端平均输出速率 = 输出 token 总数 ÷ 总墙钟时间">{speed}</strong>
                <small>输出 {row.outputTokens.toLocaleString()} tok · 平均延迟 {formatLatency(row.latencyMs > 0 ? row.latencyMs / Math.max(1, row.calls) : undefined)}</small>
              </div>
            );
          })}
          <div>
            <small>全部供应商 · 平均延迟</small>
            <strong>{usage ? formatLatency(usage.avg_latency) : '—'}</strong>
            <small>{usage ? `${Math.round(Number(usage.avg_latency || 0))} ms / 次（含 embedding）` : ''}</small>
          </div>
        </div>
      )}
      <hr className="gewu-section-divider" />
      <div className="gewu-resource-heading">
        <div><strong>{resourceLabel}</strong><p>{snapshot ? `${snapshot.platform} · 观测于 ${new Date(snapshot.observedAt).toLocaleTimeString()}` : error || '正在读取机器状态'}</p></div>
        <button type="button" className="gewu-btn gewu-btn--ghost gewu-btn--sm" disabled={loading} onClick={() => void refresh()}>刷新</button>
      </div>
      <div className="gewu-metric-grid">
        <div><small>CPU</small><strong>{snapshot ? `${snapshot.cpu.logicalCores} 核 · ${snapshot.cpu.load1m?.toFixed(2) ?? '—'}` : '—'}</strong></div>
        <div><small>可用内存</small><strong>{formatMetricBytes(snapshot?.memory.availableBytes)}</strong></div>
        <div><small>可用磁盘</small><strong>{formatMetricBytes(snapshot?.disk.availableBytes)}</strong></div>
        <div><small>活跃 Job</small><strong>{snapshot?.activeJobs ?? '—'}</strong></div>
      </div>
      <p className="gewu-field__hint">资源快照每 10 秒刷新、30 秒失效。GPU 仅在运行时能够可靠探测时展示。</p>
    </div>
  );
}
