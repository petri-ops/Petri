import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EvidenceSurface } from './EvidenceSurface';

vi.mock('@/lib/trajectoryClient', () => ({ fetchTrajectory: vi.fn() }));

afterEach(cleanup);

describe('evidence surface (Q5 minimal index)', () => {
  it('renders an honest empty state without an active result', () => {
    render(
      <EvidenceSurface
        activeJob={null}
        activeWorkflow={null}
        activeArtifact={null}
        onOpenResults={vi.fn()}
        onOpenReview={vi.fn()}
        onOpenPlan={vi.fn()}
      />,
    );
    expect(screen.getByTestId('evidence-surface').getAttribute('data-state')).toBe('empty');
    expect(screen.getByText(/当前没有可展示的产物或核验证据/)).toBeTruthy();
  });

  it('shows artifact truth, revision and availability without claiming scientific correctness', () => {
    render(
      <EvidenceSurface
        activeJob={{ id: 'job-1', tool_id: 'volcano-plot', status: 'done', created_at: 1 } as never}
        activeWorkflow={null}
        activeArtifact={{
          jobId: 'job-1',
          toolId: 'volcano-plot',
          name: 'volcano.png',
          type: 'plot',
          revisionId: 'rev-2',
          revisionOrdinal: 2,
          truthStatus: 'valid',
          availabilityStatus: 'available',
        } as never}
        onOpenResults={vi.fn()}
        onOpenReview={vi.fn()}
        onOpenPlan={vi.fn()}
      />,
    );
    expect(screen.getByText('已核验（未篡改）')).toBeTruthy();
    expect(screen.getByText('v2')).toBeTruthy();
    expect(screen.getByText(/不代表科学结论正确/)).toBeTruthy();
  });
});

describe('evidence surface (BLOCK-248 Q3 event-level evidence)', () => {
  it('shows execution event stats and opens the trace surface', async () => {
    const { fetchTrajectory } = await import('@/lib/trajectoryClient');
    vi.mocked(fetchTrajectory).mockResolvedValue({
      ok: true,
      availability: 'available',
      recordedOnly: true,
      mode: 'tail',
      conversationId: 'conv_1',
      task: null,
      events: [],
      truncated: false,
      hasMoreOlder: false,
      nextAfterSeq: 0,
      oldestSeq: null,
      stats: {
        events: 7,
        toolCalls: 3,
        toolFailures: 1,
        errors: 0,
        compactions: 0,
        promptTokens: 10,
        completionTokens: 5,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        models: [],
      },
    });
    const onOpenTrace = vi.fn();
    render(
      <EvidenceSurface
        activeJob={null}
        activeWorkflow={null}
        activeArtifact={null}
        conversationId="conv_1"
        onOpenResults={vi.fn()}
        onOpenReview={vi.fn()}
        onOpenPlan={vi.fn()}
        onOpenTrace={onOpenTrace}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId('evidence-trace-stats').textContent).toContain('事件 7');
    });
    expect(screen.getByTestId('evidence-trace-stats').textContent).toContain('工具 3');
    expect(screen.getByTestId('evidence-trace-stats').textContent).toContain('失败 1');
    fireEvent.click(screen.getByTestId('evidence-open-trace'));
    expect(onOpenTrace).toHaveBeenCalledTimes(1);
  });

  it('without a conversation keeps the honest placeholder and shows the entry when provided', () => {
    render(
      <EvidenceSurface
        activeJob={null}
        activeWorkflow={null}
        activeArtifact={null}
        onOpenResults={vi.fn()}
        onOpenReview={vi.fn()}
        onOpenPlan={vi.fn()}
        onOpenTrace={vi.fn()}
      />,
    );
    expect(screen.getByText(/打开一个会话后可查看执行事件/)).toBeTruthy();
    expect(screen.getByTestId('evidence-open-trace')).toBeTruthy();
  });
});
