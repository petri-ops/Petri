import React from 'react';
import { useLocation } from 'react-router-dom';
import { Icon } from '@/components/icons/Icon';
import { useWorkspacePanelsContext } from '../WorkspacePanelsContext';
import styles from '../TitleBar.module.css';
import { isStandalonePagePath } from './shared';

/**
 * BLOCK-62 P1a → owner 裁决 A（msg_812fc13259da）：恢复原生顶栏。
 * 自绘交通灯/窗口控制已移除（native titleBarStyle 接管），本区只保留左栏收起按钮。
 * 容器无关：既被 fixed [TitleBar.tsx] 复用，也被列级 header-slot 复用。
 */
export function TitleBarLeftZone(): React.ReactElement {
  const panels = useWorkspacePanelsContext();
  // UI-348 — 全局独立页顶栏左区不画分隔线（默认 span 与壳层左栏宽度错位）
  const bare = isStandalonePagePath(useLocation().pathname);

  return (
    <div className={`${styles.leftZone}${bare ? ` ${styles.leftZoneBare}` : ''}`}>
      <div className={styles.leftTools}>
        <button
          type="button"
          className={`${styles.iconBtn} ${!panels.leftOpen ? styles.iconBtnInactive : ''}`}
          onClick={panels.toggleLeft}
          title={panels.leftOpen ? '收起左侧栏' : '展开左侧栏'}
          aria-label={panels.leftOpen ? '收起左侧栏' : '展开左侧栏'}
        >
          <Icon name="panel-left" size={15} />
        </button>
      </div>
    </div>
  );
}
