import { isTextFile } from '@/lib/previewFileUtils';
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
  | 'pdf';

/** 一次 viewer 解析的结果：adapter + 能力声明位。 */
export interface ResolvedResultViewer {
  adapter: ResultViewerAdapter;
  /** 能力声明占位（BLOCK-138 P0 只冻结位本身，不接线取值；取值决策属后续切片 C/D）。 */
  canSelect: boolean;
  canCompare: boolean;
  canExport: boolean;
}

/**
 * 九类 adapter 的能力声明档案。BLOCK-138 P0 六类仍全部 false 占位（取值决策属切片 C/D）；
 * BLOCK-142 三新档案按 plan §1.4 定值：markdown/pdf canExport=true（原文可导出），
 * spreadsheet 三位暂 false 占位——canSelect 接选择总线属后续包。
 */
const VIEWER_PROFILES: Record<ResultViewerAdapter, Omit<ResolvedResultViewer, 'adapter'>> = {
  report: { canSelect: false, canCompare: false, canExport: false },
  image: { canSelect: false, canCompare: false, canExport: false },
  table: { canSelect: false, canCompare: false, canExport: false },
  json: { canSelect: false, canCompare: false, canExport: false },
  text: { canSelect: false, canCompare: false, canExport: false },
  binary: { canSelect: false, canCompare: false, canExport: false },
  markdown: { canSelect: false, canCompare: false, canExport: true },
  spreadsheet: { canSelect: false, canCompare: false, canExport: false },
  pdf: { canSelect: false, canCompare: false, canExport: true },
};

/**
 * 有序适配规则表：声明顺序即判定优先级，规则内 kind 与 extension 任一命中即命中。
 * kind 为原始 manifest 值的字符串化（未知 kind 无专属规则，自然落兜底）。
 */
interface AdapterRule {
  adapter: ResultViewerAdapter;
  /** kind 严格相等命中（大小写敏感）；缺省 = 不看 kind。 */
  kind?: string;
  /** 小写文件名上的扩展名正则；缺省 = 不看文件名。 */
  extension?: RegExp;
  /** isTextFile 扩展名表命中；缺省 = 不查表。 */
  textExtension?: boolean;
}

const ADAPTER_RULES: readonly AdapterRule[] = [
  // resultSurface.ts:76 — report kind 恒胜，.html/.htm 对任意 kind 生效
  { adapter: 'report', kind: 'report', extension: /\.html?$/ },
  // BLOCK-142（原位替换 resultSurface.ts:77 .pdf→binary）— .pdf → pdf viewer，仍先于 image
  { adapter: 'pdf', extension: /\.pdf$/ },
  // resultSurface.ts:78 — plot kind 恒胜（含 plot+xls 落 image 的现状行为）
  { adapter: 'image', kind: 'plot', extension: /\.(png|jpe?g|gif|svg|webp)$/ },
  // BLOCK-142（原位替换 resultSurface.ts:79 .xls/.xlsx→binary）— .xlsx/.xlsm → spreadsheet viewer（先于 table）
  { adapter: 'spreadsheet', extension: /\.(xlsx|xlsm)$/ },
  // BLOCK-142 存量拆分保留（resultSurface.ts:79 的 .xls 半边）— legacy .xls 不在 exceljs 解析范围，维持 binary 兜底
  { adapter: 'binary', extension: /\.xls$/ },
  // resultSurface.ts:80 — table kind 恒胜；.csv/.tsv 先于 text 判定命中 table
  { adapter: 'table', kind: 'table', extension: /\.(csv|tsv)$/ },
  // resultSurface.ts:81 — .json 先于 isTextFile 判定命中 json（.jsonl 不匹配，落 text）
  { adapter: 'json', extension: /\.json$/ },
  // BLOCK-142 新增（plan §1.4：md 先于 isTextFile）— .md/.markdown → markdown viewer，先于 text 规则
  { adapter: 'markdown', extension: /\.(md|markdown)$/ },
  // resultSurface.ts:82 — text kind 恒胜；isTextFile 扩展名表落 text（.md/.markdown 已被上一行抢先）
  { adapter: 'text', kind: 'text', textExtension: true },
];

export function resolveResultViewer(input: {
  kind: ResultArtifactKind;
  fileName: string;
  preview?: boolean;
}): ResolvedResultViewer {
  // resultSurface.ts:75 — preview 显式 false 短路为 binary，先于一切规则
  if (input.preview === false) return { adapter: 'binary', ...VIEWER_PROFILES.binary };
  const kind = String(input.kind);
  const name = String(input.fileName || '').toLowerCase();
  for (const rule of ADAPTER_RULES) {
    const hit =
      (rule.kind !== undefined && rule.kind === kind)
      || (rule.extension !== undefined && rule.extension.test(name))
      || (rule.textExtension === true && isTextFile(name));
    if (hit) return { adapter: rule.adapter, ...VIEWER_PROFILES[rule.adapter] };
  }
  // resultSurface.ts:83 — 兜底：'data'/'file' 与一切未知 kind 落 binary
  return { adapter: 'binary', ...VIEWER_PROFILES.binary };
}
