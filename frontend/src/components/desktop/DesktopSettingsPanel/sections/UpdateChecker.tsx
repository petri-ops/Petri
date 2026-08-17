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
  if (!window.biof3Desktop?.updater) return null;

  const { checking, available, availableVersion, downloading, progress, downloaded, error, upToDate, installing, check, download, install } =
    useAutoUpdate();

  const pct = progress !== null ? Math.round(progress * 100) : 0;

  return (
    <div className="biof3-update-section">
      {downloaded ? (
        <button
          type="button"
          className="biof3-btn biof3-btn--primary biof3-btn--sm"
          onClick={install}
          disabled={installing}
        >
          {installing ? '正在打开…' : '打开安装包'}
        </button>
      ) : downloading ? (
        <span className="biof3-update-progress">下载中 {pct}%</span>
      ) : available ? (
        <button
          type="button"
          className="biof3-btn biof3-btn--primary biof3-btn--sm"
          onClick={download}
        >
          下载 v{availableVersion}
        </button>
      ) : (
        <button
          type="button"
          className="biof3-btn biof3-btn--ghost biof3-btn--sm"
          onClick={check}
          disabled={checking}
        >
          {checking ? '检查中…' : '检查更新'}
        </button>
      )}
      {upToDate && !error && (
        <span className="biof3-field__hint">当前已是最新版本</span>
      )}
      {error && <span className="biof3-field__hint">{error}</span>}
    </div>
  );
}
