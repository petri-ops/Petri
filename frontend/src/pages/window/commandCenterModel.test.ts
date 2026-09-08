// ============================================================
// commandCenterModel.test — BLOCK-64 P1-b 活跃置顶分层纯函数回归。
// ============================================================
import { describe, expect, it } from 'vitest';
import { isActiveJob, orderJobsForWall } from './commandCenterModel';
import type { ToolJob } from '@/lib/project-types';

function job(partial: Partial<ToolJob> & { id: string }): ToolJob {
  return {
    tool_id: 't',
    status: 'done',
    created_at: 0,
    ...partial,
  };
}

describe('orderJobsForWall（活跃置顶，BLOCK-64 §3 #4）', () => {
  it('running/pending 排在 done/failed 之前，历史不再把活跃作业挤出墙', () => {
    const wall = orderJobsForWall([
      job({ id: 'old-done', status: 'done', created_at: 900 }),
      job({ id: 'new-done', status: 'done', created_at: 800 }),
      job({ id: 'running-1', status: 'running', created_at: 100 }),
      job({ id: 'running-2', status: 'running', created_at: 200 }),
      job({ id: 'failed-1', status: 'failed', created_at: 300 }),
      job({ id: 'pending-1', status: 'pending', created_at: 50 }),
    ]);

    expect(wall.ordered.map((j) => j.id)).toEqual([
      'running-2', // 活跃区内部 created_at 降序
      'running-1',
      'pending-1',
      'old-done', // 历史区内部降序
      'new-done',
      'failed-1',
    ]);
    expect(wall.active.map((j) => j.id)).toEqual(['running-2', 'running-1', 'pending-1']);
    expect(wall.history).toHaveLength(3);
  });

  it('截断发生在置顶之后：活跃作业完整保留，历史被挤出', () => {
    const many = orderJobsForWall([
      job({ id: 'running', status: 'running', created_at: 1 }),
      ...Array.from({ length: 15 }, (_, i) => job({ id: `done-${i}`, status: 'done', created_at: 1000 - i })),
    ]);
    const sliced = many.ordered.slice(0, 12);
    expect(sliced[0]?.id).toBe('running');
    expect(sliced).toHaveLength(12);
    expect(sliced.some((j) => j.id === 'done-11')).toBe(false);
  });

  it('isActiveJob 覆盖 running 与 pending 两态', () => {
    expect(isActiveJob(job({ id: 'a', status: 'running' }))).toBe(true);
    expect(isActiveJob(job({ id: 'b', status: 'pending' }))).toBe(true);
    expect(isActiveJob(job({ id: 'c', status: 'done' }))).toBe(false);
    expect(isActiveJob(job({ id: 'd', status: 'failed' }))).toBe(false);
  });
});
