import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ResultsLibrary } from './ResultsLibrary';
import type { ToolJob } from '@/lib/project-types';

afterEach(cleanup);

const baseJob: ToolJob = {
  id: 'job_local',
  tool_id: 'km-survival',
  status: 'done',
  created_at: Date.now() - 60_000,
};

describe('ResultsLibrary BLOCK-57 远程徽章', () => {
  it('远程作业（execution_target_id 非空）渲染「远程」徽章', () => {
    render(
      <ResultsLibrary
        projectId="p_test"
        jobs={[{ ...baseJob, id: 'job_remote', execution_target_id: 'tgt_dell' }]}
        onOpenJob={vi.fn()}
      />,
    );
    const badge = screen.getByText('远程');
    expect(badge).toBeTruthy();
    expect(badge.getAttribute('title')).toContain('远程执行目标');
  });

  it('本机作业不渲染徽章（零视觉变化）', () => {
    render(<ResultsLibrary projectId="p_test" jobs={[baseJob]} onOpenJob={vi.fn()} />);
    expect(screen.queryByText('远程')).toBeNull();
  });

  it('混合列表只给远程作业加徽章', () => {
    render(
      <ResultsLibrary
        projectId="p_test"
        jobs={[
          baseJob,
          { ...baseJob, id: 'job_remote', execution_target_id: 'tgt_aliyun' },
        ]}
        onOpenJob={vi.fn()}
      />,
    );
    expect(screen.getAllByText('远程').length).toBe(1);
  });
});
