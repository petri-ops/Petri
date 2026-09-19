import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { DEFAULT_THINKING_LEVEL, loadThinkingLevel, saveThinkingLevel, type ThinkingLevel } from '../../thinkingLevel';

/** BLOCK-81 P2 — 思考档位：会话级态（随会话恢复），默认「标准」＝不发任何上游参数。
 *  BLOCK-92 三波拆分 — 自 SimpleChat.tsx 296-308 连续段原样平移（调用点原位保持
 *  hook 顺序；Ctrl+T 循环 effect 因与簇不连续仍留组件内，经 setThinkingLevel 驱动）。 */
export function useThinkingLevel(
  projectId: string | null | undefined,
  conversationId: string | null | undefined,
): {
  thinkingLevel: ThinkingLevel;
  setThinkingLevel: Dispatch<SetStateAction<ThinkingLevel>>;
  thinkingMenuOpen: boolean;
  setThinkingMenuOpen: Dispatch<SetStateAction<boolean>>;
  applyThinkingLevel: (next: ThinkingLevel) => void;
} {
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevel>(DEFAULT_THINKING_LEVEL);
  const [thinkingMenuOpen, setThinkingMenuOpen] = useState(false);
  // 切会话即载入该会话档位（会话级持久化，对齐 composer 草稿同族语义）
  useEffect(() => {
    setThinkingLevel(loadThinkingLevel(projectId, conversationId));
    setThinkingMenuOpen(false);
  }, [projectId, conversationId]);
  const applyThinkingLevel = useCallback((next: ThinkingLevel) => {
    setThinkingLevel(next);
    saveThinkingLevel(projectId, conversationId, next);
    setThinkingMenuOpen(false);
  }, [projectId, conversationId]);
  return { thinkingLevel, setThinkingLevel, thinkingMenuOpen, setThinkingMenuOpen, applyThinkingLevel };
}
