import { describe, expect, it, afterEach } from 'vitest';
import {
  gewuEvents,
  dispatchGewuEvent,
  subscribeGewuEvent,
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
    const unsub = subscribeGewuEvent(gewuEvents.projectOpenArtifact, (detail) => {
      received.push(detail);
    });
    dispatchGewuEvent(gewuEvents.projectOpenArtifact, {
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
    const unsub = subscribeGewuEvent(gewuEvents.projectOpenWorkspaceFile, (detail) => {
      received.push(detail);
    });
    dispatchGewuEvent(gewuEvents.projectOpenWorkspaceFile, {
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
    const unsub = subscribeGewuEvent(gewuEvents.projectOpenArtifact, () => {
      calls.push(1);
    });
    dispatchGewuEvent(gewuEvents.projectOpenArtifact, { jobId: 'j', artifactName: 'a' });
    unsub();
    dispatchGewuEvent(gewuEvents.projectOpenArtifact, { jobId: 'j', artifactName: 'a' });
    expect(calls).toHaveLength(1);
  });

  it('projectWorkspaceChanged carries project scope and source', () => {
    const received: ProjectWorkspaceChangedDetail[] = [];
    const unsub = subscribeGewuEvent(gewuEvents.projectWorkspaceChanged, (detail) => {
      received.push(detail);
    });
    dispatchGewuEvent(gewuEvents.projectWorkspaceChanged, {
      projectId: 'proj-1',
      source: 'agent',
    });
    expect(received).toEqual([{ projectId: 'proj-1', source: 'agent' }]);
    unsub();
  });

  it('exposes gewuEvents constants', () => {
    expect(gewuEvents.projectOpenArtifact).toBe('gewu:project-open-artifact');
    expect(gewuEvents.projectOpenWorkspaceFile).toBe('gewu:project-open-workspace-file');
    expect(gewuEvents.projectWorkspaceChanged).toBe('gewu:project-workspace-changed');
  });
});
