import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PromptEnhanceControls } from './PromptEnhanceControls';

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const RESULT = {
  ok: true,
  optimizedPrompt: '按以下步骤完成：先读取输入，再输出结果。',
  taskSpec: {
    version: 'task-spec/v1',
    taskType: 'general',
    goal: '完成输入到输出',
    deliverables: [], constraints: [], assumptions: [], acceptance: [], missingInfo: [],
  },
  changeSummary: ['补充步骤'],
  contextUsed: ['surface:conversation'],
  capabilitySnapshot: [],
  model: 'test-model',
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('UI-709 提示词优化点击即覆盖', () => {
  it('点击 sparkles 直接调用优化端点并用结果覆盖原稿，不弹预览对话框', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(response(RESULT)));
    vi.stubGlobal('fetch', fetchMock);
    const onApplyText = vi.fn();
    render(<PromptEnhanceControls prompt="帮我处理一下" hasProject={false} contextItems={[]} onApplyText={onApplyText} />);

    fireEvent.click(screen.getByTestId('prompt-enhance'));
    await waitFor(() => expect(onApplyText).toHaveBeenCalledWith(RESULT.optimizedPrompt));

    expect((fetchMock.mock.calls[0] as unknown[])[0]).toContain('/ai/agent/prompt-enhance');
    const init = (fetchMock.mock.calls[0] as unknown[])[1] as { body?: string };
    const sent = JSON.parse(String(init.body)) as { mode?: string };
    expect(sent.mode).toBe('quick');
    expect(screen.queryByTestId('prompt-enhance-dialog')).toBeNull();
  });

  it('失败时不覆盖原稿且错误可见', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(response({ ok: false, error: 'task_spec_output_unparsable' }, 502))));
    const onApplyText = vi.fn();
    render(<PromptEnhanceControls prompt="原稿" hasProject={false} contextItems={[]} onApplyText={onApplyText} />);

    fireEvent.click(screen.getByTestId('prompt-enhance'));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('优化失败'));
    expect(onApplyText).not.toHaveBeenCalled();
    expect(screen.queryByTestId('prompt-enhance-dialog')).toBeNull();
  });
});


  it('试用反馈⑩：空输入时按钮不渲染', () => {
    render(<PromptEnhanceControls prompt="" hasProject={false} contextItems={[]} onApplyText={() => {}} />);
    expect(screen.queryByTestId('prompt-enhance')).toBeNull();
  });
