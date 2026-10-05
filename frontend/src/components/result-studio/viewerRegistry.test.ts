import { describe, expect, it } from 'vitest';
import type { ResultArtifactKind } from '../../lib/result-manifest';
import type { ResultViewerAdapter } from './resultSurface';
import { resolveResultViewer } from './viewerRegistry';

/**
 * BLOCK-138 P0（切片 A·内核收口）viewer registry 契约测试（HK-01 红绿先行：
 * 本文件先于 `./viewerRegistry` 实现落库，落库前必须为红）。
 *
 * 契约（D2 裁决：前端内部契约，不做跨进程面）：
 *   resolveResultViewer({ kind, fileName, preview? }) -> {
 *     adapter: ResultViewerAdapter,   // 'report' | 'image' | 'table' | 'json' | 'text' | 'binary'
 *     canSelect: boolean,             // 能力声明占位：本包只要求位存在，不接线取值
 *     canCompare: boolean,
 *     canExport: boolean,
 *   }
 *
 * adapter 解析语义源自现状 resolveResultViewerAdapter（resultSurface.ts:69-84）
 * 逐分支平迁；BLOCK-142（切片 E）按 plan §1.4 原位替换三处映射（其余零变化）：
 *   .pdf → pdf（原 binary 位）；.xlsx/.xlsm → spreadsheet（原 binary 位，先于 table）；
 *   .md/.markdown → markdown（先于 text 规则；isTextFile 表中相应让位）。
 *   .xls 存量拆分保留 binary（exceljs 不解析 legacy .xls）。
 * 平迁基线（BLOCK-142 前的 resultSurface 锚点）：
 *   :74 文件名先 toLowerCase 再匹配（扩展名匹配对大小写不敏感，kind 匹配大小写敏感）
 *   :75 preview === false -> binary（短路，先于一切其它分支）
 *   :76 kind==='report' 或 /\.html?$/ -> report（扩展名分支对任意 kind 生效）
 *   :77 /\.pdf$/ -> （BLOCK-142 起 pdf）
 *   :78 kind==='plot' 或 .png/.jpe?g/.gif/.svg/.webp -> image
 *   :79 /\.xlsx?$/ -> （BLOCK-142 起 .xlsx/.xlsm→spreadsheet、.xls→binary 存量保留）
 *   :80 kind==='table' 或 /\.(csv|tsv)$/ -> table
 *   :81 /\.json$/ -> json
 *   :82 kind==='text' 或 isTextFile(name) -> text（isTextFile 扩展名表见 previewFileUtils.ts:15-24）
 *   :83 兜底 -> binary
 */

const ALL_KINDS: ResultArtifactKind[] = ['report', 'plot', 'table', 'text', 'data', 'file'];

function resolveAdapter(input: {
  kind: ResultArtifactKind;
  fileName: string;
  preview?: boolean;
}): ResultViewerAdapter {
  return resolveResultViewer(input).adapter;
}

