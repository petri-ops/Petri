import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentChangesCard } from './AgentChangesCard';
import {
  clearConversationFileChanges,
  recordConversationFileChange,
} from './conversationChangesStore';
import { biof3Events } from '@/lib/events';

const { getBridgeMock } = vi.hoisted(() => ({
  getBridgeMock: vi.fn(),
}));

vi.mock('@/lib/desktopBridge', () => ({
  getBridge: getBridgeMock,
}));

function makeBridge(files: Array<{ path: string; status: string }>) {
  return {
    status: vi.fn(() =>
      Promise.resolve({
        ok: true,
        data: {
          files: files.map((f) => ({
            path: f.path,
            oldPath: null,
            status: f.status,
            untracked: f.status === '?',
            conflicted: false,
          })),
          totalFiles: files.length,
          hasUntracked: files.some((f) => f.status === '?'),
          hasConflict: false,
        },
      })
    ),
    diff: vi.fn(() =>
      Promise.resolve({
        ok: true,
        data: {
          files: files
            .filter((f) => f.status !== '?')
            .map((f) => ({
              path: f.path,
              oldPath: null,
              binary: false,
              hunks: [
                {
                  oldStart: 1,
                  newStart: 1,
                  lines: [
                    { type: 'ctx', text: 'line1' },
                    { type: 'add', text: 'line2-new' },
                    { type: 'del', text: 'line0-old' },
                  ],
                },
              ],
            })),
          truncated: false,
          summary: { added: files.length, removed: files.length },
        },
      })
    ),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  clearConversationFileChanges('conv-1');
  // BLOCK-40 P2 — 挂载即水合：默认 stub 掉真实 fetch（非 2xx 静默回退），
  // 水合专项用例内按需覆盖
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, status: 400 } as Response)));
});

afterEach(() => {
  cleanup();
  clearConversationFileChanges('conv-1');
  clearConversationFileChanges('conv-hy-e2e');
  vi.unstubAllGlobals();
});

describe('AgentChangesCard (BLOCK-28.7)', () => {
  it('renders per-file +N −M rows from status/diff', async () => {
    getBridgeMock.mockReturnValue(
      makeBridge([
        { path: 'src/a.py', status: 'M' },
        { path: 'notes.md', status: '?' },
      ])
    );

    render(<AgentChangesCard />);

    const card = await screen.findByTestId('agent-changes-card');
    expect(card.textContent).toContain('2 个文件');
    expect(card.textContent).toContain('src/a.py');
    expect(card.textContent).toContain('notes.md');
    // src/a.py：+1 −1；notes.md 无 diff（untracked）→ +0 −0 仍列出
    expect(card.textContent).toContain('+1');
    expect(card.textContent).toContain('−1');
  });

  it('hides entirely when the working tree is clean', async () => {
    getBridgeMock.mockReturnValue(makeBridge([]));

    render(<AgentChangesCard />);

    await waitFor(() => {
      expect(getBridgeMock.mock.results.length).toBeGreaterThan(0);
    });
    expect(screen.queryByTestId('agent-changes-card')).toBeNull();
  });

  it('clicking a file row dispatches reviewOpenFile with the path', async () => {
    getBridgeMock.mockReturnValue(makeBridge([{ path: 'src/a.py', status: 'M' }]));

    const seen: Array<{ filePath: string }> = [];
    const listener = (e: Event) => {
      seen.push((e as CustomEvent<{ filePath: string }>).detail);
    };
    window.addEventListener(biof3Events.reviewOpenFile, listener);

    render(<AgentChangesCard />);
    const row = await screen.findByText('src/a.py');
    fireEvent.click(row);

    window.removeEventListener(biof3Events.reviewOpenFile, listener);
    expect(seen).toEqual([{ filePath: 'src/a.py' }]);
  });

  it('agentTaskDone triggers a refresh and reveals the card', async () => {
    getBridgeMock.mockReturnValue(makeBridge([]));

    render(<AgentChangesCard />);
    await waitFor(() => {
      expect(screen.queryByTestId('agent-changes-card')).toBeNull();
    });

    // agent 完成任务 → 工作区出现改动 → 卡片显现
    getBridgeMock.mockReturnValue(makeBridge([{ path: 'gen/out.py', status: 'A' }]));
    window.dispatchEvent(new CustomEvent(biof3Events.agentTaskDone, { detail: { taskId: 't1' } }));

    const card = await screen.findByTestId('agent-changes-card');
    expect(card.textContent).toContain('gen/out.py');
  });
});

