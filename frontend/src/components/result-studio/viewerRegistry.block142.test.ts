import { describe, expect, it } from 'vitest';
import type { ResultArtifactKind } from '../../lib/result-manifest';
import type { ResultViewerAdapter } from './viewerRegistry';
import { resolveResultViewer } from './viewerRegistry';

/**
 * BLOCK-142（成果面切片 E·renderer 补课）viewerRegistry 注册表契约测试
 * （HK-01 红绿先行：本文件只承载测试——实现属实现切片，落库时必须先红）。
 *
 * 契约来源：docs/block-142-artifact-plane-renderers-plan.md §1.4（三条新规则
 * 插正确优先级位：pdf 先于 image、md 先于 text、xlsx 替换 .xlsx→binary 位）。
 * resolveResultViewer 是纯函数（viewerRegistry.ts:72-90），无需 mock。
 *
 * 三条新规则（现联合类型无 'markdown'/'spreadsheet'/'pdf' 成员，新断言即红）：
 *   ① .md/.markdown -> markdown（先于 text 规则命中）
 *   ② .xlsx/.xlsm   -> spreadsheet（替换现 .xlsx→binary 规则位）
 *   ③ .pdf          -> pdf（替换现 .pdf→binary 规则位，仍先于 image）
 * 既有六类映射零变化（回归，全部现状断言）：
 *   report/html、image(png)、table(csv/tsv)、json、text、未知 kind 兜底 binary。
 */

const ALL_KINDS: ResultArtifactKind[] = ['report', 'plot', 'table', 'text', 'data', 'file'];

function resolveAdapter(input: {
  kind: ResultArtifactKind;
  fileName: string;
  preview?: boolean;
}): ResultViewerAdapter {
  return resolveResultViewer(input).adapter;
}

describe('BLOCK-142 新规则①：.md/.markdown -> markdown（先于 text 规则命中）', () => {
  it("kind='text' 的 .md/.markdown 落 markdown 而非 text（text kind 分支在前却仍被新规则抢先，即优先级证据）", () => {
    expect(resolveAdapter({ kind: 'text', fileName: 'README.md' })).toBe('markdown');
    expect(resolveAdapter({ kind: 'text', fileName: 'NOTES.markdown' })).toBe('markdown');
  });

  it("kind='data' 的 .md/.markdown 落 markdown（现状经 isTextFile 扩展名表落 text，新规则接管）", () => {
    expect(resolveAdapter({ kind: 'data', fileName: 'report.md' })).toBe('markdown');
    expect(resolveAdapter({ kind: 'data', fileName: 'analysis.markdown' })).toBe('markdown');
  });

  it('扩展名大小写不敏感沿用现状（文件名先 toLowerCase 再匹配）', () => {
    expect(resolveAdapter({ kind: 'text', fileName: 'README.MD' })).toBe('markdown');
  });
});

describe('BLOCK-142 新规则②：.xlsx/.xlsm -> spreadsheet（替换现 .xlsx→binary 规则位）', () => {
  it("kind='data' 的 .xlsx/.xlsm 落 spreadsheet 而非 binary（现状 .xlsx→binary 位被替换）", () => {
    expect(resolveAdapter({ kind: 'data', fileName: 'results.xlsx' })).toBe('spreadsheet');
    expect(resolveAdapter({ kind: 'data', fileName: 'macro.xlsm' })).toBe('spreadsheet');
  });

  it("kind='file' 的 .xlsx/.xlsm 落 spreadsheet 而非 binary", () => {
    expect(resolveAdapter({ kind: 'file', fileName: 'workbook.xlsx' })).toBe('spreadsheet');
    expect(resolveAdapter({ kind: 'file', fileName: 'audit.xlsm' })).toBe('spreadsheet');
  });

  it('扩展名大小写不敏感沿用现状', () => {
    expect(resolveAdapter({ kind: 'data', fileName: 'Results.XLSX' })).toBe('spreadsheet');
  });
});

describe('BLOCK-142 新规则③：.pdf -> pdf（替换现 .pdf→binary 规则位，仍先于 image）', () => {
  it('任意 kind 的 .pdf 落 pdf 而非 binary（report 除外——report 规则恒胜，属回归不变项）', () => {
    const kinds = ['plot', 'table', 'text', 'data', 'file'] as const;
    for (const kind of kinds) {
      expect(resolveAdapter({ kind, fileName: 'paper.pdf' })).toBe('pdf');
    }
  });

  it("kind='plot' 的 .pdf 落 pdf——现 .pdf→binary 位先于 image，原位接管后仍先于 image", () => {
    expect(resolveAdapter({ kind: 'plot', fileName: 'volcano.pdf' })).toBe('pdf');
  });

  it('扩展名大小写不敏感沿用现状', () => {
    expect(resolveAdapter({ kind: 'data', fileName: 'Paper.PDF' })).toBe('pdf');
  });
});

