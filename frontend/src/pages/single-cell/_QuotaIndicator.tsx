// ============================================================
// QuotaIndicator — sidebar bottom storage + analyses pill
//
// Replaces the storage block that used to live inside _UserMenu.tsx
// (which has been removed in favor of the global navbar UserMenu).
// Mounts only when the user is logged in.
// ============================================================

import React, { useEffect, useState } from 'react';
import { getAuthHeaders } from './_auth';
import { getApiPrefix } from './_config';

interface Quota {
  usedHuman: string;
  limitHuman: string;
  percent: number;
  analysesThisMonth?: number;
  maxAnalysesMonth?: number;
}

export function QuotaIndicator(): React.ReactElement | null {
  const [q, setQ] = useState<Quota | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(getApiPrefix() + '/data/quota', { headers: getAuthHeaders() })
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d.status === 'ok') setQ(d.quota);
        else setErr(d.error || '');
      })
      .catch(() => {
        if (!cancelled) setErr('网络错误');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (err || !q) return null;

  const high = q.percent > 80;
  const showAnalyses =
    typeof q.analysesThisMonth === 'number' &&
    typeof q.maxAnalysesMonth === 'number' &&
    isFinite(q.maxAnalysesMonth);

  return (
    <div className="sc-quota-indicator" title="单细胞云平台存储占用">
      <div className="sc-quota-indicator__row">
        <span className="sc-quota-indicator__label">存储</span>
        <span className="sc-quota-indicator__value">
          {q.usedHuman} / {q.limitHuman}
        </span>
      </div>
      <div className="sc-quota-indicator__bar">
        <div
          className={`sc-quota-indicator__fill ${high ? 'is-high' : ''}`}
          style={{ width: `${Math.min(q.percent, 100)}%` }}
        />
      </div>
      {showAnalyses && (
        <div className="sc-quota-indicator__row sc-quota-indicator__row--sub">
          <span className="sc-quota-indicator__label">本月分析</span>
          <span className="sc-quota-indicator__value">
            {q.analysesThisMonth} / {q.maxAnalysesMonth}
          </span>
        </div>
      )}
    </div>
  );
}

export default QuotaIndicator;
