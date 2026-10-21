import type { IconName } from '@/components/icons/Icon';
import type {
  PackUiActionDescriptor,
  WorkSurfaceDescriptor,
  WorkSurfaceDiagnostic,
  WorkSurfaceRegistry,
} from './types';

// Core ids stay equal to the existing right-panel modes so the host can replace
// the old hard-coded tab table without moving URL/legacy state. Pack ids are
// namespaced (`pack:<packId>:<viewId>`), so the two spaces cannot collide.
export const CORE_WORK_SURFACE_IDS = {
  home: 'home',
  results: 'results',
  files: 'files',
  generated: 'generated',
  browser: 'browser',
  analyze: 'analyze',
  review: 'review',
  jobs: 'jobs',
  io: 'io',
  agent: 'agent',
  plan: 'plan',
  evidence: 'evidence',
} as const;

function coreSurface(
  id: keyof typeof CORE_WORK_SURFACE_IDS,
  title: string,
  icon: IconName,
  order: number,
  options: Partial<Pick<WorkSurfaceDescriptor, 'singleton' | 'closeable' | 'persist' | 'emptyState'>> = {}
): WorkSurfaceDescriptor {
  return {
    id: CORE_WORK_SURFACE_IDS[id],
    kind: 'core',
    title,
    icon,
    source: 'core',
    singleton: options.singleton ?? true,
    closeable: options.closeable ?? true,
    persist: options.persist ?? true,
    order,
    emptyState: options.emptyState,
  };
}

/** Order mirrors the pre-Q5 right-panel rail so the existing UI stays visually stable. */
export const CORE_WORK_SURFACES: readonly WorkSurfaceDescriptor[] = Object.freeze([
  coreSurface('home', '工作台', 'home', 0, { closeable: false, persist: false }),
  coreSurface('results', '结果', 'bar-chart', 10),
  coreSurface('files', '文件', 'folder', 20),
  coreSurface('generated', '生成文件', 'file', 25, { emptyState: '当前会话还没有写入过工作区文件。' }),
  coreSurface('browser', '浏览器', 'globe', 30),
  coreSurface('analyze', '分析', 'sparkles', 40),
  coreSurface('review', '审阅', 'git-branch', 50),
  coreSurface('jobs', '指挥中心', 'command', 60),
  coreSurface('io', '模型 I/O', 'list-details', 70),
  coreSurface('agent', '智能体', 'bot', 80),
  coreSurface('plan', '计划', 'list-details', 90, { emptyState: '当前会话还没有计划。' }),
  coreSurface('evidence', '证据', 'shield', 100, { emptyState: '当前没有可展示的产物或核验证据。' }),
]);

export interface PackViewContribution {
  id?: unknown;
  /** Backend-computed public id (`pack:<packId>:<viewId>`); this is the single source. */
  publicId?: unknown;
  title?: unknown;
  entry?: unknown;
  singleton?: unknown;
  order?: unknown;
  emptyState?: unknown;
}

export interface PackResultSurfaceContribution {
  id?: unknown;
  publicId?: unknown;
  title?: unknown;
  entry?: unknown;
  artifactTypes?: unknown;
  modes?: unknown;
  tabs?: unknown;
  priority?: unknown;
  emptyState?: unknown;
}

const RESULT_SURFACE_MODES = new Set(['result', 'code', 'compare', 'history']);
/** BLOCK-236 — pack 可接管的只读 tab 白名单（写/交互面一律留在核心）。 */
const RESULT_SURFACE_TABS = new Set(['lineage', 'history', 'revisions-source']);

export interface PackUiActionContribution {
  id?: unknown;
  publicId?: unknown;
  label?: unknown;
  surfaceId?: unknown;
}

export interface PackContributionInput {
  packId: string;
  views?: readonly PackViewContribution[];
  resultSurfaces?: readonly PackResultSurfaceContribution[];
  uiActions?: readonly PackUiActionContribution[];
}

function diagnostic(
  packId: string,
  contribution: string,
  code: string,
  detail?: string
): WorkSurfaceDiagnostic {
  return { packId, contribution, code, ...(detail ? { detail } : {}) };
}

