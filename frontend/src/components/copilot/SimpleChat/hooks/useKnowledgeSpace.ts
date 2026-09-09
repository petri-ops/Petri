/**
 * useKnowledgeSpace.ts — BLOCK-69 composer 大脑开关（D6）
 * 轻量状态：开关 + 就绪文档数 + 嵌入可用性。完整文档管理面在右栏 KnowledgeSpacePanel。
 * 启用状态单一真相 = DB；乐观更新失败即回滚（不造第二真相、不假启用）。
 */

import { useCallback, useEffect, useState } from 'react';
import {
  fetchKnowledgeSpace,
  setKnowledgeSpaceEnabled,
  type KnowledgeSpaceState,
} from '@/lib/knowledgeClient';

export interface KnowledgeSpaceToggle {
  enabled: boolean;
  readyDocs: number;
  docCount: number;
  embeddingAvailable: boolean;
  busy: boolean;
  unavailable: boolean;
  spaceName: string;
  refresh: () => Promise<void>;
  toggle: () => Promise<void>;
}

export function useKnowledgeSpaceToggle(): KnowledgeSpaceToggle {
  const [state, setState] = useState<Pick<KnowledgeSpaceState, 'space' | 'documents' | 'embeddingAvailable'> | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const next = await fetchKnowledgeSpace();
      setState({ space: next.space, documents: next.documents, embeddingAvailable: next.embeddingAvailable });
    } catch {
      // 后端未就绪/网络失败：保持上次状态，不假启用
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const toggle = useCallback(async () => {
    if (busy) return;
    const current = !!state?.space?.enabled;
    setBusy(true);
    try {
      await setKnowledgeSpaceEnabled(!current);
      await refresh();
    } catch {
      // 无 key 等拒绝：回读真实状态（不假启用）
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [busy, state?.space?.enabled, refresh]);

  const enabled = !!state?.space?.enabled;
  const readyDocs = (state?.documents || []).filter((doc) => doc.status === 'ready').length;
  return {
    enabled,
    readyDocs,
    docCount: (state?.documents || []).length,
    embeddingAvailable: state ? state.embeddingAvailable : true,
    busy,
    unavailable: !!state && !state.embeddingAvailable,
    spaceName: state?.space?.name || '知识空间',
    refresh,
    toggle,
  };
}
