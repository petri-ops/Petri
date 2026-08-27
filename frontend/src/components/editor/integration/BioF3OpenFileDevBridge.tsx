/**
 * BLOCK-22 P3 桥接层 (UI-194) — BioF3OpenFileDevBridge
 *
 * ⚠️ DEV ONLY — Do NOT mount in production builds.
 *
 * This is a development-time global function entry point that lets you
 * manually trigger file opens via `window.__biof3DispatchOpenFile(...)`.
 *
 * For production, please subscribe to biof3Events in lib/events.ts and
 * forward events through PendingScrollContext properly.
 *
 * @see docs/block-22-codemirror-inline-diff-closeout.md §10 P4.5
 *
 * ----
 *
 * 用途：建立"事件 → context → CodeMirrorEditor"的抽象桥接层
 *
 * 本文件**不**直接消费 SimpleChat.tsx / events.ts / WorkspaceFilePreview。
 * 按 biof3-project-governance §Guardrails "Never modify unknown WIP"，
 * 业务侧入口（SimpleChat 聊天卡片 / WorkspaceFilePreview 容器）的具体
 * 接入动作**不在 P3 范围**，留给 WIP 收口后由业务侧 Agent 负责。
 *
 * BioF3OpenFileDevBridge —— 全局监听桥（dev-only）：
 * 1. **不**订阅 events.ts（保持桥接层纯净，不依赖事件总线）
 * 2. **不**挂载到 App.tsx（P3 不动 App.tsx 也不在 WIP 锁外决定）
 * 3. 仅在 dev 模式（process.env.NODE_ENV === 'development'）下
 *    暴露一个 window.__biof3DispatchOpenFile 全局函数（dev tool 入口）
 *
 * P4.2 重命名：原 `AppLevelBridge` → `BioF3OpenFileDevBridge`（明确 dev-only 语义）。
 * 保留 `AppLevelBridge` 作为旧名字 deprecation alias（import 仍有效，避免 breaking change）。
 *
 * 用法（业务侧 / 主 Agent 决定后）：
 *
 *   // 方式 A：直接 import（推荐新代码）
 *   import { BioF3OpenFileDevBridge } from '.../BioF3OpenFileDevBridge';
 *   <BioF3OpenFileDevBridge />
 *
 *   // 方式 B：lazy import（P4.2 lazy loading）
 *   const BioF3OpenFileDevBridge = React.lazy(() => import('./BioF3OpenFileDevBridge'));
 *   <React.Suspense fallback={null}><BioF3OpenFileDevBridge /></React.Suspense>
 *
 *   // 方式 C：旧名字（deprecated，仍有效）
 *   import { AppLevelBridge } from '.../AppLevelBridge'; // ⚠️ deprecated
 *
 * 注意：本组件**不**消费 SimpleChat / events.ts / WorkspaceFilePreview。
 *       是否挂载由主 Agent 收口时统一决策，**P3 不挂载**。
 *
 * 不外推：详见 plan §8。
 */

import React, { lazy, Suspense, useEffect, type FC, type ReactElement } from 'react';

import { usePendingScroll } from '../../../lib/pendingScrollContext';
import type { DiffRevision } from '../CodeMirror/types';

/**
 * window.__biof3DispatchOpenFile 全局函数签名。
 *
 * 业务侧 / DevTools 控制台可直接调：
 *   window.__biof3DispatchOpenFile('/workspace/foo.py', 12, 4)
 *
 * DevTools 用法：
 *   - line 可选（默认 1）
 *   - column 可选
 *   - diffRevision 可选（传入时编辑器会切到 inline-diff 模式）
 */
export interface DispatchOpenFileFn {
  (filePath: string, line?: number, column?: number, diffRevision?: DiffRevision): void;
}

declare global {
  interface Window {
    __biof3DispatchOpenFile?: DispatchOpenFileFn;
  }
}

/**
 * BioF3OpenFileDevBridge —— P4.2 新名字（dev-only）入口组件。
 *
 * 行为：
 * - 挂载时，若 process.env.NODE_ENV === 'development'，挂一个
 *   window.__biof3DispatchOpenFile 全局函数。
 * - 该函数通过 usePendingScroll().setPendingRequest 触发滚动请求；
 *   需要与 WorkspaceFilePreviewBridge 在**同一个** PendingScrollProvider 下才会生效。
 * - 卸载时清空 window.__biof3DispatchOpenFile。
 *
 * **业务侧**后续可以把它挂到 App.tsx（不在 WIP 锁外），但**P3 不挂载**，
 *   留待主 Agent 收口时决策。
 */
export const BioF3OpenFileDevBridge: FC = (): ReactElement | null => {
  const { setPendingRequest } = usePendingScroll();

  useEffect(() => {
    // P3 仅在 dev 模式暴露全局函数；prod 模式不挂。
    if (process.env.NODE_ENV !== 'development') return undefined;

    const fn: DispatchOpenFileFn = (filePath, line = 1, column, diffRevision) => {
      setPendingRequest({
        filePath,
        line,
        column,
        diffRevision,
        timestamp: Date.now(),
      });
    };

    window.__biof3DispatchOpenFile = fn;
    return () => {
      if (window.__biof3DispatchOpenFile === fn) {
        delete window.__biof3DispatchOpenFile;
      }
    };
  }, [setPendingRequest]);

  return null;
};

// ===== P4.2 lazy loading export =====

/**
 * Lazy-loaded BioF3OpenFileDevBridge。
 *
 * 用法（业务侧懒加载）：
 *   const LazyBridge = React.lazy(() => import('./BioF3OpenFileDevBridge'));
 *   <React.Suspense fallback={null}><LazyBridge /></React.Suspense>
 *
 * 注意：React.lazy + Suspense 在 SSR 场景可能需要特殊处理；本项目为纯 SPA，无此问题。
 */
export { BioF3OpenFileDevBridge as default } from './BioF3OpenFileDevBridge';