function isSafePackEntry(entry: unknown): entry is string {
  if (typeof entry !== 'string' || !entry.trim()) return false;
  const normalized = entry.replace(/\\/g, '/');
  if (/^[a-zA-Z]:/.test(normalized)) return false;
  if (normalized.startsWith('/') || normalized.startsWith('//')) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(normalized)) return false;
  return !normalized.split('/').some((segment) => segment === '..' || segment === '');
}

function normalizePackId(packId: unknown): string | null {
  if (typeof packId !== 'string' || !packId.trim()) return null;
  return packId.trim();
}

export function mergeWorkSurfaceRegistry(
  packs: readonly PackContributionInput[],
  core: readonly WorkSurfaceDescriptor[] = CORE_WORK_SURFACES
): WorkSurfaceRegistry {
  const surfaces: WorkSurfaceDescriptor[] = [];
  const uiActions: PackUiActionDescriptor[] = [];
  const diagnostics: WorkSurfaceDiagnostic[] = [];
  const seenSurfaceIds = new Set<string>();
  const seenActionIds = new Set<string>();

  for (const descriptor of core) {
    if (seenSurfaceIds.has(descriptor.id)) {
      diagnostics.push(diagnostic('core', descriptor.id, 'duplicate_surface_id'));
      continue;
    }
    seenSurfaceIds.add(descriptor.id);
    surfaces.push(descriptor);
  }

  for (const pack of packs) {
    const packId = normalizePackId(pack?.packId);
    if (!packId) {
      diagnostics.push(diagnostic('unknown', 'pack', 'invalid_pack_id'));
      continue;
    }

    for (const view of pack.views ?? []) {
      const viewId = typeof view?.id === 'string' ? view.id.trim() : '';
      const title = typeof view?.title === 'string' ? view.title.trim() : '';
      if (!viewId || !title) {
        diagnostics.push(diagnostic(packId, 'views', 'missing_id_or_title'));
        continue;
      }
      if (!isSafePackEntry(view.entry)) {
        diagnostics.push(diagnostic(packId, `views/${viewId}`, 'unsafe_entry'));
        continue;
      }
      const id = typeof view.publicId === 'string' && view.publicId.startsWith('pack:')
        ? view.publicId
        : `pack:${packId}:${viewId}`;
      if (seenSurfaceIds.has(id)) {
        diagnostics.push(diagnostic(packId, `views/${viewId}`, 'duplicate_surface_id'));
        continue;
      }
      seenSurfaceIds.add(id);
      const order = typeof view.order === 'number' && Number.isFinite(view.order) ? view.order : 1000;
      surfaces.push({
        id,
        kind: 'pack-view',
        title,
        icon: 'puzzle',
        source: 'pack',
        packId,
        singleton: view.singleton !== false,
        closeable: true,
        persist: true,
        order,
        entry: view.entry.replace(/\\/g, '/'),
        emptyState: typeof view.emptyState === 'string' ? view.emptyState : undefined,
      });
    }

    for (const result of pack.resultSurfaces ?? []) {
      const resultId = typeof result?.id === 'string' ? result.id.trim() : '';
      const types = Array.isArray(result?.artifactTypes)
        ? result.artifactTypes.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        : [];
      if (!resultId || types.length === 0) {
        diagnostics.push(diagnostic(packId, 'resultSurfaces', 'missing_id_or_artifact_types'));
        continue;
      }
      if (result.entry !== undefined && !isSafePackEntry(result.entry)) {
        diagnostics.push(diagnostic(packId, `resultSurfaces/${resultId}`, 'unsafe_entry'));
        continue;
      }
      const id = typeof result.publicId === 'string' && result.publicId.startsWith('pack:')
        ? result.publicId
        : `pack:${packId}:result:${resultId}`;
      if (seenSurfaceIds.has(id)) {
        diagnostics.push(diagnostic(packId, `resultSurfaces/${resultId}`, 'duplicate_surface_id'));
        continue;
      }
      const rawModes = Array.isArray(result.modes)
        ? result.modes.filter((mode): mode is string => typeof mode === 'string' && RESULT_SURFACE_MODES.has(mode))
        : [];
      const modes = rawModes.length > 0 ? [...new Set(rawModes)] : ['result'];
      // BLOCK-236 — tab 级接管：只认白名单，坏形状整条丢弃并留 diagnostic（不做半读）
      const tabs: { id: string; label: string }[] = [];
      if (result.tabs !== undefined) {
        if (!Array.isArray(result.tabs)) {
          diagnostics.push(diagnostic(packId, `resultSurfaces/${resultId}`, 'tabs_not_array'));
        } else {
          for (const rawTab of result.tabs as unknown[]) {
            const tab = (rawTab && typeof rawTab === 'object' ? rawTab : {}) as { id?: unknown; label?: unknown };
            const tabId = typeof tab.id === 'string' ? tab.id.trim() : '';
            if (!RESULT_SURFACE_TABS.has(tabId)) {
              diagnostics.push(diagnostic(packId, `resultSurfaces/${resultId}`, 'tab_unknown_id'));
              continue;
            }
            if (tabs.some((t) => t.id === tabId)) continue;
            const label = typeof tab.label === 'string' && tab.label.trim() ? tab.label.trim().slice(0, 24) : tabId;
            tabs.push({ id: tabId, label });
          }
        }
      }
      seenSurfaceIds.add(id);
      surfaces.push({
        id,
        kind: 'pack-result',
        title: typeof result.title === 'string' && result.title.trim() ? result.title.trim() : resultId,
        icon: 'bar-chart',
        source: 'pack',
        packId,
        singleton: true,
        closeable: true,
        persist: false,
        order: 0,
        entry: typeof result.entry === 'string' ? result.entry.replace(/\\/g, '/') : undefined,
        emptyState: typeof result.emptyState === 'string' ? result.emptyState : undefined,
        artifactTypes: types,
        modes,
        tabs,
        priority: typeof result.priority === 'number' && Number.isFinite(result.priority) ? result.priority : 0,
      });
    }

    for (const action of pack.uiActions ?? []) {
      const actionId = typeof action?.id === 'string' ? action.id.trim() : '';
      const label = typeof action?.label === 'string' ? action.label.trim() : '';
      if (!actionId || !label) {
        diagnostics.push(diagnostic(packId, 'uiActions', 'missing_id_or_label'));
        continue;
      }
      const id = typeof action.publicId === 'string' && action.publicId.startsWith('pack:')
        ? action.publicId
        : `pack:${packId}:action:${actionId}`;
      if (seenActionIds.has(id)) {
        diagnostics.push(diagnostic(packId, `uiActions/${actionId}`, 'duplicate_action_id'));
        continue;
      }
      seenActionIds.add(id);
      uiActions.push({
        id,
        label,
        source: 'pack',
        packId,
        surfaceId: typeof action.surfaceId === 'string' && action.surfaceId.trim()
          ? (action.surfaceId.trim().startsWith('pack:')
            ? action.surfaceId.trim()
            : `pack:${packId}:${action.surfaceId.trim()}`)
          : undefined,
      });
      const surfaceId = uiActions[uiActions.length - 1].surfaceId;
      if (surfaceId && !seenSurfaceIds.has(surfaceId)) {
        diagnostics.push(diagnostic(packId, `uiActions/${actionId}`, 'unknown_surface', surfaceId));
      }
    }
  }

  surfaces.sort((a, b) => (a.order - b.order) || a.id.localeCompare(b.id));
  return { surfaces, uiActions, diagnostics };
}

export function isTabSurface(descriptor: WorkSurfaceDescriptor): boolean {
  return descriptor.kind !== 'pack-result';
}

export function createWorkSurfaceLookup(
  registry: Pick<WorkSurfaceRegistry, 'surfaces'>
): (surfaceId: string) => WorkSurfaceDescriptor | undefined {
  const byId = new Map(registry.surfaces.map((surface) => [surface.id, surface]));
  return (surfaceId) => byId.get(surfaceId);
}

export function resolveResultSurface(
  registry: Pick<WorkSurfaceRegistry, 'surfaces'>,
  input: { artifactKinds: readonly string[] }
): WorkSurfaceDescriptor | null {
  const kinds = new Set(input.artifactKinds.filter((kind) => typeof kind === 'string' && kind));
  if (kinds.size === 0) return null;
  const matches = registry.surfaces.filter((surface) => {
    if (surface.kind !== 'pack-result') return false;
    const claimed = surface.artifactTypes ?? [];
    return claimed.some((kind) => kind === '*' || kinds.has(kind));
  });
  if (matches.length === 0) return null;
  matches.sort((a, b) => ((b.priority ?? 0) - (a.priority ?? 0)) || a.id.localeCompare(b.id));
  return matches[0];
}
