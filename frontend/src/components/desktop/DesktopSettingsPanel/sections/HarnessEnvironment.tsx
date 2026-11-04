// ============================================================
// DesktopSettingsPanel — Harness environment section
//
// Extracted from src/components/desktop/DesktopSettingsPanel.tsx
// by BLOCK-9.2 PHASE 1. Original location: lines 655-710.
//
// Read-only view of pre-prepared harness capabilities (R packages,
// runtimes). Uses window.petriDesktop.harnessCapabilities.list().
// ============================================================

import React, { useEffect, useState } from 'react';

export function HarnessEnvironment(): React.ReactElement | null {
  const bridge = window.petriDesktop?.harnessCapabilities;
  const [capabilities, setCapabilities] = useState<Array<{
    capabilityId: string;
    kind: string;
    version: string;
    installedAt: number;
    size: number | null;
  }>>([]);
  const [loading, setLoading] = useState(true);

  // BLOCK-346 T4 — 面板原为纯只读（连刷新都没有）：装坏/缺包时用户无从处置。
  // 至少给「重新检测」把 list 重拉一次（不新增 IPC，复用既有只读面）。
  const reload = React.useCallback(() => {
    if (!bridge) return;
    setLoading(true);
    bridge.list()
      .then((result) => { setCapabilities((result.capabilities ?? [])); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [bridge]);

  useEffect(() => {
    if (!bridge) { setLoading(false); return; }
    bridge.list()
      .then((result) => { setCapabilities((result.capabilities ?? [])); })
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
    <div className="petri-data-section">
      <label className="petri-field__label">运行环境包</label>
      <p className="petri-field__hint">
        运行分析时按需自动准备的运行时和依赖包（由插件按需声明），无需手动安装。
      </p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          type="button"
          className="petri-btn petri-btn--ghost petri-btn--sm"
          data-testid="harness-caps-refresh"
          disabled={loading}
          onClick={reload}
        >
          {loading ? '读取中…' : '重新检测'}
        </button>
      </div>
      {loading ? (
        <p className="petri-field__hint">正在读取…</p>
      ) : capabilities.length === 0 ? (
        <p className="petri-field__hint">暂无已安装的包（运行需要它的分析时会自动获取）。</p>
      ) : (
        <div className="petri-harness-caps">
          {capabilities.map((cap) => (
            <div key={cap.capabilityId} className="petri-harness-cap-row">
              <span className="petri-badge">{cap.kind}</span>
              <strong>{cap.capabilityId}</strong>
              <span className="petri-field__hint">v{cap.version}</span>
              {cap.size ? <span className="petri-field__hint">{fmtBytes(cap.size)}</span> : null}
              <span className="petri-field__hint">
                {new Date(cap.installedAt).toLocaleDateString()}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
