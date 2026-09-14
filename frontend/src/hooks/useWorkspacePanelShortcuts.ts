/**
 * useWorkspacePanelShortcuts — 工作区面板开合快捷键（UI-359）
 *
 * 对标 VS Code 肌肉记忆：Ctrl/Cmd+` 开合底部终端、Ctrl/Cmd+Shift+B 开合右侧栏。
 * 挂载点在 ProjectWorkspace 子树内 → 天然限定在面板存在的路由生效；
 * 非工作区路由无监听器，按键不会变更不可见的全局面板状态（与 UI-359 死开关
 * 裁剪同一语义）。toggle 回调为稳定 useCallback，监听器整个生命周期只挂一次。
 */

import { useEffect } from 'react';
import { useWorkspacePanelsContext } from '@/components/desktop/WorkspacePanelsContext';

export function useWorkspacePanelShortcuts(): void {
  const { toggleBottomTerminal, toggleRight } = useWorkspacePanelsContext();

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.repeat) return;
      // Ctrl/Cmd+` — 底部终端（与输入法/终端自身无冲突；repeat 防长按连发）
      if (e.key === '`') {
        e.preventDefault();
        toggleBottomTerminal();
        return;
      }
      // Ctrl/Cmd+Shift+B — 右侧栏（Shift 按下时 e.key 为大写 B）
      if (e.shiftKey && (e.key === 'B' || e.key === 'b')) {
        e.preventDefault();
        toggleRight();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [toggleBottomTerminal, toggleRight]);
}
