import type { ArtifactRevision, ResultStudioChangeSet } from './resultStudioClient';

export type ResultVersionRole = 'original' | 'current' | 'candidate' | 'history';

/**
 * Classify a Revision from persisted Revision + ChangeSet truth. Roles may
 * overlap: the original baseline can still be current, and a candidate can be
 * the Revision the user is viewing without becoming current.
 */
export function resultVersionRoles(
  revision: ArtifactRevision,
  changeSet: ResultStudioChangeSet | null | undefined,
): ResultVersionRole[] {
  const roles: ResultVersionRole[] = [];
  if (changeSet?.intentRef?.startsWith('baseline:')) roles.push('original');
  if (revision.isCurrent) roles.push('current');
  if (changeSet?.status === 'preview_ready') roles.push('candidate');
  if (!roles.includes('current') && !roles.includes('candidate')) roles.push('history');
  return roles;
}

const LABEL: Record<ResultVersionRole, string> = {
  original: '原始版本',
  current: '当前正式版本',
  candidate: '待采用候选',
  history: '历史版本',
};

export function resultVersionRoleLabel(roles: readonly ResultVersionRole[]): string {
  return roles.map((role) => LABEL[role]).join(' · ');
}
