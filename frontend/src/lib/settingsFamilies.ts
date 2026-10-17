/**
 * settingsFamilies — 设置分区 → shared-config 注册表族的映射（BLOCK-201 W2）。
 *
 * 只有「本区所有可改值都由注册表承载」的分区才登记在这里：命中才显示「恢复默认」。
 * 刻意不给 `general`（外观偏好走 user-prefs 落点）/`models`（渠道与凭据）/`compute`
 * （数据目录）/`diagnostics`/`maintenance` 造一个假的重置按钮——那会把「没做的能力」
 * 装饰成「已提供」。
 */

import type { SettingsSectionId } from './settingsSearch';

/** 分区 → 可重置的注册表族（顺序即写入顺序，v1 无依赖）。 */
export const SETTINGS_SECTION_FAMILIES: Partial<Record<SettingsSectionId, string[]>> = {
  compute: ['network'],
  usage: ['cost-cap'],
  decisions: ['decision-points', 'runtime'],
  keymap: ['keymap'],
  reasoning: ['reasoning'],
  experimental: ['feature-flags'],
};

/** 该分区可重置的族；空数组=本区没有注册表承载的设置（不显示重置入口）。 */
export function resetFamiliesFor(section: SettingsSectionId): string[] {
  return SETTINGS_SECTION_FAMILIES[section] ?? [];
}
