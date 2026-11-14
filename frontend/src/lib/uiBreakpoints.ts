/**
 * UI-D2 (BLOCK-417) — 响应式断点阈值的 JS 侧单一真源。
 *
 * CSS 的 `@media` 不支持 `var()`，因此 CSS 侧阈值无法运行时引用本常量；
 * `scripts/ui-design-breakpoints.mjs` 的登记表把 CSS 阈值与本常量机械对账
 * （`npm run gate:ui-breakpoints`），植入未登记阈值或 JS 裸阈值必红。
 *
 * 767 → 768 对齐：报告 §1.2 记录 JS `max-width: 767px` 与 CSS `max-width: 768px`
 * 差 1px；统一取 CSS 现值 768（整数像素下 `<=767` 与 `<=768` 相差恰好 1px，
 * 对齐后 JS 与 CSS 判定域逐字一致）。档位数收敛（17 → ≤4）属 U-04 待裁决，
 * 本文件只做单源与对齐，不改任何其它阈值语义。
 */

/** 窄屏 / 投影手机浏览器阈值（与 CSS `@media (max-width: 768px)` 同源）。 */
export const MOBILE_BREAKPOINT_PX = 768;

/** 工作区浮层（compactLayout）阈值（与 CSS `@media (max-width: 960px)` 同源）。 */
const COMPACT_BREAKPOINT_PX = 960;

/** 仅导出被消费的查询串；原始数值常量保持模块内私有，避免 knip 死导出。 */
export const MOBILE_MAX_WIDTH_QUERY = `(max-width: ${MOBILE_BREAKPOINT_PX}px)`;
export const COMPACT_MAX_WIDTH_QUERY = `(max-width: ${COMPACT_BREAKPOINT_PX}px)`;
