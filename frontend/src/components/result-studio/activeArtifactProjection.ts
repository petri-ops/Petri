import {
  isSameSelection,
  type ArtifactSelection,
  type InteractionCapability,
} from '@/lib/artifact-selection';
import type { ResultArtifactKind } from '@/lib/result-manifest';

export interface ActiveArtifactProjection {
  jobId: string;
  toolId: string;
  name: string;
  type: string;
  label?: string;
  url?: string;
  revisionId?: string | null;
  revisionOrdinal?: number | null;
  artifactFamilyId?: string | null;
  semanticKind?: ResultArtifactKind;
  entityType?: string | null;
  idField?: string | null;
  selectionDurable?: boolean;
  interactionCapabilities?: InteractionCapability[];
  selection?: ArtifactSelection | null;
  selectionId?: string | null;
  truthStatus?: 'valid' | 'degraded' | 'blocked' | null;
  conclusion?: string | null;
}

function sameCapabilities(
  left: InteractionCapability[] | undefined,
  right: InteractionCapability[] | undefined,
): boolean {
  const leftValues = [...(left || [])].sort();
  const rightValues = [...(right || [])].sort();
  return leftValues.length === rightValues.length
    && leftValues.every((value, index) => value === rightValues[index]);
}

function sameSelectionProjection(
  left: ArtifactSelection | null | undefined,
  right: ArtifactSelection | null | undefined,
): boolean {
  const normalizedLeft = left ?? null;
  const normalizedRight = right ?? null;
  if (!isSameSelection(normalizedLeft, normalizedRight)) return false;
  if (!normalizedLeft || !normalizedRight) return true;
  return normalizedLeft.contractVersion === normalizedRight.contractVersion
    && normalizedLeft.entityType === normalizedRight.entityType
    && normalizedLeft.entityIdsTruncated === normalizedRight.entityIdsTruncated
    && (normalizedLeft.filterHash ?? null) === (normalizedRight.filterHash ?? null)
    && JSON.stringify(normalizedLeft.sort) === JSON.stringify(normalizedRight.sort)
    && JSON.stringify(normalizedLeft.region) === JSON.stringify(normalizedRight.region)
    && normalizedLeft.durable === normalizedRight.durable
    && normalizedLeft.createdAt === normalizedRight.createdAt
    && (normalizedLeft.selectionId ?? null) === (normalizedRight.selectionId ?? null)
    && (normalizedLeft.compatibility ?? null) === (normalizedRight.compatibility ?? null);
}

/**
 * Equality for the complete artifact identity projected from ResultArtifactShell.
 * Async interaction data may hydrate after the file body, so every projected
 * field that downstream context or navigation consumes must participate.
 */
export function isSameActiveArtifactProjection(
  left: ActiveArtifactProjection | null,
  right: ActiveArtifactProjection | null,
): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return left.jobId === right.jobId
    && left.toolId === right.toolId
    && left.name === right.name
    && left.type === right.type
    && (left.label ?? null) === (right.label ?? null)
    && (left.url ?? null) === (right.url ?? null)
    && (left.revisionId ?? null) === (right.revisionId ?? null)
    && (left.revisionOrdinal ?? null) === (right.revisionOrdinal ?? null)
    && (left.artifactFamilyId ?? null) === (right.artifactFamilyId ?? null)
    && (left.semanticKind ?? null) === (right.semanticKind ?? null)
    && (left.entityType ?? null) === (right.entityType ?? null)
    && (left.idField ?? null) === (right.idField ?? null)
    && (left.selectionDurable ?? false) === (right.selectionDurable ?? false)
    && sameCapabilities(left.interactionCapabilities, right.interactionCapabilities)
    && (left.selectionId ?? null) === (right.selectionId ?? null)
    && (left.truthStatus ?? null) === (right.truthStatus ?? null)
    && (left.conclusion ?? null) === (right.conclusion ?? null)
    && sameSelectionProjection(left.selection, right.selection);
}
