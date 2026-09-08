import { afterEach, describe, expect, it, vi } from 'vitest';
import { listProjectJobs, listAllJobs } from './project-store';

vi.mock('./authClient', () => ({
  getPlatformApiPrefix: () => '/api',
  authHeaders: () => ({}),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function response(jobs: Array<Record<string, unknown>>) {
  return {
    json: async () => ({ status: 'ok', jobs }),
  } as Response;
}

function historyResponse(jobs: Array<Record<string, unknown>>) {
  return {
    json: async () => ({ ok: true, jobs }),
  } as Response;
}

describe('project job conversation projection', () => {
  it('encodes an exact conversation query when requested', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response([]));
    vi.stubGlobal('fetch', fetchMock);

    await listProjectJobs('project-1', 'conversation / 1');

    expect(fetchMock.mock.calls[0][0]).toBe('/api/data/projects/project-1/jobs?conversationId=conversation+%2F+1');
  });

  it('keeps project-wide listing explicit and preserves camel, snake, and null identities', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response([
      { id: 'camel', tool_id: 'a', status: 'completed', created_at: 3, conversationId: 'conversation-a' },
      { id: 'snake', tool_id: 'b', status: 'running', created_at: 2, conversation_id: 'conversation-b' },
      { id: 'legacy', tool_id: 'c', status: 'failed', created_at: 1, conversation_id: null },
    ]));
    vi.stubGlobal('fetch', fetchMock);

    const jobs = await listProjectJobs('project-1');

    expect(fetchMock.mock.calls[0][0]).toBe('/api/data/projects/project-1/jobs');
    expect(jobs.map((job) => [job.id, job.conversationId])).toEqual([
      ['camel', 'conversation-a'],
      ['snake', 'conversation-b'],
      ['legacy', null],
    ]);
  });
});

// BLOCK-64 P1-a —— mapToolJob 断链回归：/api/tools/history 的 SELECT 显式返回
// execution_target_id，此前 mapper 漏映射 → 「远程」徽章生产环境永不渲染，
// 而渲染层测试用手工注入的 ToolJob 掩盖了断链。本用例走真实 mapper，
// 禁止手工构造 ToolJob（plan §5 验收门）。
describe('listAllJobs history mapper (BLOCK-64 P1-a)', () => {
  it('maps raw history rows and preserves execution_target_id end to end', async () => {
    const fetchMock = vi.fn().mockResolvedValue(historyResponse([
      {
        id: 'job_remote',
        tool_id: 'volcano-plot',
        status: 'completed',
        created_at: 1700,
        completed_at: 1900,
        name: '火山图',
        project_id: 'p_1',
        conversation_id: null,
        execution_target_id: 'tgt_dell',
      },
      {
        id: 'job_local',
        tool_id: 'deseq2',
        status: 'running',
        created_at: 1800,
        project_id: 'p_1',
        execution_target_id: null,
      },
    ]));
    vi.stubGlobal('fetch', fetchMock);

    const jobs = await listAllJobs();

    expect(fetchMock.mock.calls[0][0]).toBe('/api/tools/history');
    const remote = jobs.find((j) => j.id === 'job_remote');
    const local = jobs.find((j) => j.id === 'job_local');
    expect(remote?.execution_target_id).toBe('tgt_dell');
    expect(local?.execution_target_id).toBeNull();
    expect(remote?.status).toBe('done');
  });
});
