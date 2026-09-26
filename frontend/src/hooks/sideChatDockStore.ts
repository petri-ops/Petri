// ============================================================
// UI-448 — SideChatDock 开态共享单例。
//
// 开态原先锁在 SideChatDock 的组件 useState 里，中栏无从得知悬浮面
// 是否展开——同一会话因此出现过双 composer 并存（单一输入面破约）。
// 升为模块级 store 后，三个消费方读同一真相：
//   - SideChatDock（把手/滑出/Esc/外点收起）
//   - 中栏 SimpleChat（ownsCopilotAsk 实例 composer 让位）
//   - CenterPanel（会话内容列让位类）
// 归属 hooks/ 而非 workspace-panels/：copilot → workspace-panels 是
// 反向依赖（workspace-panels 已依赖 copilot），hooks/ 是两侧共同的下层。
// ============================================================
import { useSyncExternalStore } from 'react';

let dockOpen = false;
const listeners = new Set<() => void>();

export function getSideChatDockOpen(): boolean {
  return dockOpen;
}

export function setSideChatDockOpen(next: boolean | ((prev: boolean) => boolean)): void {
  dockOpen = typeof next === 'function' ? next(dockOpen) : next;
  for (const listener of listeners) listener();
}

function subscribeSideChatDockOpen(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useSideChatDockOpen(): boolean {
  return useSyncExternalStore(subscribeSideChatDockOpen, getSideChatDockOpen);
}
