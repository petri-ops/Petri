import type { IconName } from '@/components/icons/Icon';

type WorkSurfaceSource = 'core' | 'pack';
type WorkSurfaceKind = 'core' | 'pack-view' | 'pack-result';

export interface WorkSurfaceDescriptor {
  /** Stable id: `core:<id>` or `pack:<packId>:<viewId>`. */
  id: string;
  kind: WorkSurfaceKind;
  title: string;
  icon: IconName;
  source: WorkSurfaceSource;
  packId?: string;
  singleton: boolean;
  closeable: boolean;
  /** Whether the tab survives reload; default true (home sets false). */
  persist?: boolean;
  order: number;
  /** Pack-relative entry under the pack root (pack-view only). */
  entry?: string;
  emptyState?: string;
  /** pack-result only: artifact kinds this surface claims. */
  artifactTypes?: string[];
  /** pack-result only: result modes this surface claims (default ['result']). */
  modes?: string[];
  /**
   * BLOCK-236 — pack-result only: 同一模式内由 pack 接管的只读 tab。
   * 未声明 = 只接管模式主 body（BLOCK-218 行为）；白名单见 registry.ts。
   */
  tabs?: { id: string; label: string }[];
  /** RW-02（C-44 扩展）— v1 兼容：批注窄桥写声明（pack.json 原文透传，宿主校验）。 */
  annotations?: { write?: boolean };
  /**
   * RW-02（C-44 扩展）— v2 写能力声明（bridgeVersion 门 + 未知键 fail-closed，
   * 服务端 pack-contributions 校验后透传；pack 侧不能自宣写权限，宿主执行时复核）。
   */
  writes?: {
    bridgeVersion: number;
    annotations?: { write?: boolean };
    selection?: { write?: boolean };
    revisions?: { restore?: boolean; replay?: boolean };
    export?: { run?: boolean };
  };
  /** pack-result only: higher wins when multiple surfaces match. */
  priority?: number;
  capabilities?: Record<string, unknown>;
}

export interface PackUiActionDescriptor {
  id: string;
  label: string;
  source: 'pack';
  packId: string;
  surfaceId?: string;
}

export interface WorkSurfaceTab {
  /** `<surfaceId>` for singletons, `<surfaceId>#<ordinal>` for numbered instances. */
  id: string;
  surfaceId: string;
  ordinal?: number;
  title: string;
}

export interface WorkSurfaceState {
  tabs: WorkSurfaceTab[];
  activeId: string | null;
  /** Monotonic per-surface sequence; closing a tab never recycles its ordinal. */
  ordinalSeq?: Record<string, number>;
}

export interface WorkSurfaceOpenRequest {
  surfaceId: string;
  title?: string;
  /** Deterministic identity for numbered instances (e.g. a file path or job id). */
  instanceKey?: string;
}

export interface WorkSurfaceDiagnostic {
  packId: string;
  contribution: string;
  code: string;
  detail?: string;
}

export interface WorkSurfaceRegistry {
  surfaces: WorkSurfaceDescriptor[];
  uiActions: PackUiActionDescriptor[];
  diagnostics: WorkSurfaceDiagnostic[];
}

interface PersistedWorkSurfaceTab {
  id: string;
  surfaceId: string;
  ordinal?: number;
}

export interface PersistedWorkSurfaceState {
  version: 1;
  tabs: PersistedWorkSurfaceTab[];
  activeId: string | null;
}
