/**
 * nso-w3-viewer-dispatch.test.ts — BLOCK-369（NSO-W3 F-09）viewer 分派决策表。
 *
 * 评估 F-09：旧「规则内 kind/extension 任一命中」让 kind='report' 的 .pdf/.mp4/.svg 被塞进
 * HTML 预览、preview=false 与未命中静默落 binary 无解释。新分派三段式：
 *   A 扩展名优先（声明序；svg 规则对 kind='plot' 让位 image——BLOCK-342 语义保持）；
 *   B kind 兜底（report/plot/table/text/model3d 恒胜，仅当扩展名未先命中）；
 *   C binary 兜底 + 机器可读降级原因（preview_disabled / no_matching_viewer）。
 * 旧期望中按「现状平迁」钉住的错分派（report+pdf 等）随本契约**有意翻转**（理由=评估 F-09）。
 */
import { describe, expect, it } from 'vitest';
import { resolveResultViewer } from './viewerRegistry';

const adapterOf = (kind: string, fileName: string, preview?: boolean) =>
  resolveResultViewer({ kind: kind as never, fileName, preview }).adapter;

describe('NSO-W3 F-09 viewer 分派决策表', () => {
  it('A 段·扩展名优先：kind 与扩展名冲突时扩展名胜（修复 F-09 错分派）', () => {
    expect(adapterOf('report', 'paper.pdf')).toBe('pdf');
    expect(adapterOf('report', 'clip.mp4')).toBe('video');
    expect(adapterOf('report', 'figure.svg')).toBe('svg-editor');
    expect(adapterOf('report', 'sheet.xlsx')).toBe('spreadsheet');
    expect(adapterOf('report', 'appendix.csv')).toBe('table');
    expect(adapterOf('report', 'notes.md')).toBe('markdown');
    expect(adapterOf('report', 'data.json')).toBe('json');
  });

  it('A 段·BLOCK-342 语义保持：kind=plot 的 .svg 仍按图片预览（unlessKind 让位）', () => {
    expect(adapterOf('plot', 'volcano.svg')).toBe('image');
    expect(adapterOf('plot', 'volcano.png')).toBe('image');
    expect(adapterOf('plot', 'volcano.pdf')).toBe('pdf');
  });

  it('B 段·kind 兜底：扩展名不发言时 kind 恒胜', () => {
    expect(adapterOf('report', 'brief.unknownext')).toBe('report');
    expect(adapterOf('report', 'report.html')).toBe('report');
    expect(adapterOf('plot', 'heatmap.vega')).toBe('image');
    expect(adapterOf('text', 'run.log')).toBe('text');
    expect(adapterOf('model3d', 'part.mesh')).toBe('model3d');
  });

  it('A 段·.html 对任意 kind 生效（既有契约保持）', () => {
    for (const kind of ['data', 'file', 'plot', 'text']) {
      expect(adapterOf(kind, 'final-report.html')).toBe('report');
    }
  });

  it('C 段·降级原因：preview=false 与未命中都携带机器可读 reason', () => {
    const previewOff = resolveResultViewer({ kind: 'report', fileName: 'report.html', preview: false });
    expect(previewOff.adapter).toBe('binary');
    expect(previewOff.reasonCode).toBe('preview_disabled');
    const fallback = resolveResultViewer({ kind: 'data', fileName: 'archive.zip' });
    expect(fallback.adapter).toBe('binary');
    expect(fallback.reasonCode).toBe('no_matching_viewer');
    const hit = resolveResultViewer({ kind: 'report', fileName: 'report.html' });
    expect(hit.reasonCode).toBeUndefined();
  });

  it('大小写不敏感与 .scene3d.json → model3d（既有契约保持）', () => {
    expect(adapterOf('data', 'Report.HTML')).toBe('report');
    expect(adapterOf('data', 'enclosure.scene3d.json')).toBe('model3d');
    expect(adapterOf('data', 'Matrix.PNG')).toBe('image');
  });
});
