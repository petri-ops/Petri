/**
 * BLOCK-22 P3 桥接层 (UI-194) — AppLevelBridge (DEPRECATED)
 *
 * ⚠️ DEPRECATED — 已在 P4.2 重命名为 `BioF3OpenFileDevBridge`。
 *
 * 本文件保留以避免破坏已有 import。请在新代码中使用：
 *
 *   import { BioF3OpenFileDevBridge } from './BioF3OpenFileDevBridge';
 *
 * 或懒加载：
 *   import React from 'react';
 *   const BioF3OpenFileDevBridge = React.lazy(() => import('./BioF3OpenFileDevBridge'));
 *   <React.Suspense fallback={null}><BioF3OpenFileDevBridge /></React.Suspense>
 *
 * @see BioF3OpenFileDevBridge
 */

// Re-export from new location for backward compatibility
export {
  BioF3OpenFileDevBridge,
  type DispatchOpenFileFn,
} from './BioF3OpenFileDevBridge';

/**
 * @deprecated Use `BioF3OpenFileDevBridge` instead. This alias will be removed in a future release.
 */
export { BioF3OpenFileDevBridge as AppLevelBridge } from './BioF3OpenFileDevBridge';
