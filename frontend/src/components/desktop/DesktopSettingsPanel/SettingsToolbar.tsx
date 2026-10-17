import styles from './sections/SettingsQuickwins.module.css';

/**
 * SettingsToolbar — 设置面板顶部的搜索与「按区重置」条（BLOCK-201 W2 / P0-3）。
 *
 * 两条诚实边界：
 *  · 搜索是**分区级过滤**（匹配分区名/描述/同义词），不做字段级跳转；
 *  · 「恢复默认」只在当前分区确有注册表承载时出现（`resetFamiliesFor` 决定），
 *    且动作只清覆盖层、不动对话/项目/结果/凭据——按钮文案与确认框都这么说。
 */
interface Props {
  query: string;
  onQueryChange: (query: string) => void;
  resultCount: number;
  totalCount: number;
  resetLabel?: string;
  onReset?: () => void;
  busy?: boolean;
}

export function SettingsToolbar({
  query,
  onQueryChange,
  resultCount,
  totalCount,
  resetLabel,
  onReset,
  busy = false,
}: Props): React.ReactElement {
  return (
    <div className={styles.toolbar} data-testid="settings-toolbar">
      <input
        className={styles.searchInput}
        type="search"
        value={query}
        placeholder="搜索设置（分区名 / 描述 / 同义词）"
        aria-label="搜索设置分区"
        data-testid="settings-search-input"
        onChange={(event) => onQueryChange(event.target.value)}
      />
      <span className={styles.toolbarMeta} data-testid="settings-search-count">
        {query.trim() === '' ? `${totalCount} 个分区` : `命中 ${resultCount} / ${totalCount}`}
      </span>
      {onReset && resetLabel && (
        <button
          type="button"
          className="petri-btn petri-btn--ghost petri-btn--sm"
          disabled={busy}
          data-testid="settings-reset-section"
          onClick={onReset}
        >
          {busy ? '恢复中…' : resetLabel}
        </button>
      )}
    </div>
  );
}
