import { describe, expect, it } from 'vitest';
import {
  CORE_WORK_SURFACE_IDS,
  createWorkSurfaceLookup,
  isTabSurface,
  mergeWorkSurfaceRegistry,
  resolveResultSurface,
} from './registry';

describe('work surface registry', () => {
  it('merges core and pack views with stable namespaced ids', () => {
    const registry = mergeWorkSurfaceRegistry([{
      packId: 'petri-pack-bio',
      views: [{ id: 'volcano-lab', title: '火山图实验室', entry: 'ui/volcano.html', order: 35 }],
    }]);
    const view = registry.surfaces.find((surface) => surface.id === 'pack:petri-pack-bio:volcano-lab');
    expect(view?.kind).toBe('pack-view');
    expect(view?.source).toBe('pack');
    expect(view?.icon).toBe('puzzle');
    expect(registry.diagnostics).toEqual([]);
    expect(registry.surfaces[0].id).toBe(CORE_WORK_SURFACE_IDS.home);
    expect(CORE_WORK_SURFACE_IDS.home).toBe('home');
  });

  it('rejects unsafe entries and malformed contributions fail-closed', () => {
    const registry = mergeWorkSurfaceRegistry([{
      packId: 'petri-pack-bio',
      views: [
        { id: 'escape', title: '逃逸', entry: '../outside.html' },
        { id: 'absolute', title: '绝对', entry: '/etc/passwd' },
        { id: 'scheme', title: '协议', entry: 'https://evil.example/x.html' },
        { id: 'missing-title', entry: 'ui/ok.html' },
      ],
    }]);
    expect(registry.surfaces.some((surface) => surface.packId === 'petri-pack-bio')).toBe(false);
    expect(registry.diagnostics.map((item) => item.code).sort()).toEqual([
      'missing_id_or_title',
      'unsafe_entry',
      'unsafe_entry',
      'unsafe_entry',
    ]);
  });

  it('rejects duplicate surface ids across packs', () => {
    const registry = mergeWorkSurfaceRegistry([
      { packId: 'pack-a', views: [{ id: 'same', title: 'A', entry: 'ui/a.html' }] },
      { packId: 'pack-a', views: [{ id: 'same', title: 'A2', entry: 'ui/a2.html' }] },
    ]);
    expect(registry.surfaces.filter((surface) => surface.id === 'pack:pack-a:same')).toHaveLength(1);
    expect(registry.diagnostics.some((item) => item.code === 'duplicate_surface_id')).toBe(true);
  });

  it('resolves result surfaces by artifact kind with priority and stable tie-break', () => {
    const registry = mergeWorkSurfaceRegistry([{
      packId: 'petri-pack-bio',
      resultSurfaces: [
        { id: 'low', title: '低优先', artifactTypes: ['plot'], priority: 1, entry: 'ui/low.html' },
        { id: 'high', title: '高优先', artifactTypes: ['plot', 'table'], priority: 10, entry: 'ui/high.html' },
        { id: 'tie', title: '同优先', artifactTypes: ['plot'], priority: 10, entry: 'ui/tie.html' },
      ],
    }]);
    expect(resolveResultSurface(registry, { artifactKinds: ['plot'] })?.id)
      .toBe('pack:petri-pack-bio:result:high');
    expect(resolveResultSurface(registry, { artifactKinds: ['table'] })?.id)
      .toBe('pack:petri-pack-bio:result:high');
    expect(resolveResultSurface(registry, { artifactKinds: ['report'] })).toBeNull();
    expect(resolveResultSurface(registry, { artifactKinds: [] })).toBeNull();
  });

  it('keeps result surfaces out of the tab rail and exposes a lookup', () => {
    const registry = mergeWorkSurfaceRegistry([{
      packId: 'petri-pack-bio',
      resultSurfaces: [{ id: 'bio-result', artifactTypes: ['*'], entry: 'ui/result.html' }],
    }]);
    const result = registry.surfaces.find((surface) => surface.kind === 'pack-result');
    expect(result && isTabSurface(result)).toBe(false);
    expect(createWorkSurfaceLookup(registry)('files')?.title).toBe('文件');
  });

  it('reports ui actions that point at unknown surfaces without dropping the action', () => {
    const registry = mergeWorkSurfaceRegistry([{
      packId: 'petri-pack-bio',
      views: [{ id: 'lab', title: '实验台', entry: 'ui/lab.html' }],
      uiActions: [
        { id: 'focus', label: '聚焦', surfaceId: 'lab' },
        { id: 'orphan', label: '孤儿', surfaceId: 'missing-view' },
      ],
    }]);
    expect(registry.uiActions.map((action) => action.id)).toEqual([
      'pack:petri-pack-bio:action:focus',
      'pack:petri-pack-bio:action:orphan',
    ]);
    expect(registry.uiActions[0].surfaceId).toBe('pack:petri-pack-bio:lab');
    expect(registry.diagnostics.some((item) => item.code === 'unknown_surface')).toBe(true);
  });
});
