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
    <div className="gewu-data-section">
      <label className="gewu-field__label">运行环境包</label>
      <p className="gewu-field__hint">
        运行分析时按需自动准备的运行时和依赖包（由插件按需声明），无需手动安装。
      </p>
      {loading ? (
        <p className="gewu-field__hint">正在读取…</p>
      ) : capabilities.length === 0 ? (
        <p className="gewu-field__hint">暂无已安装的包（运行需要它的分析时会自动获取）。</p>
      ) : (
        <div className="gewu-harness-caps">
          {capabilities.map((cap) => (
            <div key={cap.capabilityId} className="gewu-harness-cap-row">
              <span className="gewu-badge">{cap.kind}</span>
              <strong>{cap.capabilityId}</strong>
              <span className="gewu-field__hint">v{cap.version}</span>
              {cap.size ? <span className="gewu-field__hint">{fmtBytes(cap.size)}</span> : null}
              <span className="gewu-field__hint">
                {new Date(cap.installedAt).toLocaleDateString()}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
