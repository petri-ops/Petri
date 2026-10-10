// ============================================================
// DesktopSettingsPanel — Data directory management section
//
// Extracted from src/components/desktop/DesktopSettingsPanel.tsx
// by BLOCK-9.2 PHASE 1. Original location: lines 248-328.
//
// Shows data dir path + size breakdown + open-in-file-manager button.
// Uses window.petriDesktop.data.info() / openDir(). Self-contained.
// ============================================================

import React, { useCallback, useEffect, useState } from 'react';

export function DataManagement(): React.ReactElement | null {
  const [info, setInfo] = useState<{
    ok: boolean;
    dataDir?: string;
    total?: number;
    breakdown?: Record<string, number>;
    labels?: Record<string, string>;
  } | null>(null);
  const [opening, setOpening] = useState(false);

  const loadInfo = useCallback(async () => {
    if (!window.petriDesktop?.data) return;
    try {
      const result = await window.petriDesktop.data.info();
      if (result.ok) setInfo(result);
    } catch {}
  }, []);

  useEffect(() => {
    void loadInfo();
  }, [loadInfo]);

  const handleOpenDir = useCallback(async () => {
    if (!window.petriDesktop?.data) return;
    setOpening(true);
    try {
      await window.petriDesktop.data.openDir();
    } finally {
      setOpening(false);
    }
  }, []);

  if (!window.petriDesktop?.data) return null;

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
    <div className="petri-data-section">
      <label className="petri-field__label">本地数据目录</label>
      <p className="petri-field__hint">
        分析结果、上传文件、插件、运行时、日志、临时文件、本地数据库与 AI 配置都存在这里。卸载应用时此目录会保留，不会自动删除。
      </p>
      {info?.dataDir && (
        <div className="petri-data-dir-path" title={info.dataDir}>
          {info.dataDir}
        </div>
      )}
      {sortedEntries.length > 0 && (
        <div className="petri-data-breakdown">
          {sortedEntries.map(([name, size]) => {
            // BLOCK-150 ⑨：展示中文名（源侧 labels），原始目录/文件名留在 title 里
            // 供与磁盘数据目录对照；未知键回退原名不硬编码。
            const label = info?.labels?.[name];
            return (
              <div key={name} className="petri-data-breakdown-row">
                <span className="petri-data-breakdown-name" title={name}>{label ?? name}</span>
                <span className="petri-data-breakdown-size">{formatSize(size)}</span>
              </div>
            );
          })}
          <div className="petri-data-breakdown-row petri-data-breakdown-row--total">
            <span>合计</span>
            <span>{formatSize(info?.total)}</span>
          </div>
        </div>
      )}
      <button
        type="button"
        className="petri-btn petri-btn--ghost petri-btn--sm"
        onClick={() => void handleOpenDir()}
        disabled={opening}
      >
        {opening ? '打开中…' : '在文件管理器中打开'}
      </button>
    </div>
  );
}
