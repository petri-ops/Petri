// ============================================================
// DesktopSettingsPanel — Data directory management section
//
// Extracted from src/components/desktop/DesktopSettingsPanel.tsx
// by BLOCK-9.2 PHASE 1. Original location: lines 248-328.
//
// Shows data dir path + size breakdown + open-in-file-manager button.
// Uses window.biof3Desktop.data.info() / openDir(). Self-contained.
// ============================================================

import React, { useCallback, useEffect, useState } from 'react';

export function DataManagement(): React.ReactElement | null {
  const [info, setInfo] = useState<{
    ok: boolean;
    dataDir?: string;
    total?: number;
    breakdown?: Record<string, number>;
  } | null>(null);
  const [opening, setOpening] = useState(false);

  const loadInfo = useCallback(async () => {
    if (!window.biof3Desktop?.data) return;
    try {
      const result = await window.biof3Desktop.data.info();
      if (result.ok) setInfo(result);
    } catch {}
  }, []);

  useEffect(() => {
    loadInfo();
  }, [loadInfo]);

  const handleOpenDir = useCallback(async () => {
    if (!window.biof3Desktop?.data) return;
    setOpening(true);
    try {
      await window.biof3Desktop.data.openDir();
    } finally {
      setOpening(false);
    }
  }, []);

  if (!window.biof3Desktop?.data) return null;

  const formatSize = (bytes?: number): string => {
    if (!bytes) return '0B';
    if (bytes >= 1024 * 1024 * 1024) return (bytes / 1024 / 1024 / 1024).toFixed(1) + 'GB';
    if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(0) + 'MB';
    if (bytes >= 1024) return (bytes / 1024).toFixed(0) + 'KB';
    return bytes + 'B';
  };

  const breakdown = info?.breakdown || {};
  const sortedEntries = Object.entries(breakdown).sort((a, b) => (b[1] || 0) - (a[1] || 0));

  return (
    <div className="biof3-data-section">
      <label className="biof3-field__label">本地数据目录</label>
      <p className="biof3-field__hint">
        分析结果、上传文件、AI 配置、执行配置、运行时都存在这里。卸载应用时此目录会保留，不会自动删除。
      </p>
      {info?.dataDir && (
        <div className="biof3-data-dir-path" title={info.dataDir}>
          {info.dataDir}
        </div>
      )}
      {sortedEntries.length > 0 && (
        <div className="biof3-data-breakdown">
          {sortedEntries.map(([name, size]) => (
            <div key={name} className="biof3-data-breakdown-row">
              <span className="biof3-data-breakdown-name">{name}</span>
              <span className="biof3-data-breakdown-size">{formatSize(size)}</span>
            </div>
          ))}
          <div className="biof3-data-breakdown-row biof3-data-breakdown-row--total">
            <span>合计</span>
            <span>{formatSize(info?.total)}</span>
          </div>
        </div>
      )}
      <button
        type="button"
        className="biof3-btn biof3-btn--ghost biof3-btn--sm"
        onClick={handleOpenDir}
        disabled={opening}
      >
        {opening ? '打开中…' : '在文件管理器中打开'}
      </button>
    </div>
  );
}
