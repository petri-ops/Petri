/**
 * DesktopSettingsPanel — 设置浮动面板（从左下角 dock 弹出）
 *
 * 内容与原 DesktopSettingsModal 相同，但渲染为浮动面板而非全屏遮罩模态。
 */

import React, { useState } from 'react';
import { Icon } from '@/components/icons/Icon';
import { ThemeControl } from './ThemeControl';
import { useTheme, FONT_SCALE_MIN, FONT_SCALE_MAX } from '@/themes/ThemeProvider';
import { AccentControl } from './AccentControl';
import { SettingsNav } from './DesktopSettingsPanel/SettingsNav';
import { MotionControl } from './DesktopSettingsPanel/sections/MotionControl';
import { NetworkProxyPanel } from './DesktopSettingsPanel/sections/NetworkProxyPanel';
import { RuntimePolicyPanel } from './DesktopSettingsPanel/sections/RuntimePolicyPanel';
import { MaintenanceSection } from './DesktopSettingsPanel/MaintenanceSection';
import { UsageSection } from './DesktopSettingsPanel/UsageSection';
import { useSettingsTransferState } from './DesktopSettingsPanel/useSettingsTransferState';
import { SettingsToolbar } from './DesktopSettingsPanel/SettingsToolbar';
import {
  endpointBaseUrl,
  isChatSelectableProfile,
  modelProviderRequiresCredential,
  USER_MODEL_PROVIDER_OPTIONS,
  type UserModelProvider,
  validateUserModelProfile,
} from '@/lib/model-provider-options';
import { parseContextWindow, formatContextWindow } from '@/lib/format-context-window';
import { getBridge } from '@/lib/desktopBridge';
import { VisionRoleBinding, hasVisionCapability } from './DesktopSettingsPanel/VisionRoleBinding';
import { ExperimentalFeaturesSection } from '@/components/settings/ExperimentalFeaturesSection';
// UI-393 — 返回按钮样式单一真源（与 Skills/知识空间页头同款 backBtn）
import backStyles from '@/pages/global-page.module.css';

// ── BLOCK-9.2 PHASE 1: types + helpers + section subcomponents ──
import { Props, SettingsSection, SETTINGS_SECTIONS } from './DesktopSettingsPanel/types';
// BLOCK-92 Wave B-4 — API Endpoint 编辑器状态簇外迁（渠道/角色/凭据/连通性/导入导出）。
import { useEndpointProfilesEditor } from './DesktopSettingsPanel/useEndpointProfilesEditor';
// BLOCK-163 W3 P9（MDL-4）— 按模型成本/用量面板（usage-mine models 聚合）
// BLOCK-163 W3 P10（KNW-5）— 记忆治理面板（facts 单条遗忘+摘要清除）
import { MemoryPanel } from './DesktopSettingsPanel/sections/MemoryPanel';
// BLOCK-160 W2 P2（ORC-1）— Agent 用户规则面板（rules.json CRUD 读面）
import { AgentRulesPanel } from './DesktopSettingsPanel/sections/AgentRulesPanel';
import { DecisionConfigPanel } from './DesktopSettingsPanel/sections/DecisionConfigPanel';
import { GenerationDefaultsPanel } from './DesktopSettingsPanel/sections/GenerationDefaultsPanel';
import { KeymapPanel } from './DesktopSettingsPanel/sections/KeymapPanel';
import { ReasoningDefaultsPanel } from './DesktopSettingsPanel/sections/ReasoningDefaultsPanel';
import { GuardAckHistoryPanel } from '@/components/copilot/SimpleChat/GuardAckCard';
import { DataManagement } from './DesktopSettingsPanel/sections/DataManagement';
import { RemoteTargets } from './DesktopSettingsPanel/sections/RemoteTargets';
import { TrashManagement } from './DesktopSettingsPanel/sections/TrashManagement';
import { HarnessEnvironment } from './DesktopSettingsPanel/sections/HarnessEnvironment';
// UI-366 — 原全局「后端」页诊断面板并入「运行时与诊断」分区
import { useBackendStatus } from '@/components/backend/BackendStatusProvider';
import { TerminalPanel } from '@/pages/project-workspace';

