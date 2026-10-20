import type {
  PersistedWorkSurfaceState,
  WorkSurfaceDescriptor,
  WorkSurfaceOpenRequest,
  WorkSurfaceState,
  WorkSurfaceTab,
} from './types';

export type WorkSurfaceLookup = (surfaceId: string) => WorkSurfaceDescriptor | undefined;

export function createWorkSurfaceState(initial?: WorkSurfaceTab[]): WorkSurfaceState {
  const tabs = initial ? initial.slice() : [];
  return { tabs, activeId: tabs[tabs.length - 1]?.id ?? null };
}

function withOrdinal(state: WorkSurfaceState, surfaceId: string, ordinal: number): WorkSurfaceState {
  return {
    ...state,
    ordinalSeq: { ...(state.ordinalSeq ?? {}), [surfaceId]: ordinal },
  };
}

export function openWorkSurfaceTab(
  state: WorkSurfaceState,
  descriptor: WorkSurfaceDescriptor,
  request: WorkSurfaceOpenRequest = { surfaceId: descriptor.id }
): WorkSurfaceState {
  if (descriptor.singleton) {
    const existing = state.tabs.find((tab) => tab.surfaceId === descriptor.id);
    if (existing) {
      const tabs = request.title && request.title !== existing.title
        ? state.tabs.map((tab) => (tab.id === existing.id ? { ...tab, title: request.title! } : tab))
        : state.tabs;
      return { ...state, tabs, activeId: existing.id };
    }
    return {
      ...state,
      tabs: [...state.tabs, { id: descriptor.id, surfaceId: descriptor.id, title: request.title || descriptor.title }],
      activeId: descriptor.id,
    };
  }

  if (request.instanceKey) {
    const tabId = `${descriptor.id}::${request.instanceKey}`;
    const existing = state.tabs.find((tab) => tab.id === tabId);
    if (existing) return { ...state, activeId: existing.id };
    return {
      ...state,
      tabs: [...state.tabs, { id: tabId, surfaceId: descriptor.id, title: request.title || descriptor.title }],
      activeId: tabId,
    };
  }

  const ordinal = nextOrdinal(state, descriptor.id);
  const tabId = `${descriptor.id}#${ordinal}`;
  return withOrdinal({
    tabs: [...state.tabs, {
      id: tabId,
      surfaceId: descriptor.id,
      ordinal,
      title: request.title || `${descriptor.title} ${ordinal}`,
    }],
    activeId: tabId,
  }, descriptor.id, ordinal);
}

function nextOrdinal(state: WorkSurfaceState, surfaceId: string): number {
  const ordinals = state.tabs
    .filter((tab) => tab.surfaceId === surfaceId)
    .map((tab) => tab.ordinal ?? 0);
  const seq = state.ordinalSeq?.[surfaceId] ?? 0;
  return Math.max(seq, ...ordinals) + 1;
}

export function activateWorkSurfaceTab(state: WorkSurfaceState, tabId: string): WorkSurfaceState {
  if (!state.tabs.some((tab) => tab.id === tabId)) return state;
  return state.activeId === tabId ? state : { ...state, activeId: tabId };
}

export function reorderWorkSurfaceTab(
  state: WorkSurfaceState,
  tabId: string,
  toIndex: number
): WorkSurfaceState {
  const fromIndex = state.tabs.findIndex((tab) => tab.id === tabId);
  if (fromIndex < 0) return state;
  const bounded = Math.max(0, Math.min(toIndex, state.tabs.length - 1));
  if (bounded === fromIndex) return state;
  const tabs = state.tabs.slice();
  const [moved] = tabs.splice(fromIndex, 1);
  tabs.splice(Math.min(bounded, tabs.length), 0, moved);
  return { ...state, tabs };
}

function closeWorkSurfaceTabs(
  state: WorkSurfaceState,
  tabIds: readonly string[],
  lookup: WorkSurfaceLookup
): WorkSurfaceState {
  const requested = new Set(tabIds);
  if (requested.size === 0) return state;
  const nextTabs = state.tabs.filter((tab) => {
    if (!requested.has(tab.id)) return true;
    return lookup(tab.surfaceId)?.closeable === false;
  });
  if (nextTabs.length === state.tabs.length) return state;
  return {
    ...state,
    tabs: nextTabs,
    activeId: resolveActiveAfterRemoval(state, nextTabs),
  };
}

export function closeWorkSurfaceTab(
  state: WorkSurfaceState,
  tabId: string,
  lookup: WorkSurfaceLookup
): WorkSurfaceState {
  return closeWorkSurfaceTabs(state, [tabId], lookup);
}

export function closeOtherWorkSurfaceTabs(
  state: WorkSurfaceState,
  keepTabId: string,
  lookup: WorkSurfaceLookup
): WorkSurfaceState {
  return closeWorkSurfaceTabs(
    state,
    state.tabs.filter((tab) => tab.id !== keepTabId).map((tab) => tab.id),
    lookup
  );
}

