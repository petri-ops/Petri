import { describe, expect, it } from 'vitest';
import { getWorkspaceFilePresentation } from './WorkspaceFileIcon';

describe('getWorkspaceFilePresentation', () => {
  it('distinguishes folders from files', () => {
    expect(getWorkspaceFilePresentation('results.csv', 'dir').kind).toBe('folder');
  });

  it.each([
    ['analysis.R', 'r'],
    ['pipeline.py', 'python'],
    ['matrix.csv', 'data'],
    ['cells.h5ad', 'data'],
    ['report.pdf', 'pdf'],
    ['figure.svg', 'image'],
    ['params.json', 'config'],
    ['README.md', 'markdown'],
    ['run.sh', 'shell'],
  ] as const)('classifies %s as %s', (name, kind) => {
    expect(getWorkspaceFilePresentation(name, 'file').kind).toBe(kind);
  });

  it('falls back to a quiet generic file icon', () => {
    expect(getWorkspaceFilePresentation('LICENSE', 'file')).toEqual({
      kind: 'generic',
      icon: 'file',
    });
  });
});
