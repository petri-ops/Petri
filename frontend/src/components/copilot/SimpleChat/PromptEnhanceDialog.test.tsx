import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PromptEnhanceDialog } from './PromptEnhanceDialog';
import { enhancePrompt, type PromptEnhanceContext, type PromptEnhanceResult } from '@/lib/promptEnhanceClient';

vi.mock('@/lib/promptEnhanceClient', () => ({
  enhancePrompt: vi.fn(),
}));

const enhanceMock = vi.mocked(enhancePrompt);
const context: PromptEnhanceContext = { workspaceLabel: '当前项目', surface: 'conversation', items: [] };
const result: PromptEnhanceResult = {
  optimizedPrompt: '生成 120×80×40mm 外壳，并导出 GLB 与尺寸校验报告。',
  taskSpec: {
    version: 'task-spec/v1',
    taskType: 'modeling',
    goal: '生成可校验外壳',
    deliverables: ['SceneSpec', 'GLB'],
    constraints: ['壁厚 2mm'],
    assumptions: ['比例来自草图'],
    acceptance: ['尺寸可校验'],
    missingInfo: ['材料'],
  },
  changeSummary: ['补充交付物'],
  contextUsed: ['project:demo', 'context:file:草图.png'],
  capabilitySnapshot: [
    { id: 'workflow', status: 'disabled', reason: 'workflow_not_enabled' },
    { id: 'vision', status: 'ready' },
    { id: 'blender', status: 'unavailable', reason: 'not_configured' },
  ],
  model: 'mock-chat',
};

beforeEach(() => {
  enhanceMock.mockResolvedValue(result);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('PromptEnhanceDialog (NEXT-03)', () => {
  it('打开即请求，展示优化稿/TaskSpec/能力，且不自动应用', async () => {
    const onApply = vi.fn();
    const onInsert = vi.fn();
    render(<PromptEnhanceDialog prompt="做个外壳" context={context} onApply={onApply} onInsert={onInsert} onClose={() => {}} />);
    expect(screen.getByText('正在结合当前项目上下文生成 TaskSpec 草稿…')).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId('prompt-enhance-result').textContent).toContain('120×80×40mm'));
    expect(screen.getByTestId('task-spec').textContent).toContain('SceneSpec');
    expect(screen.getByTestId('task-spec').textContent).toContain('壁厚 2mm');
    expect(screen.getByTestId('prompt-enhance-original').textContent).toBe('做个外壳');
    expect(enhanceMock).toHaveBeenCalledWith(expect.objectContaining({ prompt: '做个外壳', context }));
    expect(onApply).not.toHaveBeenCalled();
    expect(onInsert).not.toHaveBeenCalled();
    expect(screen.getByText('blender').parentElement?.textContent).toContain('不可用');
  });

  it('替换原稿与插入原文后都只回调用户动作', async () => {
    const onApply = vi.fn();
    const onInsert = vi.fn();
    render(<PromptEnhanceDialog prompt="做个外壳" context={context} onApply={onApply} onInsert={onInsert} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText('替换原稿')).toBeTruthy());
    fireEvent.click(screen.getByText('替换原稿'));
    expect(onApply).toHaveBeenCalledWith(result.optimizedPrompt);
    fireEvent.click(screen.getByText('插入原文后'));
    expect(onInsert).toHaveBeenCalledWith('做个外壳', result.optimizedPrompt);
  });

  it('失败保留原稿并可重试；Escape 关闭', async () => {
    enhanceMock.mockRejectedValueOnce(new Error('timeout'));
    const onClose = vi.fn();
    render(<PromptEnhanceDialog prompt="做个外壳" context={context} onApply={() => {}} onInsert={() => {}} onClose={onClose} />);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('timeout'));
    expect(screen.getByRole('alert').textContent).toContain('原稿未修改');
    enhanceMock.mockResolvedValueOnce(result);
    fireEvent.click(screen.getByText('重试'));
    await waitFor(() => expect(screen.getByTestId('prompt-enhance-result')).toBeTruthy());
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
