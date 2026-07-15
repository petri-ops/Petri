/**
 * DesktopSettingsPanel — 设置浮动面板（从左下角 dock 弹出）
 *
 * 内容与原 DesktopSettingsModal 相同，但渲染为浮动面板而非全屏遮罩模态。
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Icon } from '@/components/icons/Icon';
import {
  useAiSettings,
  DEFAULT_CHAT_MODEL_PRESETS,
  type ChatModelPreset,
} from '@/hooks/useAiSettings';
import { useAutoUpdate } from '@/hooks/useAutoUpdate';
import type { ComputeSettings } from '@/lib/electron';

interface Props {
  onClose: () => void;
}

// ChatModelPreset type + DEFAULT_CHAT_MODEL_PRESETS live in
// `@/hooks/useAiSettings` — Plan 1.6 §4.5 [HIGH] type dedup.

/** UpdateChecker — 检查 OSS 更新并打开已校验的 macOS 安装包 */
function UpdateChecker(): React.ReactElement | null {
  if (!window.biof3Desktop?.updater) return null;

  const { checking, available, availableVersion, downloading, progress, downloaded, error, installing, check, download, install } =
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
      {error && <span className="biof3-field__hint">{error}</span>}
    </div>
  );
}

/** ExportDiagnostic — 导出诊断日志包 */
function ExportDiagnostic(): React.ReactElement | null {
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

/** DataManagement — 数据目录管理（卸载数据保留） */
function DataManagement(): React.ReactElement | null {
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

const DEFAULT_COMPUTE_SETTINGS: ComputeSettings = {
  computeMode: 'local',
  remoteComputeUrl: '',
  remoteComputeToken: '',
  remoteComputeName: '',
};

function normalizeComputeSettings(
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

function ComputeExecution(): React.ReactElement | null {
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

export function DesktopSettingsPanel({ onClose }: Props): React.ReactElement {
  const [settings, setSettings] = useState<Record<string, unknown>>({});
  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, { ok: boolean; message: string }>>(
    {}
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const [deepseekKey, setDeepseekKey] = useState('');
  const [dashscopeKey, setDashscopeKey] = useState('');
  const [chatProvider, setChatProvider] = useState('deepseek');
  const [embedProvider, setEmbedProvider] = useState('dashscope');
  // Plan 1.6 §4.5 — presets + activeId now live in the shared
  // SWR hook so the chat panel and this settings panel see the
  // same source of truth. Provider / embedProvider / keys /
  // telemetry stay here because no other component reads them.
  const {
    presets: chatModelPresets,
    activeId: activeChatModelId,
    setActiveLocal: setActiveChatModelId,
    updatePreset: hookUpdatePreset,
    addPreset: hookAddPreset,
    removePreset: hookRemovePreset,
    refresh: refreshAiSettings,
  } = useAiSettings();
  // M2-3：错误遥测开关（默认关闭）
  const [telemetryEnabled, setTelemetryEnabled] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  async function loadSettings() {
    if (!window.biof3Desktop) return;
    const s = await window.biof3Desktop.aiSettings.get();
    setSettings(s);
    setChatProvider((s.chat_provider as string) || 'deepseek');
    setEmbedProvider((s.embed_provider as string) || 'dashscope');
    // presets + active_chat_model_id are owned by the shared SWR
    // hook; refresh so this panel sees the same snapshot the chat
    // panel would see after a sibling write.
    await refreshAiSettings();
    setTelemetryEnabled(s.telemetry_enabled === true);
  }

  async function handleSave() {
    if (!window.biof3Desktop) return;
    setSaving(true);
    setSaved(false);
    await window.biof3Desktop.aiSettings.save({
      deepseek_api_key: deepseekKey || undefined,
      dashscope_api_key: dashscopeKey || undefined,
      llm_provider: chatProvider,
      embed_provider: embedProvider,
      chat_model_presets: chatModelPresets,
      active_chat_model_id: activeChatModelId,
      telemetry_enabled: telemetryEnabled,
    });
    setSaving(false);
    setSaved(true);
    setDeepseekKey('');
    setDashscopeKey('');
    setTimeout(() => setSaved(false), 3000);
    loadSettings();
  }

  // M2-3：遥测开关即时保存（无需点"保存"按钮，切了立即生效）
  async function handleToggleTelemetry(next: boolean) {
    setTelemetryEnabled(next);
    if (!window.biof3Desktop) return;
    try {
      await window.biof3Desktop.aiSettings.save({
        ...settings,
        telemetry_enabled: next,
      });
      // 同步本地 settings 缓存
      setSettings((prev) => ({ ...prev, telemetry_enabled: next }));
    } catch {
      // 保存失败回滚 UI 状态
      setTelemetryEnabled(!next);
    }
  }

  async function handleTest(provider: string, key: string) {
    if (!window.biof3Desktop || !key) return;
    setTesting(provider);
    const result = await window.biof3Desktop.aiSettings.test(provider, key);
    setTestResult((prev) => ({ ...prev, [provider]: result }));
    setTesting(null);
  }

  const isConfigured = (key: string) => !!settings[`${key}_configured`];

  function updatePreset(index: number, patch: Partial<ChatModelPreset>) {
    const target = chatModelPresets[index];
    if (!target) return;
    // Plan 1.6 §4.5 — delegate to the shared hook so the chat
    // panel (SimpleChat) sees the rename immediately. JSX still
    // passes `index` (preserves the existing onChange wiring),
    // we look up the id here.
    hookUpdatePreset(target.id, patch);
  }

  function addPreset() {
    hookAddPreset({
      label: '自定义模型',
      provider: chatProvider || 'deepseek',
      model: 'deepseek-chat',
    });
  }

  return (
    <div className="biof3-desktop-panel" role="dialog" aria-label="设置">
      <div className="biof3-desktop-panel__header">
        <span className="biof3-desktop-panel__icon">
          <Icon name="settings" size={18} />
        </span>
        <div className="biof3-desktop-panel__titles">
          <h2 className="biof3-desktop-panel__title">设置</h2>
          <p className="biof3-desktop-panel__subtitle">AI Copilot 配置 · 密钥本地存储</p>
        </div>
        <button
          type="button"
          className="biof3-desktop-panel__close"
          onClick={onClose}
          aria-label="关闭"
        >
          <Icon name="x" size={16} />
        </button>
      </div>

      <div className="biof3-desktop-panel__body">
        <div className="biof3-field">
          <label className="biof3-field__label">Chat 模型 Provider</label>
          <select
            className="biof3-select"
            value={chatProvider}
            onChange={(e) => setChatProvider(e.target.value)}
          >
            <option value="deepseek">DeepSeek（深度求索）</option>
            <option value="openai">OpenAI（未来支持）</option>
            <option value="ollama">Ollama 本地模型（未来支持）</option>
          </select>
        </div>

        <div className="biof3-field">
          <label className="biof3-field__label">Chat 模型预设</label>
          <div style={{ display: 'grid', gap: 8 }}>
            {chatModelPresets.map((preset, index) => (
              <div key={preset.id} className="biof3-input-row" style={{ alignItems: 'center' }}>
                <input
                  className="biof3-input"
                  value={preset.label}
                  onChange={(e) => updatePreset(index, { label: e.target.value })}
                  placeholder="显示名称"
                />
                <input
                  className="biof3-input"
                  value={preset.provider}
                  onChange={(e) => updatePreset(index, { provider: e.target.value })}
                  placeholder="provider"
                />
                <input
                  className="biof3-input"
                  value={preset.model}
                  onChange={(e) => updatePreset(index, { model: e.target.value })}
                  placeholder="model"
                />
                <input
                  type="password"
                  className="biof3-input"
                  value={preset.apiKey || ''}
                  onChange={(e) => updatePreset(index, { apiKey: e.target.value })}
                  placeholder="可选 API Key"
                />
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
                  <input
                    type="radio"
                    name="active-chat-model"
                    checked={activeChatModelId === preset.id}
                    onChange={() => {
                      setActiveChatModelId(preset.id);
                      setChatProvider(preset.provider);
                    }}
                  />
                  默认
                </label>
                <button
                  type="button"
                  className="biof3-btn biof3-btn--ghost biof3-btn--sm"
                  onClick={() => hookRemovePreset(preset.id)}
                  disabled={chatModelPresets.length <= 1}
                >
                  删除
                </button>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 8 }}>
            <button type="button" className="biof3-btn biof3-btn--ghost biof3-btn--sm" onClick={addPreset}>
              添加模型预设
            </button>
          </div>
          <p className="biof3-field__hint">
            这里配置会话区右上角的模型列表。当前阶段 provider 复用下方 API Key；DeepSeek 默认模型为 deepseek-chat。
          </p>
        </div>

        <div className="biof3-field">
          <label className="biof3-field__label">
            DeepSeek API Key
            {isConfigured('deepseek') && (
              <span className="biof3-badge">
                <Icon name="check" size={12} /> 已配置
              </span>
            )}
          </label>
          <div className="biof3-input-row">
            <input
              type="password"
              className="biof3-input"
              value={deepseekKey}
              onChange={(e) => setDeepseekKey(e.target.value)}
              placeholder={
                isConfigured('deepseek') ? '已配置（输入新 key 覆盖）' : 'sk-xxxxxxxxxxxxxxxx'
              }
            />
            <button
              type="button"
              className="biof3-btn biof3-btn--ghost biof3-btn--sm"
              onClick={() => handleTest('deepseek', deepseekKey)}
              disabled={!deepseekKey || testing === 'deepseek'}
            >
              {testing === 'deepseek' ? '测试中…' : '测试'}
            </button>
          </div>
          {testResult.deepseek && (
            <p
              className={`biof3-field__result ${
                testResult.deepseek.ok ? 'biof3-field__result--ok' : 'biof3-field__result--err'
              }`}
            >
              {testResult.deepseek.ok ? '✓ ' : '✗ '}
              {testResult.deepseek.message}
            </p>
          )}
          <p className="biof3-field__hint">获取地址：platform.deepseek.com → API Keys</p>
        </div>

        <div className="biof3-field">
          <label className="biof3-field__label">Embedding 模型 Provider（语义搜索用）</label>
          <select
            className="biof3-select"
            value={embedProvider}
            onChange={(e) => setEmbedProvider(e.target.value)}
          >
            <option value="dashscope">DashScope（阿里云百炼）</option>
            <option value="ollama">Ollama 本地模型（未来支持）</option>
          </select>
        </div>

        <div className="biof3-field">
          <label className="biof3-field__label">
            DashScope API Key
            {isConfigured('dashscope') && (
              <span className="biof3-badge">
                <Icon name="check" size={12} /> 已配置
              </span>
            )}
          </label>
          <div className="biof3-input-row">
            <input
              type="password"
              className="biof3-input"
              value={dashscopeKey}
              onChange={(e) => setDashscopeKey(e.target.value)}
              placeholder={
                isConfigured('dashscope') ? '已配置（输入新 key 覆盖）' : 'sk-xxxxxxxxxxxxxxxx'
              }
            />
            <button
              type="button"
              className="biof3-btn biof3-btn--ghost biof3-btn--sm"
              onClick={() => handleTest('dashscope', dashscopeKey)}
              disabled={!dashscopeKey || testing === 'dashscope'}
            >
              {testing === 'dashscope' ? '测试中…' : '测试'}
            </button>
          </div>
          {testResult.dashscope && (
            <p
              className={`biof3-field__result ${
                testResult.dashscope.ok ? 'biof3-field__result--ok' : 'biof3-field__result--err'
              }`}
            >
              {testResult.dashscope.ok ? '✓ ' : '✗ '}
              {testResult.dashscope.message}
            </p>
          )}
          <p className="biof3-field__hint">获取地址：bailian.console.aliyun.com → API-KEY 管理</p>
        </div>

        <ComputeExecution />

        <DataManagement />

        {/* M2-3：可选错误遥测开关（默认关闭，用户主动开启） */}
        <div className="biof3-field">
          <label className="biof3-field__label">开启错误反馈</label>
          <div className="biof3-toggle-row">
            <input
              type="checkbox"
              id="biof3-telemetry-toggle"
              className="biof3-toggle"
              checked={telemetryEnabled}
              onChange={(e) => handleToggleTelemetry(e.target.checked)}
            />
            <label htmlFor="biof3-telemetry-toggle" className="biof3-toggle-label">
              {telemetryEnabled ? '已开启' : '已关闭'}
            </label>
          </div>
          <p className="biof3-field__hint">
            开启后，分析出错时仅上报错误分类与应用版本（不含任何用户数据、文件路径或文件名），
            用于改进工具稳定性。可随时关闭。
          </p>
        </div>
      </div>

      <div className="biof3-desktop-panel__footer">
        {saved && (
          <span className="biof3-saved-toast">
            <Icon name="check" size={14} /> 已保存
          </span>
        )}
        <UpdateChecker />
        <ExportDiagnostic />
        <button
          type="button"
          className="biof3-btn biof3-btn--primary biof3-btn--sm"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? '保存中…' : '保存'}
        </button>
      </div>
    </div>
  );
}

export default DesktopSettingsPanel;
