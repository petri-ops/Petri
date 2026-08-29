import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { biof3Events, dispatchBioF3Event } from '../../../lib/events';
import { reviewPriorityLabel } from '../../../lib/review-types';
import type { CodeReviewAgentApi } from './useCodeReviewAgent';
import { ReviewFindingsPanel } from './ReviewFindingsPanel';

const { copilotAskSpy } = vi.hoisted(() => ({
  copilotAskSpy: vi.fn(),
}));

vi.mock('../../../lib/events', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/events')>();
  return {
    ...actual,
    dispatchBioF3Event: copilotAskSpy,
  };
});

const useAiSettingsMock = vi.hoisted(() => vi.fn());

vi.mock('../../../hooks/useAiSettings', () => ({
  useAiSettings: useAiSettingsMock,
}));

beforeEach(() => {
  useAiSettingsMock.mockReturnValue({
    presets: [
      { id: 'preset-a', label: 'Channel A', provider: 'openai-compatible', model: 'm1' },
      { id: 'preset-b', label: 'Channel B', provider: 'deepseek', model: 'm2' },
    ],
    activeId: 'preset-a',
    activePreset: { id: 'preset-a', label: 'Channel A', provider: 'openai-compatible', model: 'm1' },
    loading: false,
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function finding(index: number, priority: number | null = 1) {
  return {
    title: `[P${priority ?? 1}] Finding ${index}`,
    body: `Body ${index}`,
    confidenceScore: 0.7,
    priority,
    codeLocation: { absoluteFilePath: `src/file${index}.ts`, lineRange: { start: index + 1, end: index + 2 } },
  };
}

function makeAgent(overrides: Partial<CodeReviewAgentApi> = {}): CodeReviewAgentApi {
  return {
    phase: 'done',
    statusText: null,
    findings: [finding(1), finding(2, 0)],
    output: {
      findings: [],
      droppedFindings: 0,
      overallCorrectness: 'patch is incorrect',
      overallExplanation: 'Two issues found.',
      overallConfidenceScore: 0.8,
    },
    error: null,
    taskId: 'task-1',
    selected: new Set<number>(),
    activity: [],
    startedAt: null,
    channelLabel: 'DeepSeek',
    targetHint: '当前未提交变更',
    start: vi.fn().mockResolvedValue(undefined),
    cancel: vi.fn(),
    reset: vi.fn(),
    toggleFinding: vi.fn(),
    buildFixPrompt: vi.fn().mockReturnValue(null),
    restore: vi.fn(),
    ...overrides,
  };
}

describe('ReviewFindingsPanel', () => {
  it('renders findings sorted by priority with verdict and drop count', () => {
    const agent = makeAgent({
      output: {
        findings: [],
        droppedFindings: 2,
        overallCorrectness: 'patch is incorrect',
        overallExplanation: 'Issues.',
        overallConfidenceScore: 0.8,
      },
    });
    render(<ReviewFindingsPanel agent={agent} projectId="p1" onSelectFinding={() => {}} onFixRequested={() => {}} />);
    const titles = screen.getAllByText(/Finding \d/).map((el) => el.textContent);
    expect(titles[0]).toContain('Finding 2'); // P0 sorts first
    expect(screen.getByText(/patch is incorrect/)).toBeTruthy();
    expect(screen.getByText(/2 条结果格式无效已丢弃/)).toBeTruthy();
    expect(screen.getByText('P0')).toBeTruthy();
  });

  it('clicking a finding title calls onSelectFinding with that finding', () => {
    const onSelect = vi.fn();
    render(<ReviewFindingsPanel agent={makeAgent()} projectId="p1" onSelectFinding={onSelect} onFixRequested={() => {}} />);
    fireEvent.click(screen.getByText('[P1] Finding 1'));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0].codeLocation.absoluteFilePath).toBe('src/file1.ts');
  });

  it('修复选中项 dispatches copilotAsk with the built prompt', () => {
    const prompt = '请修复以下代码审阅发现的问题';
    const agent = makeAgent({
      selected: new Set([0]),
      buildFixPrompt: vi.fn().mockReturnValue(prompt),
    });
    render(<ReviewFindingsPanel agent={agent} projectId="p1" onSelectFinding={() => {}} onFixRequested={(p) => dispatchBioF3Event(biof3Events.copilotAsk, { prompt: p })} />);
    fireEvent.click(screen.getByText(/修复选中项 \(1\)/));
    expect(copilotAskSpy).toHaveBeenCalled();
    expect((copilotAskSpy.mock.calls[0][1] as { prompt: string }).prompt).toBe(prompt);
  });

  it('running state shows status and cancel; idle without project disables start', () => {
    const agent = makeAgent({
      phase: 'running',
      statusText: '评审中 · 读取变更',
      findings: [],
      output: null,
      cancel: vi.fn(),
    });
    const { rerender } = render(
      <ReviewFindingsPanel agent={agent} projectId="p1" onSelectFinding={() => {}} onFixRequested={() => {}} />
    );
    expect(screen.getByText('评审中 · 读取变更')).toBeTruthy();
    fireEvent.click(screen.getByText('取消'));
    expect(agent.cancel).toHaveBeenCalledTimes(1);

    const idle = makeAgent({ phase: 'idle', findings: [], output: null });
    rerender(
      <ReviewFindingsPanel agent={idle} projectId={null} onSelectFinding={() => {}} onFixRequested={() => {}} />
    );
    const start = screen.getByText('开始审阅').closest('button') as HTMLButtonElement;
    expect(start.disabled).toBe(true);
  });

  it('reviewPriorityLabel maps null to unknown', () => {
    expect(reviewPriorityLabel(null)).toBe('P?');
    expect(reviewPriorityLabel(3)).toBe('P3');
  });
});

describe('ReviewFindingsPanel v2 (BLOCK-26 P1)', () => {
  it('groups findings by file and shows severity counts in the verdict header', () => {
    const agent = makeAgent();
    render(<ReviewFindingsPanel agent={agent} projectId="p1" onSelectFinding={() => {}} onFixRequested={() => {}} />);
    // finding(1) → src/file1.ts, finding(2, P0) → src/file2.ts
    expect(screen.getByText('src/file1.ts')).toBeTruthy();
    expect(screen.getByText('src/file2.ts')).toBeTruthy();
    expect(screen.getByText('P0×1')).toBeTruthy();
    expect(screen.getByText('P1×1')).toBeTruthy();
  });

  it('collapses and expands finding bodies via the toggle', () => {
    const agent = makeAgent();
    render(<ReviewFindingsPanel agent={agent} projectId="p1" onSelectFinding={() => {}} onFixRequested={() => {}} />);
    const item = screen.getByText('[P1] Finding 1').closest('.wt-ai-review-item') as HTMLElement;
    expect(screen.getByText('Body 1')).toBeTruthy();
    fireEvent.click(item.querySelector('.wt-ai-review-item-toggle') as HTMLElement);
    expect(screen.queryByText('Body 1')).toBeNull();
    fireEvent.click(item.querySelector('.wt-ai-review-item-toggle') as HTMLElement);
    expect(screen.getByText('Body 1')).toBeTruthy();
  });

  it('shows the rolling activity feed while running', () => {
    const agent = makeAgent({
      phase: 'running',
      statusText: '评审中 · 检查 review_git',
      findings: [],
      output: null,
      activity: [
        { label: '开始读取变更', at: 1 },
        { label: 'review_git git diff HEAD', at: 2 },
      ],
    });
    render(<ReviewFindingsPanel agent={agent} projectId="p1" onSelectFinding={() => {}} onFixRequested={() => {}} />);
    expect(screen.getByText(/开始读取变更/)).toBeTruthy();
    expect(screen.getByText(/git diff HEAD/)).toBeTruthy();
  });

  it('custom target requires instructions before start', () => {
    const start = vi.fn().mockResolvedValue(undefined);
    const agent = makeAgent({ phase: 'idle', findings: [], output: null, start });
    render(<ReviewFindingsPanel agent={agent} projectId="p1" onSelectFinding={() => {}} onFixRequested={() => {}} />);
    fireEvent.change(screen.getByLabelText('审阅目标'), { target: { value: 'custom' } });
    const startBtn = screen.getByText('开始审阅').closest('button') as HTMLButtonElement;
    expect(startBtn.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('自定义审阅指令'), { target: { value: '只看安全问题' } });
    expect(startBtn.disabled).toBe(false);
    fireEvent.click(startBtn);
    expect(start).toHaveBeenCalledWith('p1', { type: 'custom', instructions: '只看安全问题' }, 'preset-a', 'Channel A');
  });
});
