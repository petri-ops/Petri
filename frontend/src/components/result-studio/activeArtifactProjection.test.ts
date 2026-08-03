import { describe, expect, it } from 'vitest';

import type { ArtifactSelection } from '@/lib/artifact-selection';
import {
  isSameActiveArtifactProjection,
  type ActiveArtifactProjection,
} from './activeArtifactProjection';

function selection(overrides: Partial<ArtifactSelection> = {}): ArtifactSelection {
  return {
    contractVersion: 1,
    artifactId: 'deg_table',
    revisionId: 'rev_1',
    entityType: 'gene',
    origin: 'row_select',
    entityIds: ['TP53'],
    entityIdCount: 1,
    entityIdsTruncated: false,
    entityIdsHash: 'gene-set-a',
    filterHash: null,
    fields: [],
    filterExpression: null,
    sort: [],
    region: null,
    durable: true,
    createdAt: '2026-07-30T00:00:00.000Z',
    selectionId: 'sel_1',
    compatibility: 'compatible',
    ...overrides,
  };
}

function projection(overrides: Partial<ActiveArtifactProjection> = {}): ActiveArtifactProjection {
  return {
    jobId: 'job_1',
    toolId: 'deseq2',
    name: 'deg_table.csv',
    type: 'table',
    label: 'DEG',
    url: '/api/tools/file/job_1/deg_table.csv',
    revisionId: 'rev_1',
    revisionOrdinal: 1,
    artifactFamilyId: 'family_1',
    semanticKind: 'table',
    entityType: 'gene',
    idField: 'gene',
    selectionDurable: true,
    interactionCapabilities: ['row_select', 'filter'],
    selection: selection(),
    selectionId: 'sel_1',
    truthStatus: 'valid',
    conclusion: 'A conclusion',
    availabilityStatus: 'available',
    availabilityReason: null,
    ...overrides,
  };
}

describe('active artifact projection equality', () => {
  it('treats a late null-to-family hydration as a new projection', () => {
    const before = projection({ artifactFamilyId: null });
    const hydrated = projection({ artifactFamilyId: 'family_1' });

    expect(isSameActiveArtifactProjection(before, hydrated)).toBe(false);
  });

  it.each([
    ['job', { jobId: 'job_2' }],
    ['name', { name: 'volcano.png' }],
    ['revision', { revisionId: 'rev_2' }],
    ['revision ordinal', { revisionOrdinal: 2 }],
    ['artifact family', { artifactFamilyId: 'family_2' }],
    ['entity', { entityType: 'pathway' }],
    ['stable id field', { idField: 'ID' }],
    ['truth', { truthStatus: 'degraded' as const }],
    ['conclusion', { conclusion: 'A different conclusion' }],
    ['availability', { availabilityStatus: 'unavailable' as const }],
    ['availability reason', { availabilityReason: 'file missing' }],
    ['selection id', { selectionId: 'sel_2' }],
  ])('detects a changed %s projection', (_label, changed) => {
    expect(isSameActiveArtifactProjection(projection(), projection(changed))).toBe(false);
  });

  it('detects selection metadata used by the Agent context projection', () => {
    const changed = selection({
      compatibility: 'stale',
      sort: [{ field: 'padj', direction: 'asc' }],
    });

    expect(isSameActiveArtifactProjection(
      projection(),
      projection({ selection: changed }),
    )).toBe(false);
  });

  it('normalizes optional nullish values and capability order', () => {
    const left = projection({
      artifactFamilyId: undefined,
      conclusion: undefined,
      interactionCapabilities: ['filter', 'row_select'],
      selection: null,
      selectionId: undefined,
    });
    const right = projection({
      artifactFamilyId: null,
      conclusion: null,
      interactionCapabilities: ['row_select', 'filter'],
      selection: undefined,
      selectionId: null,
    });

    expect(isSameActiveArtifactProjection(left, right)).toBe(true);
  });
});
