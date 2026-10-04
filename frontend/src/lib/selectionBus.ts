import { useSyncExternalStore } from 'react';
import {
  summarizeSelectionForAgent,
  type AgentSelectionSummary,
  type ArtifactSelection,
} from '@/lib/artifact-selection';
import { dispatchGewuEvent, gewuEvents } from '@/lib/events';

/**
 * selectionBus.ts — BLOCK-139 P0-1 选择总线（plan=docs/block-139-selection-loop-plan.md §5 D1）
 *
 * 跨 viewer 共享的**单选择真相**前端 store：单选择真相 =「当前活跃 artifact 的
 * 当前选择」；切换活跃 artifact 即换选择上下文，旧 artifact 的选择不泄漏进新
 * artifact 的读取面。
 *
 * 词汇纪律：总线不造第二套词汇——结构化投影逐字段恒等
 * `summarizeSelectionForAgent(selection)`（artifact-selection.ts，后端
 * SelectionContext v1 为权威）。有界不变量（MAX_PERSISTED_ENTITY_IDS=2000 /
 * Agent 样本 12）由 artifact-selection.ts 的构建/摘要函数保证，总线只透传，
 * 前端不得放宽（D3）。
 *
 * 广播：沿用既有 gewuEvents 事件模式（events.ts 注册表键 `gewu:selection-bus`），
 * 每次状态写入后经 window 事件广播最新快照；React 消费面走
 * `useSelectionBus()`（useSyncExternalStore 订阅内部监听器，不依赖 window 事件时序）。
 */

/** 总线快照。`artifactId: ''` 表示尚未绑定活跃 artifact。 */
export interface SelectionBusState {
  artifactId: string;
  revisionId: string | null;
  selection: ArtifactSelection | null;
  /** 恒等 summarizeSelectionForAgent(selection)；selection 为 null 时亦为 null。 */
  agentProjection: AgentSelectionSummary | null;
  /**
   * BLOCK-139 P1 mark-to-entity：当前标记的实体 ID 源列（manifest.idField 词汇）。
   * 随选择写入（写入时经 context 携带）；entityType 不在此重复——沿用
   * selection.entityType 单一词汇。无选择 / 未带上下文的写入 / 换上下文时为 null。
   */
  idField: string | null;
}

let busState: SelectionBusState = {
  artifactId: '',
  revisionId: null,
  selection: null,
  agentProjection: null,
  idField: null,
};

type SelectionBusListener = (state: SelectionBusState) => void;
const listeners = new Set<SelectionBusListener>();

function notify(): void {
  // 先落真相再广播：订阅者读到的 detail 与 getSelectionBusState() 一致。
  dispatchGewuEvent(gewuEvents.selectionBus, busState);
  for (const listener of listeners) listener(busState);
}

export function getSelectionBusState(): SelectionBusState {
  return busState;
}

export function subscribeSelectionBus(listener: SelectionBusListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * 绑定/切换当前活跃 artifact 的选择上下文（D1）。
 *
 * 活跃 artifact（或其 revision）变化即换上下文：旧选择就地清除，绝不顺延——
 * 这是「旧 artifact 的选择不泄漏进新 artifact 读取面」的唯一执行点。
 * 绑定到完全相同的上下文时幂等（重渲染驱动的重复绑定不清空选择）。
 */
export function setSelectionBusArtifact(binding: { artifactId: string; revisionId: string | null }): void {
  const contextChanged = binding.artifactId !== busState.artifactId
    || (binding.revisionId ?? null) !== (busState.revisionId ?? null);
  if (!contextChanged) return;
  busState = {
    artifactId: binding.artifactId,
    revisionId: binding.revisionId ?? null,
    selection: null,
    agentProjection: null,
    idField: null,
  };
  notify();
}

/**
 * 写入当前活跃 artifact 的当前选择（null = 清除，无条件回到该上下文的空选择）。
 *
 * BLOCK-139 P1 mark-to-entity：表格行选中 / 图上点选落总线时经 `context.idField`
 * 携带实体 ID 源列（manifest 词汇）——entityType 在选择对象自身词汇里，不重复。
 * 清除（null）或未带上下文的写入 idField 归 null（不伪造标记列）。
 *
 * 总线不校验、不改写选择的坐标与规模：entityIds 截断（≤2000）与计数如实
 * 由上游构建函数保证；Agent 投影在写入时按 artifact-selection.ts 词汇表生成。
 */
export function setSelectionBusSelection(
  selection: ArtifactSelection | null,
  context?: { idField?: string | null },
): void {
  busState = {
    ...busState,
    selection,
    agentProjection: summarizeSelectionForAgent(selection),
    idField: selection ? (context?.idField ?? null) : null,
  };
  notify();
}

/** React 消费面：订阅总线，返回当前快照并随写入刷新（三读取面一致）。 */
export function useSelectionBus(): SelectionBusState {
  return useSyncExternalStore(subscribeSelectionBus, getSelectionBusState, getSelectionBusState);
}
