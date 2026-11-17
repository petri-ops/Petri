/**
 * useModelQuickConfig — BLOCK-456（承接 UI-MODELCFG-1 / UI-696）：模型菜单行内
 * 就地修改该模型的上下文窗口 / 默认思考档，写模型级 modelPreferences。
 *
 * 保存语义：`POST /api/ai/settings` 部分更新，只送被改的那一条
 * `chat_model_presets: [{ id: '<profileId>::<model>', ...patch }]`；
 * 服务端 sync 桥按解析值判等跳过 no-op，把真实变更同步进权威的
 * `model_profiles.modelPreferences`（渠道 fallback 不被污染）。
 * 写回结果必须可见：成功提示「下一轮生效」，失败提示并回落到服务端值。
 */

import { useCallback, useState } from 'react';
import { getPlatformApiPrefix, getToken } from '@/lib/authClient';
import { THINKING_LEVELS } from '@/components/copilot/thinkingLevel';

export type QuickSaveNotice = { text: string; tone: 'ok' | 'error' } | null;

export interface ModelConfigPatch {
  contextWindow?: number;
  defaultThinkingLevel?: string;
}

export function useModelQuickConfig({
  refresh,
}: {
  refresh: () => Promise<void> | void;
}): { updateModelConfig: (presetId: string, patch: ModelConfigPatch) => void; notice: QuickSaveNotice } {
  const [notice, setNotice] = useState<QuickSaveNotice>(null);

  const updateModelConfig = useCallback((presetId: string, patch: ModelConfigPatch) => {
    if (!presetId) return;
    const clean: ModelConfigPatch = {};
    if (patch.contextWindow !== undefined && Number.isFinite(patch.contextWindow) && patch.contextWindow > 0) {
      clean.contextWindow = Math.round(patch.contextWindow);
    }
    if (patch.defaultThinkingLevel !== undefined && (THINKING_LEVELS as readonly string[]).includes(patch.defaultThinkingLevel)) {
      clean.defaultThinkingLevel = patch.defaultThinkingLevel;
    }
    if (clean.contextWindow === undefined && clean.defaultThinkingLevel === undefined) return;
    void (async () => {
      try {
        const token = getToken();
        const response = await fetch(`${getPlatformApiPrefix()}/ai/settings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify({ chat_model_presets: [{ id: presetId, ...clean }] }),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        setNotice(null);
        await refresh();
        setNotice({ text: '已保存 · 下一轮生效', tone: 'ok' });
      } catch {
        setNotice({ text: '保存失败，已回退到服务端值', tone: 'error' });
        try { await refresh(); } catch { /* 刷新失败时保持界面原值，不假称已保存 */ }
      }
    })();
  }, [refresh]);

  return { updateModelConfig, notice };
}