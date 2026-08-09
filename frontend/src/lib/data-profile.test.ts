import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildFirstAnalysisPrompt,
  deriveDataReadiness,
  importProjectData,
  profileProjectData,
  type ImportedDataFile,
} from '@/lib/data-profile';

vi.mock('@/lib/authClient', () => ({
  getApiPrefix: () => '/api',
  getToken: () => 'test-token',
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function imported(
  name: string,
  candidates: Array<[string, number]>,
  blocked = false,
): ImportedDataFile {
  const isCounts = candidates.some(([candidate]) => candidate === 'counts_matrix');
  const isMetadata = candidates.some(([candidate]) => candidate === 'sample_metadata');
  const headers = isCounts ? ['gene', 'S1', 'S2'] : isMetadata ? ['sample', 'group'] : ['id', 'value'];
  const dataRows = isMetadata ? [['S1', 'control'], ['S2', 'case']] : [['G1', '1', '2'], ['G2', '3', '4']];
  return {
    name,
    relativePath: `data/${name}`,
    size: 100,
    profile: {
      status: blocked ? 'blocked' : 'ok',
      blocked,
      snapshot: {
        projectId: 'p1',
        relativePath: `data/${name}`,
        size: 100,
        modifiedAt: 1,
        sha256: 'a'.repeat(64),
        encoding: 'utf-8',
        delimiter: ',',
      },
      observation: {
        headers,
        sample: {
          rows: [headers, ...dataRows],
          dataRows,
          rowCount: 3,
          totalRowCount: 3,
          dataRowCount: 2,
          columnCount: headers.length,
          bounds: {
            rows: { observed: 3, truncated: false },
            columns: { observed: headers.length, truncated: false },
          },
        },
        totalRowCount: 3,
        sampleRowCount: 2,
        columnBounds: { observed: 3 },
        fileRoleCandidates: candidates.map(([candidate, confidence]) => ({
          candidate,
          confidence,
          evidence: { bounded: true },
          basis: 'fixture',
        })),
      },
      diagnostics: blocked ? [{ code: 'empty_file', severity: 'blocked', message: 'empty' }] : [],
      diagnosticCodes: blocked ? ['empty_file'] : [],
    },
  };
}

describe('SDC1-A data readiness', () => {
  it('requires distinct actionable counts and metadata candidates', () => {
    const counts = imported('counts.csv', [['counts_matrix', 0.91]]);
    const metadata = imported('metadata.csv', [['sample_metadata', 0.88]]);
    const readiness = deriveDataReadiness([counts, metadata]);
    expect(readiness.status).toBe('ready');
    expect(readiness.ready).toBe(true);
    expect(readiness.countsMatrix?.file).toBe(counts);
    expect(readiness.sampleMetadata?.file).toBe(metadata);
  });

  it('rejects candidates below threshold and profiles that are blocked', () => {
    expect(deriveDataReadiness([imported('matrix.csv', [['counts_matrix', 0.69]])]).status).toBe('blocked');
    const readiness = deriveDataReadiness([imported('bad.csv', [['counts_matrix', 0.99]], true)]);
    expect(readiness.status).toBe('blocked');
    expect(readiness.issues.map((issue) => issue.code)).toContain('blocked_profile');
  });

  it('reports ambiguous duplicate role candidates instead of using score as a tie-breaker', () => {
    const readiness = deriveDataReadiness([
      imported('counts-a.csv', [['counts_matrix', 0.91]]),
      imported('counts-b.csv', [['counts_matrix', 0.88]]),
      imported('metadata.csv', [['sample_metadata', 0.88]]),
    ]);
    expect(readiness.status).toBe('ambiguous');
    expect(readiness.ambiguous).toBe(true);
    expect(readiness.issues.map((issue) => issue.code)).toContain('ambiguous_counts_matrix');
    expect(readiness.issues.find((issue) => issue.code === 'ambiguous_counts_matrix')?.relativePaths)
      .toEqual(['data/counts-a.csv', 'data/counts-b.csv']);
  });

  it('rejects a single file being selected for both roles', () => {
    const readiness = deriveDataReadiness([
      imported('one.csv', [['counts_matrix', 0.91], ['sample_metadata', 0.88]]),
    ]);
    expect(readiness.status).toBe('blocked');
    expect(readiness.ready).toBe(false);
    expect(readiness.issues.map((issue) => issue.code)).toContain('same_file_for_roles');
  });

  it('blocks mismatched or duplicate sample identities', () => {
    const counts = imported('counts.csv', [['counts_matrix', 0.91]]);
    const mismatched = imported('metadata.csv', [['sample_metadata', 0.88]]);
    mismatched.profile.observation.sample!.dataRows = [['S1', 'control'], ['S3', 'case']];
    expect(deriveDataReadiness([counts, mismatched]).issues.map((issue) => issue.code))
      .toContain('sample_id_mismatch');

    const duplicated = imported('metadata.csv', [['sample_metadata', 0.88]]);
    duplicated.profile.observation.sample!.dataRows = [['S1', 'control'], ['S1', 'case']];
    expect(deriveDataReadiness([counts, duplicated]).issues.map((issue) => issue.code))
      .toContain('duplicate_sample_id');
  });

  it('blocks sample identity checks when the bounded profile is truncated', () => {
    const counts = imported('counts.csv', [['counts_matrix', 0.91]]);
    const metadata = imported('metadata.csv', [['sample_metadata', 0.88]]);
    metadata.profile.observation.sample!.bounds!.rows!.truncated = true;
    expect(deriveDataReadiness([counts, metadata]).issues.map((issue) => issue.code))
      .toContain('sample_identity_unverifiable');
  });
});

describe('SDC1-A data profile requests', () => {
  it('sends multipart import with auth and returns imported profiles', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      imported: [imported('counts.csv', [['counts_matrix', 0.91]])],
    }), { status: 201, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const file = new File(['gene,S1\nG1,1\n'], 'counts.csv', { type: 'text/csv' });
    const result = await importProjectData('project / 1', [file]);
    expect(result).toHaveLength(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/workspaces/project%20%2F%201/import');
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-token');
    expect((init.headers as Record<string, string>)['Content-Type']).toBeUndefined();
    expect(init.body).toBeInstanceOf(FormData);
  });

  it('sends JSON profile paths and safely surfaces non-JSON errors', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, profiles: [imported('counts.csv', [['counts_matrix', 0.91]]).profile] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response('gateway unavailable', { status: 502 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(profileProjectData('p1', ['data/counts.csv'])).resolves.toHaveLength(1);
    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)).toEqual({ paths: ['data/counts.csv'] });
    await expect(profileProjectData('p1', ['data/counts.csv'])).rejects.toThrow('gateway unavailable');
  });
});

describe('SDC1-A bounded Agent handoff', () => {
  it('includes relative paths, hashes, bounded dimensions, candidates, and explicit guardrails', () => {
    const counts = imported('counts.csv', [['counts_matrix', 0.91]]);
    const metadata = imported('metadata.csv', [['sample_metadata', 0.88]]);
    const readiness = deriveDataReadiness([counts, metadata]);
    const prompt = buildFirstAnalysisPrompt(readiness, [counts, metadata]);
    expect(prompt).toContain('data/counts.csv');
    expect(prompt).toContain('data/metadata.csv');
    expect(prompt).toContain(`sha256=${'a'.repeat(64)}`);
    expect(prompt).toContain('data rows 2');
    expect(prompt).toContain('counts_matrix (0.910)');
    expect(prompt).toContain('不要推断或擅自决定 contrast、control、batch');
    expect(prompt).toContain('confirmation → run_tool → ToolJob → Artifact Truth');
    expect(prompt).not.toContain('G1,10,12');
    expect(prompt).not.toContain('/Users/');
  });

  it('does not build a handoff from a blocked or ambiguous readiness state', () => {
    const readiness = deriveDataReadiness([imported('counts.csv', [['counts_matrix', 0.91]])]);
    expect(() => buildFirstAnalysisPrompt(readiness)).toThrow('data_not_ready');
  });
});
