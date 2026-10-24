import * as React from 'react';
import { usePackContributions } from '@/lib/workSurface/packContributionsClient';
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
  type WorkSurfaceLookup,
} from '@/lib/workSurface/model';
import {
  CORE_WORK_SURFACES,
  CORE_WORK_SURFACE_IDS,
  createWorkSurfaceLookup,
  isTabSurface,
  mergeWorkSurfaceRegistry,
} from '@/lib/workSurface/registry';
import type {
  PackUiActionDescriptor,
  WorkSurfaceDescriptor,
  WorkSurfaceState,
  WorkSurfaceTab,
} from '@/lib/workSurface/types';

const STORAGE_PREFIX = 'petri.workSurfaceTabs.v1';

function storageKey(projectId: string | null | undefined): string {
  return `${STORAGE_PREFIX}.${projectId || 'global'}`;
}

function readPersisted(projectId: string | null | undefined): unknown {
  try {
    const raw = window.localStorage.getItem(storageKey(projectId));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writePersisted(projectId: string | null | undefined, state: WorkSurfaceState, lookup: WorkSurfaceLookup): void {
  try {
    window.localStorage.setItem(storageKey(projectId), JSON.stringify(persistWorkSurfaceState(state, lookup)));
  } catch { /* storage unavailable: tabs stay session-only */ }
}

function homeTab(descriptor: WorkSurfaceDescriptor): WorkSurfaceTab {
  return { id: descriptor.id, surfaceId: descriptor.id, title: descriptor.title };
}

function withHome(state: WorkSurfaceState, home: WorkSurfaceDescriptor): WorkSurfaceState {
  if (state.tabs.some((tab) => tab.id === home.id)) return state;
  const tabs = [homeTab(home), ...state.tabs];
  return { ...state, tabs, activeId: state.activeId ?? home.id };
}

export interface UseWorkSurfaceTabsResult {
  surfaces: WorkSurfaceDescriptor[];
  resultSurfaces: WorkSurfaceDescriptor[];
  uiActions: PackUiActionDescriptor[];
  registryLoading: boolean;
  registryError: string | null;
  rightTab: string;
  openRightTabs: string[];
  tabs: WorkSurfaceTab[];
  rightToolMenuOpen: boolean;
  setRightToolMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
  browserUrl: string;
  setBrowserUrl: React.Dispatch<React.SetStateAction<string>>;
  openRightPanel: (surfaceId: string) => void;
  setRightTab: (surfaceId: string) => void;
  closeRightPanelTab: (surfaceId: string) => void;
  closeOtherTabs: (surfaceId: string) => void;
  closeTabsToRight: (surfaceId: string) => void;
  closeAllTabs: () => void;
  reorderTab: (surfaceId: string, toIndex: number) => void;
  descriptorFor: WorkSurfaceLookup;
}

export function useWorkSurfaceTabs(projectId: string | null | undefined): UseWorkSurfaceTabsResult {
  const { packs, loading: registryLoading, error: registryError } = usePackContributions();
  const registry = React.useMemo(() => mergeWorkSurfaceRegistry(packs), [packs]);
  const descriptorFor = React.useMemo(() => createWorkSurfaceLookup(registry), [registry]);
  const home = descriptorFor(CORE_WORK_SURFACE_IDS.home)
    || CORE_WORK_SURFACES.find((surface) => surface.id === CORE_WORK_SURFACE_IDS.home)!;

  const [state, setState] = React.useState<WorkSurfaceState>(() =>
    createWorkSurfaceState([homeTab(home)])
  );
  const [restoredKey, setRestoredKey] = React.useState<string | null>(null);
  const [rightToolMenuOpen, setRightToolMenuOpen] = React.useState(false);
  const [browserUrl, setBrowserUrl] = React.useState('https://petri.com/');

  // Restore only after the pack registry settles: restoring earlier would drop
  // pack tabs that are merely late, not uninstalled. Render-phase adjustment
  // (React's "adjust state when props change" pattern) avoids setState-in-effect.
  const restoreKey = `${projectId || 'global'}:${registryLoading ? 'loading' : 'ready'}`;
  if (!registryLoading && restoredKey !== restoreKey) {
    setRestoredKey(restoreKey);
    const restored = restoreWorkSurfaceState(readPersisted(projectId), descriptorFor);
    setState((current) => {
      const nextTabs = restored.tabs.length > 0
        ? restored.tabs
        : current.tabs.filter((tab) => tab.id === home.id);
      return withHome({
        tabs: nextTabs,
        activeId: restored.activeId,
        ordinalSeq: restored.ordinalSeq,
      }, home);
    });
  }

  React.useEffect(() => {
    if (restoredKey !== restoreKey) return;
    writePersisted(projectId, state, descriptorFor);
  }, [descriptorFor, projectId, restoreKey, restoredKey, state]);

  const openRightPanel = React.useCallback((surfaceId: string) => {
    const descriptor = descriptorFor(surfaceId);
    if (!descriptor) return;
    setState((current) => openWorkSurfaceTab(withHome(current, home), descriptor, { surfaceId }));
  }, [descriptorFor, home]);

  const setRightTab = React.useCallback((surfaceId: string) => {
    const descriptor = descriptorFor(surfaceId);
    setState((current) => {
      if (current.tabs.some((tab) => tab.id === surfaceId)) {
        return activateWorkSurfaceTab(current, surfaceId);
      }
      if (!descriptor) return current;
      return openWorkSurfaceTab(withHome(current, home), descriptor, { surfaceId });
    });
  }, [descriptorFor, home]);

  const closeRightPanelTab = React.useCallback((surfaceId: string) => {
    setState((current) => closeWorkSurfaceTab(current, surfaceId, descriptorFor));
  }, [descriptorFor]);

  const closeOtherTabs = React.useCallback((surfaceId: string) => {
    setState((current) => closeOtherWorkSurfaceTabs(current, surfaceId, descriptorFor));
  }, [descriptorFor]);

  const closeTabsToRight = React.useCallback((surfaceId: string) => {
    setState((current) => closeWorkSurfaceTabsToRight(current, surfaceId, descriptorFor));
  }, [descriptorFor]);

  const closeAllTabs = React.useCallback(() => {
    setState((current) => closeAllWorkSurfaceTabs(current, descriptorFor));
  }, [descriptorFor]);

  const reorderTab = React.useCallback((surfaceId: string, toIndex: number) => {
    setState((current) => reorderWorkSurfaceTab(current, surfaceId, toIndex));
  }, []);

  const activeId = state.activeId && state.tabs.some((tab) => tab.id === state.activeId)
    ? state.activeId
    : home.id;

  // 派生数组必须 memo：每次渲染 filter 出新数组会把「surfaces」变成每轮新依赖，
  // 传导到标题栏 effect（其 setState 与闭合 callback 叠加 → Maximum update depth，
  // BLOCK-250 实机抓真）。
  const tabSurfaces = React.useMemo(() => registry.surfaces.filter(isTabSurface), [registry]);
  const resultSurfaces = React.useMemo(
    () => registry.surfaces.filter((surface) => surface.kind === 'pack-result'),
    [registry]
  );

  return {
    surfaces: tabSurfaces,
    resultSurfaces,
    uiActions: registry.uiActions,
    registryLoading,
    registryError,
    rightTab: activeId,
    openRightTabs: state.tabs.map((tab) => tab.id),
    tabs: state.tabs,
    rightToolMenuOpen,
    setRightToolMenuOpen,
    browserUrl,
    setBrowserUrl,
    openRightPanel,
    setRightTab,
    closeRightPanelTab,
    closeOtherTabs,
    closeTabsToRight,
    closeAllTabs,
    reorderTab,
    descriptorFor,
  };
}
