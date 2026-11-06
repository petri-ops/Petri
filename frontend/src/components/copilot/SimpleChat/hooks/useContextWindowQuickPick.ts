/**
 * useContextWindowQuickPick — UI-MODELCFG-1 / UI-696：聊天输入框内切换当前模型的上下文窗口。
 *
 * 背景：上下文窗口原先只能在设置页逐模型修改，多层级才能改一个数字。
 * 现在模型菜单里直接拖刻度条，写回当前模型档案并刷新 SWR（设置页同源可见）。
 *
 * 保存语义：走 `POST /api/ai/settings` 的部分更新，只送 `chat_model_presets`；
 * 服务端负责把它同步进权威的 `model_profiles`（预算/裁剪实际读它）。
 * 写回结果必须可见：成功提示「下一轮生效」，失败提示并回落到服务端值，
 * 不再静默失败。
 */

import { useCallback, useState } from 'react';
import { getPlatformApiPrefix, getToken } from '@/lib/authClient';

interface MinimalPreset {
  id: string;
  contextWindow?: number;
}

export type QuickSaveNotice = { text: string; tone: 'ok' | 'error' } | null;

export function useContextWindowQuickPick({
  activePreset,
  presets,
  refresh,
}: {
  activePreset: MinimalPreset | undefined;
  presets: readonly MinimalPreset[];
  refresh: () => Promise<void> | void;
}): { updateContextWindow: (next: number) => void; notice: QuickSaveNotice } {
  const [notice, setNotice] = useState<QuickSaveNotice>(null);
  const activeId = activePreset?.id;

  const updateContextWindow = useCallback((next: number) => {
    if (!activeId || !Number.isFinite(next) || next <= 0) return;
    void (async () => {
      const nextPresets = presets.map((preset) => (
        preset.id === activeId ? { ...preset, contextWindow: next } : preset
      ));
      try {
        const token = getToken();
        const response = await fetch(`${getPlatformApiPrefix()}/ai/settings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify({ chat_model_presets: nextPresets }),
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
  }, [activeId, presets, refresh]);

  return { updateContextWindow, notice };
}
