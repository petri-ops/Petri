// ============================================================
// ScratchpadDock.tsx — BLOCK-246 C13 composer 侧入口（钮 + 面板一体）
//
// 为什么合成一个组件：面板是绝对定位浮层（锚在 .sc-composer 上），钮在底栏；
// 若把两者分别写进 SimpleChat.tsx，宿主会为同一件事多背一个 state 与两段 JSX，
// 而该文件受 code-size 棘轮约束（只许变短）。宿主只需一行 + 一个回调。
// ============================================================
import { useCallback, useState } from 'react';
import { Icon } from '@/components/icons/Icon';
import type { ScratchpadEntry } from '@/lib/scratchpadClient';
import { ScratchpadPanel, type ScratchpadApi } from './ScratchpadPanel';
import { scratchpadContextItem, type ComposerContextItem } from './contextItems';

export interface ScratchpadDockProps {
  /** 引用一条速记：**已转成** ComposerContextItem（宿主只负责入单列表）。 */
  onQuote: (item: ComposerContextItem) => void;
  /** 测试注入点（透传面板）。 */
  api?: ScratchpadApi;
}

export function ScratchpadDock({ onQuote, api }: ScratchpadDockProps) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const handleQuote = useCallback((entry: ScratchpadEntry) => {
    onQuote(scratchpadContextItem(entry));
    setOpen(false);
  }, [onQuote, setOpen]);

  return (
    <>
      {open && <ScratchpadPanel onClose={close} onQuote={handleQuote} api={api} />}
      <button
        type="button"
        className="sc-model-btn sc-thinking-btn"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-label="速记板"
        title="速记板：把要点存下来，随时引用回对话"
        data-testid="scratchpad-toggle"
      >
        <Icon name="pin" size={14} />
      </button>
    </>
  );
}