describe('AgentChangesCard 会话作用域 (BLOCK-31 P3)', () => {
  it('defaults to conversation scope when the session has attributed changes', async () => {
    getBridgeMock.mockReturnValue(
      makeBridge([
        { path: 'mine.md', status: 'M' },
        { path: 'other.py', status: 'M' },
      ])
    );
    recordConversationFileChange('conv-1', 'mine.md', 'modified');

    render(<AgentChangesCard conversationId="conv-1" />);

    const card = await screen.findByTestId('agent-changes-card');
    // 默认只显示当前会话归属的文件
    expect(card.textContent).toContain('本会话改动');
    expect(card.textContent).toContain('1 个文件');
    expect(card.textContent).toContain('mine.md');
    expect(card.textContent).not.toContain('other.py');
  });

  it('「全部」toggle reveals the full working tree view', async () => {
    getBridgeMock.mockReturnValue(
      makeBridge([
        { path: 'mine.md', status: 'M' },
        { path: 'other.py', status: 'M' },
      ])
    );
    recordConversationFileChange('conv-1', 'mine.md', 'modified');

    render(<AgentChangesCard conversationId="conv-1" />);
    fireEvent.click(await screen.findByRole('tab', { name: '全部' }));

    const card = await screen.findByTestId('agent-changes-card');
    expect(card.textContent).toContain('工作区改动');
    expect(card.textContent).toContain('2 个文件');
    expect(card.textContent).toContain('other.py');
  });

  it('keeps the full view when the conversation has no attributed changes', async () => {
    getBridgeMock.mockReturnValue(makeBridge([{ path: 'legacy.md', status: 'M' }]));

    render(<AgentChangesCard conversationId="conv-other" />);

    const card = await screen.findByTestId('agent-changes-card');
    expect(card.textContent).toContain('工作区改动');
    expect(card.textContent).toContain('legacy.md');
    expect(screen.queryByRole('tab', { name: '全部' })).toBeNull();
  });

  it('groups conversation-scope rows by execution step (iteration) with unattributed last (UI-273)', async () => {
    getBridgeMock.mockReturnValue(
      makeBridge([
        { path: 'late.md', status: 'M' },
        { path: 'exec-made.txt', status: '?' },
        { path: 'second.py', status: 'M' },
        { path: 'first.ts', status: 'M' },
      ])
    );
    recordConversationFileChange('conv-1', 'first.ts', 'modified', { iteration: 1, tool: 'workspace_write' });
    recordConversationFileChange('conv-1', 'second.py', 'modified', { iteration: 2, tool: 'workspace_replace' });
    recordConversationFileChange('conv-1', 'late.md', 'modified', { iteration: 2, tool: 'workspace_write' });
    // exec 盲区：无迭代归属
    recordConversationFileChange('conv-1', 'exec-made.txt', 'created');

    render(<AgentChangesCard conversationId="conv-1" />);

    const card = await screen.findByTestId('agent-changes-card');
    expect(card.textContent).toContain('本会话改动');
    expect(card.textContent).toContain('4 个文件');
    // 组头按迭代升序：第 1 轮 → 第 2 轮 → 其他改动（exec 盲区）
    expect(card.textContent).toContain('第 1 轮');
    expect(card.textContent).toContain('第 2 轮');
    expect(card.textContent).toContain('其他改动');
    const firstIdx = card.textContent.indexOf('第 1 轮');
    const secondIdx = card.textContent.indexOf('第 2 轮');
    const otherIdx = card.textContent.indexOf('其他改动');
    expect(firstIdx).toBeGreaterThan(-1);
    expect(secondIdx).toBeGreaterThan(firstIdx);
    expect(otherIdx).toBeGreaterThan(secondIdx);
    expect(card.textContent).toContain('first.ts');
    expect(card.textContent).toContain('exec-made.txt');
  });
});

describe('AgentChangesCard 水合 (BLOCK-40 P2)', () => {
  it('reload 后挂载：索引为空先全量回退，水合成功自动切「本会话改动」', async () => {
    getBridgeMock.mockReturnValue(
      makeBridge([
        { path: 'hy-a.md', status: 'M' },
        { path: 'other.py', status: 'M' },
      ])
    );
    // 用手工 resolve 的 deferred 控制水合时点，消除竞态：
    // 先断言全量回退，再放行水合结果
    let resolveHydrate: (v: Response) => void = () => {};
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            resolveHydrate = resolve;
          })
      )
    );

    render(<AgentChangesCard conversationId="conv-hy-e2e" />);

    // 水合返回前：索引为空 → 诚实回退全量视图（现状行为）
    const card = await screen.findByTestId('agent-changes-card');
    expect(card.textContent).toContain('工作区改动');
    expect(card.textContent).toContain('other.py');

    resolveHydrate({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          conversationId: 'conv-hy-e2e',
          changes: [
            { path: 'hy-a.md', status: 'created', iteration: 1, tool: 'workspace_write', lastChangedAt: '2026-09-02T01:00:00.000Z' },
          ],
        }),
    } as Response);

    // 水合成功 → 会话归属恢复 → 默认视图自动切「本会话改动」（BLOCK-31 S1 语义）
    await waitFor(() => {
      expect(card.textContent).toContain('本会话改动');
    });
    expect(card.textContent).toContain('1 个文件');
    expect(card.textContent).toContain('hy-a.md');
    expect(card.textContent).not.toContain('other.py');
  });
});
