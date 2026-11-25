import React, { useState } from 'react';
import { Icon } from '@/components/icons/Icon';
import { SETTINGS_SECTIONS, type SettingsSection } from './types';

/**
 * SettingsNav — 设置分区导航（BLOCK-201 W2 从 696 行面板抽出）。
 *
 * BLOCK-423 — 视觉改版（参照 reference/ZCode）：分区按语义分组，左栏承载
 * 分组标题 + 当前分组说明；窄窗口收成图标栏时靠 `title` 暴露标题。
 *
 * UI-704 — 设置页 IA v2（设计源 docs/settings-ia-simplification-design.md）：
 * core 收敛 5 组（导航极少），低频分区收进「高级」折叠组并**默认收起**
 * （对标 orca「pane 多但靠搜索」的反面：导航极少 + 搜索兜底——用户三条裁决
 * 「联网/快捷键不占显眼位置」直接执行）。深链进入高级分区时自动展开；
 * 功能零删除，全部子项搜索可达。
 */
interface Props {
  visibleSectionIds: Set<string>;
  activeSection: SettingsSection;
  onSelect: (section: SettingsSection) => void;
}

/** 常驻分区（core 5 组）的展示分组：只影响阅读顺序，不改 id 与深链语义。 */
const NAV_GROUPS: Array<{ label: string; ids: SettingsSection[] }> = [
  { label: '能力', ids: ['models', 'speech'] },
  { label: '应用', ids: ['appearance', 'desktop'] },
  { label: '系统', ids: ['usage', 'maintenance'] },
];

export function SettingsNav({ visibleSectionIds, activeSection, onSelect }: Props): React.ReactElement {
  const visibleSections = SETTINGS_SECTIONS.filter((item) => visibleSectionIds.has(item.id));
  const coreSections = visibleSections.filter((item) => item.tier === 'core');
  const advancedSections = visibleSections.filter((item) => item.tier === 'advanced');
  const activeMeta = visibleSections.find((item) => item.id === activeSection);
  // UI-704 — 高级折叠组默认收起；派生默认值跟随「当前分区是否属高级」：
  // 深链进入高级分区（?section=diagnostics 等）时自动展开，核心分区时收起。
  // 用户手动开合进入 override 态，再次点选分区即回到派生默认。
  const [advancedOpenOverride, setAdvancedOpenOverride] = useState<boolean | null>(null);
  const activeIsAdvanced = (SETTINGS_SECTIONS.find((item) => item.id === activeSection)?.tier ?? 'core') === 'advanced';
  const advancedOpen = advancedOpenOverride ?? activeIsAdvanced;

  const handleSelect = (id: SettingsSection): void => {
    setAdvancedOpenOverride(null);
    onSelect(id);
  };

  const renderItem = (item: (typeof SETTINGS_SECTIONS)[number]): React.ReactElement => (
    <button
      key={item.id}
      type="button"
      className={`petri-settings-nav__item${activeSection === item.id ? ' active' : ''}`}
      onClick={() => handleSelect(item.id)}
      title={`${item.label} — ${item.description}`}
      aria-current={activeSection === item.id ? 'page' : undefined}
    >
      <Icon name={item.icon} size={15} />
      <span>
        <strong>{item.label}</strong>
        <small>{item.description}</small>
      </span>
    </button>
  );

  return (
    <nav className="petri-settings-nav" aria-label="设置分类">
      {NAV_GROUPS.map((group) => {
        const items = coreSections.filter((item) => group.ids.includes(item.id));
        if (items.length === 0) return null;
        return (
          <div className="petri-settings-nav__group" key={group.label}>
            <p className="petri-settings-nav__group-label">{group.label}</p>
            {items.map(renderItem)}
          </div>
        );
      })}
      {/* 未登记到展示分组的核心分区不能被吞掉 */}
      {coreSections
        .filter((item) => !NAV_GROUPS.some((group) => group.ids.includes(item.id)))
        .map(renderItem)}
      {advancedSections.length > 0 && (
        <div className="petri-settings-nav__group petri-settings-nav__group--advanced">
          <button
            type="button"
            className="petri-settings-nav__group-toggle"
            onClick={() => setAdvancedOpenOverride(!advancedOpen)}
            aria-expanded={advancedOpen}
            title={advancedOpen ? '收起高级设置' : '展开高级设置'}
          >
            <span>{advancedOpen ? '▾' : '▸'} 高级</span>
            <small>{advancedSections.length}</small>
          </button>
          {advancedOpen && advancedSections.map(renderItem)}
        </div>
      )}
      {visibleSections.length === 0 && (
        <p className="petri-field__hint" data-testid="settings-search-empty">
          没有匹配的分区。试试「快捷键」「成本」「模型」或清空搜索。
        </p>
      )}
      {activeMeta && (
        <p className="petri-settings-nav__footnote">
          当前：{activeMeta.label} · {activeMeta.description}
        </p>
      )}
    </nav>
  );
}
