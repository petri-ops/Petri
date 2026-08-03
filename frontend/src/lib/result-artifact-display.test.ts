import { describe, expect, it } from 'vitest';
import { groupResultArtifacts, isRelatedArtifactKind } from './result-artifact-display';

describe('result-artifact-display', () => {
  it('groups plot format variants and prefers PNG', () => {
    const groups = groupResultArtifacts([
      { name: 'volcano.svg' },
      { name: 'volcano.pdf' },
      { name: 'volcano.png' },
      { name: 'heatmap.png' },
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0].primary.name).toBe('volcano.png');
    expect(groups[0].variants.map((item) => item.name)).toEqual(['volcano.pdf', 'volcano.png', 'volcano.svg']);
  });

  it('does not merge non-plot files with a shared stem', () => {
    const groups = groupResultArtifacts([{ name: 'counts.png' }, { name: 'counts.csv' }]);
    expect(groups).toHaveLength(2);
  });

  it('marks data and unknown files as related artifacts', () => {
    expect(isRelatedArtifactKind('data')).toBe(true);
    expect(isRelatedArtifactKind('file')).toBe(true);
    expect(isRelatedArtifactKind('plot')).toBe(false);
  });
});
