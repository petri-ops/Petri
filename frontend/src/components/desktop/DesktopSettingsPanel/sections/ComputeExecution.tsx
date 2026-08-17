// ============================================================
// DesktopSettingsPanel — Compute execution section
//
// Extracted from src/components/desktop/DesktopSettingsPanel.tsx
// by BLOCK-9.2 PHASE 1. Original location: lines 366-510.
//
// Local vs remote compute mode config + save. Uses
// window.biof3Desktop.computeSettings.get() / save() + DEFAULT_COMPUTE_SETTINGS
// + normalizeComputeSettings (both shipped in this module since they
// were tightly coupled to the section in the original file).
// ============================================================

import React, { useCallback, useEffect, useState } from 'react';
import type { ComputeSettings } from '@/lib/electron';

export const DEFAULT_COMPUTE_SETTINGS: ComputeSettings = {
  computeMode: 'local',
  remoteComputeUrl: '',
  remoteComputeToken: '',
  remoteComputeName: '',
};

export function normalizeComputeSettings(
  raw: Partial<ComputeSettings> | Record<string, unknown> | null | undefined
): ComputeSettings {
  const data = raw && typeof raw === 'object' ? raw : {};
  const mode = String(
    (data as Record<string, unknown>).computeMode ??
      (data as Record<string, unknown>).compute_mode ??
      'local'
  ).toLowerCase();
  return {
    computeMode: mode === 'remote' ? 'remote' : 'local',
    remoteComputeUrl: String(
      (data as Record<string, unknown>).remoteComputeUrl ??
        (data as Record<string, unknown>).remote_compute_url ??
        ''
    ).trim(),
    remoteComputeToken: String(
      (data as Record<string, unknown>).remoteComputeToken ??
        (data as Record<string, unknown>).remote_compute_token ??
        ''
    ),
    remoteComputeName: String(
      (data as Record<string, unknown>).remoteComputeName ??
        (data as Record<string, unknown>).remote_compute_name ??
        ''
    ).trim(),
  };
}

export function ComputeExecution(): React.ReactElement | null {
  const bridge = window.biof3Desktop?.computeSettings;
  const [computeSettings, setComputeSettings] = useState<ComputeSettings>(DEFAULT_COMPUTE_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!bridge) {
      setLoading(false);
      return;
    }
    (async () => {
      try {
        const result = await bridge.get();
        setComputeSettings(normalizeComputeSettings(result));
        setError(null);
      } catch (e) {
        setError(String(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [bridge]);

  const handleSave = useCallback(async () => {
    if (!bridge) return;
    setSaving(true);
    setError(null);
    try {
      const normalized = normalizeComputeSettings(computeSettings);
      const result = await bridge.save(normalized);
      if (result?.ok !== false) {
        setComputeSettings(normalized);
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      } else {
        setError(result?.error || '保存失败');
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }, [bridge, computeSettings]);

  if (!bridge) return null;

  const isRemote = computeSettings.computeMode === 'remote';
  const remoteUrlMissing = isRemote && !computeSettings.remoteComputeUrl.trim();
  const currentLabel = isRemote
    ? remoteUrlMissing
      ? '远端未配置'
      : `远端集群${computeSettings.remoteComputeName ? ` · ${computeSettings.remoteComputeName}` : ''}`
    : '本地优先';

  return (
    <div className="biof3-data-section">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <label className="biof3-field__label" style={{ marginBottom: 0 }}>
          计算执行
        </label>
        <span className="biof3-badge">{currentLabel}</span>
      </div>
      <p className="biof3-field__hint">
        默认先用本地；如果切到远端集群，这里就是统一入口。保存后重启应用生效。
      </p>

      <div className="biof3-field">
        <label className="biof3-field__label">执行位置</label>
        <select
          className="biof3-select"
          value={computeSettings.computeMode}
          onChange={(e) =>
            setComputeSettings((prev) => ({
              ...prev,
              computeMode: e.target.value === 'remote' ? 'remote' : 'local',
            }))
          }
          disabled={loading}
        >
          <option value="local">本地执行</option>
          <option value="remote">远端集群</option>
        </select>
      </div>

      {isRemote && (
        <>
          <div className="biof3-field">
            <label className="biof3-field__label">远端地址</label>
            <input
              className="biof3-input"
              value={computeSettings.remoteComputeUrl}
              onChange={(e) =>
                setComputeSettings((prev) => ({ ...prev, remoteComputeUrl: e.target.value }))
              }
              placeholder="https://compute.example.com"
            />
          </div>

          {remoteUrlMissing && <p className="biof3-field__hint">请先填写远端地址。</p>}

          <div className="biof3-field">
            <label className="biof3-field__label">访问令牌</label>
            <input
              type="password"
              className="biof3-input"
              value={computeSettings.remoteComputeToken}
              onChange={(e) =>
                setComputeSettings((prev) => ({ ...prev, remoteComputeToken: e.target.value }))
              }
              placeholder="远端集群 Token"
            />
          </div>

          <div className="biof3-field">
            <label className="biof3-field__label">集群名称</label>
            <input
              className="biof3-input"
              value={computeSettings.remoteComputeName}
              onChange={(e) =>
                setComputeSettings((prev) => ({ ...prev, remoteComputeName: e.target.value }))
              }
              placeholder="可选，例如 Dell / ECS / Lab Cluster"
            />
          </div>
        </>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <button
          type="button"
          className="biof3-btn biof3-btn--primary biof3-btn--sm"
          onClick={handleSave}
          disabled={saving || loading || remoteUrlMissing}
        >
          {saving ? '保存中…' : '保存计算设置'}
        </button>
        {saved && <span className="biof3-field__hint">已保存，重启后生效</span>}
      </div>
      {error && <p className="biof3-field__hint">{error}</p>}
    </div>
  );
}
