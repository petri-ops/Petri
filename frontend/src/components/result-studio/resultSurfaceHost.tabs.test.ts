import { describe, expect, it } from 'vitest';
import { resolveResultSurfaceHost } from './resultSurfaceHost';
import type { WorkSurfaceDescriptor } from '@/lib/workSurface/types';
import type { ActiveArtifact } from '@/components/workspace-panels/ResultView';

function surface(overrides: Partial<WorkSurfaceDescriptor> = {}): WorkSurfaceDescriptor {
  return {
    id: 'pack:bio:result:bio-result',
    kind: 'pack-result',
    title: '生信结果',
    icon: 'bar-chart',
    source: 'pack',
    packId: 'bio',
    singleton: true,
    closeable: true,
    order: 0,
    modes: ['result', 'code', 'history'],
    artifactTypes: ['matrix', 'table'],
    ...overrides,
  };
}

const artifact = { type: 'table', semanticKind: 'matrix' } as unknown as Pick<ActiveArtifact, 'type' | 'semanticKind'>;

describe('resultSurfaceHost（BLOCK-236 tab 级接管）', () => {
  it('result 模式：只接管主 body，不带 tab', () => {
    const res = resolveResultSurfaceHost([surface()], artifact, 'result');
    expect(res.source).toBe('pack');
    expect(res.tab).toBeUndefined();
  });

  it('code 模式 + 包声明 revisions-source：命 pack 并带 tab', () => {
    const res = resolveResultSurfaceHost(
      [surface({ tabs: [{ id: 'revisions-source', label: '源码' }] })],
      artifact,
      'code',
    );
    expect(res).toMatchObject({ source: 'pack', tab: 'revisions-source' });
  });

  it('code 模式 + 包未声明该 tab：回落核心，reason=tab_not_claimed', () => {
    const res = resolveResultSurfaceHost([surface()], artifact, 'code');
    expect(res).toMatchObject({ source: 'core-transitional', reason: 'tab_not_claimed' });
    expect(res.tab).toBeUndefined();
  });

  it('compare 模式 + 包声明 compare：命 pack 并带 tab', () => {
    const res = resolveResultSurfaceHost(
      [surface({ modes: ['result', 'compare'], tabs: [{ id: 'compare', label: '比较' }] })],
      artifact,
      'compare',
    );
    expect(res).toMatchObject({ source: 'pack', tab: 'compare' });
  });

  it('history 模式 + 包声明 history：命中（数据桥是否可用由桥层决定）', () => {
    const res = resolveResultSurfaceHost(
      [surface({ tabs: [{ id: 'history', label: '历史' }] })],
      artifact,
      'history',
    );
    expect(res).toMatchObject({ source: 'pack', tab: 'history' });
  });

  it('无候选 surface：回落核心，reason=no_matching_surface', () => {
    const res = resolveResultSurfaceHost([], artifact, 'result');
    expect(res).toMatchObject({ source: 'core-transitional', reason: 'no_matching_surface' });
  });
});
