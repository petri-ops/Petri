// BLOCK-160 W2 P3（KNW-3）— 斜杠菜单动态数据源纯函数契约。
import { describe, expect, it } from 'vitest';
import {
  buildSkillEntries,
  buildTemplateEntries,
  filterSlashEntries,
  slashIntentTemplate,
  type SlashEntry,
} from './slashSources';

describe('slashSources（KNW-3 双来源斜杠菜单）', () => {
  it('buildSkillEntries：Skill → /<skill-id> 条目（label 带分类，description 兜底）', () => {
    const entries = buildSkillEntries([
      { id: 'deg-analysis-standard', name: '标准差异分析', description: '从计数矩阵到火山图', category: 'bioinformatics/ngs' },
      { id: 'x', name: 'X', description: '', category: 'coding' },
    ]);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ kind: 'skill', id: 'deg-analysis-standard' });
    expect(entries[0].label).toContain('bioinformatics/ngs');
    expect(entries[1].description).toBe('产品技能 x');
  });

  it('buildTemplateEntries：模板条目带可用性标注', () => {
    const entries = buildTemplateEntries([
      { id: 'deg-standard-pipeline', title: 'DEG 标准流程', description: 'd', available: true },
      { id: 'scrna', title: '单细胞', available: false },
    ]);
    expect(entries[0].label).toContain('可规划');
    expect(entries[1].label).toContain('部分工具未激活');
  });

  it('filterSlashEntries：label/id/description 大小写不敏感；空 query 全量', () => {
    const entries: SlashEntry[] = [
      { kind: 'action', id: 'new', label: '新建对话', description: '开始一个新对话' },
      { kind: 'skill', id: 'deg-analysis-standard', label: '标准差异分析', description: '从计数矩阵开始' },
      { kind: 'template', id: 'deg-standard-pipeline', label: 'DEG 流程', description: '标准模板' },
    ];
    expect(filterSlashEntries(entries, '')).toHaveLength(3);
    expect(filterSlashEntries(entries, 'deg').map((e) => e.id)).toEqual(['deg-analysis-standard', 'deg-standard-pipeline']);
    expect(filterSlashEntries(entries, 'DEG').length).toBe(2);
    expect(filterSlashEntries(entries, '新建')[0].kind).toBe('action');
  });

  it('slashIntentTemplate：skill=skill_get 手册模板；template=run_tool plan 模板；action=空', () => {
    const skill = slashIntentTemplate({ kind: 'skill', id: 'coding-playbook', label: '', description: '' });
    expect(skill).toContain('skill_get');
    expect(skill).toContain('coding-playbook');
    const tpl = slashIntentTemplate({ kind: 'template', id: 'deg-standard-pipeline', label: '', description: '' });
    expect(tpl).toContain('run_tool');
    expect(tpl).toContain('templateId="deg-standard-pipeline"');
    expect(slashIntentTemplate({ kind: 'action', id: 'new', label: '', description: '' })).toBe('');
  });
});