export function closeWorkSurfaceTabsToRight(
  state: WorkSurfaceState,
  tabId: string,
  lookup: WorkSurfaceLookup
): WorkSurfaceState {
  const index = state.tabs.findIndex((tab) => tab.id === tabId);
  if (index < 0) return state;
  return closeWorkSurfaceTabs(state, state.tabs.slice(index + 1).map((tab) => tab.id), lookup);
}

export function closeAllWorkSurfaceTabs(
  state: WorkSurfaceState,
  lookup: WorkSurfaceLookup
): WorkSurfaceState {
  return closeWorkSurfaceTabs(state, state.tabs.map((tab) => tab.id), lookup);
}

function resolveActiveAfterRemoval(state: WorkSurfaceState, nextTabs: WorkSurfaceTab[]): string | null {
  const activeId = state.activeId;
  if (!activeId) return nextTabs[0]?.id ?? null;
  if (nextTabs.some((tab) => tab.id === activeId)) return activeId;

  const activeIndex = state.tabs.findIndex((tab) => tab.id === activeId);
  if (activeIndex < 0) return nextTabs[0]?.id ?? null;
  const nextIds = new Set(nextTabs.map((tab) => tab.id));
  for (let index = activeIndex + 1; index < state.tabs.length; index += 1) {
    if (nextIds.has(state.tabs[index].id)) return state.tabs[index].id;
  }
  for (let index = activeIndex - 1; index >= 0; index -= 1) {
    if (nextIds.has(state.tabs[index].id)) return state.tabs[index].id;
  }
  return nextTabs[0]?.id ?? null;
}

export function persistWorkSurfaceState(
  state: WorkSurfaceState,
  lookup: WorkSurfaceLookup
): PersistedWorkSurfaceState {
  const tabs = state.tabs
    .filter((tab) => {
      const descriptor = lookup(tab.surfaceId);
      return descriptor ? descriptor.persist !== false : false;
    })
    .map((tab) => ({
      id: tab.id,
      surfaceId: tab.surfaceId,
      ...(tab.ordinal ? { ordinal: tab.ordinal } : {}),
    }));
  const activeId = tabs.some((tab) => tab.id === state.activeId) ? state.activeId : null;
  return { version: 1, tabs, activeId };
}

export function restoreWorkSurfaceState(
  raw: unknown,
  lookup: WorkSurfaceLookup
): WorkSurfaceState {
  if (!raw || typeof raw !== 'object') return { tabs: [], activeId: null };
  const persisted = raw as Partial<PersistedWorkSurfaceState>;
  if (persisted.version !== 1 || !Array.isArray(persisted.tabs)) {
    return { tabs: [], activeId: null };
  }
  const seen = new Set<string>();
  const tabs: WorkSurfaceTab[] = [];
  for (const record of persisted.tabs) {
    if (!record || typeof record !== 'object') continue;
    const surfaceId = (record as { surfaceId?: unknown }).surfaceId;
    if (typeof surfaceId !== 'string') continue;
    const descriptor = lookup(surfaceId);
    if (!descriptor || descriptor.persist === false) continue;
    const rawId = (record as { id?: unknown }).id;
    const tabId = typeof rawId === 'string' && rawId.trim() ? rawId : (
      descriptor.singleton
        ? descriptor.id
        : `${descriptor.id}#${nextOrdinal({ tabs, activeId: null }, descriptor.id)}`
    );
    if (seen.has(tabId)) continue;
    if (descriptor.singleton && tabId !== descriptor.id) continue;
    if (!descriptor.singleton && !tabId.startsWith(`${descriptor.id}#`) && !tabId.startsWith(`${descriptor.id}::`)) continue;
    const ordinalRaw = (record as { ordinal?: unknown }).ordinal;
    const ordinal = typeof ordinalRaw === 'number' && Number.isInteger(ordinalRaw) && ordinalRaw > 0
      ? ordinalRaw
      : undefined;
    if (!descriptor.singleton && !tabId.startsWith(`${descriptor.id}::`) && ordinal === undefined) continue;
    seen.add(tabId);
    tabs.push({
      id: tabId,
      surfaceId: descriptor.id,
      ...(ordinal ? { ordinal } : {}),
      title: ordinal ? `${descriptor.title} ${ordinal}` : descriptor.title,
    });
  }
  const ordinalSeq: Record<string, number> = {};
  for (const tab of tabs) {
    if (!tab.ordinal) continue;
    ordinalSeq[tab.surfaceId] = Math.max(ordinalSeq[tab.surfaceId] ?? 0, tab.ordinal);
  }
  const activeRaw = persisted.activeId;
  const activeId = typeof activeRaw === 'string' && tabs.some((tab) => tab.id === activeRaw)
    ? activeRaw
    : tabs[tabs.length - 1]?.id ?? null;
  return {
    tabs,
    activeId,
    ...(Object.keys(ordinalSeq).length > 0 ? { ordinalSeq } : {}),
  };
}
