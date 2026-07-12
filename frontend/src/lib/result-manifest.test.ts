import { describe, expect, it } from 'vitest';
import {
  classifyArtifact,
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
});
