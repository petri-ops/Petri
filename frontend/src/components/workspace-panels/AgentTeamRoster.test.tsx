// BLOCK-249（Q4a）— 团队 roster：成员切换/两步停止/回执/暂停恢复/结构化徽标。
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { AgentTeamRoster } from './AgentTeamRoster';
import type { AgentTeamStopReceipt, AgentTeamView } from '@/lib/agentTeamClient';

afterEach(cleanup);

function teamView(overrides: Partial<AgentTeamView> = {}): AgentTeamView {
  return {
    ok: true,
    leader: {
      agentId: 'leader_1',
      status: 'running',
      agentStatus: 'running',
      conversationId: 'conv_1',
      taskHead: '派三个子代理调查',
      createdAt: '2026-10-24T00:00:00.000Z',
      finishedAt: null,
    },
    members: [
      {
        agentId: 'task_a', role: 'search', status: 'running', agentStatus: 'running',
        conversationId: 'conv_1', taskHead: '查引用', createdAt: '2026-10-24T00:00:01.000Z',
        finishedAt: null, error: null, lastEventAt: '2026-10-24T00:00:05.000Z', structured: null,
      },
      {
        agentId: 'task_b', role: 'investigator', status: 'completed', agentStatus: 'completed',
        conversationId: 'conv_1', taskHead: '调查调用链', createdAt: '2026-10-24T00:00:01.000Z',
        finishedAt: '2026-10-24T00:00:09.000Z', error: null, lastEventAt: '2026-10-24T00:00:09.000Z',
        structured: { required: true, ok: false, errors: ['缺少必填字段 answer'], attempts: 2 },
      },
    ],
    counts: { total: 2, running: 1, finished: 1, structuredInvalid: 1 },
    journalAvailable: true,
    ...overrides,
  };
}

const receipt: AgentTeamStopReceipt = {
  ok: true,
  leader: { agentId: 'leader_1', outcome: 'cancel_requested' },
  members: [
    { agentId: 'task_a', outcome: 'cancel_requested', status: 'cancel_requested', agentStatus: 'cancel_requested' },
    { agentId: 'task_b', outcome: 'already_finished', status: 'completed', agentStatus: 'completed' },
  ],
  summary: { requested: 1, alreadyFinished: 1, notCancelled: 0 },
};

describe('AgentTeamRoster (BLOCK-249 / Q4a)', () => {
  it('渲染 leader/成员/计数/journal 与结构化徽标；点成员切换', () => {
    const onSelectAgent = vi.fn();
    render(
      <AgentTeamRoster
        team={teamView()}
        currentAgentId="task_a"
        busy={false}
        receipt={null}
        onSelectAgent={onSelectAgent}
        onPause={vi.fn()}
        onResume={vi.fn()}
        onStopTeam={vi.fn()}
      />
    );
    expect(screen.getByTestId('team-counts').textContent).toContain('2 成员');
    expect(screen.getByTestId('team-counts').textContent).toContain('1 结构化未通过');
    expect(screen.getByTestId('team-leader').textContent).toContain('派三个子代理调查');
    expect(screen.getByTestId('team-journal')).toBeTruthy();
    const members = screen.getAllByTestId('team-member');
    expect(members).toHaveLength(2);
    expect(members[1].textContent).toContain('调查员');
    expect(members[1].textContent).toContain('结构化 ✗');
    expect(members[0].getAttribute('aria-current')).toBe('true');
    fireEvent.click(members[1]);
    expect(onSelectAgent).toHaveBeenCalledWith('task_b');
  });

  it('停止团队两步武装：第一次只武装，第二次才发停止', () => {
    const onStopTeam = vi.fn();
    render(
      <AgentTeamRoster
        team={teamView()}
        currentAgentId="task_a"
        busy={false}
        receipt={null}
        onSelectAgent={vi.fn()}
        onPause={vi.fn()}
        onResume={vi.fn()}
        onStopTeam={onStopTeam}
      />
    );
    fireEvent.click(screen.getByTestId('team-stop'));
    expect(onStopTeam).not.toHaveBeenCalled();
    expect(screen.getByTestId('team-stop-confirm').textContent).toContain('1 个在跑');
    fireEvent.click(screen.getByTestId('team-stop-confirm'));
    expect(onStopTeam).toHaveBeenCalledWith('leader_1');
  });

  it('回执逐成员展示（部分成功如实）', () => {
    render(
      <AgentTeamRoster
        team={teamView()}
        currentAgentId="task_a"
        busy={false}
        receipt={receipt}
        onSelectAgent={vi.fn()}
        onPause={vi.fn()}
        onResume={vi.fn()}
        onStopTeam={vi.fn()}
      />
    );
    const receiptEl = screen.getByTestId('team-receipt');
    expect(receiptEl.textContent).toContain('已请求 1');
    expect(receiptEl.textContent).toContain('本就已结束 1');
    const rows = screen.getAllByTestId('team-receipt-member');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('已请求停止');
    expect(rows[1].textContent).toContain('本就已结束');
  });

  it('暂停/恢复只对当前成员；暂停中显示恢复', () => {
    const onPause = vi.fn();
    const onResume = vi.fn();
    const { rerender } = render(
      <AgentTeamRoster
        team={teamView()}
        currentAgentId="task_a"
        busy={false}
        receipt={null}
        onSelectAgent={vi.fn()}
        onPause={onPause}
        onResume={onResume}
        onStopTeam={vi.fn()}
      />
    );
    fireEvent.click(screen.getByTestId('team-pause'));
    expect(onPause).toHaveBeenCalledWith('task_a');

    const pausedTeam = teamView();
    pausedTeam.members[0] = { ...pausedTeam.members[0], agentStatus: 'paused' };
    rerender(
      <AgentTeamRoster
        team={pausedTeam}
        currentAgentId="task_a"
        busy={false}
        receipt={null}
        onSelectAgent={vi.fn()}
        onPause={onPause}
        onResume={onResume}
        onStopTeam={vi.fn()}
      />
    );
    fireEvent.click(screen.getByTestId('team-resume'));
    expect(onResume).toHaveBeenCalledWith('task_a');
  });

  it('空团队给诚实空态（无停止按钮）', () => {
    render(
      <AgentTeamRoster
        team={teamView({ members: [], counts: { total: 0, running: 0, finished: 0, structuredInvalid: 0 }, journalAvailable: false })}
        currentAgentId={null}
        busy={false}
        receipt={null}
        onSelectAgent={vi.fn()}
        onPause={vi.fn()}
        onResume={vi.fn()}
        onStopTeam={vi.fn()}
      />
    );
    expect(screen.getByTestId('team-empty')).toBeTruthy();
    expect(screen.queryByTestId('team-stop')).toBeNull();
  });
});
