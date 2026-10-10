import { describe, expect, it, afterEach } from 'vitest';
import {
  petriEvents,
  dispatchPetriEvent,
  subscribePetriEvent,
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
    const unsub = subscribePetriEvent(petriEvents.projectOpenArtifact, (detail) => {
      received.push(detail);
    });
    dispatchPetriEvent(petriEvents.projectOpenArtifact, {
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
    const unsub = subscribePetriEvent(petriEvents.projectOpenWorkspaceFile, (detail) => {
      received.push(detail);
    });
    dispatchPetriEvent(petriEvents.projectOpenWorkspaceFile, {
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
    const unsub = subscribePetriEvent(petriEvents.projectOpenArtifact, () => {
      calls.push(1);
    });
    dispatchPetriEvent(petriEvents.projectOpenArtifact, { jobId: 'j', artifactName: 'a' });
    unsub();
    dispatchPetriEvent(petriEvents.projectOpenArtifact, { jobId: 'j', artifactName: 'a' });
    expect(calls).toHaveLength(1);
  });

  it('projectWorkspaceChanged carries project scope and source', () => {
    const received: ProjectWorkspaceChangedDetail[] = [];
    const unsub = subscribePetriEvent(petriEvents.projectWorkspaceChanged, (detail) => {
      received.push(detail);
    });
    dispatchPetriEvent(petriEvents.projectWorkspaceChanged, {
      projectId: 'proj-1',
      source: 'agent',
    });
    expect(received).toEqual([{ projectId: 'proj-1', source: 'agent' }]);
    unsub();
  });

  it('exposes petriEvents constants', () => {
    expect(petriEvents.projectOpenArtifact).toBe('petri:project-open-artifact');
    expect(petriEvents.projectOpenWorkspaceFile).toBe('petri:project-open-workspace-file');
    expect(petriEvents.projectWorkspaceChanged).toBe('petri:project-workspace-changed');
  });
});
