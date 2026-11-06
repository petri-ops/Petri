import { isTextFile } from '@/lib/previewFileUtils';
import { MESH_INPUT_FORMATS } from '@/lib/meshAssets';
import type { ResultArtifactKind } from '@/lib/result-manifest';

/**
 * Result Studio viewer 注册表（D2 裁决：前端内部契约）。
 *
 * BLOCK-138 P0（切片 A·内核收口）：kind→viewer 的解析逻辑自 `resultSurface.ts` 收编于此。
 * BLOCK-142（切片 E·renderer 补课，docs/block-142-artifact-plane-renderers-plan.md §1.4）：
 * 新增 markdown/spreadsheet/pdf 三 adapter，其中两条原位替换旧 binary 规则：
 *   - .pdf → pdf（原 .pdf→binary 位，仍先于 image）
 *   - .xlsx/.xlsm → spreadsheet（原 .xls/.xlsx→binary 位，先于 table；exceljs 只读 OOXML）
 *   - .xls → binary（上行拆分的存量保留：legacy .xls 不在 exceljs 解析范围，维持下载兜底）
 *   - .md/.markdown → markdown（新增，先于 text 规则；isTextFile 表中相应让位）
 *
 * kind→viewer 解析链（声明顺序即判定优先级；行号锚点为本文件现行行号）：
 *   :107 preview === false -> binary（短路，先于一切规则）
 *    :82 kind==='report' 或 /\.html?$/ -> report（扩展名分支对任意 kind 生效）
 *    :84 /\.pdf$/ -> pdf
 *    :86 kind==='plot' 或 .png/.jpe?g/.gif/.svg/.webp -> image
 *    :88 /\.(xlsx|xlsm)$/ -> spreadsheet
 *    :90 /\.xls$/ -> binary（存量保留）
 *    :92 kind==='table' 或 /\.(csv|tsv)$/ -> table
 *    :94 /\.json$/ -> json
 *    :96 /\.(md|markdown)$/ -> markdown
 *    :98 kind==='text' 或 isTextFile(name) -> text（isTextFile 扩展名表 previewFileUtils.ts:15-24）
 *   :118 兜底（'data'/'file' 无专属分支的 kind 与一切未知 kind）-> binary
 * 文件名先 toLowerCase 再匹配（:109，扩展名大小写不敏感）；kind 严格相等（大小写敏感）。
 */
export type ResultViewerAdapter =
  | 'report'
  | 'image'
  | 'table'
  | 'json'
  | 'text'
  | 'binary'
  | 'markdown'
  | 'spreadsheet'
  | 'pdf'
  | 'model3d'
  | 'video'
  | 'svg-editor';

/** 一次 viewer 解析的结果：adapter + 能力声明位。 */
export interface ResolvedResultViewer {
  adapter: ResultViewerAdapter;
  /** 能力声明占位（BLOCK-138 P0 只冻结位本身，不接线取值；取值决策属后续切片 C/D）。 */
  canSelect: boolean;
  canCompare: boolean;
  canExport: boolean;
  /** BLOCK-369（NSO-W3 F-09）机器可读降级原因：仅 binary 兜底（preview_disabled / no_matching_viewer）。 */
  reasonCode?: 'preview_disabled' | 'no_matching_viewer';
  /** 命中方式（extension / kind / fallback），供审计与测试断言。 */
  matchedBy?: 'extension' | 'kind' | 'fallback';
}

/**
 * 九类 adapter 的能力声明档案。BLOCK-138 P0 六类仍全部 false 占位（取值决策属切片 C/D）；
 * BLOCK-142 三新档案按 plan §1.4 定值：markdown/pdf canExport=true（原文可导出），
 * spreadsheet 三位暂 false 占位——canSelect 接选择总线属后续包。
 * BLOCK-151 B 轨（审视吸收二波）：canExport 位经 viewerProfileCanExport 接线消费
 * （Shell 挂载面「打开原文件」出口）；canSelect/canCompare 仍为占位。
 */
// BLOCK-175 CP-14 — 能力位接线（切片 C）：只读文本族（table/json/text/markdown）
// 的文本选择经选择总线→「继续分析」引用链（useArtifactTextSelection 消费）；
// table 族自Pair可比较（canCompare，分屏钉住面消费）。report/image/binary/
// spreadsheet 维持 false（无文本选择面/比较语义不成立），pdf canExport 既有。
const VIEWER_PROFILES: Record<ResultViewerAdapter, Omit<ResolvedResultViewer, 'adapter'>> = {
  report: { canSelect: false, canCompare: false, canExport: false },
  image: { canSelect: false, canCompare: false, canExport: false },
  table: { canSelect: true, canCompare: true, canExport: false },
  json: { canSelect: true, canCompare: false, canExport: false },
  text: { canSelect: true, canCompare: false, canExport: false },
  binary: { canSelect: false, canCompare: false, canExport: false },
  markdown: { canSelect: true, canCompare: false, canExport: true },
  spreadsheet: { canSelect: false, canCompare: false, canExport: false },
  pdf: { canSelect: false, canCompare: false, canExport: true },
  // RW-01：3D 产物 artifact 级选择进选择总线（Composer 结构化引用）；比较/导出位如实 false
  // （网格级 diff 与原文出口不在本包范围）。
  model3d: { canSelect: true, canCompare: false, canExport: false },
  // BLOCK-322 P2-05 — 视频：无文本选择语义（canSelect false）、无可比较对象（canCompare false）；
  // 原文可导出成立（产物就是可下载可外发的 mp4/webm），故 canExport true 由 ViewerExportAction 消费。
  video: { canSelect: false, canCompare: false, canExport: true },
  // BLOCK-342 W1 — SVG 编辑器：画布级选择（元素选择不是文本选择，不进选择总线），
  // 无比较语义；原文可导出成立（就是可下载的 .svg 文件）。
  'svg-editor': { canSelect: false, canCompare: false, canExport: true },
};

