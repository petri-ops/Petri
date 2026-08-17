// ============================================================
// DesktopSettingsPanel — Harness environment section
//
// Extracted from src/components/desktop/DesktopSettingsPanel.tsx
// by BLOCK-9.2 PHASE 1. Original location: lines 655-710.
//
// Read-only view of pre-prepared harness capabilities (R packages,
// runtimes). Uses window.biof3Desktop.harnessCapabilities.list().
// ============================================================

import React, { useEffect, useState } from 'react';

export function HarnessEnvironment(): React.ReactElement | null {
  const bridge = window.biof3Desktop?.harnessCapabilities;
  const [capabilities, setCapabilities] = useState<Array<{
    capabilityId: string;
    kind: string;
    version: string;
    installedAt: number;
    size: number | null;
  }>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!bridge) { setLoading(false); return; }
    bridge.list()
      .then((result) => { setCapabilities((result.capabilities ?? []) as typeof capabilities); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [bridge]);

  if (!bridge) return null;

  function fmtBytes(size: number | null): string {
    if (!size) return '';
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(0)} KB`;
    return `${(size / (1024 * 1024)).toFixed(0)} MB`;
  }

  return (
    <div className="biof3-data-section">
      <label className="biof3-field__label">Harness 分析环境</label>
      <p className="biof3-field__hint">
        Harness 自动为内置分析模块准备的运行时和 R 包，无需手动安装。
      </p>
      {loading ? (
        <p className="biof3-field__hint">正在读取…</p>
      ) : capabilities.length === 0 ? (
        <p className="biof3-field__hint">暂无已预备的分析包（将在首次运行分析时自动获取）。</p>
      ) : (
        <div className="biof3-harness-caps">
          {capabilities.map((cap) => (
            <div key={cap.capabilityId} className="biof3-harness-cap-row">
              <span className="biof3-badge">{cap.kind}</span>
              <strong>{cap.capabilityId}</strong>
              <span className="biof3-field__hint">v{cap.version}</span>
              {cap.size ? <span className="biof3-field__hint">{fmtBytes(cap.size)}</span> : null}
              <span className="biof3-field__hint">
                {new Date(cap.installedAt).toLocaleDateString()}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
