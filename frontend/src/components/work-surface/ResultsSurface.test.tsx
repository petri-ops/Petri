import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ResultsSurface, type ResultsSurfaceContext } from './ResultsSurface';

vi.mock('@/components/copilot/conversationRunStore', () => ({
  useConversationRun: () => null,
  resultEditProgressForContext: () => [],
}));
vi.mock('@/lib/result-studio-interaction-client', () => ({
  fetchArtifactInteraction: vi.fn(() => Promise.resolve({
    manifest: { artifactId: 'art_1', revisionId: 'rev_1', artifactFamilyId: 'fam_1' },
    revision: { revisionId: 'rev_1', revisionOrdinal: 2, artifactFamilyId: 'fam_1', changeSetId: 'cs_1' },
  })),
}));
vi.mock('@/components/workspace-panels/ResultsLibrary', () => ({
  ResultsLibrary: () => <div data-testid="results-library">library</div>,
}));
vi.mock('@/components/workspace-panels/ResultView', () => ({
  ResultView: ({
    mode,
    active,
    onBack,
    onModeChange,
    onAskCurrentResult,
  }: {
    mode: string;
    active?: boolean;
    onBack?: () => void;
    onModeChange?: (mode: string) => void;
    onAskCurrentResult?: () => void;
  }) => (
    <div data-testid="core-result-view" data-mode={mode} data-active={active ? 'true' : 'false'} data-has-back={onBack ? 'true' : 'false'}>
      result body
      <button type="button" onClick={onAskCurrentResult}>询问 Agent</button>
      <button type="button" onClick={() => onModeChange?.('compare')}>审查</button>
      <button type="button" onClick={() => onModeChange?.('code')}>代码</button>
    </div>
  ),
}));

// usePackTabData 经 fetch 取 tab 数据；桩死网络面让 tab 级接管诚实回落核心（不出空白 iframe）。
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, status: 599 } as unknown as Response)));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const packSurface = (modes: string[], tabs?: { id: string; label: string }[]) => ({
  id: 'pack:bio:result:bio-result',
  kind: 'pack-result' as const,
  title: '生信结果',
  icon: 'bar-chart' as const,
  source: 'pack' as const,
  packId: 'bio',
  singleton: true,
  closeable: true,
  persist: false,
  order: 0,
  artifactTypes: ['table'],
  modes,
  ...(tabs ? { tabs } : {}),
  entry: 'ui/result.html',
});

function context(overrides: Partial<ResultsSurfaceContext> = {}): ResultsSurfaceContext {
  return {
    project: { id: 'project-1', name: 'Project One' },
    projectId: 'project-1',
    conversationId: 'conversation-1',
    activeJob: { id: 'job-1', tool_id: 'deseq2', status: 'done', created_at: 1 },
    activeWorkflow: { jobStatus: 'done', artifactTruth: { status: 'valid' } },
    activeArtifact: {
      jobId: 'job-1', toolId: 'deseq2', name: 'deg.csv', type: 'table', label: '差异表达结果',
      revisionId: 'revision-abcdef123456', artifactFamilyId: 'family-1', truthStatus: 'valid', conclusion: '发现稳定差异表达信号。',
    },
    setActiveArtifact: vi.fn(),
    jobs: [],
    packResultSurfaces: [],
    resultContext: { status: 'ready', contextToken: 'a'.repeat(64) },
    resultEditControls: null,
    resultEditSubmitting: false,
    resultAgentDraft: '',
    setResultAgentDraft: vi.fn(),
    onResultEditSubmit: vi.fn(),
    pendingArtifactName: null,
    onPendingArtifactConsumed: vi.fn(),
    onWorkflowChanged: vi.fn(),
    handleAskAgent: vi.fn(),
    handleOpenResult: vi.fn(),
    openRevisionWorkspaceFile: vi.fn(),
    openResultBrowser: vi.fn(),
    ...overrides,
  } as unknown as ResultsSurfaceContext;
}

