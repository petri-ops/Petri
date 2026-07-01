/**
 * DesktopSettingsPanel — 设置浮动面板（从左下角 dock 弹出）
 *
 * 内容与原 DesktopSettingsModal 相同，但渲染为浮动面板而非全屏遮罩模态。
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Icon } from '@/components/icons/Icon';

interface Props {
  onClose: () => void;
}

/** UpdateChecker — 检查应用更新（electron-updater 前端 UI） */
function UpdateChecker(): React.ReactElement | null {
  const [checking, setChecking] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<{ version: string } | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [downloaded, setDownloaded] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const handleCheck = useCallback(async () => {
    if (!window.biof3Desktop?.updater) return;
    setChecking(true);
    setMsg(null);
    try {
      const result = await window.biof3Desktop.updater.check();
      if (!result.ok) {
        setMsg(result.error || '检查失败');
      } else if (!result.hasUpdate) {
        setMsg('已是最新版本');
      } else if (result.info) {
        setUpdateInfo({ version: result.info.version });
      }
    } catch (e) {
      setMsg(String(e));
    }
    setChecking(false);
  }, []);

  const handleDownload = useCallback(async () => {
    if (!window.biof3Desktop?.updater) return;
    setDownloading(true);
    setProgress(0);
    try {
      await window.biof3Desktop.updater.download();
    } catch (e) {
      setMsg(String(e));
      setDownloading(false);
    }
  }, []);

  const handleInstall = useCallback(async () => {
    if (!window.biof3Desktop?.updater) return;
    await window.biof3Desktop.updater.install();
  }, []);

  useEffect(() => {
    if (!window.biof3Desktop?.updater) return;
    const off1 = window.biof3Desktop.updater.onDownloadProgress((p) =>
      setProgress(Math.round(p.ratio * 100))
    );
    const off2 = window.biof3Desktop.updater.onUpdateDownloaded(() => {
      setDownloading(false);
      setDownloaded(true);
    });
    const off3 = window.biof3Desktop.updater.onError((m) => {
      setMsg(m);
      setDownloading(false);
    });
    return () => {
      off1?.();
      off2?.();
      off3?.();
    };
  }, []);

  if (!window.biof3Desktop?.updater) return null;

  return (
    <div className="biof3-update-section">
      {downloaded ? (
        <button
          type="button"
          className="biof3-btn biof3-btn--primary biof3-btn--sm"
          onClick={handleInstall}
        >
          重启安装更新
        </button>
      ) : downloading ? (
        <span className="biof3-update-progress">下载中 {progress.toFixed(0)}%</span>
      ) : updateInfo ? (
        <button
          type="button"
          className="biof3-btn biof3-btn--primary biof3-btn--sm"
          onClick={handleDownload}
        >
          下载 v{updateInfo.version}
        </button>
      ) : (
        <button
          type="button"
          className="biof3-btn biof3-btn--ghost biof3-btn--sm"
          onClick={handleCheck}
          disabled={checking}
        >
          {checking ? '检查中…' : '检查更新'}
        </button>
      )}
      {msg && <span className="biof3-field__hint">{msg}</span>}
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
        分析结果、上传文件、AI 配置、运行时都存在这里。卸载应用时此目录会保留，不会自动删除。
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

  useEffect(() => {
    loadSettings();
  }, []);

  async function loadSettings() {
    if (!window.biof3Desktop) return;
    const s = await window.biof3Desktop.aiSettings.get();
    setSettings(s);
    setChatProvider((s.chat_provider as string) || 'deepseek');
    setEmbedProvider((s.embed_provider as string) || 'dashscope');
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
    });
    setSaving(false);
    setSaved(true);
    setDeepseekKey('');
    setDashscopeKey('');
    setTimeout(() => setSaved(false), 3000);
    loadSettings();
  }

  async function handleTest(provider: string, key: string) {
    if (!window.biof3Desktop || !key) return;
    setTesting(provider);
    const result = await window.biof3Desktop.aiSettings.test(provider, key);
    setTestResult((prev) => ({ ...prev, [provider]: result }));
    setTesting(null);
  }

  const isConfigured = (key: string) => !!settings[`${key}_configured`];

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

        <DataManagement />
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
