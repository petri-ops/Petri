/**
 * useContextWindowQuickPick — UI-MODELCFG-1：聊天输入框内切换当前模型的上下文窗口。
 *
 * 背景：上下文窗口原先只能在设置页逐模型修改，多层级才能改一个数字。
 * 现在模型菜单里直接选档位，写回当前模型档案并刷新 SWR（设置页同源可见）。
 *
 * 保存语义：走 `POST /api/ai/settings` 的**部分更新**（服务端 `{...current, ...incoming}`），
 * 只送 `chat_model_presets`，不触碰其它设置；失败静默（菜单值回落到服务端档案值，
 * 不假称已保存）。
 */

import { useCallback } from 'react';
import { getPlatformApiPrefix, getToken } from '@/lib/authClient';

interface MinimalPreset {
  id: string;
  contextWindow?: number;
}

export function useContextWindowQuickPick({
  activePreset,
  presets,
  refresh,
}: {
  activePreset: MinimalPreset | undefined;
  presets: readonly MinimalPreset[];
  refresh: () => Promise<void> | void;
}): (next: number) => void {
  const activeId = activePreset?.id;
  return useCallback((next: number) => {
    if (!activeId || !Number.isFinite(next) || next <= 0) return;
    void (async () => {
      const nextPresets = presets.map((preset) => (
        preset.id === activeId ? { ...preset, contextWindow: next } : preset
      ));
      try {
        const token = getToken();
        await fetch(`${getPlatformApiPrefix()}/ai/settings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify({ chat_model_presets: nextPresets }),
        });
        await refresh();
      } catch {
        // 静默失败：菜单下拉回落到服务端返回的档案值（不声称已保存）
      }
    })();
  }, [activeId, presets, refresh]);
}
