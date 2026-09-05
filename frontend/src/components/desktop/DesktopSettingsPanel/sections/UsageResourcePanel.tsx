// ============================================================
// DesktopSettingsPanel — Usage & Resource panel section
//
// Extracted from src/components/desktop/DesktopSettingsPanel.tsx
// by BLOCK-9.2 PHASE 1. Original location: lines 84-125.
//
// 30-day usage aggregation + runtime resource snapshot. Self-contained
// (uses useRuntimeResourceSnapshot + getPlatformApiPrefix + getToken).
// ============================================================

import React, { useEffect, useState } from 'react';
import { useRuntimeResourceSnapshot } from '@/hooks/useRuntimeResourceSnapshot';
import { getPlatformApiPrefix, getToken } from '@/lib/authClient';
import { formatMetricBytes } from '../helpers';
import type { UsageSummary } from '../types';

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