import { credentialId } from './DesktopSettingsPanel/model-types';

export function DesktopSettingsPanel({ onClose, initialSection }: Props): React.ReactElement {
  // BLOCK-171 CP-3 — 深链初始节（?section= 经设置页透传；非法值由类型域外校验兜底 general）
  const [activeSection, setActiveSection] = useState<SettingsSection>(initialSection ?? 'general');
  const activeSectionMeta = SETTINGS_SECTIONS.find((item) => item.id === activeSection) || SETTINGS_SECTIONS[0];
  // BLOCK-201 W2 — 搜索/分区过滤/按区重置（状态机外置：面板已贴 code-size 预算，见钩子注释）
  const {
    query: settingsQuery,
    setQuery: setSettingsQuery,
    visibleSectionIds,
    resetFamilies,
    resetBusy,
    notice: settingsNotice,
    settingsVersion,
    bumpVersion,
    resetActiveSection,
  } = useSettingsTransferState({ activeSection, activeLabel: activeSectionMeta.label });
  const backendStatus = useBackendStatus();
  const { preference: themePreference, fontScale, setFontScale } = useTheme();
  // BLOCK-92 Wave B-4 — API Endpoint 编辑器状态簇外迁
  // （./useEndpointProfilesEditor.ts：渠道/角色绑定/凭据/连通性/导入导出，纯搬运零行为变化）。
  const {
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
  } = useEndpointProfilesEditor();

  // M2-3：遥测开关即时保存（无需点"保存"按钮，切了立即生效）
  async function handleToggleTelemetry(next: boolean) {
    setTelemetryEnabled(next);
    // BLOCK-87 L4-2 收尾：走 getBridge（投影下切 HTTP 桥，桌面同 IPC 面）。
    const settingsBridge = getBridge('aiSettings');
    if (!settingsBridge) return;
    try {
      await settingsBridge.save({
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

  const showAiSave = activeSection === 'models';

  const agentPrimaryProfileId = roleBindings.agent || roleBindings.chat;
  const agentFallbackProfileIds = fallbackBindings.agent || [];
  const agentFallbackCandidates = modelProfiles.filter((profile) =>
    profile.id !== agentPrimaryProfileId &&
    profile.capabilities?.includes('chat') &&
    profile.capabilities?.includes('tools')
  );

  return (
    <div className="petri-desktop-panel" role="dialog" aria-label="设置">
      <div className="petri-desktop-panel__header">
        {/* UI-393 — × 关闭按钮退役，左侧「← 返回」对齐 Skills/知识空间页头形态
            （backBtn 样式单一真源=global-page.module.css，onClose 语义即离开设置） */}
        <button
          type="button"
          className={backStyles.backBtn}
          onClick={onClose}
          aria-label="返回"
          title="返回"
        >
          <Icon name="arrow-left" size={16} />
          <span>返回</span>
        </button>
        <span className="petri-desktop-panel__icon">
          <Icon name="settings" size={18} />
        </span>
        <div className="petri-desktop-panel__titles">
          <h2 className="petri-desktop-panel__title">设置</h2>
          <p className="petri-desktop-panel__subtitle">{activeSectionMeta.description}</p>
        </div>
      </div>

      <SettingsToolbar
        query={settingsQuery}
        onQueryChange={setSettingsQuery}
        resultCount={visibleSectionIds.size}
        totalCount={SETTINGS_SECTIONS.length}
        resetLabel={resetFamilies.length > 0 ? `恢复「${activeSectionMeta.label}」默认` : undefined}
        onReset={resetFamilies.length > 0 ? () => void resetActiveSection() : undefined}
        busy={resetBusy}
      />
      {settingsNotice && (
        <p className="petri-field__hint" data-testid="settings-reset-notice" role="status">{settingsNotice}</p>
      )}

      <div className="petri-settings-layout">
        <SettingsNav
          visibleSectionIds={visibleSectionIds}
          activeSection={activeSection}
          onSelect={setActiveSection}
        />
        <div className="petri-desktop-panel__body petri-settings-content">
        {activeSection === 'general' && (
          <section className="petri-settings-section">
            <div className="petri-settings-section__heading">
              <h3>常规</h3>
              <p>调整应用外观与基础使用偏好。</p>
            </div>
        <div className="petri-field">
          <label className="petri-field__label">外观主题</label>
          <ThemeControl menuPlacement="bottom" />
          <span className="petri-badge">
            当前：
            {themePreference === 'system'
              ? '跟随系统'
              : themePreference === 'light'
                ? '日间'
                : '夜间'}
          </span>
          <p className="petri-field__hint">可跟随 macOS 外观，或固定使用日间/夜间模式。</p>
        </div>
        <div className="petri-field">
          <label className="petri-field__label" htmlFor="font-scale-input">界面字号</label>
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
                border: '1px solid var(--petri-border)', borderRadius: 6,
                background: 'var(--petri-bg-surface)', color: 'var(--petri-text)' }}
            />
            <span style={{ color: 'var(--petri-text-secondary)', fontSize: 13 }}>%</span>
          </div>
          <p className="petri-field__hint">调整应用界面的文字大小（100% = 默认；80%–140%），图标和布局尺寸不受影响。</p>
        </div>
        <div className="petri-field">
          <label className="petri-field__label">主题色</label>
          <AccentControl />
          <p className="petri-field__hint">更换应用的强调配色（按钮、链接、高亮等），明暗主题与布局不受影响。</p>
        </div>
        <MotionControl />
          </section>
        )}

        {activeSection === 'models' && (
          <section className="petri-settings-section petri-settings-section--models">
            <GenerationDefaultsPanel />
            <div className="petri-settings-section__heading">
              <h3>API Endpoint</h3>
              <p>
                为每个渠道选择接口协议，再配置供应商、Base URL、Key 和默认模型；模型能力由后端统一适配。Key
                {credentialBackend === 'keychain' ? ' 保存在 macOS Keychain。' : ' 保存在独立本地凭据存储。'}
              </p>
              <p className="petri-field__hint">Key 默认隐藏，可点击眼睛显示或复制；导出前会确认是否把 Key 写入文件，请仅保存到安全位置。</p>
            </div>
            <VisionRoleBinding
              profiles={userModelProfiles}
              value={roleBindings.vision}
              onChange={(profileId) => setRoleBindings((prev) => ({ ...prev, vision: profileId }))}
            />
            <div className="petri-model-list">
              {userModelProfiles.length > 0 && (
                <div className="petri-endpoint-list-header" aria-hidden="true">
                  <span>协议</span>
                  <span>供应商</span>
                  <span>Base URL</span>
                  <span>Key</span>
                  <span>默认模型</span>
                  <span>上下文</span>
                  <span>思考</span>
                  <span>视觉</span>
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
                <div key={profile.id} className="petri-model-preset petri-endpoint-card">
                  <div className="petri-endpoint-card__grid" role="group" aria-label={`${profile.label || '自定义'} 模型渠道`}>
                    <span className="petri-endpoint-field-label" aria-hidden="true">协议</span>
                    <select
                      className="petri-select"
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
                    <span className="petri-endpoint-field-label" aria-hidden="true">供应商</span>
                    <input
                      className="petri-input"
                      value={profile.label}
                      onChange={(event) => updateProfile(profile.id, { label: event.target.value })}
                      placeholder="供应商"
                      aria-label="供应商"
                    />
                    <span className="petri-endpoint-field-label" aria-hidden="true">Base URL</span>
                    <input
                      className="petri-input"
                      value={endpointBaseUrl(profile)}
                      onChange={(e) => {
                        updateProfileBaseUrl(profile, e.target.value || undefined);
                      }}
                      placeholder="Base URL"
                      aria-label="Base URL"
                      title={endpointBaseUrl(profile)}
                    />
                    <span className="petri-endpoint-field-label" aria-hidden="true">Key</span>
                    <div className="petri-endpoint-key-field">
                      <input
                        type={visibleCredentialIds[id] ? 'text' : 'password'}
                        className="petri-input"
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
                        className="petri-endpoint-key-action"
                        onClick={() => void revealCredential(id)}
                        aria-label="显示 API Key"
                        title="显示 API Key"
                      >
                        <Icon name={visibleCredentialIds[id] ? 'eye-off' : 'eye'} size={13} />
                      </button>
                      <button
                        type="button"
                        className="petri-endpoint-key-action"
                        onClick={() => void copyCredential(id)}
                        aria-label="复制 API Key"
                        title="复制 API Key"
                      >
                        {copiedCredentialId === id ? <Icon name="check" size={13} /> : <Icon name="copy" size={13} />}
                      </button>
                    </div>
                    <span className="petri-endpoint-field-label" aria-hidden="true">默认模型</span>
                    <select
                      className="petri-select"
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
                    <span className="petri-endpoint-field-label" aria-hidden="true">上下文</span>
                    <input
                      type="text"
                      className="petri-input petri-input--sm"
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
                    <span className="petri-endpoint-field-label" aria-hidden="true">思考</span>
                    <label
                      className="petri-endpoint-reasoning"
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
                    <span className="petri-endpoint-field-label" aria-hidden="true">视觉</span>
                    <label
                      className="petri-endpoint-reasoning"
                      title="声明该渠道支持图片输入（识图）：勾选后可在上方「识图模型」换绑；网关须真正支持 image_url 多模态，否则识图调用诚实报错"
                    >
                      <input
                        type="checkbox"
                        checked={hasVisionCapability(profile)}
                        onChange={(e) => {
                          const current = profile.capabilities || ['chat', 'streaming', 'tools'];
                          const next = e.target.checked
                            ? Array.from(new Set([...current, 'vision']))
                            : current.filter((cap) => cap !== 'vision');
                          updateProfile(profile.id, { capabilities: next });
                        }}
                        aria-label={`${profile.label || '自定义渠道'} 支持识图（视觉输入）`}
                      />
                    </label>
                    <span className="petri-endpoint-field-label" aria-hidden="true">连通性</span>
                    <button
                      type="button"
                      className={`petri-btn petri-btn--ghost petri-btn--sm petri-endpoint-card__test${connectionResult?.ok ? ' is-ok' : connectionResult || profileError ? ' is-error' : ''}`}
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
                    <span className="petri-endpoint-field-label" aria-hidden="true">删除</span>
                    <button
                      type="button"
                      className="petri-endpoint-card__delete"
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
              {userModelProfiles.length === 0 && <p className="petri-field__hint">尚未配置模型。请添加 API 渠道并填写连接信息。</p>}
            </div>
            <div className="petri-model-fallback" aria-label="Agent 模型自动容错">
              <label className="petri-model-fallback__toggle">
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
              <div className="petri-model-fallback__choices" aria-label="Agent 备用模型">
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
                  <span className="petri-field__hint">还没有其他支持工具调用的模型渠道。</span>
                )}
              </div>
            </div>
            <div className="petri-endpoint-list-actions">
              <button type="button" className="petri-btn petri-btn--ghost petri-btn--sm" onClick={addProfile}>
                添加 API 渠道
              </button>
              {userModelProfiles.length > 0 && (
                <div className="petri-endpoint-transfer-actions">
                  <button type="button" className="petri-btn petri-btn--ghost petri-btn--sm" onClick={() => void exportEndpoints('json')}>
                    导出 JSON
                  </button>
                  <button type="button" className="petri-btn petri-btn--ghost petri-btn--sm" onClick={() => void exportEndpoints('csv')}>
                    导出 CSV
                  </button>
                  <button type="button" className="petri-btn petri-btn--ghost petri-btn--sm" onClick={() => endpointImportRef.current?.click()}>
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
                  {endpointTransferMessage && <span className="petri-field__hint">{endpointTransferMessage}</span>}
                </div>
              )}
            </div>

          </section>
        )}

        {activeSection === 'compute' && (
          <section className="petri-settings-section">
            <div className="petri-settings-section__heading">
              <h3>计算与数据</h3>
              <p>管理远程执行目标，并查看本地数据占用。</p>
            </div>
        {/* UI-355 — 「计算执行」遗留卡移除（PETRI_COMPUTE_MODE 零读者，BLOCK-30 解耦后即死面）；
            远程执行目标（SSH）为 BLOCK-57/67 活功能，保留 */}

        <RemoteTargets />

        <hr className="petri-section-divider" />

        <DataManagement />

        <hr className="petri-section-divider" />

        <HarnessEnvironment />

        <hr className="petri-section-divider" />

        {/* BLOCK-202 W3 — 网络代理与自签 CA（保存后需重启后端生效） */}
        <NetworkProxyPanel />
        <hr className="petri-section-divider" />

        <TrashManagement />

          </section>
        )}

        {activeSection === 'usage' && <UsageSection versionKey={settingsVersion} />}

        {/* BLOCK-160 W2 P2（ORC-1）— Agent 用户规则节（与决策观测节相邻） */}
        {activeSection === 'decisions' && (
          <section className="petri-settings-section">
            <AgentRulesPanel />
          </section>
        )}

        {/* BLOCK-163 W3 P10（KNW-5）— 记忆治理节（同区相邻：治理面集中） */}
        {activeSection === 'decisions' && (
          <section className="petri-settings-section">
            <MemoryPanel />
          </section>
        )}

        {/* BLOCK-116 P4 — 决策原语配置节（与观测节相邻：配置+观测同位） */}
        {activeSection === 'decisions' && (
          <section className="petri-settings-section">
            <div className="petri-settings-section__heading">
              <h3>决策原语</h3>
              <p>各智能决策接点的启用与阈值（校准默认预填，可调整并自动保存；每次调用记录实际生效阈值）。</p>
            </div>
            <DecisionConfigPanel key={`decision-config-${settingsVersion}`} />
            {/* BLOCK-202 W3 — 全局审批默认档位 + 并发/深度 + 工具曝光黑名单 */}
            <RuntimePolicyPanel key={`runtime-policy-${settingsVersion}`} />
            {/* BLOCK-171 CP-2 — 审批记录（guard_ack 事件复审；治理可见化） */}
            <GuardAckHistoryPanel />
          </section>
        )}

        {activeSection === 'keymap' && <KeymapPanel key={`keymap-${settingsVersion}`} />}
        {activeSection === 'reasoning' && <ReasoningDefaultsPanel key={`reasoning-${settingsVersion}`} />}

        {/* UI-366 — 原全局「后端」页（/backend，BLOCK-72/UI-320）并入本分区 */}
        {activeSection === 'diagnostics' && (
          <section className="petri-settings-section">
            <div className="petri-settings-section__heading">
              <h3>运行时与诊断</h3>
              <p>本地服务进程、R / Python 运行时状态与日志（设备级，不关联项目）。</p>
            </div>
            <TerminalPanel backendStatus={backendStatus} />
          </section>
        )}

        {activeSection === 'maintenance' && (
          <MaintenanceSection
            telemetryEnabled={telemetryEnabled}
            onToggleTelemetry={(next) => void handleToggleTelemetry(next)}
            onConfigChanged={bumpVersion}
          />
        )}

        {activeSection === 'experimental' && (
          <section className="petri-settings-section">
            <div className="petri-settings-section__heading">
              <h3>实验特性</h3>
              <p>长会话与长任务开关已实机验证并默认开启（2026-09-18 裁决）；其余实验开关默认关闭，打开前请确认你的使用场景。</p>
            </div>
            <ExperimentalFeaturesSection key={`experimental-${settingsVersion}`} bridge={window.petriAgentFlags?.agentWorkbenchFlags} />
          </section>
        )}
        </div>
      </div>

      {showAiSave && <div className="petri-desktop-panel__footer petri-settings-footer">
        {saved && (
          <span className="petri-saved-toast">
            <Icon name="check" size={14} /> 已保存
          </span>
        )}
        <button
          type="button"
          className="petri-btn petri-btn--primary petri-btn--sm"
          onClick={() => void handleSave()}
          disabled={saving}
        >
          {saving ? '保存中…' : '保存'}
        </button>
      </div>}
    </div>
  );
}

