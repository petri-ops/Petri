/**
 * useWorkspacePanelShortcuts — 工作区面板开合快捷键（UI-359 / BLOCK-200 P1）
 *
 * 对标 VS Code 肌肉记忆：默认 Ctrl/Cmd+` 开合底部终端、Ctrl/Cmd+Shift+B 开合右侧栏。
 * **组合串读键位注册表**（`workspace.toggleTerminal` / `workspace.toggleRight`），
 * 挂载点与局部门条件留在这里：本钩子在 ProjectWorkspace 子树内 → 天然限定在面板存在的
 * 路由生效，非工作区路由无监听器，按键不会变更不可见的全局面板状态（与 UI-359 死开关
 * 裁剪同一语义）。即「键位是全局事实、生效条件是局部语义」——这条分工见 plan §1。
 */

import { useEffect } from 'react';
import { useWorkspacePanelsContext } from '@/components/desktop/WorkspacePanelsContext';
import { matchesCombo } from '@/lib/appKeymap';
import { useKeymapSafe } from '@/lib/appKeymapContext';

export function useWorkspacePanelShortcuts(): void {
  const { toggleBottomTerminal, toggleRight } = useWorkspacePanelsContext();
  const { bindings } = useKeymapSafe();
  const terminalCombo = bindings['workspace.toggleTerminal'];
  const rightCombo = bindings['workspace.toggleRight'];

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.repeat) return; // 长按连发不该反复开合
      if (matchesCombo(terminalCombo, e)) {
        e.preventDefault();
        toggleBottomTerminal();
        return;
      }
      if (matchesCombo(rightCombo, e)) {
        e.preventDefault();
        toggleRight();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [toggleBottomTerminal, toggleRight, terminalCombo, rightCombo]);
}
