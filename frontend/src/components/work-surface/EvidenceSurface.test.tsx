import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EvidenceSurface } from './EvidenceSurface';

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
