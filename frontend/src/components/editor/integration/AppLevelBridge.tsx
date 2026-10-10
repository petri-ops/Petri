/**
 * BLOCK-22 P3 桥接层 (UI-194) — AppLevelBridge (DEPRECATED)
 *
 * ⚠️ DEPRECATED — 已在 P4.2 重命名为 `PetriOpenFileDevBridge`。
 *
 * 本文件保留以避免破坏已有 import。请在新代码中使用：
 *
 *   import { PetriOpenFileDevBridge } from './PetriOpenFileDevBridge';
 *
 * 或懒加载：
 *   import React from 'react';
 *   const PetriOpenFileDevBridge = React.lazy(() => import('./PetriOpenFileDevBridge'));
 *   <React.Suspense fallback={null}><PetriOpenFileDevBridge /></React.Suspense>
 *
 * @see PetriOpenFileDevBridge
 */

// Re-export from new location for backward compatibility
export {
  PetriOpenFileDevBridge,
  type DispatchOpenFileFn,
} from './PetriOpenFileDevBridge';

/**
 * @deprecated Use `PetriOpenFileDevBridge` instead. This alias will be removed in a future release.
 */
export { PetriOpenFileDevBridge as AppLevelBridge } from './PetriOpenFileDevBridge';
