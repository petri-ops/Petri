import { describe, expect, it } from 'vitest';
import { actionsForSurface } from '@/lib/workSurface/uiActionBus';
import type { WorkSurfaceDescriptor } from '@/lib/workSurface/types';
import { packSurfaceUrl } from './PackSurfaceFrame';

const VIEW: WorkSurfaceDescriptor = {
  id: 'pack:bio:lab',
  kind: 'pack-view',
  title: '实验台',
  icon: 'puzzle',
  source: 'pack',
  packId: 'bio',
  singleton: true,
  closeable: true,
  persist: true,
  order: 100,
  entry: 'ui/lab page.html',
};

describe('pack surface frame contract', () => {
  it('builds an isolated petri-pack URL from a pack-relative entry', () => {
    expect(packSurfaceUrl(VIEW)).toBe('petri-pack://bio/ui/lab%20page.html');
  });

  it('returns null for non-view surfaces', () => {
    expect(packSurfaceUrl({ ...VIEW, kind: 'core' })).toBeNull();
    expect(packSurfaceUrl({ ...VIEW, entry: undefined })).toBeNull();
  });

  it('routes actions to a surface, keeping global actions available', () => {
    const actions = [
      { id: 'a', label: 'A', source: 'pack' as const, packId: 'bio', surfaceId: VIEW.id },
      { id: 'b', label: 'B', source: 'pack' as const, packId: 'bio' },
    ];
    expect(actionsForSurface(actions, VIEW.id).map((action) => action.id)).toEqual(['a', 'b']);
    expect(actionsForSurface(actions, 'other').map((action) => action.id)).toEqual(['b']);
  });
});
