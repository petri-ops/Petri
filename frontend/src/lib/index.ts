/**
 * BLOCK-22 P3 桥接层 (UI-194) — frontend/src/lib barrel 导出
 *
 * 用途：让业务侧 / 测试方便从 `@/lib` 一处导入 P3 桥接层公共 API。
 *
 * 范围：
 * - PendingScrollProvider / usePendingScroll / usePendingScrollStrict
 * - PendingScrollRequest / PendingScrollContextValue 类型
 *
 * 注意：frontend/src/lib/ 目前**没有**统一个 barrel（其他 .ts 模块仍按需
 *       直接 import），本文件**仅**为 P3 桥接层暴露的 PendingScroll API
 *       提供一个集中入口，**不**外推导出 lib/ 目录下其他模块。
 *
 * 不外推：详见 plan §8。
 */

export {
  PendingScrollProvider,
  usePendingScroll,
  usePendingScrollStrict,
} from './pendingScrollContext';
export type {
  PendingScrollRequest,
  PendingScrollContextValue,
} from './pendingScrollContext';