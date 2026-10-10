/**
 * BLOCK-22 P3 桥接层 (UI-194) — PendingScrollContext
 *
 * 用途：建立"事件 → context → CodeMirrorEditor"的抽象桥接层
 *
 * 本文件**不**直接消费 SimpleChat.tsx / events.ts / WorkspaceFilePreview。
 * 按 petri-project-governance §Guardrails "Never modify unknown WIP"，
 * 业务侧入口（SimpleChat 聊天卡片 / WorkspaceFilePreview 容器）的具体
 * 接入动作**不在 P3 范围**，留给 WIP 收口后由业务侧 Agent 负责。
 *
 * P3 提供：
 * 1. PendingScrollContext —— React Context 抽象
 * 2. WorkspaceFilePreviewBridge —— CodeMirrorEditor + Context 集成包装
 * 3. ChatCardLinkBridge —— 跳转触发器包装（接受 prop API）
 * 4. AppLevelBridge —— 全局监听桥（仅 dev tool 入口）
 *
 * 设计要点：
 * - 独立 Context，**不**订阅 events.ts，**不**依赖任何事件总线
 * - 由调用方通过 setPendingRequest 触发；Context Provider / Consumer 完全自包含
 * - 单实例：一次只有一个 PendingScrollRequest 在 context 中；
 *   处理完后需手动调 setPendingRequest(null) 清空
 *
 * 不外推：详见 plan §8。
 */

import React, { createContext, useCallback, useContext, useMemo, useState, type FC, type ReactNode } from 'react';

import type { DiffRevision } from '../components/editor/CodeMirror/types';

/**
 * 单个滚动请求的载荷。
 *
 * - filePath：目标文件路径（用于 WorkspaceFilePreviewBridge 比对自身 filePath）
 * - line：1-based 行号（与 EditorApi.scrollToLine 的 ScrollTarget.line 一致）
 * - column：0-based 列偏移（可选）
 * - pulseMs：可选滚动后高亮 pulse 时长（可选）
 * - diffRevision：可选；存在时 WorkspaceFilePreviewBridge 会把编辑器切到 inline-diff 模式
 * - timestamp：触发时刻 epoch ms；用于上游判断"是否是新的请求"（避免 stale 触发）
 */
export interface PendingScrollRequest {
  filePath: string;
  line: number;
  column?: number;
  pulseMs?: number;
  diffRevision?: DiffRevision;
  timestamp: number;
}

export interface PendingScrollContextValue {
  /** 当前 pending 请求；处理完后会被 setPendingRequest(null) 清空。 */
  pendingRequest: PendingScrollRequest | null;
  /** 设置 / 清空 pending 请求。传 null 表示清空。 */
  setPendingRequest: (req: PendingScrollRequest | null) => void;
}

const PendingScrollContext = createContext<PendingScrollContextValue | null>(null);

const FALLBACK: PendingScrollContextValue = {
  pendingRequest: null,
  setPendingRequest: () => {
    // 静默 no-op，便于未挂载 Provider 时也能调用（避免硬崩）
  },
};

/**
 * PendingScrollProvider
 *
 * 用法：
 *   <PendingScrollProvider>
 *     <WorkspaceFilePreviewBridge filePath={path} ... />
 *   </PendingScrollProvider>
 *
 * 注意：WorkspaceFilePreviewBridge 自身已内置 Provider，**业务侧**无需再次 wrap；
 *       这里单独导出给需要 Provider 跨多层桥接的场景。
 */
export const PendingScrollProvider: FC<{ children: ReactNode }> = ({ children }) => {
  const [pendingRequest, setPendingRequestState] = useState<PendingScrollRequest | null>(null);

  const setPendingRequest = useCallback((req: PendingScrollRequest | null) => {
    setPendingRequestState(req);
  }, []);

  const value = useMemo<PendingScrollContextValue>(
    () => ({ pendingRequest, setPendingRequest }),
    [pendingRequest, setPendingRequest],
  );

  return <PendingScrollContext.Provider value={value}>{children}</PendingScrollContext.Provider>;
};

/**
 * usePendingScroll —— 消费 PendingScrollContext。
 *
 * 返回的对象**不会**为 null；当未在 PendingScrollProvider 内时返回的 setPendingRequest
 * 是 no-op，方便上层组件无脑消费而无需 Provider 存在性检查。
 *
 * 若需严格 Provider 检测（用于测试断言"必须被 Provider 包起来"），使用
 * `usePendingScrollStrict()` —— 它在未挂载 Provider 时抛错。
 */
export function usePendingScroll(): PendingScrollContextValue {
  const ctx = useContext(PendingScrollContext);
  if (ctx) return ctx;
  return FALLBACK;
}

/**
 * usePendingScrollStrict —— 严格版 usePendingScroll；未在 Provider 内时抛错。
 *
 * 用于内部组件（WorkspaceFilePreviewBridge / ChatCardLinkBridge）的安全性校验。
 */
export function usePendingScrollStrict(): PendingScrollContextValue {
  const ctx = useContext(PendingScrollContext);
  if (!ctx) {
    throw new Error(
      'usePendingScrollStrict must be used within a <PendingScrollProvider>. ' +
        'If you are building a consumer outside a Provider, use usePendingScroll() instead.',
    );
  }
  return ctx;
}

/**
 * useHasPendingScrollProviderContext —— 轻量 Provider 在场检测。
 *
 * 用于 WorkspaceFilePreviewBridge 等内部组件：检测自身是否已被外部 PendingScrollProvider 包裹，
 * 避免重复 wrap（double Provider 导致 Context 隔离失效）。
 *
 * 实现原理：用 `useRef(null)` 在 render 阶段读取 context；
 *         不需要 useState/useEffect，零额外渲染成本。
 *
 * 用法示例：
 *   const hasOuter = useHasPendingScrollProviderContext();
 *   if (!hasOuter) {
 *     // 自动 wrap PendingScrollProvider（内部兜底）
 *   }
 */
export function useHasPendingScrollProviderContext(): boolean {
  const ctx = useContext(PendingScrollContext);
  return ctx !== null;
}