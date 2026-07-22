import { describe, expect, it, afterEach } from 'vitest';
import {
  biof3Events,
  dispatchBioF3Event,
  subscribeBioF3Event,
  type ProjectOpenArtifactDetail,
  type ProjectOpenWorkspaceFileDetail,
  type ProjectWorkspaceChangedDetail,
} from './events';

afterEach(() => {
  // No explicit teardown needed — each subscription returns an unsubscribe.
});

describe('events typed bus', () => {
  it('projectOpenArtifact fires with the expected payload', () => {
    const received: ProjectOpenArtifactDetail[] = [];
    const unsub = subscribeBioF3Event(biof3Events.projectOpenArtifact, (detail) => {
      received.push(detail);
    });
    dispatchBioF3Event(biof3Events.projectOpenArtifact, {
      jobId: 'job-7',
      artifactName: 'deg.csv',
      projectId: 'proj-1',
    });
    expect(received).toEqual([
      { jobId: 'job-7', artifactName: 'deg.csv', projectId: 'proj-1' },
    ]);
    unsub();
  });

  it('projectOpenWorkspaceFile fires with the expected payload', () => {
    const received: ProjectOpenWorkspaceFileDetail[] = [];
    const unsub = subscribeBioF3Event(biof3Events.projectOpenWorkspaceFile, (detail) => {
      received.push(detail);
    });
    dispatchBioF3Event(biof3Events.projectOpenWorkspaceFile, {
      projectId: 'proj-1',
      relativePath: 'data/foo.csv',
      name: 'foo.csv',
    });
    expect(received).toEqual([
      {
        projectId: 'proj-1',
        relativePath: 'data/foo.csv',
        name: 'foo.csv',
      },
    ]);
    unsub();
  });

  it('unsubscribe stops further callbacks', () => {
    const calls: number[] = [];
    const unsub = subscribeBioF3Event(biof3Events.projectOpenArtifact, () => {
      calls.push(1);
    });
    dispatchBioF3Event(biof3Events.projectOpenArtifact, { jobId: 'j', artifactName: 'a' });
    unsub();
    dispatchBioF3Event(biof3Events.projectOpenArtifact, { jobId: 'j', artifactName: 'a' });
    expect(calls).toHaveLength(1);
  });

  it('projectWorkspaceChanged carries project scope and source', () => {
    const received: ProjectWorkspaceChangedDetail[] = [];
    const unsub = subscribeBioF3Event(biof3Events.projectWorkspaceChanged, (detail) => {
      received.push(detail);
    });
    dispatchBioF3Event(biof3Events.projectWorkspaceChanged, {
      projectId: 'proj-1',
      source: 'agent',
    });
    expect(received).toEqual([{ projectId: 'proj-1', source: 'agent' }]);
    unsub();
  });

  it('exposes biof3Events constants', () => {
    expect(biof3Events.projectOpenArtifact).toBe('biof3:project-open-artifact');
    expect(biof3Events.projectOpenWorkspaceFile).toBe('biof3:project-open-workspace-file');
    expect(biof3Events.projectWorkspaceChanged).toBe('biof3:project-workspace-changed');
  });
});
