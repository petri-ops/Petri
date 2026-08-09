import { describe, expect, it } from 'vitest';
import {
  buildResultArtifactPickerGroups,
  filterResultArtifactRelatedSections,
  findResultArtifactPickerOption,
  groupResultArtifacts,
  isRelatedArtifactKind,
} from './result-artifact-display';

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

  it('builds one compact option per scientific result while retaining manifest groups', () => {
    const groups = buildResultArtifactPickerGroups([
      {
        id: 'plots',
        label: '图表',
        description: '主要图表',
        artifactNames: ['volcano.png', 'volcano.svg', 'heatmap.png'],
        artifacts: [
          { name: 'volcano.png', label: '火山图' },
          { name: 'volcano.svg', label: '火山图' },
          { name: 'heatmap.png', label: '热图' },
        ],
        kind: 'plot',
      },
      {
        id: 'tables',
        label: '表格',
        artifactNames: ['deg.csv'],
        artifacts: [{ name: 'deg.csv', label: '差异基因' }],
        kind: 'table',
      },
    ]);

    expect(groups.map((group) => [group.id, group.options.length])).toEqual([
      ['plots', 2],
      ['tables', 1],
    ]);
    expect(groups[0].options[0].primary.name).toBe('volcano.png');
  });

  it('maps a secondary format back to the primary picker option', () => {
    const groups = buildResultArtifactPickerGroups([
      {
        id: 'plots',
        label: '图表',
        artifactNames: ['volcano.png', 'volcano.svg'],
        artifacts: [{ name: 'volcano.png' }, { name: 'volcano.svg' }],
        kind: 'plot',
      },
    ]);

    expect(findResultArtifactPickerOption(groups, 'volcano.svg')).toMatchObject({
      sectionId: 'plots',
      option: { primary: { name: 'volcano.png' } },
    });
    expect(findResultArtifactPickerOption(groups, 'missing.png')).toBeNull();
  });

  it('keeps related files out of the primary picker and removes duplicate artifact names', () => {
    const groups = buildResultArtifactPickerGroups([
      {
        id: 'mixed',
        label: '结果',
        artifactNames: ['volcano.png', 'matrix.rds', 'volcano.png'],
        artifacts: [
          { name: 'volcano.png' },
          { name: 'matrix.rds' },
          { name: 'volcano.png' },
        ],
        kind: 'mixed',
      },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].options.map((option) => option.primary.name)).toEqual(['volcano.png']);
    expect(buildResultArtifactPickerGroups([])).toEqual([]);
  });

  it('can promote related files when a job has no primary scientific result', () => {
    const sections = [{
      id: 'data',
      label: '数据',
      artifactNames: ['matrix.rds'],
      artifacts: [{ name: 'matrix.rds' }],
      kind: 'data' as const,
    }];
    expect(buildResultArtifactPickerGroups(sections)).toEqual([]);
    expect(buildResultArtifactPickerGroups(sections, { includeRelated: true })[0].options)
      .toHaveLength(1);
  });

  it('absorbs cross-section PDF variants and removes them from related files', () => {
    const plotSection = {
      id: 'plots',
      label: '图表',
      artifactNames: ['volcano.png'],
      artifacts: [{ name: 'volcano.png' }],
      kind: 'plot' as const,
    };
    const relatedSection = {
      id: 'files',
      label: '相关文件',
      artifactNames: ['volcano.pdf', 'matrix.rds'],
      artifacts: [{ name: 'volcano.pdf' }, { name: 'matrix.rds' }],
      kind: 'file' as const,
    };
    const groups = buildResultArtifactPickerGroups([plotSection], {
      allArtifacts: [...plotSection.artifacts, ...relatedSection.artifacts],
    });
    expect(groups[0].options[0].variants.map((artifact) => artifact.name))
      .toEqual(['volcano.pdf', 'volcano.png']);
    expect(filterResultArtifactRelatedSections([relatedSection], groups)[0].artifactNames)
      .toEqual(['matrix.rds']);
  });
});
