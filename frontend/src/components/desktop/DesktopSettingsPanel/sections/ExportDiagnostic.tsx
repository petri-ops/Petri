// ============================================================
// DesktopSettingsPanel — Export diagnostic section
//
// Extracted from src/components/desktop/DesktopSettingsPanel.tsx
// by BLOCK-9.2 PHASE 1. Original location: lines 209-246.
//
// Wraps window.biof3Desktop.diagnostic.export() into a button with
// success/failure message. Self-contained.
// ============================================================

import React, { useCallback, useState } from 'react';

export function ExportDiagnostic(): React.ReactElement | null {
  const [exporting, setExporting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const handleExport = useCallback(async () => {
    if (!window.biof3Desktop?.diagnostic) return;
    setExporting(true);
    setMsg(null);
    try {
      const result = await window.biof3Desktop.diagnostic.export();
      if (result.ok) {
        setMsg('已导出到下载文件夹');
      } else if (result.error !== 'cancelled') {
        setMsg(result.error || '导出失败');
      }
    } catch (e) {
      setMsg(String(e));
    }
    setExporting(false);
  }, []);

  if (!window.biof3Desktop?.diagnostic) return null;

  return (
    <div className="biof3-update-section">
      <button
        type="button"
        className="biof3-btn biof3-btn--ghost biof3-btn--sm"
        onClick={handleExport}
        disabled={exporting}
      >
        {exporting ? '导出中…' : '导出诊断日志'}
      </button>
      {msg && <span className="biof3-field__hint">{msg}</span>}
    </div>
  );
}
