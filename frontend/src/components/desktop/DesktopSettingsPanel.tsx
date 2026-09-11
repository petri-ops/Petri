/**
 * DesktopSettingsPanel — 设置浮动面板（从左下角 dock 弹出）
 *
 * 内容与原 DesktopSettingsModal 相同，但渲染为浮动面板而非全屏遮罩模态。
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/icons/Icon';
import { ThemeControl } from './ThemeControl';
import { useTheme, FONT_SCALE_MIN, FONT_SCALE_MAX } from '@/themes/ThemeProvider';
import { AccentControl } from './AccentControl';
import {
  useAiSettings,
  type ChatModelPreset,
} from '@/hooks/useAiSettings';
import { useAutoUpdate } from '@/hooks/useAutoUpdate';
import type { ComputeSettings } from '@/lib/electron';
import { getPlatformApiPrefix, getToken } from '@/lib/authClient';
import { useRuntimeResourceSnapshot } from '@/hooks/useRuntimeResourceSnapshot';
import { ExperimentalFeaturesSection } from '@/components/settings/ExperimentalFeaturesSection';
import { deleteProject, listProjects, setProjectStatus } from '@/lib/project-store';
import type { Project } from '@/lib/project-types';
import {
  endpointBaseUrl,
  inferUserModelProvider,
  isChatSelectableProfile,
  isUserConfigurableModelProvider,
  modelProviderCredentialRef,
  modelProviderProtocol,
  modelProviderRequiresCredential,
  normalizeLegacyUserModelProfile,
  USER_MODEL_PROVIDER_OPTIONS,
  type UserModelProvider,
  validateUserModelProfile,
} from '@/lib/model-provider-options';
import { parseContextWindow, formatContextWindow } from '@/lib/format-context-window';
import {
  exportEndpointProfilesCsv,
  exportEndpointProfilesJson,
  parseEndpointProfiles,
} from '@/lib/model-endpoint-transfer';
import {
  archiveConversation,
  deleteConversation,
  listConversations,
  type ConversationSummary,
} from '@/components/copilot/copilotConversationsClient';


// ── BLOCK-9.2 PHASE 1: types + helpers + section subcomponents ──
import { Props, SettingsSection, SETTINGS_SECTIONS } from './DesktopSettingsPanel/types';
import { UsageResourcePanel } from './DesktopSettingsPanel/sections/UsageResourcePanel';
import { UpdateChecker } from './DesktopSettingsPanel/sections/UpdateChecker';
import { ExportDiagnostic } from './DesktopSettingsPanel/sections/ExportDiagnostic';
import { DataManagement } from './DesktopSettingsPanel/sections/DataManagement';
import { ComputeExecution } from './DesktopSettingsPanel/sections/ComputeExecution';
import { RemoteTargets } from './DesktopSettingsPanel/sections/RemoteTargets';
import { TrashManagement } from './DesktopSettingsPanel/sections/TrashManagement';
import { HarnessEnvironment } from './DesktopSettingsPanel/sections/HarnessEnvironment';

// DEFAULT_COMPUTE_SETTINGS + normalizeComputeSettings live in ComputeExecution module
import { DEFAULT_COMPUTE_SETTINGS, normalizeComputeSettings } from './DesktopSettingsPanel/sections/ComputeExecution';
import {
  MODEL_ROLES,
  providerDefaults,
  credentialId,
  type ModelRole,
} from './DesktopSettingsPanel/model-types';

export function DesktopSettingsPanel({ onClose }: Props): React.ReactElement {
  const [activeSection, setActiveSection] = useState<SettingsSection>('general');
  const [settings, setSettings] = useState<Record<string, unknown>>({});
  const [loadingModels, setLoadingModels] = useState<Record<string, boolean>>({});
  const [availableModels, setAvailableModels] = useState<Record<string, string[]>>({});
  const [testResult, setTestResult] = useState<Record<string, { ok: boolean; message: string }>>(
    {}
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const [modelProfiles, setModelProfiles] = useState<ChatModelPreset[]>([]);
  const [roleBindings, setRoleBindings] = useState<Partial<Record<ModelRole, string>>>({});
  const [fallbackEnabled, setFallbackEnabled] = useState(false);
  const [fallbackBindings, setFallbackBindings] = useState<Partial<Record<ModelRole, string[]>>>({});
  const [credentialInputs, setCredentialInputs] = useState<Record<string, string>>({});
  const [credentialStatus, setCredentialStatus] = useState<Record<string, boolean>>({});
  const [visibleCredentialIds, setVisibleCredentialIds] = useState<Record<string, boolean>>({});
  const [copiedCredentialId, setCopiedCredentialId] = useState<string | null>(null);
  const [profileErrors, setProfileErrors] = useState<Record<string, string>>({});
  const [credentialBackend, setCredentialBackend] = useState('local');
  const [endpointTransferMessage, setEndpointTransferMessage] = useState<string | null>(null);
  const [contextWindowDrafts, setContextWindowDrafts] = useState<Record<string, string>>({});
  const endpointImportRef = useRef<HTMLInputElement>(null);
  const modelDiscoveryGeneration = useRef<Record<string, number>>({});
  const modelProfilesRef = useRef<ChatModelPreset[]>([]);
  const { refresh: refreshAiSettings } = useAiSettings();
  const { preference: themePreference, fontScale, setFontScale } = useTheme();
  // M2-3：错误遥测开关（默认关闭）
  const [telemetryEnabled, setTelemetryEnabled] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  useEffect(() => {
    modelProfilesRef.current = modelProfiles;
  }, [modelProfiles]);

  async function loadSettings() {
    if (!window.biof3Desktop) return;
    const s = await window.biof3Desktop.aiSettings.get();
    setSettings(s);
    const profiles = Array.isArray(s.model_profiles)
      ? (s.model_profiles as ChatModelPreset[])
          .filter((profile) => profile?.id && profile?.model)
          .map(normalizeLegacyUserModelProfile)
          .map((profile) => ({ ...profile, defaultModel: profile.defaultModel || profile.model }))
      : [];
    const statuses = (s.credential_status as Record<string, boolean>) || {};
    setModelProfiles(profiles);
    setRoleBindings((s.model_role_bindings as Partial<Record<ModelRole, string>>) || {});
    setFallbackEnabled(s.model_fallback_enabled === true);
    setFallbackBindings((s.model_fallback_bindings as Partial<Record<ModelRole, string[]>>) || {});
    setCredentialStatus(statuses);
    setCredentialBackend(String(s.credential_backend || 'local'));
    await refreshAiSettings();
    setTelemetryEnabled(s.telemetry_enabled === true);
    profiles
      .filter((profile) =>
        isUserConfigurableModelProvider(profile.provider) &&
        ((modelProviderRequiresCredential(profile.provider) && statuses[credentialId(profile)]) ||
          (!modelProviderRequiresCredential(profile.provider) && Boolean(profile.baseUrl)))
      )
      .forEach((profile) => void discoverModels(profile, '', true));
  }

  async function handleSave() {
    if (!window.biof3Desktop) return;
    setSaving(true);
    setSaved(false);
    const nextProfileErrors = Object.fromEntries(
      modelProfiles
        .filter((profile) => isUserConfigurableModelProvider(profile.provider))
        .map((profile) => [profile.id, validateUserModelProfile(profile)])
        .filter((entry): entry is [string, string] => Boolean(entry[1]))
    );
    if (Object.keys(nextProfileErrors).length > 0) {
      setProfileErrors(nextProfileErrors);
      setSaving(false);
      return;
    }
    setProfileErrors({});
    const profiles = modelProfiles
      .filter((profile) => profile.id.trim() && profile.model.trim())
      .map((profile) => ({
        ...profile,
        defaultModel: profile.defaultModel || profile.model,
        roles: MODEL_ROLES.filter((role) => roleBindings[role.id] === profile.id).map((role) => role.id),
      }));
    const chatProfile = profiles.find((profile) => profile.id === roleBindings.chat);
    const embedProfile = profiles.find((profile) => profile.id === roleBindings.embedding);
    await window.biof3Desktop.aiSettings.save({
      model_profiles: profiles,
      model_role_bindings: roleBindings,
      model_fallback_enabled: fallbackEnabled,
      model_fallback_bindings: fallbackBindings,
      credential_updates: Object.fromEntries(Object.entries(credentialInputs).filter(([, value]) => value.trim())),
      // Compatibility snapshot for older renderer builds. The Gateway only
      // reads ModelProfiles and role bindings.
      chat_model_presets: profiles.filter((profile) => profile.capabilities?.includes('chat')).map(({ id, label, provider, model, defaultModel, baseUrl, contextWindow }) => ({ id, label, provider, model, defaultModel, baseUrl, contextWindow })),
      active_chat_model_id: roleBindings.chat,
      llm_provider: chatProfile?.provider,
      embed_provider: embedProfile?.provider,
      telemetry_enabled: telemetryEnabled,
    });
    setSaving(false);
    setSaved(true);
    setCredentialInputs({});
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

  async function discoverModels(profile: ChatModelPreset, apiKey = '', silent = false) {
    if (!window.biof3Desktop) return;
    const generation = (modelDiscoveryGeneration.current[profile.id] || 0) + 1;
    modelDiscoveryGeneration.current[profile.id] = generation;
    setLoadingModels((current) => ({ ...current, [profile.id]: true }));
    try {
      const result = await window.biof3Desktop.aiSettings.listModels(
        profile as unknown as Record<string, unknown>,
        apiKey
      );
      if (modelDiscoveryGeneration.current[profile.id] !== generation) return;
      if (result.ok && result.models.length > 0) {
        setAvailableModels((current) => ({ ...current, [profile.id]: result.models }));
        setModelProfiles((profiles) => profiles.map((candidate) =>
          candidate.id === profile.id
                ? {
                ...candidate,
                model: result.models.includes(candidate.model) ? candidate.model : result.models[0],
                defaultModel: result.models.includes(candidate.defaultModel || candidate.model)
                  ? (candidate.defaultModel || candidate.model)
                  : result.models[0],
              }
            : candidate
        ));
      }
      if (!silent || result.ok) {
        setTestResult((prev) => ({
          ...prev,
          [profile.id]: { ok: result.ok, message: result.message },
        }));
      }
    } catch (error) {
      if (modelDiscoveryGeneration.current[profile.id] !== generation) return;
      if (!silent) {
        setTestResult((current) => ({
          ...current,
          [profile.id]: {
            ok: false,
            message: error instanceof Error ? error.message : '模型列表请求失败',
          },
        }));
      }
    } finally {
      if (modelDiscoveryGeneration.current[profile.id] === generation) {
        setLoadingModels((current) => ({ ...current, [profile.id]: false }));
      }
    }
  }

  function invalidateModelDiscovery(id: string) {
    modelDiscoveryGeneration.current[id] = (modelDiscoveryGeneration.current[id] || 0) + 1;
    setLoadingModels((current) => ({ ...current, [id]: false }));
  }

  function clearProfileRuntimeState(id: string) {
    invalidateModelDiscovery(id);
    setAvailableModels((current) => ({ ...current, [id]: [] }));
    setTestResult((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    setProfileErrors((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
  }

  function clearCredentialUi(id: string) {
    setCredentialInputs((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    setCredentialStatus((current) => ({ ...current, [id]: false }));
    setVisibleCredentialIds((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
  }

  function updateProfile(id: string, patch: Partial<ChatModelPreset>) {
    setModelProfiles((profiles) => profiles.map((profile) => {
      if (profile.id !== id) return profile;
      const next = { ...profile, ...patch, id };
      return next;
    }));
  }

  function updateProfileBaseUrl(profile: ChatModelPreset, baseUrl: string | undefined) {
    setModelProfiles((profiles) => profiles.map((candidate) => candidate.id === profile.id
      ? {
          ...candidate,
          baseUrl,
        }
      : candidate));
    clearProfileRuntimeState(profile.id);
  }

  function updateProfileProvider(currentProfile: ChatModelPreset, provider: UserModelProvider) {
    const nextCredentialRef = modelProviderCredentialRef(provider, currentProfile.id);
    const providerDefaultsForProvider = providerDefaults(provider, currentProfile.id);
    setModelProfiles((profiles) => profiles.map((profile) => {
      if (profile.id !== currentProfile.id) return profile;
      return {
        ...profile,
        ...providerDefaultsForProvider,
        id: currentProfile.id,
        provider,
        protocol: modelProviderProtocol(provider),
        // UI-038: 切换供应商时保留用户已手选的模型/默认模型，不再清空；
        // 仅当原手选为空时回落到该渠道默认值，满足「带入默认模型」意图。
        model: profile.model || providerDefaultsForProvider.model || '',
        defaultModel: profile.defaultModel || profile.model || '',
        roles: profile.roles || [],
        parameters: profile.parameters || {},
      };
    }));
    clearProfileRuntimeState(currentProfile.id);
    if (currentProfile.provider !== 'deepseek') clearCredentialUi(credentialId(currentProfile));
    clearCredentialUi(nextCredentialRef.slice(nextCredentialRef.indexOf(':') + 1));
  }

  function addProfile() {
    const id = `model-${Date.now()}`;
    setModelProfiles((profiles) => [...profiles, {
      id,
      label: '自定义 API',
      provider: 'openai-compatible',
      model: '',
      defaultModel: '',
      ...providerDefaults('openai-compatible', id),
      roles: [],
      parameters: {},
    }]);
  }

  function removeProfile(id: string) {
    setModelProfiles((profiles) => profiles.filter((profile) => profile.id !== id));
    setRoleBindings((bindings) => Object.fromEntries(Object.entries(bindings).filter(([, value]) => value !== id)));
    setFallbackBindings((bindings) => Object.fromEntries(Object.entries(bindings).map(([role, ids]) => [role, (ids || []).filter((value) => value !== id)])));
  }

  function downloadEndpointFile(filename: string, content: string, type: string) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function readCredential(id: string): Promise<string> {
    const inline = credentialInputs[id]?.trim();
    if (inline) return inline;
    const result = await window.biof3Desktop?.aiSettings.getCredential(id);
    return result?.ok ? result.apiKey : '';
  }

  async function revealCredential(id: string) {
    const value = await readCredential(id);
    if (!value) {
      setEndpointTransferMessage('当前渠道没有可读取的 Key，请重新填写后保存。');
      return;
    }
    setCredentialInputs((current) => ({ ...current, [id]: value }));
    setVisibleCredentialIds((current) => ({ ...current, [id]: true }));
  }

  async function copyCredential(id: string) {
    const value = await readCredential(id);
    if (!value) {
      setEndpointTransferMessage('当前渠道没有可复制的 Key，请重新填写后保存。');
      return;
    }
    await navigator.clipboard.writeText(value);
    setCopiedCredentialId(id);
    setTimeout(() => setCopiedCredentialId((current) => current === id ? null : current), 1600);
  }

  async function exportEndpoints(format: 'json' | 'csv') {
    if (!window.biof3Desktop?.aiSettings.getCredential) return;
    if (!window.confirm('导出文件将包含 API Key 明文。请仅保存到安全位置，确定继续吗？')) return;
    const apiKeys: Record<string, string> = {};
    await Promise.all(userModelProfiles.map(async (profile) => {
      const value = await readCredential(credentialId(profile));
      if (value) apiKeys[profile.id] = value;
    }));
    const content = format === 'json'
      ? exportEndpointProfilesJson(userModelProfiles, apiKeys)
      : exportEndpointProfilesCsv(userModelProfiles, apiKeys);
    downloadEndpointFile(
      `gewu-api-endpoints.${format}`,
      content,
      format === 'json' ? 'application/json;charset=utf-8' : 'text/csv;charset=utf-8'
    );
    setEndpointTransferMessage(`已导出 ${userModelProfiles.length} 个渠道（含 ${Object.keys(apiKeys).length} 个 Key）`);
  }

  async function importEndpoints(file: File) {
    try {
      const format = file.name.toLowerCase().endsWith('.csv') ? 'csv' : 'json';
      const parsed = parseEndpointProfiles(await file.text(), format);
      const imported = parsed.profiles;
      const importedCredentials: Record<string, string> = {};
      const changedProviderCredentialIds = new Set<string>();
      const importedProfileIds = new Set<string>();
      const next = [...modelProfilesRef.current];
      imported.forEach((item) => {
          const existingIndex = next.findIndex((profile) =>
            (item.id && profile.id === item.id) ||
            (profile.baseUrl && profile.baseUrl.replace(/\/$/, '') === item.baseUrl)
          );
          const existing = existingIndex >= 0 ? next[existingIndex] : undefined;
          const id = existing?.id || item.id || `model-${Date.now()}-${next.length}`;
          const provider = isUserConfigurableModelProvider(item.provider || '')
            ? item.provider as UserModelProvider
            : inferUserModelProvider({ label: item.supplier, baseUrl: item.baseUrl });
          const profile: ChatModelPreset = {
            ...(existing || providerDefaults(provider, id)),
            id,
            label: item.supplier,
            provider,
            protocol: modelProviderProtocol(provider),
            baseUrl: item.baseUrl,
            model: existing?.model || item.defaultModel,
            defaultModel: item.defaultModel,
            credentialRef: existing?.provider === provider && existing.credentialRef
              ? existing.credentialRef
              : modelProviderCredentialRef(provider, id),
            capabilities: existing?.capabilities || ['chat', 'streaming', 'tools'],
            roles: existing?.roles || [],
            parameters: existing?.parameters || {},
          };
          importedProfileIds.add(id);
          if (existing && existing.provider !== provider) {
            changedProviderCredentialIds.add(credentialId(existing));
            changedProviderCredentialIds.add(credentialId(profile));
          }
          if (item.apiKey) importedCredentials[credentialId(profile)] = item.apiKey;
          if (existingIndex >= 0) next[existingIndex] = profile;
          else next.push(profile);
      });
      setModelProfiles(next);
      importedProfileIds.forEach((id) => clearProfileRuntimeState(id));
      changedProviderCredentialIds.forEach((id) => clearCredentialUi(id));
      if (Object.keys(importedCredentials).length > 0) {
        setCredentialInputs((current) => ({ ...current, ...importedCredentials }));
      }
      const warning = parsed.warnings.length ? `；${parsed.warnings.join(' ')}` : '';
      setEndpointTransferMessage(`已导入 ${imported.length} 个渠道，已合并现有配置${warning}`);
    } catch (error) {
      setEndpointTransferMessage(`导入失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      if (endpointImportRef.current) endpointImportRef.current.value = '';
    }
  }

  const activeSectionMeta = SETTINGS_SECTIONS.find((item) => item.id === activeSection) || SETTINGS_SECTIONS[0];
  const showAiSave = activeSection === 'models';
  const userModelProfiles = modelProfiles.filter((profile) =>
    isUserConfigurableModelProvider(profile.provider)
  );
  const agentPrimaryProfileId = roleBindings.agent || roleBindings.chat;
  const agentFallbackProfileIds = fallbackBindings.agent || [];
  const agentFallbackCandidates = modelProfiles.filter((profile) =>
    profile.id !== agentPrimaryProfileId &&
    profile.capabilities?.includes('chat') &&
    profile.capabilities?.includes('tools')
  );

  return (
    <div className="gewu-desktop-panel" role="dialog" aria-label="设置">
      <div className="gewu-desktop-panel__header">
        <span className="gewu-desktop-panel__icon">
          <Icon name="settings" size={18} />
        </span>
        <div className="gewu-desktop-panel__titles">
          <h2 className="gewu-desktop-panel__title">设置</h2>
          <p className="gewu-desktop-panel__subtitle">{activeSectionMeta.description}</p>
        </div>
        <button
          type="button"
          className="gewu-desktop-panel__close"
          onClick={onClose}
          aria-label="关闭"
        >
          <Icon name="x" size={16} />
        </button>
      </div>

      <div className="gewu-settings-layout">
        <nav className="gewu-settings-nav" aria-label="设置分类">
          {SETTINGS_SECTIONS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`gewu-settings-nav__item${activeSection === item.id ? ' active' : ''}`}
              onClick={() => setActiveSection(item.id)}
            >
              <Icon name={item.icon} size={15} />
              <span>
                <strong>{item.label}</strong>
                <small>{item.description}</small>
              </span>
            </button>
          ))}
        </nav>

        <div className="gewu-desktop-panel__body gewu-settings-content">
        {activeSection === 'general' && (
          <section className="gewu-settings-section">
            <div className="gewu-settings-section__heading">
              <h3>常规</h3>
              <p>调整应用外观与基础使用偏好。</p>
            </div>
        <div className="gewu-field">
          <label className="gewu-field__label">外观主题</label>
          <ThemeControl menuPlacement="bottom" />
          <span className="gewu-badge">
            当前：
            {themePreference === 'system'
              ? '跟随系统'
              : themePreference === 'light'
                ? '日间'
                : '夜间'}
          </span>
          <p className="gewu-field__hint">可跟随 macOS 外观，或固定使用日间/夜间模式。</p>
        </div>
        <div className="gewu-field">
          <label className="gewu-field__label" htmlFor="font-scale-input">界面字号</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              id="font-scale-input"
              type="number"
              min={Math.round(FONT_SCALE_MIN * 100)}
              max={Math.round(FONT_SCALE_MAX * 100)}
              step={5}
              value={Math.round(fontScale * 100)}
              onChange={(e) => {
                const pct = Number(e.target.value);
                if (Number.isFinite(pct)) setFontScale(pct / 100);
              }}
              style={{ width: 90, height: 32, textAlign: 'right',
                border: '1px solid var(--gewu-border)', borderRadius: 6,
                background: 'var(--gewu-bg-surface)', color: 'var(--gewu-text)' }}
            />
            <span style={{ color: 'var(--gewu-text-secondary)', fontSize: 13 }}>%</span>
          </div>
          <p className="gewu-field__hint">调整应用界面的文字大小（100% = 默认；80%–140%），图标和布局尺寸不受影响。</p>
        </div>
        <div className="gewu-field">
          <label className="gewu-field__label">主题色</label>
          <AccentControl />
          <p className="gewu-field__hint">更换应用的强调配色（按钮、链接、高亮等），明暗主题与布局不受影响。</p>
        </div>

          </section>
        )}

        {activeSection === 'models' && (
          <section className="gewu-settings-section gewu-settings-section--models">
            <div className="gewu-settings-section__heading">
              <h3>API Endpoint</h3>
              <p>
                为每个渠道选择接口协议，再配置供应商、Base URL、Key 和默认模型；模型能力由后端统一适配。Key
                {credentialBackend === 'keychain' ? ' 保存在 macOS Keychain。' : ' 保存在独立本地凭据存储。'}
              </p>
              <p className="gewu-field__hint">Key 默认隐藏，可点击眼睛显示或复制；导出前会确认是否把 Key 写入文件，请仅保存到安全位置。</p>
            </div>
            <div className="gewu-model-list">
              {userModelProfiles.length > 0 && (
                <div className="gewu-endpoint-list-header" aria-hidden="true">
                  <span>协议</span>
                  <span>供应商</span>
                  <span>Base URL</span>
                  <span>Key</span>
                  <span>默认模型</span>
                  <span>上下文</span>
                  <span>思考</span>
                  <span>连通性</span>
                  <span />
                </div>
              )}
              {userModelProfiles.map((profile) => {
                const id = credentialId(profile);
                const configured = !!credentialStatus[id];
                const discoveredModels = availableModels[profile.id] || [];
                const configuredDefault = profile.defaultModel || profile.model;
                const modelOptions = configuredDefault && !discoveredModels.includes(configuredDefault)
                  ? [configuredDefault, ...discoveredModels]
                  : discoveredModels;
                const discovering = loadingModels[profile.id] === true;
                const profileError = profileErrors[profile.id];
                const connectionResult = testResult[profile.id];
                const chatReady =
                  isChatSelectableProfile(profile) &&
                  validateUserModelProfile(profile) === null &&
                  connectionResult?.ok === true;
                const connectionLabel = discovering
                  ? '测试中'
                  : profileError
                    ? '需补全'
                    : connectionResult?.ok
                      ? '已连接'
                      : connectionResult
                        ? '重试'
                        : '测试';
                const connectionTitle = profileError
                  || connectionResult?.message
                  || (chatReady ? '连接正常，可在聊天窗口选择' : '测试接口并获取模型列表');
                return (
                <div key={profile.id} className="gewu-model-preset gewu-endpoint-card">
                  <div className="gewu-endpoint-card__grid" role="group" aria-label={`${profile.label || '自定义'} 模型渠道`}>
                    <span className="gewu-endpoint-field-label" aria-hidden="true">协议</span>
                    <select
                      className="gewu-select"
                      value={profile.provider}
                      onChange={(event) => updateProfileProvider(
                        profile,
                        event.target.value as UserModelProvider
                      )}
                      aria-label={`${profile.label || '自定义渠道'} 接口协议`}
                    >
                      {USER_MODEL_PROVIDER_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                    <span className="gewu-endpoint-field-label" aria-hidden="true">供应商</span>
                    <input
                      className="gewu-input"
                      value={profile.label}
                      onChange={(event) => updateProfile(profile.id, { label: event.target.value })}
                      placeholder="供应商"
                      aria-label="供应商"
                    />
                    <span className="gewu-endpoint-field-label" aria-hidden="true">Base URL</span>
                    <input
                      className="gewu-input"
                      value={endpointBaseUrl(profile)}
                      onChange={(e) => {
                        updateProfileBaseUrl(profile, e.target.value || undefined);
                      }}
                      placeholder="Base URL"
                      aria-label="Base URL"
                      title={endpointBaseUrl(profile)}
                    />
                    <span className="gewu-endpoint-field-label" aria-hidden="true">Key</span>
                    <div className="gewu-endpoint-key-field">
                      <input
                        type={visibleCredentialIds[id] ? 'text' : 'password'}
                        className="gewu-input"
                        value={credentialInputs[id] || ''}
                        onChange={(e) => {
                          setCredentialInputs((current) => ({ ...current, [id]: e.target.value }));
                          clearProfileRuntimeState(profile.id);
                        }}
                        placeholder={configured ? 'Key 已配置' : 'API Key'}
                        aria-label={configured ? 'API Key 已配置，输入新 Key 可覆盖' : 'API Key'}
                      />
                      <button
                        type="button"
                        className="gewu-endpoint-key-action"
                        onClick={() => void revealCredential(id)}
                        aria-label="显示 API Key"
                        title="显示 API Key"
                      >
                        <Icon name={visibleCredentialIds[id] ? 'eye-off' : 'eye'} size={13} />
                      </button>
                      <button
                        type="button"
                        className="gewu-endpoint-key-action"
                        onClick={() => void copyCredential(id)}
                        aria-label="复制 API Key"
                        title="复制 API Key"
                      >
                        {copiedCredentialId === id ? <Icon name="check" size={13} /> : <Icon name="copy" size={13} />}
                      </button>
                    </div>
                    <span className="gewu-endpoint-field-label" aria-hidden="true">默认模型</span>
                    <select
                      className="gewu-select"
                      value={configuredDefault}
                      onChange={(e) => updateProfile(profile.id, { defaultModel: e.target.value, model: profile.model || e.target.value })}
                      disabled={discovering || modelOptions.length === 0}
                      aria-label="默认模型"
                      title={configuredDefault || '测试连接后选择模型'}
                    >
                      {modelOptions.length === 0 && (
                        <option value="">{discovering ? '获取中…' : '先测试'}</option>
                      )}
                      {modelOptions.map((model) => <option key={model} value={model}>{model}</option>)}
                    </select>
                    <span className="gewu-endpoint-field-label" aria-hidden="true">上下文</span>
                    <input
                      type="text"
                      className="gewu-input gewu-input--sm"
                      // Render the user's literal text during editing so the
                      // cursor doesn't jump mid-typing; only format on blur
                      // and when state has a numeric value.
                      value={contextWindowDrafts[profile.id] ?? formatContextWindow(profile.contextWindow)}
                      onChange={(e) => {
                        const text = e.target.value;
                        setContextWindowDrafts((current) => ({ ...current, [profile.id]: text }));
                        const parsed = parseContextWindow(text);
                        updateProfile(profile.id, { contextWindow: parsed });
                      }}
                      onBlur={(e) => {
                        // Drop the draft so subsequent renders show the
                        // canonical formatted value (e.g. "128K" instead of
                        // any partial state).
                        setContextWindowDrafts((current) => {
                          if (!(profile.id in current)) return current;
                          const next = { ...current };
                          delete next[profile.id];
                          return next;
                        });
                        const parsed = parseContextWindow(e.target.value);
                        updateProfile(profile.id, { contextWindow: parsed });
                      }}
                      placeholder="64K / 1M"
                      aria-label="上下文窗口"
                      title="模型上下文窗口，如 64K、128K、1M；留空则使用默认值"
                    />
                    <span className="gewu-endpoint-field-label" aria-hidden="true">思考</span>
                    <label
                      className="gewu-endpoint-reasoning"
                      title="声明该渠道支持思考档位：勾选后 composer 的档位控件才会出现，并按协议映射上游参数"
                    >
                      <input
                        type="checkbox"
                        checked={(profile.capabilities || []).includes('reasoning')}
                        onChange={(e) => {
                          const current = profile.capabilities || ['chat', 'streaming', 'tools'];
                          const next = e.target.checked
                            ? Array.from(new Set([...current, 'reasoning']))
                            : current.filter((cap) => cap !== 'reasoning');
                          updateProfile(profile.id, { capabilities: next });
                        }}
                        aria-label={`${profile.label || '自定义渠道'} 支持思考档位`}
                      />
                    </label>
                    <span className="gewu-endpoint-field-label" aria-hidden="true">连通性</span>
                    <button
                      type="button"
                      className={`gewu-btn gewu-btn--ghost gewu-btn--sm gewu-endpoint-card__test${connectionResult?.ok ? ' is-ok' : connectionResult || profileError ? ' is-error' : ''}`}
                      onClick={() => void discoverModels(profile, credentialInputs[id] || '')}
                      disabled={
                        discovering ||
                        !endpointBaseUrl(profile).trim() ||
                        (modelProviderRequiresCredential(profile.provider) && !configured && !credentialInputs[id])
                      }
                      title={connectionTitle}
                    >
                      {connectionResult?.ok && <Icon name="check" size={12} />}
                      {connectionLabel}
                    </button>
                    <span className="gewu-endpoint-field-label" aria-hidden="true">删除</span>
                    <button
                      type="button"
                      className="gewu-endpoint-card__delete"
                      onClick={() => {
                        const label = profile.label?.trim() || '该渠道';
                        if (!window.confirm(`删除「${label}」？已保存的 URL、Key 与默认模型都会从面板移除，回收站不可恢复。`)) return;
                        removeProfile(profile.id);
                      }}
                      aria-label={`删除 ${profile.label || '该渠道'}`}
                      title="删除渠道"
                    >
                      <Icon name="trash" size={14} />
                    </button>
                  </div>
                </div>
              );
              })}
              {userModelProfiles.length === 0 && <p className="gewu-field__hint">尚未配置模型。请添加 API 渠道并填写连接信息。</p>}
            </div>
            <div className="gewu-model-fallback" aria-label="Agent 模型自动容错">
              <label className="gewu-model-fallback__toggle">
                <input
                  type="checkbox"
                  checked={fallbackEnabled}
                  onChange={(event) => setFallbackEnabled(event.target.checked)}
                />
                <span>
                  <strong>Agent 自动容错</strong>
                  <small>主模型遇到限流、服务异常或最终整理协议失败时，按顺序尝试已选备用模型。</small>
                </span>
              </label>
              <div className="gewu-model-fallback__choices" aria-label="Agent 备用模型">
                {agentFallbackCandidates.map((profile) => {
                  const selected = agentFallbackProfileIds.includes(profile.id);
                  return (
                    <label key={profile.id} className={selected ? 'is-selected' : ''}>
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={(event) => setFallbackBindings((current) => {
                          const existing = current.agent || [];
                          const nextAgent = event.target.checked
                            ? [...existing.filter((id) => id !== profile.id), profile.id]
                            : existing.filter((id) => id !== profile.id);
                          return { ...current, agent: nextAgent };
                        })}
                      />
                      <span>{profile.label || profile.model}</span>
                    </label>
                  );
                })}
                {agentFallbackCandidates.length === 0 && (
                  <span className="gewu-field__hint">还没有其他支持工具调用的模型渠道。</span>
                )}
              </div>
            </div>
            <div className="gewu-endpoint-list-actions">
              <button type="button" className="gewu-btn gewu-btn--ghost gewu-btn--sm" onClick={addProfile}>
                添加 API 渠道
              </button>
              {userModelProfiles.length > 0 && (
                <div className="gewu-endpoint-transfer-actions">
                  <button type="button" className="gewu-btn gewu-btn--ghost gewu-btn--sm" onClick={() => exportEndpoints('json')}>
                    导出 JSON
                  </button>
                  <button type="button" className="gewu-btn gewu-btn--ghost gewu-btn--sm" onClick={() => exportEndpoints('csv')}>
                    导出 CSV
                  </button>
                  <button type="button" className="gewu-btn gewu-btn--ghost gewu-btn--sm" onClick={() => endpointImportRef.current?.click()}>
                    导入配置
                  </button>
                  <input
                    ref={endpointImportRef}
                    type="file"
                    accept=".json,.csv,application/json,text/csv"
                    style={{ display: 'none' }}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) void importEndpoints(file);
                    }}
                  />
                  {endpointTransferMessage && <span className="gewu-field__hint">{endpointTransferMessage}</span>}
                </div>
              )}
            </div>

          </section>
        )}

        {activeSection === 'compute' && (
          <section className="gewu-settings-section">
            <div className="gewu-settings-section__heading">
              <h3>计算与数据</h3>
              <p>设置分析任务的执行位置，并查看本地数据占用。</p>
            </div>
        <ComputeExecution />

        <RemoteTargets />

        <hr className="gewu-section-divider" />

        <DataManagement />

        <hr className="gewu-section-divider" />

        <HarnessEnvironment />

        <hr className="gewu-section-divider" />

        <TrashManagement />

          </section>
        )}

        {activeSection === 'usage' && (
          <section className="gewu-settings-section">
            <div className="gewu-settings-section__heading">
              <h3>用量与资源</h3>
              <p>查看模型成本、缓存命中和当前机器容量，不保存原始数据或密钥。</p>
            </div>
            <UsageResourcePanel />
          </section>
        )}

        {activeSection === 'maintenance' && (
          <section className="gewu-settings-section">
            <div className="gewu-settings-section__heading">
              <h3>隐私与维护</h3>
              <p>控制匿名错误反馈，并处理诊断和应用更新。</p>
            </div>
        {/* M2-3：可选错误遥测开关（默认关闭，用户主动开启） */}
        <div className="gewu-field">
          <label className="gewu-field__label">开启错误反馈</label>
          <div className="gewu-toggle-row">
            <input
              type="checkbox"
              id="gewu-telemetry-toggle"
              className="gewu-toggle"
              checked={telemetryEnabled}
              onChange={(e) => handleToggleTelemetry(e.target.checked)}
            />
            <label htmlFor="gewu-telemetry-toggle" className="gewu-toggle-label">
              {telemetryEnabled ? '已开启' : '已关闭'}
            </label>
          </div>
          <p className="gewu-field__hint">
            开启后，分析出错时仅上报错误分类与应用版本（不含任何用户数据、文件路径或文件名），
            用于改进工具稳定性。可随时关闭。
          </p>
        </div>
        <div className="gewu-maintenance-actions">
          <div className="gewu-maintenance-row">
            <div>
              <strong>应用更新</strong>
              <p>检查并下载适用于当前 Mac 的安装包。</p>
            </div>
            <UpdateChecker />
          </div>
          <div className="gewu-maintenance-row">
            <div>
              <strong>诊断日志</strong>
              <p>导出用于排查问题的本地诊断信息。</p>
            </div>
            <ExportDiagnostic />
          </div>
        </div>
          </section>
        )}

        {activeSection === 'experimental' && (
          <section className="gewu-settings-section">
            <div className="gewu-settings-section__heading">
              <h3>实验特性</h3>
              <p>这些开关在开发态已验证，但默认关闭；打开前请确认你的使用场景。</p>
            </div>
            <ExperimentalFeaturesSection bridge={window.biof3?.agentWorkbenchFlags} />
          </section>
        )}
        </div>
      </div>

      {showAiSave && <div className="gewu-desktop-panel__footer gewu-settings-footer">
        {saved && (
          <span className="gewu-saved-toast">
            <Icon name="check" size={14} /> 已保存
          </span>
        )}
        <button
          type="button"
          className="gewu-btn gewu-btn--primary gewu-btn--sm"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? '保存中…' : '保存'}
        </button>
      </div>}
    </div>
  );
}

export default DesktopSettingsPanel;
