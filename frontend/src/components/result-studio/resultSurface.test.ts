import { describe, expect, it } from 'vitest';
import {
  chooseResultArtifactName,
  chooseResultSectionLandingName,
  RESULT_SURFACE_PERFORMANCE_BUDGETS,
  describeSelection,
  describeTruthStatus,
  resolveResultArtifactUrl,
  resolveResultViewerAdapter,
  shortRevisionLabel,
} from './resultSurface';

describe('G0-RS-P1 result surface projection', () => {
  it('routes every supported artifact into an explicit viewer adapter', () => {
    expect(resolveResultViewerAdapter({ kind: 'report', fileName: 'report.html' })).toBe('report');
    expect(resolveResultViewerAdapter({ kind: 'plot', fileName: 'volcano.svg' })).toBe('image');
    expect(resolveResultViewerAdapter({ kind: 'table', fileName: 'deg.csv' })).toBe('table');
    expect(resolveResultViewerAdapter({ kind: 'text', fileName: 'summary.json' })).toBe('json');
    expect(resolveResultViewerAdapter({ kind: 'text', fileName: 'notes.md' })).toBe('text');
    expect(resolveResultViewerAdapter({ kind: 'data', fileName: 'matrix.rds' })).toBe('binary');
    expect(resolveResultViewerAdapter({ kind: 'file', fileName: 'archive.zip', preview: false })).toBe('binary');
  });

  it('projects trust, revision and selection without inventing missing facts', () => {
    expect(describeTruthStatus('valid', 'done')).toEqual({ tone: 'valid', label: '可信结果' });
    expect(describeTruthStatus(null, 'done')).toEqual({ tone: 'unknown', label: '尚未核验' });
    expect(describeTruthStatus('blocked', 'done')).toEqual({ tone: 'blocked', label: '结果已阻断' });
    expect(shortRevisionLabel('revision-abcdef123456')).toBe('版本 abcdef12');
    expect(shortRevisionLabel(null)).toBe('原始结果');
    expect(describeSelection(null)).toBe('未选择对象');
    expect(describeSelection({ entityIdCount: 27, fields: [], durable: true })).toBe('已选择 27 个对象 · 可恢复');
    expect(describeSelection({ entityIdCount: 0, fields: ['padj', 'log2FC'], durable: false })).toBe('已选择 2 列 · 当前会话');
  });

  it('routes relative and unsafe manifest URLs through the controlled Job file endpoint', () => {
    expect(resolveResultArtifactUrl('report.html', '/api/tools/file/job/report.html')).toBe('/api/tools/file/job/report.html');
    expect(resolveResultArtifactUrl('javascript:alert(1)', '/api/tools/file/job/report.html')).toBe('/api/tools/file/job/report.html');
    expect(resolveResultArtifactUrl('//untrusted.test/report.html', '/api/tools/file/job/report.html')).toBe('/api/tools/file/job/report.html');
    expect(resolveResultArtifactUrl('/api/tools/file/job/report.html', '/fallback')).toBe('/api/tools/file/job/report.html');
    expect(resolveResultArtifactUrl('https://example.test/result.png', '/fallback')).toBe('https://example.test/result.png');
  });

  it('keeps a user-selected report instead of forcing the preferred table back', () => {
    const availableNames = ['deg.csv', 'report.html'];
    expect(chooseResultArtifactName({ currentName: 'report.html', preferredName: 'deg.csv', availableNames })).toBe('report.html');
    expect(chooseResultArtifactName({ currentName: 'missing.txt', preferredName: 'deg.csv', availableNames })).toBe('deg.csv');
    expect(chooseResultArtifactName({ currentName: 'report.html', pendingName: 'deg.csv', preferredName: 'report.html', availableNames })).toBe('deg.csv');
  });

  it('opens a previewable artifact when entering a mixed-availability section', () => {
    expect(chooseResultSectionLandingName([
      { name: 'report.html', preview: false },
      { name: 'final-report.html', preview: true },
    ])).toBe('final-report.html');
    expect(chooseResultSectionLandingName([{ name: 'archive.zip', preview: false }])).toBe('archive.zip');
  });

  it('freezes explicit UI budgets without claiming later scientific interaction performance', () => {
    expect(RESULT_SURFACE_PERFORMANCE_BUDGETS).toEqual({
      firstCanvasVisibleMs: 1000,
      artifactSwitchMs: 500,
      tableScrollResponseMs: 100,
      selectionFeedbackMs: 100,
      parameterPreviewMs: 500,
      compareOpenMs: 1000,
      restartRestoreMs: 5000,
      returnConversationMs: 250,
      maxToggleHeapGrowthBytes: 67108864,
    });
  });
});