describe('viewerRegistry（BLOCK-138 P0 切片A）adapter 解析 = resultSurface.resolveResultViewerAdapter 现状平迁', () => {
  it('preview === false 短路为 binary，先于一切其它分支（resultSurface.ts:75）', () => {
    expect(resolveAdapter({ kind: 'report', fileName: 'report.html', preview: false })).toBe('binary');
    expect(resolveAdapter({ kind: 'plot', fileName: 'volcano.png', preview: false })).toBe('binary');
    expect(resolveAdapter({ kind: 'table', fileName: 'deg.csv', preview: false })).toBe('binary');
    expect(resolveAdapter({ kind: 'text', fileName: 'notes.md', preview: false })).toBe('binary');
    expect(resolveAdapter({ kind: 'data', fileName: 'matrix.h5ad', preview: false })).toBe('binary');
    expect(resolveAdapter({ kind: 'file', fileName: 'archive.zip', preview: false })).toBe('binary');
  });

  it('preview 只有严格等于 false 才短路；true 与缺省不触发（resultSurface.ts:75）', () => {
    expect(resolveAdapter({ kind: 'report', fileName: 'report.html', preview: true })).toBe('report');
    expect(resolveAdapter({ kind: 'plot', fileName: 'volcano.svg' })).toBe('image');
  });

  it("kind==='report' 与扩展名 .html/.htm 都落 report（resultSurface.ts:76）", () => {
    // kind 分支：任意扩展名都 report
    expect(resolveAdapter({ kind: 'report', fileName: 'brief.unknownext' })).toBe('report');
    // 扩展名分支对任意 kind 生效
    for (const kind of ALL_KINDS) {
      expect(resolveAdapter({ kind, fileName: 'final-report.html' })).toBe('report');
      expect(resolveAdapter({ kind, fileName: 'legacy-page.htm' })).toBe('report');
    }
  });

  it('report 分支先于其后所有覆盖分支（resultSurface.ts:76 顺序敏感）', () => {
    // kind report 恒胜：即使扩展名会命中后续 pdf/image/table/text 规则
    expect(resolveAdapter({ kind: 'report', fileName: 'paper.pdf' })).toBe('report');
    expect(resolveAdapter({ kind: 'report', fileName: 'cover.png' })).toBe('report');
    expect(resolveAdapter({ kind: 'report', fileName: 'appendix.csv' })).toBe('report');
    expect(resolveAdapter({ kind: 'report', fileName: 'brief.md' })).toBe('report');
  });

  it('文件名先 toLowerCase 再匹配（resultSurface.ts:74），大小写不敏感', () => {
    expect(resolveAdapter({ kind: 'file', fileName: 'Report.HTML' })).toBe('report');
    expect(resolveAdapter({ kind: 'data', fileName: 'Matrix.PNG' })).toBe('image');
  });

  it('.pdf 落 pdf——先于 image 分支（BLOCK-142 原位替换 resultSurface.ts:77 的 binary 位）', () => {
    expect(resolveAdapter({ kind: 'plot', fileName: 'volcano.pdf' })).toBe('pdf');
    expect(resolveAdapter({ kind: 'table', fileName: 'paper.pdf' })).toBe('pdf');
    expect(resolveAdapter({ kind: 'text', fileName: 'paper.pdf' })).toBe('pdf');
    expect(resolveAdapter({ kind: 'data', fileName: 'paper.pdf' })).toBe('pdf');
    expect(resolveAdapter({ kind: 'file', fileName: 'paper.pdf' })).toBe('pdf');
  });

  it("kind==='plot' 与图片扩展名 .png/.jpg/.jpeg/.gif/.svg/.webp 都落 image（resultSurface.ts:78）", () => {
    // kind 分支：任意扩展名都 image
    expect(resolveAdapter({ kind: 'plot', fileName: 'heatmap.vega' })).toBe('image');
    // 扩展名分支（对无前置专属分支的 kind 生效）
    for (const ext of ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp']) {
      expect(resolveAdapter({ kind: 'data', fileName: `figure.${ext}` })).toBe('image');
      expect(resolveAdapter({ kind: 'file', fileName: `figure.${ext}` })).toBe('image');
    }
  });

  it('image 分支先于 .xls/.xlsx 覆盖分支（resultSurface.ts:78 < :79 顺序敏感）', () => {
    // 现状行为：kind plot 的 .xls 也落 image——image 分支在 xlsx 覆盖之前
    expect(resolveAdapter({ kind: 'plot', fileName: 'sheet.xls' })).toBe('image');
    expect(resolveAdapter({ kind: 'plot', fileName: 'sheet.xlsx' })).toBe('image');
  });

  it('.xlsx/.xlsm 落 spreadsheet——先于 table 分支（BLOCK-142 原位替换 resultSurface.ts:79 的 binary 位）', () => {
    // xlsx/xlsm 交给 spreadsheet viewer，不再落 binary
    expect(resolveAdapter({ kind: 'table', fileName: 'results.xlsx' })).toBe('spreadsheet');
    expect(resolveAdapter({ kind: 'text', fileName: 'results.xlsx' })).toBe('spreadsheet');
    expect(resolveAdapter({ kind: 'file', fileName: 'results.xlsx' })).toBe('spreadsheet');
    expect(resolveAdapter({ kind: 'data', fileName: 'macro.xlsm' })).toBe('spreadsheet');
  });

  it('.xls 存量保留 binary——先于 table 分支（BLOCK-142 拆分保留：exceljs 不解析 legacy .xls）', () => {
    expect(resolveAdapter({ kind: 'table', fileName: 'legacy.xls' })).toBe('binary');
    expect(resolveAdapter({ kind: 'data', fileName: 'legacy.xls' })).toBe('binary');
    expect(resolveAdapter({ kind: 'file', fileName: 'legacy.xls' })).toBe('binary');
  });

  it("kind==='table' 与 .csv/.tsv 都落 table，且先于 text 判定（resultSurface.ts:80 顺序敏感）", () => {
    // kind 分支：任意扩展名都 table
    expect(resolveAdapter({ kind: 'table', fileName: 'pivot.custom' })).toBe('table');
    // .csv/.tsv 也在 isTextFile 表内，但 table 分支在前——text/file/data kind 的 csv 落 table 而非 text
    expect(resolveAdapter({ kind: 'text', fileName: 'deg.csv' })).toBe('table');
    expect(resolveAdapter({ kind: 'text', fileName: 'deg.tsv' })).toBe('table');
    expect(resolveAdapter({ kind: 'file', fileName: 'deg.csv' })).toBe('table');
    expect(resolveAdapter({ kind: 'data', fileName: 'deg.tsv' })).toBe('table');
  });

  it('.json 落 json，先于 isTextFile 判定（resultSurface.ts:81 顺序敏感）', () => {
    expect(resolveAdapter({ kind: 'text', fileName: 'summary.json' })).toBe('json');
    expect(resolveAdapter({ kind: 'file', fileName: 'payload.json' })).toBe('json');
    expect(resolveAdapter({ kind: 'data', fileName: 'payload.json' })).toBe('json');
    // .jsonl 不匹配 /\.json$/，落到 isTextFile -> text
    expect(resolveAdapter({ kind: 'file', fileName: 'trace.jsonl' })).toBe('text');
  });

  it("kind==='text' 落 text（resultSurface.ts:82 kind 分支）", () => {
    expect(resolveAdapter({ kind: 'text', fileName: 'notes.weirdext' })).toBe('text');
    expect(resolveAdapter({ kind: 'text', fileName: 'README' })).toBe('text');
  });

  it('isTextFile 扩展名表（previewFileUtils.ts:15-24）逐个按现状落点解析（resultSurface.ts:82）', () => {
    // isTextFile 全表 40 扩展名；csv/tsv 先命中 table（:80）、html/htm 先命中
    // report（:76）、json 先命中 json（:81）、md/markdown 先命中 markdown（BLOCK-142
    // 规则，分支顺序），其余落 text（:82）。
    const isTextFileTable: Array<[string, ResultViewerAdapter]> = [
      ['txt', 'text'], ['md', 'markdown'], ['markdown', 'markdown'],
      ['csv', 'table'], ['tsv', 'table'], ['tab', 'text'],
      ['json', 'json'], ['jsonl', 'text'], ['log', 'text'],
      ['r', 'text'], ['py', 'text'], ['sh', 'text'], ['bash', 'text'], ['zsh', 'text'],
      ['js', 'text'], ['jsx', 'text'], ['mjs', 'text'], ['cjs', 'text'], ['ts', 'text'], ['tsx', 'text'],
      ['css', 'text'], ['scss', 'text'], ['html', 'report'], ['htm', 'report'], ['xml', 'text'],
      ['yaml', 'text'], ['yml', 'text'], ['toml', 'text'], ['ini', 'text'], ['conf', 'text'], ['sql', 'text'],
      ['sam', 'text'], ['bed', 'text'], ['gtf', 'text'], ['gff', 'text'], ['vcf', 'text'],
      ['fasta', 'text'], ['fa', 'text'], ['fastq', 'text'], ['fq', 'text'],
    ];
    expect(isTextFileTable).toHaveLength(40);
    for (const [ext, expected] of isTextFileTable) {
      expect(resolveAdapter({ kind: 'file', fileName: `sample.${ext}` })).toBe(expected);
    }
  });

  it("兜底：'data'/'file' 两个无专属分支的 kind 落 binary（resultSurface.ts:83）", () => {
    expect(resolveAdapter({ kind: 'data', fileName: 'matrix.rds' })).toBe('binary');
    expect(resolveAdapter({ kind: 'data', fileName: 'object.h5ad' })).toBe('binary');
    expect(resolveAdapter({ kind: 'file', fileName: 'archive.zip' })).toBe('binary');
    expect(resolveAdapter({ kind: 'file', fileName: 'bundle.tar.gz' })).toBe('binary');
    expect(resolveAdapter({ kind: 'data', fileName: 'tensor.npy' })).toBe('binary');
  });
});

