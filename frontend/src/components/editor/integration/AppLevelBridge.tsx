/**
 * BLOCK-22 P3 桥接层 (UI-194) — AppLevelBridge (DEPRECATED)
 *
 * ⚠️ DEPRECATED — 已在 P4.2 重命名为 `GewuOpenFileDevBridge`。
 *
 * 本文件保留以避免破坏已有 import。请在新代码中使用：
 *
 *   import { GewuOpenFileDevBridge } from './GewuOpenFileDevBridge';
 *
 * 或懒加载：
 *   import React from 'react';
 *   const GewuOpenFileDevBridge = React.lazy(() => import('./GewuOpenFileDevBridge'));
 *   <React.Suspense fallback={null}><GewuOpenFileDevBridge /></React.Suspense>
 *
 * @see GewuOpenFileDevBridge
 */

// Re-export from new location for backward compatibility
export {
  GewuOpenFileDevBridge,
  type DispatchOpenFileFn,
} from './GewuOpenFileDevBridge';

/**
 * @deprecated Use `GewuOpenFileDevBridge` instead. This alias will be removed in a future release.
 */
export { GewuOpenFileDevBridge as AppLevelBridge } from './GewuOpenFileDevBridge';
