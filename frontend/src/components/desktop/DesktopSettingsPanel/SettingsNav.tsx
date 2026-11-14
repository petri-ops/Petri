import React, { useEffect, useState } from 'react';
import { Icon } from '@/components/icons/Icon';
import { SETTINGS_SECTIONS, type SettingsSection } from './types';

/**
 * SettingsNav — 设置分区导航（BLOCK-201 W2 从 696 行面板抽出）。
 *
 * BLOCK-423 — 视觉改版（参照 reference/ZCode）：分区按语义分组，左栏承载
 * 分组标题 + 当前分组说明；窄窗口收成图标栏时靠 `title` 暴露标题。
 *
 * BLOCK-424 — 信息架构分层：`core` 分区常驻，`advanced` 分区（决策原语 /
 * 推理档位 / 实验特性 / 运行时与诊断）收进「高级」折叠组，默认不展开。
 * 实机盘点依据：决策原语 29 输入 / 118 下拉 / 9152 字符、运行时与诊断 8846 字符，
 * 属绝大多数用户不关注、也不该被诱导点击的面。深链进入高级分区时自动展开。
 */
interface Props {
  visibleSectionIds: Set<string>;
  activeSection: SettingsSection;
  onSelect: (section: SettingsSection) => void;
}

/** 常驻分区的展示分组：只影响阅读顺序，不改 id 与深链语义。 */
const NAV_GROUPS: Array<{ label: string; ids: SettingsSection[] }> = [
  { label: '应用', ids: ['appearance', 'desktop'] },
  { label: '能力', ids: ['models', 'network', 'compute', 'usage'] },
  { label: '系统', ids: ['keymap', 'general', 'maintenance'] },
];

export function SettingsNav({ visibleSectionIds, activeSection, onSelect }: Props): React.ReactElement {
  const visibleSections = SETTINGS_SECTIONS.filter((item) => visibleSectionIds.has(item.id));
  const coreSections = visibleSections.filter((item) => item.tier === 'core');
  const advancedSections = visibleSections.filter((item) => item.tier === 'advanced');
  const activeMeta = visibleSections.find((item) => item.id === activeSection);
  const activeIsAdvanced = advancedSections.some((item) => item.id === activeSection);
  const [advancedOpen, setAdvancedOpen] = useState(activeIsAdvanced);

  // 深链/搜索命中的高级分区必须可见，否则用户会以为跳转失败。
  useEffect(() => {
    if (activeIsAdvanced) setAdvancedOpen(true);
  }, [activeIsAdvanced]);

  const renderItem = (item: (typeof SETTINGS_SECTIONS)[number]): React.ReactElement => (
    <button
      key={item.id}
      type="button"
      className={`petri-settings-nav__item${activeSection === item.id ? ' active' : ''}`}
      onClick={() => onSelect(item.id)}
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
            onClick={() => setAdvancedOpen((open) => !open)}
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