describe('BLOCK-142 新 adapter 能力声明档案（VIEWER_PROFILES，plan §1.4 能力声明位）', () => {
  it('markdown/pdf 档案 canExport=true，canSelect/canCompare=false', () => {
    const markdownResolved = resolveResultViewer({ kind: 'text', fileName: 'README.md' });
    expect(markdownResolved.adapter).toBe('markdown');
    expect(markdownResolved.canExport).toBe(true);
    expect(markdownResolved.canSelect).toBe(false);
    expect(markdownResolved.canCompare).toBe(false);

    const pdfResolved = resolveResultViewer({ kind: 'data', fileName: 'paper.pdf' });
    expect(pdfResolved.adapter).toBe('pdf');
    expect(pdfResolved.canExport).toBe(true);
    expect(pdfResolved.canSelect).toBe(false);
    expect(pdfResolved.canCompare).toBe(false);
  });

  it('spreadsheet 档案三能力位暂 false 占位（selection 接线属后续包，plan §1.4）', () => {
    const resolved = resolveResultViewer({ kind: 'data', fileName: 'results.xlsx' });
    expect(resolved.adapter).toBe('spreadsheet');
    expect(resolved.canSelect).toBe(false);
    expect(resolved.canCompare).toBe(false);
    expect(resolved.canExport).toBe(false);
  });
});

describe('BLOCK-142 回归：既有六类映射零变化（全部现状断言，本文件落库时必须全绿）', () => {
  it('report 类：kind=report 恒胜 + .html/.htm 对任意 kind 生效（含 report+pdf 仍 report）', () => {
    expect(resolveAdapter({ kind: 'report', fileName: 'brief.unknownext' })).toBe('report');
    expect(resolveAdapter({ kind: 'report', fileName: 'paper.pdf' })).toBe('report');
    for (const kind of ALL_KINDS) {
      expect(resolveAdapter({ kind, fileName: 'final-report.html' })).toBe('report');
      expect(resolveAdapter({ kind, fileName: 'legacy-page.htm' })).toBe('report');
    }
  });

  it('image 类：图片扩展名落 image + plot kind 恒胜 + plot+xlsx 仍落 image（位次在 spreadsheet 之前）', () => {
    for (const ext of ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp']) {
      expect(resolveAdapter({ kind: 'data', fileName: `figure.${ext}` })).toBe('image');
    }
    expect(resolveAdapter({ kind: 'plot', fileName: 'heatmap.vega' })).toBe('image');
    expect(resolveAdapter({ kind: 'plot', fileName: 'sheet.xlsx' })).toBe('image');
  });

  it('table 类：.csv/.tsv 先于 text 判定落 table + kind=table 恒胜', () => {
    expect(resolveAdapter({ kind: 'text', fileName: 'deg.csv' })).toBe('table');
    expect(resolveAdapter({ kind: 'text', fileName: 'deg.tsv' })).toBe('table');
    expect(resolveAdapter({ kind: 'file', fileName: 'deg.csv' })).toBe('table');
    expect(resolveAdapter({ kind: 'data', fileName: 'deg.tsv' })).toBe('table');
    expect(resolveAdapter({ kind: 'table', fileName: 'pivot.custom' })).toBe('table');
  });

  it('json 类：.json 先于 isTextFile 落 json + .jsonl 仍落 text', () => {
    expect(resolveAdapter({ kind: 'text', fileName: 'summary.json' })).toBe('json');
    expect(resolveAdapter({ kind: 'file', fileName: 'payload.json' })).toBe('json');
    expect(resolveAdapter({ kind: 'data', fileName: 'payload.json' })).toBe('json');
    expect(resolveAdapter({ kind: 'file', fileName: 'trace.jsonl' })).toBe('text');
  });

  it('text 类：kind=text 恒胜 + isTextFile 其余扩展名落 text（.md/.markdown 已让位新规则，不在本类）', () => {
    expect(resolveAdapter({ kind: 'text', fileName: 'notes.weirdext' })).toBe('text');
    expect(resolveAdapter({ kind: 'text', fileName: 'README' })).toBe('text');
    expect(resolveAdapter({ kind: 'file', fileName: 'sample.txt' })).toBe('text');
    expect(resolveAdapter({ kind: 'file', fileName: 'pipeline.py' })).toBe('text');
    expect(resolveAdapter({ kind: 'data', fileName: 'trace.log' })).toBe('text');
  });

  it('兜底类：未知 kind 与 data/file 无专属扩展名一律落 binary', () => {
    for (const raw of ['telemetry-stream', '', 'analysis/plot', 'REPORT']) {
      expect(resolveAdapter({ kind: raw as ResultArtifactKind, fileName: 'blob.bin' })).toBe('binary');
    }
    expect(resolveAdapter({ kind: 'data', fileName: 'matrix.rds' })).toBe('binary');
    expect(resolveAdapter({ kind: 'file', fileName: 'archive.zip' })).toBe('binary');
  });
});
