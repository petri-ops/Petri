/**
 * usePackTabData — BLOCK-236：pack 只读 tab 的取数状态（含「失败即回落核心」的判定）。
 *
 * 设计要点：
 * - 判定与取数分离：`shouldDowngradeToCore` 是纯函数，便于单测钉住三态；
 * - 取数失败（http/坏 JSON/端点缺失/网络）一律 `status='error'` + `reason`，
 *   由 host 降级到核心过渡面，**不渲染空白 iframe**；
 * - `history` 目前无列表端点，桥层直接返回 `no_endpoint` → 自动回落，属预期行为。
 */

import { useEffect, useState } from 'react';
import {
  fetchPackTabData,
  type PackLineagePayload,
  type PackSourcePayload,
  type PackTabId,
  type PackTabResult,
} from './packTabData';

export type PackTabStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface PackTabState {
  status: PackTabStatus;
  reason?: string;
  data?: PackLineagePayload | PackSourcePayload;
}

export const EMPTY_PACK_TAB_STATE: PackTabState = { status: 'idle' };

/**
 * host 侧降级判定：只有「命中 pack 且 tab 数据可用」才留在 pack。
 * - 无 tab（模式主 body）→ 不因本规则降级；
 * - tab 加载中 → 保持 pack（避免闪回核心）；
 * - tab 失败 → 降级核心并带原因。
 */
export function shouldDowngradeToCore(tab: string | undefined, state: PackTabState): boolean {
  if (!tab) return false;
  return state.status === 'error';
}

export function usePackTabData(
  tab: string | undefined,
  params: { jobId?: string | null; revisionId?: string | null },
  apiBase: string,
): PackTabState {
  const [state, setState] = useState<PackTabState>(EMPTY_PACK_TAB_STATE);
  const jobId = params.jobId ?? null;
  const revisionId = params.revisionId ?? null;

  useEffect(() => {
    let cancelled = false;
    if (!tab) {
      setState(EMPTY_PACK_TAB_STATE);
      return () => { cancelled = true; };
    }
    setState({ status: 'loading' });
    void fetchPackTabData(tab as PackTabId, { jobId, revisionId }, { apiBase })
      .then((res: PackTabResult<PackLineagePayload | PackSourcePayload>) => {
        if (cancelled) return;
        setState(res.ok
          ? { status: 'ready', data: res.data }
          : { status: 'error', reason: res.reason });
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error', reason: 'network_error' });
      });
    return () => { cancelled = true; };
  }, [tab, jobId, revisionId, apiBase]);

  return state;
}
