/**
 * item83 追加④ HK-01：同轮多产物聚合网格（多行多列自适应、视频独占整行、批次头、
 * 不同轮次不合并），点单项放大等既有行为由复用的 ChatArtifactCard 保持。
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ConversationSegment } from './conversationSegments';
import { ConversationTimeline } from './ConversationTimeline';
import { ChatArtifactGridCard } from './ChatArtifactGridCard';
import { groupGeneratedActivities } from '@/lib/generatedArtifactGroups';
import type { ToolActivityItem } from './toolActivity';

vi.mock('@/lib/events', () => ({
  petriEvents: { projectOpenArtifact: 'petri:project-open-artifact', model3dOpen: 'petri:model3d-open' },
  dispatchPetriEvent: vi.fn(),
}));

const artifact = (kind: 'image' | 'video', n: number) => ({
  name: `${kind}-${n}.${kind === 'image' ? 'png' : 'mp4'}`,
  path: `/data/generated/generate-${kind}/${kind}-${n}.${kind === 'image' ? 'png' : 'mp4'}`,
  url: `/api/generated/file/${kind}/${kind}-${n}.${kind === 'image' ? 'png' : 'mp4'}`,
  mime: kind === 'image' ? 'image/png' : 'video/mp4',
  source: { provider: 'ark', model: 'seedream' },
});

const activity = (key: string, kind: 'image' | 'video', n: number, iteration: number): ToolActivityItem => ({
  key,
  name: `generate.${kind}`,
  status: 'success',
  actionLabel: '已生成',
  iteration,
  resultData: artifact(kind, n),
});

function toolsSegment(iteration: number, activities: ToolActivityItem[]): ConversationSegment {
  return {
    kind: 'tools', iteration, activities, groups: [], totalCount: activities.length,
    failedCount: 0, runningCount: 0, durationMs: null, state: 'settled',
  };
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('item83 多结果网格卡', () => {
  it('HK-01 网格列数自适应 + 视频/图片混排 + 批次头', () => {
    const groups = groupGeneratedActivities([
      activity('a1', 'image', 1, 5), activity('a2', 'image', 2, 5), activity('a3', 'video', 1, 5),
    ]);
    expect(groups.length).toBe(1);
    render(<ChatArtifactGridCard groups={groups} projectId={null} />);
    const grid = screen.getByTestId('chat-artifact-grid');
    expect(grid.style.display).toBe('grid');
    expect(grid.style.gridTemplateColumns).toContain('repeat(auto-fit,minmax(');
    expect(grid.style.gap).toContain('var(--petri-space-');
    expect(screen.getByTestId('chat-artifact-grid-header').textContent).toContain('本轮产物 3 项');
    expect(screen.getAllByTestId('chat-artifact-grid-tile').length).toBe(3);
    const videoTile = screen.getByTestId('chat-artifact-grid-tile-video');
    expect(videoTile.style.gridColumn).toBe('1 / -1');
    const imageTiles = screen.getAllByTestId('chat-artifact-grid-tile-image');
    expect(imageTiles[0].style.gridColumn).toBe('');
  });

  it('HK-01 跨轮不合并：按 iteration 分组后各轮独立成卡', () => {
    const groups = groupGeneratedActivities([
      activity('c1', 'image', 1, 5),
      activity('c2', 'video', 1, 8),
      activity('c3', 'image', 2, 8),
    ]);
    expect(groups.map((g) => g.iteration)).toEqual([5, 8]);
    expect(groups.map((g) => g.artifacts.length)).toEqual([1, 2]);
    render(<ChatArtifactGridCard groups={groups} projectId={null} />);
    expect(screen.getAllByTestId('chat-artifact-grid').length).toBe(2);
    const headers = screen.getAllByTestId('chat-artifact-grid-header').map((el) => el.textContent);
    expect(headers).toEqual(['本轮产物 1 项', '本轮产物 2 项']);
  });

  it('HK-01 ConversationTimeline 折叠态展示同轮网格卡', () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 }))));
    const view = render(<ConversationTimeline segments={[
      toolsSegment(5, [activity('d1', 'image', 1, 5), activity('d2', 'video', 1, 5)]),
    ]} projectId={null} />);
    expect(view.getAllByTestId('chat-artifact-grid').length).toBe(1);
  });
});
