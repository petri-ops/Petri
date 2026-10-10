// ============================================================
// DesktopSettingsPanel — Update checker section
//
// Extracted from src/components/desktop/DesktopSettingsPanel.tsx
// by BLOCK-9.2 PHASE 1. Original location: lines 162-207.
//
// Wraps useAutoUpdate hook into a 4-state UI (idle / checking /
// downloading / available / downloaded). Pure delegated component.
// ============================================================

import React from 'react';
import { useAutoUpdate } from '@/hooks/useAutoUpdate';

export function UpdateChecker(): React.ReactElement | null {
  // hooks 顺序纪律：useAutoUpdate() 必须无条件调用（它自身对桥缺失有守卫），
  // 早退只能放在 hook 之后——条件在两次渲染间翻转时提前 return 会让 hook 数量变化，
  // React 抛「Rendered more hooks than during the previous render」并卸载整棵树。
  // （同类实例：DesktopOnboarding 首启整页空白，P6 渲染层实机抓真。）
  const { checking, available, availableVersion, downloading, progress, downloaded, error, upToDate, installing, check, download, install } =
    useAutoUpdate();

  if (!window.petriDesktop?.updater) return null;

  const pct = progress !== null ? Math.round(progress * 100) : 0;

  return (
    <div className="petri-update-section">
      {downloaded ? (
        <button
          type="button"
          className="petri-btn petri-btn--primary petri-btn--sm"
          onClick={() => void install()}
          disabled={installing}
        >
          {installing ? '正在打开…' : '打开安装包'}
        </button>
      ) : downloading ? (
        <span className="petri-update-progress">下载中 {pct}%</span>
      ) : available ? (
        <button
          type="button"
          className="petri-btn petri-btn--primary petri-btn--sm"
          onClick={() => void download()}
        >
          下载 v{availableVersion}
        </button>
      ) : (
        <button
          type="button"
          className="petri-btn petri-btn--ghost petri-btn--sm"
          onClick={() => void check()}
          disabled={checking}
        >
          {checking ? '检查中…' : '检查更新'}
        </button>
      )}
      {upToDate && !error && (
        <span className="petri-field__hint">当前已是最新版本</span>
      )}
      {error && <span className="petri-field__hint">{error}</span>}
    </div>
  );
}
