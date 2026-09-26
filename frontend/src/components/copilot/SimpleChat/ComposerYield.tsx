// ============================================================
// UI-448 — 单一输入面：composer 让位件。
//
// 悬浮聊天面（SideChatDock）展开时，中栏 ownsCopilotAsk 实例的
// composer 让位为提示条——同一会话任意时刻只有一个活跃输入面。
// 悬挂面自身是非 owns 实例，isComposerSuppressed 恒 false，不受影响。
// ============================================================
import React from 'react';
import { Icon } from '@/components/icons/Icon';

/** 中栏宽列的完整键位提示。 */
export const COMPOSER_PLACEHOLDER_FULL = '输入消息… (Enter 发送, Shift+Enter 换行, ↑/↓ 回溯历史)';

/** 让位判定：仅中栏 owns 实例 × 悬浮面展开时让位（悬挂面自身照常可输入）。 */
export function isComposerSuppressed({
  ownsCopilotAsk,
  dockOpen,
}: {
  ownsCopilotAsk: boolean;
  dockOpen: boolean;
}): boolean {
  return ownsCopilotAsk && dockOpen;
}

/** compact 档（380px 悬浮面）用短占位符，完整键位提示在窄面内会折两行。 */
export function composerPlaceholder(compact?: boolean): string {
  return compact ? '输入消息…' : COMPOSER_PLACEHOLDER_FULL;
}

export function ComposerYieldHint({
  onReturnToCenter,
}: {
  onReturnToCenter: () => void;
}): React.ReactElement {
  return (
    <div className="sc-composer-yield" data-testid="composer-yield-hint" role="status">
      <Icon name="message-circle" size={13} />
      <span className="sc-composer-yield-text">会话输入已移至侧边聊天面板</span>
      <button
        type="button"
        className="sc-composer-yield-btn"
        onClick={onReturnToCenter}
        title="收起侧边聊天面板，回到中栏输入"
      >
        返回中栏输入
      </button>
    </div>
  );
}
