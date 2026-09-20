import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ResultAgentComposer } from './ResultAgentComposer';

afterEach(cleanup);

const TOKEN_A = 'a'.repeat(64);
const TOKEN_B = 'b'.repeat(64);

describe('G0-RS-P4R-3 result-focus Agent Composer', () => {
  it('默认只呈现单行目标输入，并把当前 token 原样绑定到提交但不渲染 token', () => {
    const onSubmit = vi.fn();
    const onDraftChange = vi.fn();
    render(
      <ResultAgentComposer
        context={{ status: 'ready', contextToken: TOKEN_A, selectionUsable: true }}
        draft="换成色盲友好配色"
        onDraftChange={onDraftChange}
        onSubmit={onSubmit}
      />,
    );

    expect(document.body.textContent).not.toContain(TOKEN_A);
    expect(screen.queryByText(/上下文已绑定|当前选择会一并绑定/)).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByLabelText('描述你希望当前结果发生什么变化').getAttribute('rows')).toBe('1');
    fireEvent.click(screen.getByRole('button', { name: '交给 Agent' }));

    expect(onSubmit).toHaveBeenCalledWith({
      origin: 'agent',
      completionExpectation: 'result_action',
      requestedOutcome: '换成色盲友好配色',
      parameterPatch: {},
      scientificConfirmed: false,
      contextToken: TOKEN_A,
    });
    expect(onDraftChange).toHaveBeenLastCalledWith('');
  });

  it('loading、blocked 或缺失/非法 token 时均 fail-closed 禁止发送', () => {
    const { rerender } = render(
      <ResultAgentComposer
        context={{ status: 'loading', contextToken: null }}
        draft="调整配色"
        onDraftChange={() => undefined}
        onSubmit={() => undefined}
      />,
    );
    expect(screen.getByRole('status').textContent).toContain('正在绑定');
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '交给 Agent' }).disabled).toBe(true);

    rerender(
      <ResultAgentComposer
        context={{ status: 'blocked', contextToken: null, reason: '缺少正式 Revision' }}
        draft="调整配色"
        onDraftChange={() => undefined}
        onSubmit={() => undefined}
      />,
    );
    expect(screen.getByText(/缺少正式 Revision/)).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '交给 Agent' }).disabled).toBe(true);

    rerender(
      <ResultAgentComposer
        context={{ status: 'ready', contextToken: 'not-a-token' }}
        draft="调整配色"
        onDraftChange={() => undefined}
        onSubmit={() => undefined}
      />,
    );
    expect(screen.getByRole('status').textContent).toContain('上下文不完整');
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '交给 Agent' }).disabled).toBe(true);
  });

  it('选择过期或不可用时保留可见安全边界，但不重复就绪说明', () => {
    const { rerender } = render(
      <ResultAgentComposer
        context={{ status: 'ready', contextToken: TOKEN_A, selectionCompatibility: 'stale' }}
        draft="调整配色"
        onDraftChange={() => undefined}
        onSubmit={() => undefined}
      />,
    );
    expect(screen.getByRole('status').textContent).toContain('选择已过期');
    expect(screen.getByRole('status').textContent).toContain('不会交给 Agent');

    rerender(
      <ResultAgentComposer
        context={{ status: 'ready', contextToken: TOKEN_A, selectionCompatibility: 'invalid' }}
        draft="调整配色"
        onDraftChange={() => undefined}
        onSubmit={() => undefined}
      />,
    );
    expect(screen.getByRole('status').textContent).toContain('选择不可用');
  });

  it('上下文刷新后只提交最新 token，旧 token 不会被复用', () => {
    const onSubmit = vi.fn();
    const { rerender } = render(
      <ResultAgentComposer
        context={{ status: 'ready', contextToken: TOKEN_A }}
        draft="加大标签"
        onDraftChange={() => undefined}
        onSubmit={onSubmit}
      />,
    );
    rerender(
      <ResultAgentComposer
        context={{ status: 'ready', contextToken: TOKEN_B }}
        draft="加大标签"
        onDraftChange={() => undefined}
        onSubmit={onSubmit}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '交给 Agent' }));
    expect(onSubmit.mock.calls[0][0].contextToken).toBe(TOKEN_B);
  });

  it('Cmd/Ctrl+Enter 可发送，但普通 Enter 只换行', () => {
    const onSubmit = vi.fn();
    render(
      <ResultAgentComposer
        context={{ status: 'ready', contextToken: TOKEN_A }}
        draft="修改图例"
        onDraftChange={() => undefined}
        onSubmit={onSubmit}
      />,
    );
    const input = screen.getByLabelText('描述你希望当前结果发生什么变化');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Enter', metaKey: true });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('宿主拒绝提交时保留草稿，不把并发运行误报成已发送', () => {
    const onDraftChange = vi.fn();
    render(
      <ResultAgentComposer
        context={{ status: 'ready', contextToken: TOKEN_A }}
        draft="不要丢掉我"
        onDraftChange={onDraftChange}
        onSubmit={() => false}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: '交给 Agent' }));
    expect(onDraftChange).not.toHaveBeenCalledWith('');
  });

  it('只渲染后端投影的公开阶段，并保留停止/失败结论', () => {
    render(
      <ResultAgentComposer
        context={{ status: 'ready', contextToken: TOKEN_A }}
        draft=""
        onDraftChange={() => undefined}
        onSubmit={() => undefined}
        progress={[
          {
            resultEditProgressVersion: 1, sequence: 1, changeSetId: '',
            stage: 'intent', status: 'completed',
            publicPhase: 'understand_intent', publicPhaseLabel: '理解意图',
          },
          {
            resultEditProgressVersion: 1, sequence: 2, changeSetId: '',
            stage: 'plan', status: 'completed',
            publicPhase: 'assess_impact', publicPhaseLabel: '判断影响',
          },
          {
            resultEditProgressVersion: 1, sequence: 3, changeSetId: 'cs_1',
            stage: 'materialize', status: 'completed',
            publicPhase: 'execute_or_recompute', publicPhaseLabel: '执行/重算',
          },
          {
            resultEditProgressVersion: 1, sequence: 4, changeSetId: 'cs_1',
            stage: 'revision', status: 'completed',
            publicPhase: 'validate', publicPhaseLabel: '验证',
          },
          {
            resultEditProgressVersion: 1, sequence: 5, changeSetId: 'cs_1',
            stage: 'preview', status: 'ready',
            publicPhase: 'candidate_comparable', publicPhaseLabel: '候选可比较',
          },
          {
            resultEditProgressVersion: 1, sequence: 6, changeSetId: 'cs_1',
            stage: 'failed', status: 'terminal', reason: 'validator blocked',
          },
        ]}
      />,
    );
    for (const label of ['理解意图', '判断影响', '执行/重算', '验证', '候选可比较']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    expect(screen.getAllByText('已完成').length).toBeGreaterThan(0);
    expect(screen.getByText('修改未完成')).toBeTruthy();
    expect(screen.queryByText(/validator blocked/)).toBeNull();
    expect(screen.queryByText('materialize')).toBeNull();
  });
});
