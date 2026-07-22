/**
 * DesktopSettingsPanel — 设置浮动面板（从左下角 dock 弹出）
 *
 * 内容与原 DesktopSettingsModal 相同，但渲染为浮动面板而非全屏遮罩模态。
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '@/components/icons/Icon';
import { ThemeControl } from './ThemeControl';
import { useTheme } from '@/themes/ThemeProvider';
import {
  useAiSettings,
  type ChatModelPreset,
} from '@/hooks/useAiSettings';
import { useAutoUpdate } from '@/hooks/useAutoUpdate';
import type { ComputeSettings } from '@/lib/electron';
import { getPlatformApiPrefix, getToken } from '@/lib/authClient';
import { useRuntimeResourceSnapshot } from '@/hooks/useRuntimeResourceSnapshot';
import { deleteProject, listProjects, setProjectStatus } from '@/lib/project-store';
import type { Project } from '@/lib/project-types';
import {
  endpointBaseUrl,
  inferUserModelProvider,
  isChatSelectableProfile,
  isUserConfigurableModelProvider,
  validateUserModelProfile,
} from '@/lib/model-provider-options';
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

interface Props {
  onClose: () => void;
}

type SettingsSection = 'general' | 'models' | 'compute' | 'usage' | 'maintenance';

const SETTINGS_SECTIONS: Array<{
  id: SettingsSection;
  label: string;
  description: string;
  icon: 'settings' | 'brain' | 'cpu' | 'wrench';
}> = [
  { id: 'general', label: '常规', description: '外观与应用偏好', icon: 'settings' },
  { id: 'models', label: '模型接口', description: 'URL、模型与 Key', icon: 'brain' },
  { id: 'compute', label: '计算与数据', description: '执行位置与存储', icon: 'cpu' },
  { id: 'usage', label: '用量与资源', description: '成本、缓存与机器状态', icon: 'cpu' },
  { id: 'maintenance', label: '隐私与维护', description: '反馈、诊断与更新', icon: 'wrench' },
];

interface UsageSummary {
  calls: number;
  prompt_tokens: number;
  completion_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  estimated_cost_cny: number;
  unknown_cost_calls: number;
  cache_hit_rate: number;
  cost_status: 'partial' | 'estimated';
}

function formatMetricBytes(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '未知';
  return value >= 1024 ** 3 ? `${(value / 1024 ** 3).toFixed(1)} GB` : `${(value / 1024 ** 2).toFixed(0)} MB`;
}

function UsageResourcePanel(): React.ReactElement {
  const { snapshot, loading, error, refresh } = useRuntimeResourceSnapshot();
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [usageError, setUsageError] = useState('');
  useEffect(() => {
    const token = getToken();
    void fetch(`${getPlatformApiPrefix()}/ai/usage-mine?days=30`, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    }).then(async (response) => {
      const data = await response.json();
      if (!response.ok || data?.status !== 'ok') throw new Error(data?.error || '用量不可用');
      setUsage(data);
      setUsageError('');
    }).catch((reason) => setUsageError(reason instanceof Error ? reason.message : String(reason)));
  }, []);
  const resourceLabel = snapshot?.state === 'ready' ? '资源正常' : snapshot?.state === 'warning' ? '需要注意' : snapshot ? '资源不足' : '检查中';
  return (
    <div className="biof3-usage-resource">
      <div className="biof3-metric-grid">
        <div><small>30 天调用</small><strong>{usage?.calls ?? '—'}</strong></div>
        <div><small>输入 / 输出 Token</small><strong>{usage ? `${usage.prompt_tokens || 0} / ${usage.completion_tokens || 0}` : '—'}</strong></div>
        <div><small>缓存命中</small><strong>{usage ? `${((usage.cache_hit_rate || 0) * 100).toFixed(1)}%` : '—'}</strong></div>
        <div><small>估算成本</small><strong>{usage ? `¥${Number(usage.estimated_cost_cny || 0).toFixed(4)}` : '—'}</strong></div>
      </div>
      <p className="biof3-field__hint">
        {usageError || (usage?.cost_status === 'partial' ? `${usage.unknown_cost_calls} 次调用缺少可靠价格，金额仅为部分估算。` : '成本来自已知价格表；供应商未返回价格时不会伪造金额。')}
      </p>
      <hr className="biof3-section-divider" />
      <div className="biof3-resource-heading">
        <div><strong>{resourceLabel}</strong><p>{snapshot ? `${snapshot.platform} · 观测于 ${new Date(snapshot.observedAt).toLocaleTimeString()}` : error || '正在读取机器状态'}</p></div>
        <button type="button" className="biof3-btn biof3-btn--ghost biof3-btn--sm" disabled={loading} onClick={() => void refresh()}>刷新</button>
      </div>
      <div className="biof3-metric-grid">
        <div><small>CPU</small><strong>{snapshot ? `${snapshot.cpu.logicalCores} 核 · ${snapshot.cpu.load1m?.toFixed(2) ?? '—'}` : '—'}</strong></div>
        <div><small>可用内存</small><strong>{formatMetricBytes(snapshot?.memory.availableBytes)}</strong></div>
        <div><small>可用磁盘</small><strong>{formatMetricBytes(snapshot?.disk.availableBytes)}</strong></div>
        <div><small>活跃 Job</small><strong>{snapshot?.activeJobs ?? '—'}</strong></div>
      </div>
      <p className="biof3-field__hint">资源快照每 10 秒刷新、30 秒失效。GPU 仅在运行时能够可靠探测时展示。</p>
    </div>
  );
}

// ChatModelPreset type + DEFAULT_CHAT_MODEL_PRESETS live in
// `@/hooks/useAiSettings` — Plan 1.6 §4.5 [HIGH] type dedup.

type ModelRole = 'chat' | 'agent' | 'planner' | 'vision' | 'embedding' | 'summary' | 'report' | 'explanation';
type ModelCapability = 'chat' | 'streaming' | 'tools' | 'vision' | 'embedding' | 'reasoning';

const MODEL_ROLES: Array<{ id: ModelRole; label: string; capability: ModelCapability; hint: string }> = [
  { id: 'chat', label: '默认聊天', capability: 'chat', hint: '日常对话与问答' },
  { id: 'agent', label: 'Agent 工具调用', capability: 'tools', hint: '分析规划和工具执行' },
  { id: 'planner', label: '复杂规划', capability: 'chat', hint: '多步骤任务拆解' },
  { id: 'vision', label: '视觉理解', capability: 'vision', hint: '图片和图表解读' },
  { id: 'embedding', label: '语义向量', capability: 'embedding', hint: '记忆与语义检索' },
  { id: 'summary', label: '低成本摘要', capability: 'chat', hint: '会话与文档摘要' },
  { id: 'report', label: '报告生成', capability: 'chat', hint: '分析报告撰写' },
  { id: 'explanation', label: '结果解释', capability: 'chat', hint: 'Artifact 结果解读' },
];

function providerDefaults(provider: string, id: string): Partial<ChatModelPreset> {
  const defaults: Record<string, Partial<ChatModelPreset>> = {
    deepseek: { label: 'DeepSeek', model: 'deepseek-chat', capabilities: ['chat', 'streaming', 'tools'], credentialRef: 'provider:deepseek' },
    'openai-compatible': { label: '自定义 API', model: '', capabilities: ['chat', 'streaming', 'tools'], credentialRef: `credential:${id}` },
  };
  return { protocol: 'openai-compatible', baseUrl: undefined, ...defaults[provider] };
}

function credentialId(profile: ChatModelPreset): string {
  const ref = profile.credentialRef || `provider:${profile.provider.replace(/-vision$/, '')}`;
  return ref.includes(':') ? ref.slice(ref.indexOf(':') + 1) : ref;
}

/** UpdateChecker — 检查 OSS 更新并打开已校验的 macOS 安装包 */
function UpdateChecker(): React.ReactElement | null {
  if (!window.biof3Desktop?.updater) return null;

  const { checking, available, availableVersion, downloading, progress, downloaded, error, upToDate, installing, check, download, install } =
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
      {upToDate && !error && (
        <span className="biof3-field__hint">当前已是最新版本</span>
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

function TrashManagement(): React.ReactElement {
  const [projects, setProjects] = useState<Project[]>([]);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const loadTrash = useCallback(async () => {
    setLoading(true);
    try {
      const [activeProjects, archivedProjects] = await Promise.all([
        listProjects(),
        listProjects(undefined, 'archived'),
      ]);
      const allProjects = [...activeProjects, ...archivedProjects];
      const archivedConversations = await Promise.all(
        allProjects.map((project) => listConversations('archived', project.id))
      );
      setProjects(archivedProjects);
      setConversations(archivedConversations.flat());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadTrash();
  }, [loadTrash]);

  const restoreProject = async (projectId: string) => {
    setBusyId(projectId);
    try {
      await setProjectStatus(projectId, 'active');
      await loadTrash();
    } finally {
      setBusyId(null);
    }
  };

  const restoreConversation = async (conversationId: string) => {
    setBusyId(conversationId);
    try {
      await archiveConversation(conversationId, false);
      await loadTrash();
    } finally {
      setBusyId(null);
    }
  };

  const permanentlyDeleteProject = async (projectId: string) => {
    if (!window.confirm('永久删除这个项目记录及其应用内数据？外部工作目录不会被删除。此操作无法撤销。')) return;
    setBusyId(projectId);
    try {
      await deleteProject(projectId);
      await loadTrash();
    } finally {
      setBusyId(null);
    }
  };

  const permanentlyDeleteConversation = async (conversationId: string) => {
    if (!window.confirm('永久删除这个会话及其消息？此操作无法撤销。')) return;
    setBusyId(conversationId);
    try {
      await deleteConversation(conversationId);
      await loadTrash();
    } finally {
      setBusyId(null);
    }
  };

  const emptyTrash = async () => {
    if (projects.length + conversations.length === 0) return;
    if (!window.confirm('永久清空回收站？项目记录、会话和消息将无法恢复；外部工作目录不会被删除。')) return;
    setBusyId('all');
    try {
      // Delete conversations first. Project deletion cascades its remaining
      // conversations, so avoiding concurrent requests keeps the operation
      // deterministic when both appear in the recycle bin.
      for (const conversation of conversations) {
        await deleteConversation(conversation.id);
      }
      for (const project of projects) {
        await deleteProject(project.id);
      }
      await loadTrash();
    } finally {
      setBusyId(null);
    }
  };

  const projectNameById = new Map(
    projects.map((project) => [project.id, project.name])
  );
  const count = projects.length + conversations.length;

  return (
    <div className="biof3-trash-section">
      <div className="biof3-trash-section__header">
        <div>
          <strong>回收站</strong>
          <p>移除的项目和会话会保留在这里，清理后才会永久删除。</p>
        </div>
        <button
          type="button"
          className="biof3-btn biof3-btn--danger-ghost biof3-btn--sm"
          onClick={() => void emptyTrash()}
          disabled={loading || count === 0 || busyId !== null}
        >
          清空回收站{count > 0 ? ` (${count})` : ''}
        </button>
      </div>
      {loading ? (
        <div className="biof3-trash-empty">正在读取回收站…</div>
      ) : count === 0 ? (
        <div className="biof3-trash-empty">回收站为空</div>
      ) : (
        <div className="biof3-trash-list">
          {projects.map((project) => (
            <div key={project.id} className="biof3-trash-item">
              <Icon name="folder" size={14} />
              <div><strong>{project.name}</strong><small>项目</small></div>
              <button type="button" onClick={() => void restoreProject(project.id)} disabled={busyId !== null}>恢复</button>
              <button type="button" className="danger" onClick={() => void permanentlyDeleteProject(project.id)} disabled={busyId !== null}>永久删除</button>
            </div>
          ))}
          {conversations.map((conversation) => (
            <div key={conversation.id} className="biof3-trash-item">
              <Icon name="message-circle" size={14} />
              <div>
                <strong>{conversation.title}</strong>
                <small>会话{conversation.project_id ? ` · ${projectNameById.get(conversation.project_id) || '现有项目'}` : ''}</small>
              </div>
              <button type="button" onClick={() => void restoreConversation(conversation.id)} disabled={busyId !== null}>恢复</button>
              <button type="button" className="danger" onClick={() => void permanentlyDeleteConversation(conversation.id)} disabled={busyId !== null}>永久删除</button>
            </div>
          ))}
        </div>
      )}
      <p className="biof3-field__hint">永久清理只删除 BioF3 内的项目记录、会话和关联消息，不会删除你选择的外部工作目录。</p>
    </div>
  );
}

// ── Stage 3 M1: Harness 环境 — 只读已预备能力视图 ───────────────
function HarnessEnvironment(): React.ReactElement | null {
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
  const endpointImportRef = useRef<HTMLInputElement>(null);
  const { refresh: refreshAiSettings } = useAiSettings();
  const { preference: themePreference } = useTheme();
  // M2-3：错误遥测开关（默认关闭）
  const [telemetryEnabled, setTelemetryEnabled] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  async function loadSettings() {
    if (!window.biof3Desktop) return;
    const s = await window.biof3Desktop.aiSettings.get();
    setSettings(s);
    const profiles = Array.isArray(s.model_profiles)
      ? (s.model_profiles as ChatModelPreset[])
          .filter((profile) => profile?.id && profile?.model)
          .map((profile) => profile.provider === 'deepseek'
            ? { ...profile, label: 'DeepSeek', defaultModel: profile.defaultModel || profile.model }
            : { ...profile, defaultModel: profile.defaultModel || profile.model })
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
        ((profile.provider === 'deepseek' && statuses[credentialId(profile)]) ||
          (profile.provider === 'openai-compatible' && Boolean(profile.baseUrl)))
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
      chat_model_presets: profiles.filter((profile) => profile.capabilities?.includes('chat')).map(({ id, label, provider, model, defaultModel, baseUrl }) => ({ id, label, provider, model, defaultModel, baseUrl })),
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
    setLoadingModels((current) => ({ ...current, [profile.id]: true }));
    const result = await window.biof3Desktop.aiSettings.listModels(
      profile as unknown as Record<string, unknown>,
      apiKey
    );
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
    setLoadingModels((current) => ({ ...current, [profile.id]: false }));
  }

  function updateProfile(id: string, patch: Partial<ChatModelPreset>) {
    setModelProfiles((profiles) => profiles.map((profile) => {
      if (profile.id !== id) return profile;
      const next = { ...profile, ...patch, id };
      if (Object.prototype.hasOwnProperty.call(patch, 'baseUrl')) {
        const provider = inferUserModelProvider({ label: next.label, baseUrl: next.baseUrl });
        next.provider = provider;
        next.protocol = 'openai-compatible';
        next.credentialRef = provider === 'deepseek'
          ? 'provider:deepseek'
          : `credential:${id}`;
        if (provider === 'deepseek') next.label = 'DeepSeek';
        else if (profile.provider === 'deepseek') next.label = '自定义 API';
      }
      return next;
    }));
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
      `biof3-api-endpoints.${format}`,
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
      setModelProfiles((current) => {
        const next = [...current];
        imported.forEach((item) => {
          const existingIndex = next.findIndex((profile) =>
            (item.id && profile.id === item.id) ||
            (profile.baseUrl && profile.baseUrl.replace(/\/$/, '') === item.baseUrl)
          );
          const existing = existingIndex >= 0 ? next[existingIndex] : undefined;
          const id = existing?.id || item.id || `model-${Date.now()}-${next.length}`;
          const provider = inferUserModelProvider({ label: item.supplier, baseUrl: item.baseUrl });
          const profile: ChatModelPreset = {
            ...(existing || providerDefaults(provider, id)),
            id,
            label: provider === 'deepseek' ? 'DeepSeek' : item.supplier,
            provider,
            protocol: 'openai-compatible',
            baseUrl: item.baseUrl,
            model: existing?.model || item.defaultModel,
            defaultModel: item.defaultModel,
            credentialRef: existing?.credentialRef || (provider === 'deepseek' ? 'provider:deepseek' : `credential:${id}`),
            capabilities: existing?.capabilities || ['chat', 'streaming', 'tools'],
            roles: existing?.roles || [],
            parameters: existing?.parameters || {},
          };
          if (item.apiKey) importedCredentials[credentialId(profile)] = item.apiKey;
          if (existingIndex >= 0) next[existingIndex] = profile;
          else next.push(profile);
        });
        return next;
      });
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

  return (
    <div className="biof3-desktop-panel" role="dialog" aria-label="设置">
      <div className="biof3-desktop-panel__header">
        <span className="biof3-desktop-panel__icon">
          <Icon name="settings" size={18} />
        </span>
        <div className="biof3-desktop-panel__titles">
          <h2 className="biof3-desktop-panel__title">设置</h2>
          <p className="biof3-desktop-panel__subtitle">{activeSectionMeta.description}</p>
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

      <div className="biof3-settings-layout">
        <nav className="biof3-settings-nav" aria-label="设置分类">
          {SETTINGS_SECTIONS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`biof3-settings-nav__item${activeSection === item.id ? ' active' : ''}`}
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

        <div className="biof3-desktop-panel__body biof3-settings-content">
        {activeSection === 'general' && (
          <section className="biof3-settings-section">
            <div className="biof3-settings-section__heading">
              <h3>常规</h3>
              <p>调整应用外观与基础使用偏好。</p>
            </div>
        <div className="biof3-field">
          <label className="biof3-field__label">外观主题</label>
          <ThemeControl menuPlacement="bottom" />
          <span className="biof3-badge">
            当前：
            {themePreference === 'system'
              ? '跟随系统'
              : themePreference === 'light'
                ? '日间'
                : '夜间'}
          </span>
          <p className="biof3-field__hint">可跟随 macOS 外观，或固定使用日间/夜间模式。</p>
        </div>

          </section>
        )}

        {activeSection === 'models' && (
          <section className="biof3-settings-section biof3-settings-section--models">
            <div className="biof3-settings-section__heading">
              <h3>API Endpoint</h3>
              <p>
                每个供应商只需配置供应商、Base URL、Key 和默认模型；接口协议与模型能力由后端自动适配。Key
                {credentialBackend === 'keychain' ? ' 保存在 macOS Keychain。' : ' 保存在独立本地凭据存储。'}
              </p>
              <p className="biof3-field__hint">Key 默认隐藏，可点击眼睛显示或复制；导出前会确认是否把 Key 写入文件，请仅保存到安全位置。</p>
            </div>
            <div className="biof3-model-list">
              {userModelProfiles.length > 0 && (
                <div className="biof3-endpoint-list-header" aria-hidden="true">
                  <span>供应商</span>
                  <span>Base URL</span>
                  <span>Key</span>
                  <span>默认模型</span>
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
                <div key={profile.id} className="biof3-model-preset biof3-endpoint-card">
                  <div className="biof3-endpoint-card__grid" role="group" aria-label={`${profile.label || '自定义'} 模型渠道`}>
                    <input
                      className="biof3-input"
                      value={profile.provider === 'deepseek' ? 'DeepSeek' : profile.label}
                      onChange={(e) => updateProfile(profile.id, { label: e.target.value })}
                      placeholder="供应商"
                      aria-label="供应商"
                      readOnly={profile.provider === 'deepseek'}
                    />
                    <input
                      className="biof3-input"
                      value={endpointBaseUrl(profile)}
                      onChange={(e) => {
                        updateProfile(profile.id, { baseUrl: e.target.value || undefined });
                        setAvailableModels((current) => ({ ...current, [profile.id]: [] }));
                        setTestResult((current) => {
                          const next = { ...current };
                          delete next[profile.id];
                          return next;
                        });
                      }}
                      placeholder="Base URL"
                      aria-label="Base URL"
                      title={endpointBaseUrl(profile)}
                    />
                    <div className="biof3-endpoint-key-field">
                      <input
                        type={visibleCredentialIds[id] ? 'text' : 'password'}
                        className="biof3-input"
                        value={credentialInputs[id] || ''}
                        onChange={(e) => {
                          setCredentialInputs((current) => ({ ...current, [id]: e.target.value }));
                          setAvailableModels((current) => ({ ...current, [profile.id]: [] }));
                          setTestResult((current) => {
                            const next = { ...current };
                            delete next[profile.id];
                            return next;
                          });
                        }}
                        placeholder={configured ? 'Key 已配置' : 'API Key'}
                        aria-label={configured ? 'API Key 已配置，输入新 Key 可覆盖' : 'API Key'}
                      />
                      <button
                        type="button"
                        className="biof3-endpoint-key-action"
                        onClick={() => void revealCredential(id)}
                        aria-label="显示 API Key"
                        title="显示 API Key"
                      >
                        <Icon name={visibleCredentialIds[id] ? 'eye-off' : 'eye'} size={13} />
                      </button>
                      <button
                        type="button"
                        className="biof3-endpoint-key-action"
                        onClick={() => void copyCredential(id)}
                        aria-label="复制 API Key"
                        title="复制 API Key"
                      >
                        {copiedCredentialId === id ? <Icon name="check" size={13} /> : <Icon name="copy" size={13} />}
                      </button>
                    </div>
                    <select
                      className="biof3-select"
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
                    <button
                      type="button"
                      className={`biof3-btn biof3-btn--ghost biof3-btn--sm biof3-endpoint-card__test${connectionResult?.ok ? ' is-ok' : connectionResult || profileError ? ' is-error' : ''}`}
                      onClick={() => void discoverModels(profile, credentialInputs[id] || '')}
                      disabled={
                        discovering ||
                        !endpointBaseUrl(profile).trim() ||
                        (profile.provider === 'deepseek' && !configured && !credentialInputs[id])
                      }
                      title={connectionTitle}
                    >
                      {connectionResult?.ok && <Icon name="check" size={12} />}
                      {connectionLabel}
                    </button>
                    <button
                      type="button"
                      className="biof3-endpoint-card__delete"
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
              {userModelProfiles.length === 0 && <p className="biof3-field__hint">尚未配置模型。添加一个自定义 API，或选择 DeepSeek。</p>}
            </div>
            <div className="biof3-endpoint-list-actions">
              <button type="button" className="biof3-btn biof3-btn--ghost biof3-btn--sm" onClick={addProfile}>
                添加 API 渠道
              </button>
              {userModelProfiles.length > 0 && (
                <div className="biof3-endpoint-transfer-actions">
                  <button type="button" className="biof3-btn biof3-btn--ghost biof3-btn--sm" onClick={() => exportEndpoints('json')}>
                    导出 JSON
                  </button>
                  <button type="button" className="biof3-btn biof3-btn--ghost biof3-btn--sm" onClick={() => exportEndpoints('csv')}>
                    导出 CSV
                  </button>
                  <button type="button" className="biof3-btn biof3-btn--ghost biof3-btn--sm" onClick={() => endpointImportRef.current?.click()}>
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
                  {endpointTransferMessage && <span className="biof3-field__hint">{endpointTransferMessage}</span>}
                </div>
              )}
            </div>

          </section>
        )}

        {activeSection === 'compute' && (
          <section className="biof3-settings-section">
            <div className="biof3-settings-section__heading">
              <h3>计算与数据</h3>
              <p>设置分析任务的执行位置，并查看本地数据占用。</p>
            </div>
        <ComputeExecution />

        <hr className="biof3-section-divider" />

        <DataManagement />

        <hr className="biof3-section-divider" />

        <HarnessEnvironment />

        <hr className="biof3-section-divider" />

        <TrashManagement />

          </section>
        )}

        {activeSection === 'usage' && (
          <section className="biof3-settings-section">
            <div className="biof3-settings-section__heading">
              <h3>用量与资源</h3>
              <p>查看模型成本、缓存命中和当前机器容量，不保存原始数据或密钥。</p>
            </div>
            <UsageResourcePanel />
          </section>
        )}

        {activeSection === 'maintenance' && (
          <section className="biof3-settings-section">
            <div className="biof3-settings-section__heading">
              <h3>隐私与维护</h3>
              <p>控制匿名错误反馈，并处理诊断和应用更新。</p>
            </div>
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
        <div className="biof3-maintenance-actions">
          <div className="biof3-maintenance-row">
            <div>
              <strong>应用更新</strong>
              <p>检查并下载适用于当前 Mac 的安装包。</p>
            </div>
            <UpdateChecker />
          </div>
          <div className="biof3-maintenance-row">
            <div>
              <strong>诊断日志</strong>
              <p>导出用于排查问题的本地诊断信息。</p>
            </div>
            <ExportDiagnostic />
          </div>
        </div>
          </section>
        )}
        </div>
      </div>

      {showAiSave && <div className="biof3-desktop-panel__footer biof3-settings-footer">
        {saved && (
          <span className="biof3-saved-toast">
            <Icon name="check" size={14} /> 已保存
          </span>
        )}
        <button
          type="button"
          className="biof3-btn biof3-btn--primary biof3-btn--sm"
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