describe('viewerRegistry（BLOCK-138 P0）未知 kind 兜底 binary 路径', () => {
  it('清单里出现的一切未知 kind 走兜底 binary（resultSurface.ts:83），不抛错', () => {
    // 运行时 kind 来自原始 manifest JSON，可能越过 ResultArtifactKind 联合类型；
    // 现状解析对 kind 用严格相等比较（大小写敏感），未知值一律走扩展名链后兜底。
    for (const raw of ['telemetry-stream', '', 'analysis/plot', 'REPORT']) {
      const kind = raw as ResultArtifactKind;
      expect(resolveAdapter({ kind, fileName: 'blob.bin' })).toBe('binary');
    }
  });

  it('未知 kind 仍按扩展名链路解析，等价现状（零行为平迁）', () => {
    const unknownKind = 'mystery' as string as ResultArtifactKind;
    expect(resolveAdapter({ kind: unknownKind, fileName: 'notes.txt' })).toBe('text');
    expect(resolveAdapter({ kind: unknownKind, fileName: 'deg.csv' })).toBe('table');
    expect(resolveAdapter({ kind: unknownKind, fileName: 'payload.json' })).toBe('json');
  });
});

describe('viewerRegistry（BLOCK-138 P0）能力声明位（占位，本包不接线）', () => {
  const ADAPTER_REPRESENTATIVES: Array<[ResultArtifactKind, string, ResultViewerAdapter]> = [
    ['report', 'report.html', 'report'],
    ['plot', 'volcano.svg', 'image'],
    ['table', 'deg.csv', 'table'],
    ['text', 'summary.json', 'json'],
    ['text', 'notes.md', 'markdown'],
    ['data', 'matrix.rds', 'binary'],
  ];

  it('六类 adapter 的解析结果都携带 canSelect/canCompare/canExport 声明位', () => {
    for (const [kind, fileName, adapter] of ADAPTER_REPRESENTATIVES) {
      const resolved = resolveResultViewer({ kind, fileName });
      expect(resolved.adapter).toBe(adapter);
      expect(resolved).toHaveProperty('canSelect');
      expect(resolved).toHaveProperty('canCompare');
      expect(resolved).toHaveProperty('canExport');
      expect(typeof resolved.canSelect).toBe('boolean');
      expect(typeof resolved.canCompare).toBe('boolean');
      expect(typeof resolved.canExport).toBe('boolean');
    }
  });

  it('兜底 binary 解析同样携带完整能力声明位', () => {
    const resolved = resolveResultViewer({
      kind: 'telemetry-stream' as string as ResultArtifactKind,
      fileName: 'blob.bin',
    });
    expect(resolved.adapter).toBe('binary');
    expect(typeof resolved.canSelect).toBe('boolean');
    expect(typeof resolved.canCompare).toBe('boolean');
    expect(typeof resolved.canExport).toBe('boolean');
  });
});