describe('BLOCK-334 ResultsSurface (right-rail result host)', () => {
  it('renders the core result body in result sub-mode and threads active down for WebGL gating', () => {
    render(<ResultsSurface ctx={context()} active />);
    const body = screen.getByTestId('core-result-view');
    expect(body.getAttribute('data-mode')).toBe('result');
    expect(body.getAttribute('data-active')).toBe('true');
    // 中央不再是宿主：结果子态没有「返回对话」可回
    expect(body.getAttribute('data-has-back')).toBe('false');
    expect(screen.queryByRole('button', { name: '返回结果' })).toBeNull();
  });

  it('keeps the sub-mode local: switching to compare shows the context bar whose back returns to result (D1)', () => {
    const { container } = render(<ResultsSurface ctx={context()} active />);
    fireEvent.click(screen.getByRole('button', { name: '审查' }));
    expect(container.firstElementChild?.getAttribute('data-result-mode')).toBe('compare');
    expect(screen.getByTestId('core-result-view').getAttribute('data-mode')).toBe('compare');
    fireEvent.click(screen.getByRole('button', { name: '返回结果' }));
    expect(container.firstElementChild?.getAttribute('data-result-mode')).toBe('result');
  });

  it('resets the sub-mode to result when the job changes', () => {
    const ctx = context();
    const view = render(<ResultsSurface ctx={ctx} active />);
    fireEvent.click(screen.getByRole('button', { name: '代码' }));
    expect(screen.getByTestId('core-result-view').getAttribute('data-mode')).toBe('code');
    view.rerender(<ResultsSurface ctx={context({ activeJob: { id: 'job-2', tool_id: 'deseq2', status: 'done', created_at: 2 } })} active />);
    expect(screen.getByTestId('core-result-view').getAttribute('data-mode')).toBe('result');
  });

  it('shows the results library when no job is bound', () => {
    render(<ResultsSurface ctx={context({ activeJob: null, activeArtifact: null })} active />);
    expect(screen.getByTestId('results-library')).toBeTruthy();
    expect(screen.queryByTestId('core-result-view')).toBeNull();
  });

  it('询问 Agent prompt 锚定任务与产物坐标并强制 result_summary 真值（BIO-6）', () => {
    const ctx = context();
    render(<ResultsSurface ctx={ctx} active />);
    fireEvent.click(screen.getByRole('button', { name: '询问 Agent' }));
    expect(ctx.handleAskAgent).toHaveBeenCalledTimes(1);
    const prompt = String((ctx.handleAskAgent as ReturnType<typeof vi.fn>).mock.calls[0][0]);
    expect(prompt).toContain('result_summary');
    expect(prompt).toContain('job-1');
    expect(prompt).toContain('deg.csv');
    expect(prompt).toContain('不得编造');
    // 遗留模板措辞退役：解读真相只剩 Agent + result_summary 链一条
    expect(prompt).not.toContain('请解释当前结果');
  });

  it('keeps only a default-closed advanced parameter drawer below the canvas (UI-109 / P4R-3)', () => {
    render(<ResultsSurface ctx={context({
      resultEditControls: {
        controlsVersion: 1,
        groups: [{ group: 'presentation', label: '外观', parameterNames: ['point_size'] }],
        controls: [{
          name: 'point_size', controlType: 'number', impact: 'presentation', group: 'presentation',
          default: 1.8, required: false, scientificallyNeutral: true,
        }],
        diagnostics: [],
        currentValues: { point_size: 1.8 },
      } as unknown as ResultsSurfaceContext['resultEditControls'],
    })} active />);
    const drawer = document.querySelector('details[aria-label="高级精细调整"]');
    expect(drawer).toBeTruthy();
    expect(drawer?.hasAttribute('open')).toBe(false);
  });

  it('routes result sub-mode to a matching pack result surface (BLOCK-218)', () => {
    render(<ResultsSurface ctx={context({ packResultSurfaces: [packSurface(['result'])] })} active />);
    expect(screen.getByTestId('pack-surface-unsupported')).toBeTruthy();
    expect(screen.queryByTestId('core-result-view')).toBeNull();
  });

  it('keeps the core body for code sub-mode even when a pack result surface matches result only (BLOCK-218)', () => {
    render(<ResultsSurface ctx={context({ packResultSurfaces: [packSurface(['result'])] })} active />);
    // pack 接管 result 子态时 ContextBar 在场，经它切到 code
    const nav = screen.getByRole('navigation', { name: '结果视图' });
    fireEvent.click(Array.from(nav.querySelectorAll('button')).find((btn) => btn.textContent === '代码')!);
    expect(screen.getByTestId('core-result-view').getAttribute('data-mode')).toBe('code');
    expect(screen.queryByTestId('pack-surface-unsupported')).toBeNull();
  });

  it('hydrates revision/family/changeSet when a pack takes over result body (BLOCK-252)', async () => {
    const ctx = context({ packResultSurfaces: [packSurface(['result', 'code'], [{ id: 'revisions-source', label: '源码' }])] });
    ctx.activeArtifact = { ...ctx.activeArtifact!, revisionId: null, artifactFamilyId: null, changeSetId: null };
    render(<ResultsSurface ctx={ctx} active />);
    await waitFor(() => {
      expect(ctx.setActiveArtifact).toHaveBeenCalledWith(expect.objectContaining({
        revisionId: 'rev_1',
        artifactFamilyId: 'fam_1',
        changeSetId: 'cs_1',
        artifactId: 'art_1',
      }));
    });
  });
});
