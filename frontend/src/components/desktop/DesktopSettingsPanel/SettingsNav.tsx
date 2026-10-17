import { Icon } from '@/components/icons/Icon';
import { SETTINGS_SECTIONS, type SettingsSection } from './types';

/**
 * SettingsNav — 设置分区导航（BLOCK-201 W2 从 696 行面板抽出）。
 *
 * 抽出的原因与钩子同源：面板已贴 code-size 预算上限，导航的过滤/空态渲染留在这里，
 * 面板只保留「当前分区 + 选中回调」。过滤集合由 `useSettingsTransferState` 给出。
 */
interface Props {
  visibleSectionIds: Set<string>;
  activeSection: SettingsSection;
  onSelect: (section: SettingsSection) => void;
}

export function SettingsNav({ visibleSectionIds, activeSection, onSelect }: Props): React.ReactElement {
  const visibleSections = SETTINGS_SECTIONS.filter((item) => visibleSectionIds.has(item.id));
  return (
    <nav className="petri-settings-nav" aria-label="设置分类">
      {visibleSections.map((item) => (
        <button
          key={item.id}
          type="button"
          className={`petri-settings-nav__item${activeSection === item.id ? ' active' : ''}`}
          onClick={() => onSelect(item.id)}
        >
          <Icon name={item.icon} size={15} />
          <span>
            <strong>{item.label}</strong>
            <small>{item.description}</small>
          </span>
        </button>
      ))}
      {visibleSections.length === 0 && (
        <p className="petri-field__hint" data-testid="settings-search-empty">
          没有匹配的分区。试试「快捷键」「成本」「模型」或清空搜索。
        </p>
      )}
    </nav>
  );
}
