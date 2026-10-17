import { describe, expect, it } from 'vitest';
import {
  SETTINGS_SEARCH_INDEX,
  filterSettingsSections,
  isSettingsSectionMatch,
} from './settingsSearch';
import { SETTINGS_SECTIONS } from '@/components/desktop/DesktopSettingsPanel/types';
import { resetFamiliesFor, SETTINGS_SECTION_FAMILIES } from './settingsFamilies';

/**
 * BLOCK-201 W2 — 设置搜索契约（纯函数，穷举匹配规则）。
 * 第一条断言是**漂移门**：索引与 SETTINGS_SECTIONS 的 id/label/description 必须逐项相等，
 * 新增分区忘了补索引会红，而不是"搜不到但没人知道"。
 */
describe('settingsSearch', () => {
  it('索引与 SETTINGS_SECTIONS 逐项相等（id/label/description）', () => {
    expect(SETTINGS_SEARCH_INDEX.map((row) => row.id)).toEqual(SETTINGS_SECTIONS.map((row) => row.id));
    for (const section of SETTINGS_SECTIONS) {
      const entry = SETTINGS_SEARCH_INDEX.find((row) => row.id === section.id);
      expect(entry, `缺少分区 ${section.id} 的搜索条目`).toBeTruthy();
      expect(entry?.label).toBe(section.label);
      expect(entry?.description).toBe(section.description);
    }
  });

  it('空查询返回全部分区（保持索引顺序）', () => {
    expect(filterSettingsSections('')).toEqual(SETTINGS_SEARCH_INDEX.map((row) => row.id));
    expect(filterSettingsSections('   ')).toHaveLength(SETTINGS_SEARCH_INDEX.length);
  });

  it('按分区名/描述/同义词命中，大小写不敏感', () => {
    expect(filterSettingsSections('快捷键')).toEqual(['keymap']);
    expect(filterSettingsSections('KEYMAP')).toEqual(['keymap']);
    expect(filterSettingsSections('思考')).toEqual(['reasoning']);
    expect(filterSettingsSections('成本')).toEqual(['usage']);
    expect(filterSettingsSections('备份')).toEqual(['maintenance']);
  });

  it('多词按 AND：任一词不命中即整条不命中', () => {
    expect(filterSettingsSections('快捷键 冲突')).toEqual(['keymap']);
    expect(filterSettingsSections('快捷键 成本')).toEqual([]);
  });

  it('分区名命中排在描述命中之前', () => {
    const results = filterSettingsSections('模型');
    expect(results[0]).toBe('models');
  });

  it('无匹配返回空数组，匹配判定与过滤结果一致', () => {
    expect(filterSettingsSections('zzz-not-a-setting')).toEqual([]);
    expect(isSettingsSectionMatch('keymap', '快捷键')).toBe(true);
    expect(isSettingsSectionMatch('keymap', '成本')).toBe(false);
  });
});

describe('settingsFamilies', () => {
  it('只有注册表承载的分区才有重置族；未登记分区返回空数组（不造假日按钮）', () => {
    expect(resetFamiliesFor('keymap')).toEqual(['keymap']);
    expect(resetFamiliesFor('general')).toEqual([]);
    expect(resetFamiliesFor('models')).toEqual([]);
    expect(resetFamiliesFor('maintenance')).toEqual([]);
  });

  it('映射里的族全部是已知注册表族（与 CONFIG_TRANSFER_FAMILIES 对齐）', () => {
    const known = new Set(['feature-flags', 'decision-points', 'generation', 'cost-cap', 'keymap', 'reasoning']);
    for (const families of Object.values(SETTINGS_SECTION_FAMILIES)) {
      for (const family of families) expect(known.has(family)).toBe(true);
    }
  });
});
