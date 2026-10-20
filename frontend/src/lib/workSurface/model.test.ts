import { describe, expect, it } from 'vitest';
import type { WorkSurfaceDescriptor } from './types';
import {
  activateWorkSurfaceTab,
  closeAllWorkSurfaceTabs,
  closeOtherWorkSurfaceTabs,
  closeWorkSurfaceTab,
  closeWorkSurfaceTabsToRight,
  createWorkSurfaceState,
  openWorkSurfaceTab,
  persistWorkSurfaceState,
  reorderWorkSurfaceTab,
  restoreWorkSurfaceState,
} from './model';

function surface(overrides: Partial<WorkSurfaceDescriptor>): WorkSurfaceDescriptor {
  return {
    id: 'core:test',
    kind: 'core',
    title: '测试面',
    icon: 'file',
    source: 'core',
    singleton: true,
    closeable: true,
    persist: true,
    order: 10,
    ...overrides,
  };
}

const HOME = surface({ id: 'home', title: '工作台', closeable: false, persist: false, order: 0 });
const FILES = surface({ id: 'files', title: '文件', order: 10 });
const REVIEW = surface({ id: 'review', title: '审阅', order: 20 });
const PACK_ORDINAL = surface({
  id: 'pack:bio:lab',
  kind: 'pack-view',
  title: '实验台',
  icon: 'puzzle',
  source: 'pack',
  singleton: false,
  order: 100,
});

const LOOKUP = (id: string) => [HOME, FILES, REVIEW, PACK_ORDINAL].find((item) => item.id === id);

function baseState() {
  let state = createWorkSurfaceState([{ id: HOME.id, surfaceId: HOME.id, title: HOME.title }]);
  state = openWorkSurfaceTab(state, FILES);
  state = openWorkSurfaceTab(state, REVIEW);
  return state;
}

describe('work surface tab model', () => {
  it('singleton surfaces reuse one tab and keep stable identity', () => {
    let state = baseState();
    const reopened = openWorkSurfaceTab(state, FILES, { surfaceId: FILES.id, title: '文件（新）' });
    expect(reopened.tabs.filter((tab) => tab.surfaceId === FILES.id)).toHaveLength(1);
    expect(reopened.activeId).toBe(FILES.id);
    expect(reopened.tabs.find((tab) => tab.id === FILES.id)?.title).toBe('文件（新）');
    state = reopened;
    expect(state.tabs.map((tab) => tab.id)).toEqual([HOME.id, FILES.id, REVIEW.id]);
  });

  it('numbered surfaces allocate monotonic ordinals and never recycle them on close', () => {
    let state = baseState();
    state = openWorkSurfaceTab(state, PACK_ORDINAL);
    state = openWorkSurfaceTab(state, PACK_ORDINAL);
    expect(state.tabs.filter((tab) => tab.surfaceId === PACK_ORDINAL.id).map((tab) => tab.ordinal)).toEqual([1, 2]);
    state = closeWorkSurfaceTab(state, `${PACK_ORDINAL.id}#2`, LOOKUP);
    state = openWorkSurfaceTab(state, PACK_ORDINAL);
    expect(state.tabs.filter((tab) => tab.surfaceId === PACK_ORDINAL.id).map((tab) => tab.ordinal)).toEqual([1, 3]);
  });

  it('instanceKey gives numbered surfaces deterministic identity', () => {
    let state = baseState();
    state = openWorkSurfaceTab(state, PACK_ORDINAL, { surfaceId: PACK_ORDINAL.id, instanceKey: 'job-1' });
    state = openWorkSurfaceTab(state, PACK_ORDINAL, { surfaceId: PACK_ORDINAL.id, instanceKey: 'job-1' });
    expect(state.tabs.filter((tab) => tab.surfaceId === PACK_ORDINAL.id)).toHaveLength(1);
    expect(state.activeId).toBe(`${PACK_ORDINAL.id}::job-1`);
  });

  it('closing the active tab falls back to the right neighbor, then left, then first', () => {
    let state = baseState();
    state = activateWorkSurfaceTab(state, REVIEW.id);
    state = closeWorkSurfaceTab(state, REVIEW.id, LOOKUP);
    expect(state.activeId).toBe(FILES.id);

    state = activateWorkSurfaceTab(state, FILES.id);
    state = closeWorkSurfaceTab(state, FILES.id, LOOKUP);
    expect(state.activeId).toBe(HOME.id);
  });

  it('close others / right / all never remove non-closable surfaces', () => {
    let state = baseState();
    state = closeOtherWorkSurfaceTabs(state, FILES.id, LOOKUP);
    expect(state.tabs.map((tab) => tab.id)).toEqual([HOME.id, FILES.id]);

    state = openWorkSurfaceTab(state, REVIEW);
    state = closeWorkSurfaceTabsToRight(state, FILES.id, LOOKUP);
    expect(state.tabs.map((tab) => tab.id)).toEqual([HOME.id, FILES.id]);

    state = closeAllWorkSurfaceTabs(state, LOOKUP);
    expect(state.tabs.map((tab) => tab.id)).toEqual([HOME.id]);
    expect(state.activeId).toBe(HOME.id);
  });

  it('reorders a tab to the requested final index', () => {
    let state = baseState();
    state = reorderWorkSurfaceTab(state, HOME.id, 2);
    expect(state.tabs.map((tab) => tab.id)).toEqual([FILES.id, REVIEW.id, HOME.id]);
    state = reorderWorkSurfaceTab(state, HOME.id, 0);
    expect(state.tabs.map((tab) => tab.id)).toEqual([HOME.id, FILES.id, REVIEW.id]);
  });

  it('persists only restorable surfaces and restores valid tabs, dropping unknown ones', () => {
    let state = baseState();
    state = openWorkSurfaceTab(state, PACK_ORDINAL);
    const persisted = persistWorkSurfaceState(state, LOOKUP);
    expect(persisted.tabs.map((tab) => tab.surfaceId)).toEqual([FILES.id, REVIEW.id, PACK_ORDINAL.id]);
    expect(persisted.tabs.some((tab) => tab.surfaceId === HOME.id)).toBe(false);

    const restored = restoreWorkSurfaceState({
      version: 1,
      tabs: [
        ...persisted.tabs,
        { id: 'pack:missing:gone', surfaceId: 'pack:missing:gone' },
        { id: 'files', surfaceId: 'files' },
      ],
      activeId: 'pack:missing:gone',
    }, LOOKUP);
    expect(restored.tabs.map((tab) => tab.surfaceId)).toEqual([FILES.id, REVIEW.id, PACK_ORDINAL.id]);
    expect(restored.activeId).toBe(`${PACK_ORDINAL.id}#1`);
    expect(restored.tabs.find((tab) => tab.surfaceId === PACK_ORDINAL.id)?.title).toBe('实验台 1');
  });

  it('rejects malformed persisted state instead of throwing', () => {
    expect(restoreWorkSurfaceState(null, LOOKUP)).toEqual({ tabs: [], activeId: null });
    expect(restoreWorkSurfaceState({ version: 2, tabs: [] }, LOOKUP)).toEqual({ tabs: [], activeId: null });
    expect(restoreWorkSurfaceState({ version: 1, tabs: 'nope' }, LOOKUP)).toEqual({ tabs: [], activeId: null });
  });
});
