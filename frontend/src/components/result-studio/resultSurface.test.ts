import { describe, expect, it } from 'vitest';
import {
  buildResultInterpretationPrompt,
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
  shouldShowResultInteraction,
  shouldSurfaceInteractionFailure,
  shortRevisionLabel,
} from './resultSurface';

describe('G0-RS-P1 result surface projection', () => {
  it('routes every supported artifact into an explicit viewer adapter', () => {
    expect(resolveResultViewerAdapter({ kind: 'report', fileName: 'report.html' })).toBe('report');
    expect(resolveResultViewerAdapter({ kind: 'plot', fileName: 'volcano.svg' })).toBe('image');
    expect(resolveResultViewerAdapter({ kind: 'plot', fileName: 'volcano.pdf' })).toBe('binary');
    expect(resolveResultViewerAdapter({ kind: 'table', fileName: 'deg.csv' })).toBe('table');
    expect(resolveResultViewerAdapter({ kind: 'text', fileName: 'summary.json' })).toBe('json');
    expect(resolveResultViewerAdapter({ kind: 'text', fileName: 'notes.md' })).toBe('text');
    expect(resolveResultViewerAdapter({ kind: 'data', fileName: 'matrix.rds' })).toBe('binary');
    expect(resolveResultViewerAdapter({ kind: 'file', fileName: 'archive.zip', preview: false })).toBe('binary');
  });

  it('keeps readable scientific text files aligned with the text preview loader', () => {
    expect(resolveResultViewerAdapter({ kind: 'file', fileName: 'analysis.py' })).toBe('text');
    expect(resolveResultViewerAdapter({ kind: 'file', fileName: 'workflow.R' })).toBe('text');
    expect(resolveResultViewerAdapter({ kind: 'file', fileName: 'variants.vcf' })).toBe('text');
    expect(resolveResultViewerAdapter({ kind: 'file', fileName: 'config.toml' })).toBe('text');
  });

  it('does not claim Excel workbooks have an inline table viewer', () => {
    expect(resolveResultViewerAdapter({ kind: 'table', fileName: 'results.xlsx' })).toBe('binary');
    expect(resolveResultViewerAdapter({ kind: 'file', fileName: 'legacy.xls' })).toBe('binary');
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

  it('keeps generated plots primary until interaction is explicitly requested', () => {
    expect(shouldShowResultInteraction({
      adapter: 'image',
      interactionAvailable: true,
      interactionRequested: false,
    })).toBe(false);
    expect(shouldShowResultInteraction({
      adapter: 'image',
      interactionAvailable: true,
      interactionRequested: true,
    })).toBe(true);
    expect(shouldShowResultInteraction({
      adapter: 'table',
      interactionAvailable: true,
      interactionRequested: false,
    })).toBe(true);
    expect(shouldShowResultInteraction({
      adapter: 'image',
      interactionAvailable: false,
      interactionRequested: true,
    })).toBe(false);
    expect(shouldShowResultInteraction({
      adapter: 'report',
      interactionAvailable: true,
      interactionRequested: true,
    })).toBe(false);
    expect(shouldShowResultInteraction({
      adapter: 'binary',
      interactionAvailable: true,
      interactionRequested: true,
    })).toBe(false);
  });

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

  // BIO-6（BIO-D4 裁决 b：单一真相）— 解读 prompt 只此一个出词口：两个入口
  // （CenterPanel 询问 Agent / Inspector 解释当前结果）都经它取词，锚定任务与
  // 产物坐标并强制 result_summary 有界真值，不接遗留 /api/ai/interpret 模板。
  it('interpretation prompt anchors job coordinates and forces the result_summary bounded truth', () => {
    expect(buildResultInterpretationPrompt({ jobId: 'job-9', artifactName: 'deg_table.csv' })).toBe(
      '请解读任务 job-9 的结果 deg_table.csv：先调用 result_summary 工具读取该结果的有界真值，'
      + '基于返回数据解读主要结论、可信边界与建议的下一步；引用的数字必须来自工具返回，不得编造。',
    );
  });

  it('interpretation prompt without a jobId never fakes a task anchor but keeps the truth discipline', () => {
    const prompt = buildResultInterpretationPrompt({ jobId: null, artifactName: 'deg.csv' });
    expect(prompt).toContain('result_summary');
    expect(prompt).toContain('deg.csv');
    expect(prompt).toContain('不得编造');
    expect(prompt).not.toContain('任务');
  });
});
