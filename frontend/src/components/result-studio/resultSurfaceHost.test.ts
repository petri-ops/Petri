import { describe, expect, it } from 'vitest';
import { resolveResultSurfaceHost } from './resultSurfaceHost';
import type { WorkSurfaceDescriptor } from '@/lib/workSurface/types';

const PACK_RESULT: WorkSurfaceDescriptor = {
  id: 'pack:bio:result:bio',
  kind: 'pack-result',
  title: '生信结果',
  icon: 'bar-chart',
  source: 'pack',
  packId: 'bio',
  singleton: true,
  closeable: true,
  persist: false,
  order: 0,
  artifactTypes: ['plot', 'table'],
  priority: 10,
};

describe('result surface host (Q5)', () => {
  it('mounts a matching pack result surface', () => {
    const resolved = resolveResultSurfaceHost([PACK_RESULT], { type: 'plot', semanticKind: undefined });
    expect(resolved.source).toBe('pack');
    expect(resolved.descriptor?.id).toBe(PACK_RESULT.id);
    expect(resolved.artifactKinds).toEqual(['plot']);
  });

  it('prefers semanticKind when present but still matches type', () => {
    expect(resolveResultSurfaceHost([PACK_RESULT], {
      type: 'file',
      semanticKind: 'table',
    }).source).toBe('pack');
  });

  it('keeps the core transitional surface when no pack surface matches', () => {
    const resolved = resolveResultSurfaceHost([PACK_RESULT], { type: 'report', semanticKind: undefined });
    expect(resolved.source).toBe('core-transitional');
    expect(resolved.descriptor).toBeUndefined();
  });

  it('keeps the core transitional surface when no artifact is selected', () => {
    expect(resolveResultSurfaceHost([PACK_RESULT], null).source).toBe('core-transitional');
  });
});
