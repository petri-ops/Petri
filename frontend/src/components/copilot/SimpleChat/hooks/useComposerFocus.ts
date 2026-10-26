// BLOCK-92 Wave A-3 — composer 焦点管理簇（自主组件平移，零行为变化）：
// 挂载自动聚焦 + 窗口获焦/可打印击键时的焦点兜底（仅 copilotAsk 拥有者执行）。
import { useEffect } from 'react';
import type { RefObject } from 'react';

interface UseComposerFocusOptions {
  taRef: RefObject<HTMLTextAreaElement | null>;
  ownsCopilotAsk: boolean;
  accessMenuOpen: boolean;
  modelMenuOpen: 'supplier' | 'model' | 'all' | null;
}

export function useComposerFocus(options: UseComposerFocusOptions): void {
  const { taRef, ownsCopilotAsk, accessMenuOpen, modelMenuOpen } = options;

  // 自动聚焦输入框：新加载/刷新后无需先点一下才能打字。macOS 上窗口被程序化
  // 激活后 webview 常拿不到键盘焦点，挂载时主动聚焦一次即可立即可输入。
  // 仅 copilotAsk 的拥有者（中央会话）执行：两个实例可能同时挂载（中央会话 +
  // 右侧面板 chat tab），都自动聚焦会互相抢焦点。
  useEffect(() => {
    if (!ownsCopilotAsk) return;
    taRef.current?.focus();
  }, [ownsCopilotAsk]);

  // 键盘焦点兜底：窗口重新获焦、或用户开始打字时，若焦点并不在任何可输入控件/按钮
  // 上（例如停留在标题栏窗口控件这类非输入元素），把焦点交还输入框，避免击键被吞。
  // 菜单打开时跳过，避免抢走菜单焦点。同样只由 copilotAsk 拥有者执行。
  useEffect(() => {
    if (!ownsCopilotAsk) return undefined;
    const focusInputIfIdle = () => {
      if (accessMenuOpen || modelMenuOpen) return;
      const ta = taRef.current;
      if (!ta || document.activeElement === ta) return;
      // 自身被隐藏（display:none，如切到非会话模式）时不抢焦点。
      if (ta.offsetParent === null) return;
      const ae = document.activeElement as HTMLElement | null;
      // 焦点已在真正的输入控件里（别处的输入框/可编辑区）就不要抢。
      if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
      ta.focus();
    };
    const onWinFocus = () => focusInputIfIdle();
    const onDocKeyDown = (e: KeyboardEvent) => {
      // 仅在"可打印字符"击键且焦点无处安放时接管，不干扰快捷键与 Tab 导航。
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key.length !== 1) return;
      focusInputIfIdle();
    };
    window.addEventListener('focus', onWinFocus);
    document.addEventListener('keydown', onDocKeyDown);
    return () => {
      window.removeEventListener('focus', onWinFocus);
      document.removeEventListener('keydown', onDocKeyDown);
    };
  }, [accessMenuOpen, modelMenuOpen, ownsCopilotAsk]);
}
