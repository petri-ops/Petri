import { describe, expect, it } from 'vitest';
import { resultVersionRoleLabel, resultVersionRoles } from './resultVersionRole';
import type { ArtifactRevision, ResultStudioChangeSet } from './resultStudioClient';

const revision = { revisionId: 'rev_1', isCurrent: false } as ArtifactRevision;
const changeSet = { status: 'adopted', intentRef: null } as ResultStudioChangeSet;

describe('resultVersionRoles', () => {
  it('keeps original and current as independent persisted roles', () => {
    const roles = resultVersionRoles(
      { ...revision, isCurrent: true },
      { ...changeSet, intentRef: 'baseline:job:plot' },
    );
    expect(roles).toEqual(['original', 'current']);
    expect(resultVersionRoleLabel(roles)).toBe('原始版本 · 当前正式版本');
  });

  it('labels preview_ready as candidate without calling it current', () => {
    expect(resultVersionRoles(revision, { ...changeSet, status: 'preview_ready' })).toEqual(['candidate']);
  });

  it('labels settled and reverted non-current revisions as history', () => {
    expect(resultVersionRoles(revision, changeSet)).toEqual(['history']);
    expect(resultVersionRoles(revision, { ...changeSet, status: 'reverted' })).toEqual(['history']);
  });
});
