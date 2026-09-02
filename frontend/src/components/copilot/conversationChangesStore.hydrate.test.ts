/**
 * BLOCK-40 P2 — 会话改动水合（conversationChangesStore）。
 *
 * 覆盖：
 *   - mergeConversationFileChanges：只填充缺失路径，live/已有记录优先不覆盖
 *   - hydrateConversationFileChanges：成功水合 / once+in-flight 去重 / 非 2xx 与
 *     网络失败静默回退（维持全量视图，不新增报错面）
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  clearConversationFileChanges,
  getConversationFileChanges,
  hydrateConversationFileChanges,
  mergeConversationFileChanges,
  recordConversationFileChange,
} from './conversationChangesStore';

function okResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  } as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
  for (const id of ['conv-merge', 'conv-hy', 'conv-fail', 'conv-400', 'conv-dedupe']) {
    clearConversationFileChanges(id);
  }
});

describe('mergeConversationFileChanges (BLOCK-40 P2)', () => {
  it('只填充缺失路径；live 记录优先，不覆盖已有归属', () => {
    recordConversationFileChange('conv-merge', 'live.md', 'modified', {
      iteration: 7,
      tool: 'workspace_replace',
    });

    mergeConversationFileChanges('conv-merge', [
      // live 已有 → 不覆盖（status/iteration/tool 均保持 live 值）
      { path: 'live.md', status: 'created', iteration: 1, tool: 'workspace_write', lastChangedAt: '2026-09-01T00:00:00.000Z' },
      // live 缺失 → 填充
      { path: 'hydrated.md', status: 'created', iteration: 2, tool: 'workspace_write', lastChangedAt: '2026-09-02T00:00:00.000Z' },
      // 非法条目 → 忽略
      { path: '', status: 'created' },
      null,
    ] as never);

    const changes = getConversationFileChanges('conv-merge');
    const byPath = new Map(changes.map((c) => [c.path, c]));
    expect(byPath.get('live.md')).toMatchObject({
      status: 'modified',
      iteration: 7,
      tool: 'workspace_replace',
    });
    expect(byPath.get('hydrated.md')).toMatchObject({
      status: 'created',
      iteration: 2,
      tool: 'workspace_write',
    });
    // lastChangedAt：ISO 字符串解析为 epoch ms
    expect(typeof byPath.get('hydrated.md')!.lastChangedAt).toBe('number');
    expect(Number.isFinite(byPath.get('hydrated.md')!.lastChangedAt)).toBe(true);
  });

  it('无效输入诚实不落地', () => {
    mergeConversationFileChanges('', [{ path: 'x.md' }]);
    mergeConversationFileChanges('conv-merge', 'not-an-array' as never);
    expect(getConversationFileChanges('conv-merge')).toEqual([]);
  });
});

describe('hydrateConversationFileChanges (BLOCK-40 P2)', () => {
  it('成功水合：权威清单进入索引，恢复会话归属', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        okResponse({
          conversationId: 'conv-hy',
          changes: [
            { path: 'a.md', status: 'created', iteration: 1, tool: 'workspace_write', lastChangedAt: '2026-09-02T01:00:00.000Z' },
            { path: 'b.md', status: 'modified', lastChangedAt: '2026-09-02T02:00:00.000Z' },
          ],
        })
      )
    );
    vi.stubGlobal('fetch', fetchMock);

    await hydrateConversationFileChanges('conv-hy');

    const paths = getConversationFileChanges('conv-hy').map((c) => c.path);
    expect(paths.sort()).toEqual(['a.md', 'b.md']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toContain(
      '/api/ai/agent/conversation-changes?conversationId=conv-hy'
    );
  });

  it('同会话 once 去重：第二次调用不再发请求', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(okResponse({ conversationId: 'conv-dedupe', changes: [{ path: 'x.md', status: 'created' }] }))
    );
    vi.stubGlobal('fetch', fetchMock);

    await hydrateConversationFileChanges('conv-dedupe');
    await hydrateConversationFileChanges('conv-dedupe');

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('live 与水合并发：live 记录优先，水合只补缺失', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        okResponse({
          conversationId: 'conv-merge-2',
          changes: [{ path: 'live.md', status: 'created' }],
        })
      )
    );
    vi.stubGlobal('fetch', fetchMock);
    recordConversationFileChange('conv-merge-2', 'live.md', 'modified');

    await hydrateConversationFileChanges('conv-merge-2');

    expect(getConversationFileChanges('conv-merge-2')).toHaveLength(1);
    expect(getConversationFileChanges('conv-merge-2')[0].status).toBe('modified');
    clearConversationFileChanges('conv-merge-2');
  });

  it('后端 400/500：静默回退，不抛错、不落地', async () => {
    const fetchMock = vi.fn(() => Promise.resolve({ ok: false, status: 400 } as Response));
    vi.stubGlobal('fetch', fetchMock);

    await expect(hydrateConversationFileChanges('conv-400')).resolves.toBeUndefined();
    expect(getConversationFileChanges('conv-400')).toEqual([]);
  });

  it('网络失败：静默回退，不新增报错面', async () => {
    const fetchMock = vi.fn(() => Promise.reject(new TypeError('Failed to fetch')));
    vi.stubGlobal('fetch', fetchMock);

    await expect(hydrateConversationFileChanges('conv-fail')).resolves.toBeUndefined();
    expect(getConversationFileChanges('conv-fail')).toEqual([]);
  });

  it('空 conversationId 直接返回', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await hydrateConversationFileChanges(undefined);
    await hydrateConversationFileChanges(null);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
