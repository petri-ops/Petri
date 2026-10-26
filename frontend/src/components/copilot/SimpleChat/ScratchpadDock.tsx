// ============================================================
// ScratchpadDock.tsx — BLOCK-246 C13 composer 侧入口（钮 + 面板一体）
//
// 为什么合成一个组件：面板是绝对定位浮层（锚在 .sc-composer 上），钮在底栏；
// 若把两者分别写进 SimpleChat.tsx，宿主会为同一件事多背一个 state 与两段 JSX，
// 而该文件受 code-size 棘轮约束（只许变短）。宿主只需一行 + 一个回调。
//
// BLOCK-267（AUDIT-LOG 🟡 清偿）— 开态提升为模块级外置 store：composer 子树在
// 会话消息/流式推进时会重挂（BLOCK-246 实机观察），组件内 useState 的 open 会被
// 重挂吃掉（~300ms 自行关闭）。外置 store 让重挂后的新实例重读同一份开态——
// 开关状态不再随组件生命周期漂移。
// ============================================================
import { useCallback, useEffect, useState } from 'react';
import { Icon } from '@/components/icons/Icon';
import type { ScratchpadEntry } from '@/lib/scratchpadClient';
import { ScratchpadPanel, type ScratchpadApi } from './ScratchpadPanel';
import { scratchpadContextItem, type ComposerContextItem } from './contextItems';

export interface ScratchpadDockProps {
  /** 引用一条速记：**已转成** ComposerContextItem（宿主只负责入单列表）。 */
  onQuote: (item: ComposerContextItem) => void;
  /** BLOCK-254 P6 — 当前项目（速记条目自身无项目时用于图片批注的 scope 兜底）。 */
  projectId?: string | null;
  /** 测试注入点（透传面板）。 */
  api?: ScratchpadApi;
}

// ---- 模块级外置开态 store（零依赖；会话内不持久化，刷新即归零为有意语义） ----
let dockOpen = false;
const dockListeners = new Set<() => void>();

function setDockOpen(next: boolean | ((current: boolean) => boolean)) {
  dockOpen = typeof next === 'function' ? next(dockOpen) : next;
  dockListeners.forEach((listener) => listener());
}

/** 订阅外置开态（useSyncExternalStore 语义的简化实现：挂载重读 + 变更同步）。 */
function useDockOpen(): [boolean, (next: boolean | ((current: boolean) => boolean)) => void] {
  const [open, setOpen] = useState(dockOpen);
  useEffect(() => {
    const listener = () => setOpen(dockOpen);
    dockListeners.add(listener);
    listener(); // 挂载即重读——重挂不再丢开态
    return () => {
      dockListeners.delete(listener);
    };
  }, []);
  const set = useCallback((next: boolean | ((current: boolean) => boolean)) => {
    setDockOpen(next);
  }, []);
  return [open, set];
}

/** 测试复位（模块级态跨用例残留；下划线前缀=非产品面）。 */
export function _resetDockOpenForTest() {
  dockOpen = false;
  dockListeners.forEach((listener) => listener());
}

export function ScratchpadDock({ onQuote, projectId, api }: ScratchpadDockProps) {
  const [open, setOpen] = useDockOpen();
  const close = useCallback(() => setOpen(false), []);
  const handleQuote = useCallback((entry: ScratchpadEntry) => {
    onQuote(scratchpadContextItem(entry));
    setOpen(false);
  }, [onQuote, setOpen]);

  return (
    <>
      {open && (
        <ScratchpadPanel
          onClose={close}
          onQuote={handleQuote}
          projectId={projectId ?? null}
          api={api}
        />
      )}
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
