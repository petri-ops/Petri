/**
 * usePackTabData — BLOCK-236：pack 只读 tab 的取数状态（含「失败即回落核心」的判定）。
 *
 * 纪律：
 * - effect 内**不同步 setState**（避免级联渲染）：状态按 `key` 归属，渲染期比对 key 决定
 *   「这一份数据是不是当前 tab 的」——换 tab 即视为 loading，旧数据不残留；
 * - 取数失败一律 `status='error'` + `reason`，由 host 降级核心过渡面，不渲染空白 iframe；
 * - `history` 目前无列表端点，桥层返回 `no_endpoint` → 自动回落，属预期行为。
 */

import { useEffect, useState } from 'react';
import {
  fetchPackTabData,
  type PackLineagePayload,
  type PackSourcePayload,
  type PackComparePayload,
  type PackTabId,
  type PackTabResult,
} from './packTabData';

type PackTabStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface PackTabState {
  status: PackTabStatus;
  reason?: string;
  data?: PackLineagePayload | PackSourcePayload | PackComparePayload;
}

const EMPTY_PACK_TAB_STATE: PackTabState = { status: 'idle' };
const LOADING_PACK_TAB_STATE: PackTabState = { status: 'loading' };

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
  params: { projectId?: string | null; jobId?: string | null; revisionId?: string | null; changeSetId?: string | null },
  apiBase: string,
): PackTabState {
  const projectId = params.projectId ?? null;
  const jobId = params.jobId ?? null;
  const revisionId = params.revisionId ?? null;
  const changeSetId = params.changeSetId ?? null;
  const key = tab ? `${tab}|${projectId ?? ''}|${jobId ?? ''}|${revisionId ?? ''}|${changeSetId ?? ''}|${apiBase}` : '';
  const [entry, setEntry] = useState<{ key: string; state: PackTabState }>({
    key: '',
    state: EMPTY_PACK_TAB_STATE,
  });

  useEffect(() => {
    if (!tab) return undefined;
    let cancelled = false;
    void fetchPackTabData(tab as PackTabId, { projectId, jobId, revisionId, changeSetId }, { apiBase })
      .then((res: PackTabResult<PackLineagePayload | PackSourcePayload | PackComparePayload>) => {
        if (cancelled) return;
        setEntry({
          key,
          state: res.ok ? { status: 'ready', data: res.data } : { status: 'error', reason: res.reason },
        });
      })
      .catch(() => {
        if (!cancelled) setEntry({ key, state: { status: 'error', reason: 'network_error' } });
      });
    return () => {
      cancelled = true;
    };
  }, [key, tab, projectId, jobId, revisionId, changeSetId, apiBase]);

  if (!tab) return EMPTY_PACK_TAB_STATE;
  return entry.key === key ? entry.state : LOADING_PACK_TAB_STATE;
}