/**
 * 有序适配规则表：声明顺序即判定优先级，规则内 kind 与 extension 任一命中即命中。
 * kind 为原始 manifest 值的字符串化（未知 kind 无专属规则，自然落兜底）。
 */

/**
 * 能力声明消费面（BLOCK-151 B 轨）：adapter 是否声明「原文可导出」。
 * 取值唯一来源=上方档案表（不复制布尔）；canExport=true 的消费形态是
 * ResultArtifactShell/ViewerExportAction 的「打开原文件」出口。
 */
export function viewerProfileCanExport(adapter: ResultViewerAdapter): boolean {
  return VIEWER_PROFILES[adapter].canExport;
}

/** BLOCK-175 CP-14 — adapter 是否声明「文本选择→选择总线」能力。 */
export function viewerProfileCanSelect(adapter: ResultViewerAdapter): boolean {
  return VIEWER_PROFILES[adapter].canSelect;
}

export function resolveResultViewer(input: {
  kind: ResultArtifactKind;
  fileName: string;
  preview?: boolean;
}): ResolvedResultViewer {
  // BLOCK-369（NSO-W3 F-09）三段式分派：扩展名优先 → kind 兜底 → binary+降级原因。
  // 旧「规则内 kind/extension 任一命中」让 kind='report' 的 .pdf/.mp4/.svg 被塞进 HTML 预览
  // 且降级无解释（评估 F-09 错分派）。
  if (input.preview === false) {
    return { adapter: 'binary', ...VIEWER_PROFILES.binary, reasonCode: 'preview_disabled' };
  }
  const kind = String(input.kind);
  const name = String(input.fileName || '').toLowerCase();

  // A 段·扩展名优先（声明序；svg 规则对 kind='plot' 让位 image——BLOCK-342 语义保持）。
  const extensionRules: readonly { adapter: ResultViewerAdapter; test: (n: string) => boolean; unlessKind?: string }[] = [
    { adapter: 'pdf', test: (n) => /\.pdf$/.test(n) },
    { adapter: 'video', test: (n) => /\.(mp4|webm)$/.test(n) },
    { adapter: 'model3d', test: (n) => new RegExp(`\\.(${MESH_INPUT_FORMATS.join('|')})$|\\.scene3d\\.json$`).test(n) },
    { adapter: 'spreadsheet', test: (n) => /\.(xlsx|xlsm)$/.test(n) },
    { adapter: 'binary', test: (n) => /\.xls$/.test(n) },
    { adapter: 'image', test: (n) => /\.(png|jpe?g|gif|webp)$/.test(n) },
    { adapter: 'svg-editor', test: (n) => /\.svg$/.test(n), unlessKind: 'plot' },
    { adapter: 'table', test: (n) => /\.(csv|tsv)$/.test(n) },
    { adapter: 'report', test: (n) => /\.html?$/.test(n) },
    { adapter: 'json', test: (n) => /\.json$/.test(n) && !/\.scene3d\.json$/.test(n) },
    { adapter: 'markdown', test: (n) => /\.(md|markdown)$/.test(n) },
    { adapter: 'text', test: (n) => isTextFile(n) },
  ];
  for (const rule of extensionRules) {
    if (rule.unlessKind && rule.unlessKind === kind) continue;
    if (rule.test(name)) return { adapter: rule.adapter, ...VIEWER_PROFILES[rule.adapter], matchedBy: 'extension' };
  }

  // B 段·kind 兜底：扩展名未命中时 kind 恒胜（report/plot/table/text/model3d 专属语义）。
  const kindRules: readonly { kind: string; adapter: ResultViewerAdapter }[] = [
    { kind: 'report', adapter: 'report' },
    { kind: 'plot', adapter: 'image' },
    { kind: 'table', adapter: 'table' },
    { kind: 'text', adapter: 'text' },
    { kind: 'model3d', adapter: 'model3d' },
  ];
  for (const rule of kindRules) {
    if (rule.kind === kind) return { adapter: rule.adapter, ...VIEWER_PROFILES[rule.adapter], matchedBy: 'kind' };
  }

  // C 段·兜底：'data'/'file' 与一切未知 kind 落 binary，附机器可读降级原因。
  return { adapter: 'binary', ...VIEWER_PROFILES.binary, reasonCode: 'no_matching_viewer', matchedBy: 'fallback' };
}
