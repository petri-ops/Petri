import { describe, expect, it } from 'vitest';
import { actionsForSurface } from '@/lib/workSurface/uiActionBus';
import type { WorkSurfaceDescriptor } from '@/lib/workSurface/types';
import { packSurfaceUrl, PACK_SURFACE_SANDBOX } from './PackSurfaceFrame';

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

  it('sandbox permits petri-pack custom-protocol navigation but no broader top-navigation', () => {
    const tokens = PACK_SURFACE_SANDBOX.split(/\s+/).filter(Boolean);
    expect(tokens).toContain('allow-scripts');
    expect(tokens).toContain('allow-same-origin');
    // B1（2026-11-22 用户裁决）：Chromium 对 sandbox iframe 加载 petri-pack:// 自定义
    // 协议要求该 token，否则导航在 iframe target 创建前被拒（P6-TABLE-LOAD 真断点）。
    expect(tokens).toContain('allow-top-navigation-to-custom-protocols');
    // 最小权限：不放开更宽的顶层导航 / 弹窗 token。
    expect(tokens).not.toContain('allow-top-navigation');
    expect(tokens).not.toContain('allow-top-navigation-by-user-activation');
    expect(tokens).not.toContain('allow-popups');
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
