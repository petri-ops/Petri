import { describe, expect, it } from 'vitest';
import {
  buildResultArtifactNavigation,
  classifyArtifact,
  countArtifactsByKind,
  inferSectionDisplayKind,
  normalizeResultManifest,
  pickPreferredArtifact,
} from './result-manifest';

describe('result-manifest', () => {
  it('normalizes explicit sections and keeps fallback artifacts', () => {
    const manifest = normalizeResultManifest(
      {
        title: 'DESeq2 报告',
        summary: { status: 'ok' },
        files: [
          { name: 'report.html', type: 'file' },
          { name: 'volcano.png', type: 'plot' },
        ],
        sections: [
          {
            id: 'report',
            label: '报告',
            artifactNames: ['report.html'],
          },
        ],
      },
      [{ name: 'summary.txt', type: 'text' }]
    );

    expect(manifest?.title).toBe('DESeq2 报告');
    expect(manifest?.summary).toEqual({ status: 'ok' });
    expect(manifest?.hasExplicitSections).toBe(true);
    expect(manifest?.sections).toHaveLength(1);
    expect(manifest?.artifacts.map((item) => item.name)).toEqual([
      'report.html',
      'volcano.png',
      'summary.txt',
    ]);
    expect(classifyArtifact(manifest!.artifacts[0])).toBe('report');
    expect(pickPreferredArtifact(manifest!.artifacts, null)?.name).toBe('report.html');
  });

  it('derives sections from artifact kinds when sections are missing', () => {
    const manifest = normalizeResultManifest({
      files: [
        { name: 'report.html' },
        { name: 'heatmap.png' },
        { name: 'stats.csv' },
        { name: 'notes.txt' },
      ],
    });

    expect(manifest?.hasExplicitSections).toBe(false);
    expect(manifest?.sections.map((section) => section.id)).toEqual([
      'report',
      'plot',
      'table',
      'text',
    ]);
  });

  it('builds navigation that keeps artifacts outside explicit sections', () => {
    const manifest = normalizeResultManifest(
      {
        files: [
          { name: 'report.html' },
          { name: 'volcano.png' },
        ],
        sections: [
          {
            id: 'overview',
            label: '概览报告',
            artifactNames: ['report.html'],
          },
        ],
      },
      [
        { name: 'deg.csv', type: 'table' },
        { name: 'run.log', type: 'text' },
      ]
    );

    const nav = buildResultArtifactNavigation(manifest, manifest!.artifacts);

    expect(nav.map((section) => section.label)).toEqual([
      '概览报告',
      '其他图表',
      '其他表格',
      '其他文本',
    ]);
    expect(nav.flatMap((section) => section.artifactNames)).toEqual([
      'report.html',
      'volcano.png',
      'deg.csv',
      'run.log',
    ]);
  });

  it('counts artifact kinds for compact result navigation metadata', () => {
    const counts = countArtifactsByKind([
      { name: 'report.html' },
      { name: 'heatmap.png' },
      { name: 'matrix.h5ad' },
      { name: 'notes.md' },
      { name: 'unknown.bin' },
    ]);

    expect(counts).toMatchObject({
      report: 1,
      plot: 1,
      data: 1,
      text: 1,
      file: 1,
    });
  });

  it('prefers a representative icon kind for mixed sections', () => {
    const kind = inferSectionDisplayKind([
      { name: 'volcano.png' },
      { name: 'volcano.pdf' },
      { name: 'notes.txt' },
    ]);

    expect(kind).toBe('plot');
  });

  it('prefers plot when a mixed section label clearly indicates charts', () => {
    const kind = inferSectionDisplayKind(
      [
        { name: 'report.html' },
        { name: 'volcano.svg' },
      ],
      '图表结果',
    );

    expect(kind).toBe('plot');
  });
});
