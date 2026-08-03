import { describe, expect, it } from 'vitest';
import {
  chooseResultArtifactName,
  chooseResultSectionLandingName,
  RESULT_SURFACE_PERFORMANCE_BUDGETS,
  describeSelection,
  describeTruthStatus,
  resolveResultArtifactUrl,
  resolveResultViewerAdapter,
  requestedArtifactRequestKey,
  shouldApplyRequestedArtifact,
  shouldRequestArtifactInteraction,
  shouldSurfaceInteractionFailure,
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

  it.each([
    ['image', true, false],
    ['table', true, true],
    ['report', false, false],
    ['json', false, false],
    ['text', false, false],
    ['binary', false, false],
  ] as const)(
    'treats %s interaction as capability discovery without static-plot error noise',
    (adapter, shouldRequest, shouldSurfaceFailure) => {
      expect(shouldRequestArtifactInteraction(adapter)).toBe(shouldRequest);
      expect(shouldSurfaceInteractionFailure(adapter)).toBe(shouldSurfaceFailure);
    },
  );

  it('projects trust, revision and selection without inventing missing facts', () => {
    expect(describeTruthStatus('valid', 'done')).toEqual({ tone: 'valid', label: '可信结果' });
    expect(describeTruthStatus(null, 'done')).toEqual({ tone: 'unknown', label: '尚未核验' });
    expect(describeTruthStatus('blocked', 'done')).toEqual({ tone: 'blocked', label: '结果已阻断' });
    // The ordinal is the version. This assertion used to pin the opposite —
    // shortRevisionLabel('revision-abcdef12...') === '版本 abcdef12' — inside a
    // test named for not inventing missing facts, while presenting an id
    // fragment where the acceptance matrix promises vN.
    expect(shortRevisionLabel('revision-abcdef123456', 2)).toBe('v2');
    expect(shortRevisionLabel('revision-abcdef123456', 1)).toBe('v1');
    // A revision exists but its ordinal did not arrive: say what is known.
    expect(shortRevisionLabel('revision-abcdef123456')).toBe('当前版本');
    expect(shortRevisionLabel('revision-abcdef123456', null)).toBe('当前版本');
    // Non-ordinals must not be rendered as one.
    expect(shortRevisionLabel('revision-abcdef123456', 0)).toBe('当前版本');
    expect(shortRevisionLabel('revision-abcdef123456', 1.5)).toBe('当前版本');
    expect(shortRevisionLabel(null)).toBe('原始结果');
    expect(shortRevisionLabel(null, 3)).toBe('v3');
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

  it('consumes one URL artifact request once instead of reasserting it after a Job refresh', () => {
    const request = requestedArtifactRequestKey({
      projectId: 'project-1',
      jobId: 'job-1',
      artifactName: 'classified_table.csv',
    });
    expect(shouldApplyRequestedArtifact(null, request)).toBe(true);
    expect(shouldApplyRequestedArtifact(request, request)).toBe(false);
    const nextArtifact = requestedArtifactRequestKey({
      projectId: 'project-1',
      jobId: 'job-1',
      artifactName: 'volcano.svg',
    });
    expect(shouldApplyRequestedArtifact(request, nextArtifact)).toBe(true);
    expect(requestedArtifactRequestKey({
      projectId: 'project-1',
      jobId: 'job-1',
      artifactName: null,
    })).toBeNull();
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
