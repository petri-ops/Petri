/**
 * BLOCK-342 W1 — viewerRegistry 的 svg-editor 分派契约。
 *
 * 只钉机制：
 *  - 普通 .svg（kind=file/data）→ svg-editor（人可编辑的受治理编辑器）；
 *  - kind=plot 的 .svg 仍按图片预览（既有行为不回退）；
 *  - 位图仍走 image（.svg 不再被图片规则吃掉）；
 *  - 能力位：无文本选择/无比较，原文可导出。
 */
import { describe, expect, it } from 'vitest';
import { resolveResultViewer, viewerProfileCanExport } from './viewerRegistry';

describe('BLOCK-342 W1 viewerRegistry · svg-editor', () => {
  it('.svg 工作区文件命中 svg-editor', () => {
    const resolved = resolveResultViewer({ kind: 'file', fileName: 'plot.svg', preview: true });
    expect(resolved.adapter).toBe('svg-editor');
    expect(resolved.canSelect).toBe(false);
    expect(resolved.canCompare).toBe(false);
    expect(viewerProfileCanExport('svg-editor')).toBe(true);
  });

  it('大写扩展名同样命中（大小写不敏感）', () => {
    expect(resolveResultViewer({ kind: 'data', fileName: 'Figure.SVG', preview: true }).adapter).toBe('svg-editor');
  });

  it('preview:false 仍短路 binary（既有语义不回退）', () => {
    expect(resolveResultViewer({ kind: 'file', fileName: 'plot.svg', preview: false }).adapter).toBe('binary');
  });

  it('kind=plot 的 .svg 仍按图片预览（不抢既有产物语义）', () => {
    expect(resolveResultViewer({ kind: 'plot', fileName: 'volcano.svg', preview: true }).adapter).toBe('image');
  });

  it('位图不被 svg 规则影响', () => {
    expect(resolveResultViewer({ kind: 'file', fileName: 'photo.png', preview: true }).adapter).toBe('image');
    expect(resolveResultViewer({ kind: 'file', fileName: 'pic.jpeg', preview: true }).adapter).toBe('image');
  });

  it('其它文本/表格族分派零变化（回归哨兵）', () => {
    expect(resolveResultViewer({ kind: 'file', fileName: 'a.md', preview: true }).adapter).toBe('markdown');
    expect(resolveResultViewer({ kind: 'data', fileName: 'a.csv', preview: true }).adapter).toBe('table');
    expect(resolveResultViewer({ kind: 'file', fileName: 'a.pdf', preview: true }).adapter).toBe('pdf');
  });
});
