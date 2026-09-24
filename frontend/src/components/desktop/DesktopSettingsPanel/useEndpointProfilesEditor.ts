import { unknownText } from '@/lib/unknownText';
import { useEffect, useRef, useState } from 'react';
import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import {
  useAiSettings,
  type ChatModelPreset,
} from '@/hooks/useAiSettings';
import {
  inferUserModelProvider,
  isUserConfigurableModelProvider,
  modelProviderCredentialRef,
  modelProviderProtocol,
  modelProviderRequiresCredential,
  normalizeLegacyUserModelProfile,
  type UserModelProvider,
  validateUserModelProfile,
} from '@/lib/model-provider-options';
import {
  exportEndpointProfilesCsv,
  exportEndpointProfilesJson,
  parseEndpointProfiles,
} from '@/lib/model-endpoint-transfer';
import { credentialId } from './model-types';
import { MODEL_ROLES, providerDefaults, type ModelRole } from './model-types';
import { getBridge } from '@/lib/desktopBridge';

/**
 * BLOCK-92 Wave B-4 — API Endpoint（模型渠道）编辑器状态簇外迁
 * （原 DesktopSettingsPanel.tsx 内联，纯搬运零行为变化）：
 * 渠道 profiles / 角色绑定 / 容错绑定 / 凭据输入与状态 / 连通性测试 /
 * 上下文窗口草稿 / 导入导出全部由此承载；主组件只做 JSX 渲染与保存按钮。
 */
export function useEndpointProfilesEditor(): {
  settings: Record<string, unknown>;
  setSettings: Dispatch<SetStateAction<Record<string, unknown>>>;
  loadingModels: Record<string, boolean>;
  availableModels: Record<string, string[]>;
  testResult: Record<string, { ok: boolean; message: string }>;
  saving: boolean;
  saved: boolean;
  modelProfiles: ChatModelPreset[];
  roleBindings: Partial<Record<ModelRole, string>>;
  setRoleBindings: Dispatch<SetStateAction<Partial<Record<ModelRole, string>>>>;
  fallbackEnabled: boolean;
  setFallbackEnabled: Dispatch<SetStateAction<boolean>>;
  fallbackBindings: Partial<Record<ModelRole, string[]>>;
  setFallbackBindings: Dispatch<SetStateAction<Partial<Record<ModelRole, string[]>>>>;
  credentialInputs: Record<string, string>;
  setCredentialInputs: Dispatch<SetStateAction<Record<string, string>>>;
  credentialStatus: Record<string, boolean>;
  visibleCredentialIds: Record<string, boolean>;
  copiedCredentialId: string | null;
  profileErrors: Record<string, string>;
  credentialBackend: string;
  endpointTransferMessage: string | null;
  contextWindowDrafts: Record<string, string>;
  setContextWindowDrafts: Dispatch<SetStateAction<Record<string, string>>>;
  endpointImportRef: MutableRefObject<HTMLInputElement | null>;
  userModelProfiles: ChatModelPreset[];
  telemetryEnabled: boolean;
  setTelemetryEnabled: Dispatch<SetStateAction<boolean>>;
  loadSettings: () => Promise<void>;
  handleSave: () => Promise<void>;
  discoverModels: (profile: ChatModelPreset, apiKey?: string, silent?: boolean) => Promise<void>;
  clearProfileRuntimeState: (id: string) => void;
  updateProfile: (id: string, patch: Partial<ChatModelPreset>) => void;
  updateProfileBaseUrl: (profile: ChatModelPreset, baseUrl: string | undefined) => void;
  updateProfileProvider: (currentProfile: ChatModelPreset, provider: UserModelProvider) => void;
  addProfile: () => void;
  removeProfile: (id: string) => void;
  revealCredential: (id: string) => Promise<void>;
  copyCredential: (id: string) => Promise<void>;
  exportEndpoints: (format: 'json' | 'csv') => Promise<void>;
  importEndpoints: (file: File) => Promise<void>;
} {
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
  const endpointImportRef = useRef<HTMLInputElement | null>(null);
  const modelDiscoveryGeneration = useRef<Record<string, number>>({});
  const modelProfilesRef = useRef<ChatModelPreset[]>([]);
  const { refresh: refreshAiSettings } = useAiSettings();
  // M2-3：错误遥测开关（默认关闭）
  const [telemetryEnabled, setTelemetryEnabled] = useState(false);

  useEffect(() => {
    void loadSettings();
  }, []);

  useEffect(() => {
    modelProfilesRef.current = modelProfiles;
  }, [modelProfiles]);

  async function loadSettings() {
    // BLOCK-87 L4-2 收尾：走 getBridge 而非直引 window.biof3Desktop——投影
    // 环境下切 HTTP 桥（直引经 shim Proxy 拿到 undefined 会 TypeError）。
    const settingsBridge = getBridge('aiSettings');
    if (!settingsBridge) return;
    const s = await settingsBridge.get();
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
    setCredentialBackend(unknownText(s.credential_backend || 'local'));
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
    const settingsBridge = getBridge('aiSettings');
    if (!settingsBridge) return;
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
    await settingsBridge.save({
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
    void loadSettings();
  }

  async function discoverModels(profile: ChatModelPreset, apiKey = '', silent = false) {
    const settingsBridge = getBridge('aiSettings');
    if (!settingsBridge) return;
    const generation = (modelDiscoveryGeneration.current[profile.id] || 0) + 1;
    modelDiscoveryGeneration.current[profile.id] = generation;
    setLoadingModels((current) => ({ ...current, [profile.id]: true }));
    try {
      const result = await settingsBridge.listModels(
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
    // 投影桥恒 ok:false（凭据明文不过投影 HTTP）→ 返回空串走既有降级提示。
    const result = await getBridge('aiSettings')?.getCredential(id);
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

  const userModelProfiles = modelProfiles.filter((profile) =>
    isUserConfigurableModelProvider(profile.provider)
  );

  async function exportEndpoints(format: 'json' | 'csv') {
    if (!getBridge('aiSettings')?.getCredential) return;
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

  return {
    settings,
    setSettings,
    loadingModels,
    availableModels,
    testResult,
    saving,
    saved,
    modelProfiles,
    roleBindings,
    setRoleBindings,
    fallbackEnabled,
    setFallbackEnabled,
    fallbackBindings,
    setFallbackBindings,
    credentialInputs,
    setCredentialInputs,
    credentialStatus,
    visibleCredentialIds,
    copiedCredentialId,
    profileErrors,
    credentialBackend,
    endpointTransferMessage,
    contextWindowDrafts,
    setContextWindowDrafts,
    endpointImportRef,
    userModelProfiles,
    telemetryEnabled,
    setTelemetryEnabled,
    loadSettings,
    handleSave,
    discoverModels,
    clearProfileRuntimeState,
    updateProfile,
    updateProfileBaseUrl,
    updateProfileProvider,
    addProfile,
    removeProfile,
    revealCredential,
    copyCredential,
    exportEndpoints,
    importEndpoints,
  };
}
