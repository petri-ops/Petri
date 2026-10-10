/**
 * BLOCK-156 D2 — 扩展中心货架分类学单测。
 * 钉住：前缀匹配规则（含边界）/ 未知 category 回落通用 / tab 值域守卫。
 */

import { describe, expect, it } from 'vitest';
import {
  EXTENSION_SHELVES,
  classifySkillShelf,
  isExtensionShelfId,
} from './extensionShelves';

describe('BLOCK-156 extensionShelves 分类学', () => {
  it('bioinformatics 前缀 category 判为领域技能（含命名空间层级）', () => {
    expect(classifySkillShelf('bioinformatics/ngs')).toBe('domain-skills');
    expect(classifySkillShelf('bioinformatics/single-cell')).toBe('domain-skills');
    expect(classifySkillShelf('bioinformatics')).toBe('domain-skills');
  });

  it('其余 category 判为通用技能（coding-playbook 为既成实例）', () => {
    expect(classifySkillShelf('coding/playbook')).toBe('general-skills');
    expect(classifySkillShelf('productivity')).toBe('general-skills');
    expect(classifySkillShelf('')).toBe('general-skills');
  });

  it('前缀匹配是整段或斜杠分段，不做子串误伤', () => {
    // `bioinformatics-x/...` 不以 `bioinformatics/` 开头也不相等 → 通用
    expect(classifySkillShelf('bioinformatics-x/tools')).toBe('general-skills');
  });

  it('四货架元数据齐备且 id 唯一（tab 栏数据源契约）', () => {
    expect(EXTENSION_SHELVES.map((s) => s.id)).toEqual([
      'domain-plugins',
      'domain-skills',
      'general-skills',
      'mcp',
    ]);
    const labels = EXTENSION_SHELVES.map((s) => s.label);
    expect(new Set(labels).size).toBe(labels.length);
    for (const shelf of EXTENSION_SHELVES) {
      expect(shelf.description.length).toBeGreaterThan(0);
    }
  });

  it('isExtensionShelfId 只放行四货架 id，其余 false（fail-closed）', () => {
    expect(isExtensionShelfId('domain-plugins')).toBe(true);
    expect(isExtensionShelfId('mcp')).toBe(true);
    expect(isExtensionShelfId('plugins')).toBe(false);
    expect(isExtensionShelfId('')).toBe(false);
    expect(isExtensionShelfId('../etc')).toBe(false);
  });
});
