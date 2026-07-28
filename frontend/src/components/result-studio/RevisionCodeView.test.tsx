import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RevisionCodeView } from './RevisionCodeView';
import type { RevisionSourceProjection } from './resultStudioClient';

const client = vi.hoisted(() => ({
  fetchRevisionSource: vi.fn(),
  preflightRevisionReplay: vi.fn(),
  confirmRevisionReplay: vi.fn(),
}));
vi.mock('./resultStudioClient', async () => {
  const actual = await vi.importActual<typeof import('./resultStudioClient')>('./resultStudioClient');
  return { ...actual, ...client };
});

function projection(revisionId: string, content = `print('${revisionId}')\n`): RevisionSourceProjection {
  return {
    revisionId,
    artifactId: 'plot',
    revisionOrdinal: revisionId === 'rev_2' ? 2 : 1,
    relativePath: 'analysis/scripts/family/plot.R',
    entryPoint: 'plot.R',
    language: 'r',
    origin: 'project_materialized',
    rendererId: 'volcano-plot:plot',
    scope: 'artifact_specific_materialization',
    content,
    sha256: 'a'.repeat(64),
    openableRelativePath: null,
    parameters: { relativePath: 'analysis/scripts/family/parameters.json', sha256: 'b'.repeat(64), values: { alpha: 0.05 } },
    reproduction: {
      status: 'available', requiresConfirmation: true, replayable: true, inputDrift: [],
      inputs: [], runtime: { name: 'R', version: '4.5.2', readiness: true },
      plugin: { id: 'volcano-plot', version: '1', language: 'r', packageConstraints: {} },
    },
  };
}

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('P4R-5 RevisionCodeView', () => {
  it('loads the exact revision and copies/downloads the same complete bytes', async () => {
    client.fetchRevisionSource.mockResolvedValue(projection('rev_2', 'line1\nline2\n'));
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const createObjectURL = vi.fn(() => 'blob:code');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
    render(<RevisionCodeView projectId="p_1" revisionId="rev_2" />);
    expect(await screen.findByText('plot.R · v2')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '复制' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('line1\nline2\n'));
    fireEvent.click(screen.getByRole('button', { name: '下载' }));
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
  });

  it('never lets a late source response for an old Revision replace the selected one', async () => {
    let resolveOne!: (value: RevisionSourceProjection) => void;
    let resolveTwo!: (value: RevisionSourceProjection) => void;
    client.fetchRevisionSource
      .mockReturnValueOnce(new Promise<RevisionSourceProjection>((resolve) => { resolveOne = resolve; }))
      .mockReturnValueOnce(new Promise<RevisionSourceProjection>((resolve) => { resolveTwo = resolve; }));
    const { rerender } = render(<RevisionCodeView projectId="p_1" revisionId="rev_1" />);
    rerender(<RevisionCodeView projectId="p_1" revisionId="rev_2" />);
    resolveTwo(projection('rev_2', 'new revision\n'));
    expect(await screen.findByText('plot.R · v2')).toBeTruthy();
    resolveOne(projection('rev_1', 'old revision\n'));
    await waitFor(() => expect(screen.getByText('new revision')).toBeTruthy());
    expect(screen.queryByText('old revision')).toBeNull();
  });

  it('blocks actions when the source projection is unavailable', async () => {
    client.fetchRevisionSource.mockRejectedValue({ code: 'source_hash_mismatch', message: '代码 hash 与 Revision 不一致' });
    const agent = vi.fn();
    render(<RevisionCodeView projectId="p_1" revisionId="rev_1" onAgentRequest={agent} />);
    expect(await screen.findByText('代码不可用')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '复制' })).toBeNull();
    expect(screen.queryByRole('button', { name: '下载' })).toBeNull();
    expect(agent).not.toHaveBeenCalled();
  });

  it('preflights and explicitly confirms a controlled replay without adopting it', async () => {
    client.fetchRevisionSource.mockResolvedValue(projection('rev_2'));
    client.preflightRevisionReplay.mockResolvedValue({
      ok: true,
      controlledReplayVersion: 1,
      status: 'confirmation_required',
      confirmationToken: 'rrc_token',
      expiresAt: Date.now() + 60_000,
      fingerprint: 'f'.repeat(64),
      revision: {
        revisionId: 'rev_2', artifactId: 'plot', revisionOrdinal: 2,
        sourceSha256: 'a'.repeat(64), parametersHash: 'b'.repeat(64), inputCount: 1,
      },
      execution: {
        toolId: 'volcano-plot', pluginVersion: '1.0.0',
        runtime: { name: 'R', version: '4.5.2', readiness: true },
        createsToolJob: true, createsCandidateRevision: true,
        adoptsCandidate: false, mutatesCurrentRevision: false,
        acceptsWorkflowPlan: false, acceptsShell: false,
      },
    });
    const replayResult = {
      ok: true as const, controlledReplayVersion: 1, status: 'preview_ready' as const,
      replayFingerprint: 'f'.repeat(64), changeSetId: 'cs_2', toolJobId: 'job_2',
      revisionId: 'rev_3', parentRevisionId: 'rev_2', adopted: false as const, idempotent: false,
    };
    client.confirmRevisionReplay.mockResolvedValue(replayResult);
    const created = vi.fn();
    render(
      <RevisionCodeView
        projectId="p_1"
        revisionId="rev_2"
        replayContext={{ conversationId: 'conv_1', contextToken: 'c'.repeat(64) }}
        onReplayCreated={created}
      />,
    );
    expect(await screen.findByText('plot.R · v2')).toBeTruthy();
    fireEvent.click(screen.getByText('交给 Agent'));
    fireEvent.click(screen.getByRole('button', { name: '受控重放' }));
    expect(await screen.findByText('确认创建新的复现候选？')).toBeTruthy();
    expect(client.preflightRevisionReplay).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'p_1', revisionId: 'rev_2', contextToken: 'c'.repeat(64),
      expectedSourceSha256: 'a'.repeat(64), expectedParametersHash: 'b'.repeat(64),
    }));
    fireEvent.click(screen.getByRole('button', { name: '确认受控重放' }));
    await waitFor(() => expect(created).toHaveBeenCalledWith(replayResult));
    expect(client.confirmRevisionReplay).toHaveBeenCalledWith(expect.objectContaining({
      confirmationToken: 'rrc_token', revisionId: 'rev_2', contextToken: 'c'.repeat(64),
    }));
    expect(screen.getByText(/新候选版本已就绪/)).toBeTruthy();
  });
});
