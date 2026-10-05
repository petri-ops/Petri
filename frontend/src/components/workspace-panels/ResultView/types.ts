// ============================================================
// ResultView — shared types
//
// Extracted from src/components/workspace-panels/ResultView.tsx
// by BLOCK-9.2 PHASE 2. Original location: lines 151-227.
//
// Contains:
//   - 2 exported interfaces: ActiveArtifact (UI-146 multi-consumer)
//     + JobStats
//   - 4 private types: JobResultFile / DeliveryManifestSummary /
//     JobResult / JobDetailMeta (only used by ResultArtifactShell)
//
// Re-export compatibility:
//   `ResultView.tsx` keeps `export type { ActiveArtifact, JobStats }`
//   re-export so CenterPanel.tsx and project-workspace.tsx (which
//   itself re-exports) keep importing from `@/components/workspace-panels/ResultView`.
// ============================================================

import type { ResultArtifactKind } from '@/lib/result-manifest';
import type { ArtifactSelection, InteractionCapability } from '@/lib/artifact-selection';

export interface ActiveArtifact {
  jobId: string;
  toolId: string;
  name: string;
  type: string;
  label?: string;
  url?: string;
  revisionId?: string | null;
  /**
   * 1-based ordinal within the artifact family, for showing a real "v2"
   * instead of a truncated Revision ID. The interaction endpoint already
   * returns it on `revision` (routes/result-studio.js:559); the client used
   * to read only `manifest` and discard it.
   */
  revisionOrdinal?: number | null;
  artifactFamilyId?: string | null;
  /**
   * BLOCK-141 R-5 — viewer interaction manifest 的 artifactId（后端库记录 id，
   * 前端不可由 jobId+name 合成）。D2 注入归属校验的可比来源：选择总线的
   * artifactId 与本字段同源才可注入当前 artifact 的 Agent 上下文。交互清单
   * 未绑定（产物不支持交互）时为 null——此时不启用归属校验，维持 BLOCK-139
   * 既有注入契约。
   */
  artifactId?: string | null;
  semanticKind?: ResultArtifactKind;
  entityType?: string | null;
  idField?: string | null;
  selectionDurable?: boolean;
  interactionCapabilities?: InteractionCapability[];
  selection?: ArtifactSelection | null;
  selectionId?: string | null;
  truthStatus?: 'valid' | 'degraded' | 'blocked' | null;
  conclusion?: string | null;
  availabilityStatus?: 'checking' | 'available' | 'unavailable';
  availabilityReason?: string | null;
}

export interface JobStats {
  running: number;
  failed: number;
  done: number;
  pending: number;
}

export interface JobResultFile {
  name: string;
  type: string;
  label?: string;
  title?: string;
  filename?: string;
  url?: string;
  preview?: boolean;
  download?: boolean;
}

export interface DeliveryManifestSummary {
  status: 'valid' | 'degraded' | 'blocked';
  manifestHash?: string;
  artifacts?: Array<{ reproducibility?: { status?: 'available' | 'verified' | 'unavailable' } }>;
  summary?: {
    conclusion?: string;
    whatWasDone?: string;
    cautions?: string[];
  };
}

export interface JobResult {
  artifacts?: JobResultFile[];
  files?: JobResultFile[];
  tool?: {
    id?: string;
    version?: string | null;
    language?: string | null;
  };
  outputs?: unknown;
  manifest?: unknown;
  stdout?: string;
  summary?: unknown;
  deliveryManifest?: DeliveryManifestSummary;
}

export interface JobDetailMeta {
  params?: Record<string, unknown>;
  ackStatus?: string | null;
  projectId?: string | null;
}
