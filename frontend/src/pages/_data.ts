// ============================================================
// Backward-compatible re-export of legacy `_data` API.
//
// The 2157-line monolithic data file has been split into:
//   - frontend/src/tools/registry.ts   — InputField / OutputDef / Tool interfaces
//   - frontend/src/tools/categories.ts — toolCategories array
//   - frontend/src/tools/inventory.ts  — tools: Tool[] array
//
// Existing consumers (e.g. SimpleChat, RightPanel,
// ResultView, AnalysisLaunchPanel, project-workspace) still import from
// `@/pages/_data` via alias. New code should import directly from
// `frontend/src/tools/*`.
// ============================================================

export type { InputField, OutputDef, Tool } from '../tools/registry';
export { toolCategories } from '../tools/categories';
export { tools } from '../tools/inventory';
