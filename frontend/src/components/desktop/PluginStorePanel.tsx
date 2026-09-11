/**
 * PluginStorePanel — 插件商店浮动面板（从左下角 dock 弹出）
 *
 * 内容与 PluginStoreModal 相同，但渲染为浮动面板而非全屏遮罩模态。
 * 左侧分类导航 + 右侧卡片网格。
 */

import React, { useState, useCallback, useMemo } from 'react';
import { Icon, type IconName } from '@/components/icons/Icon';
// UI-347 — 返回按钮复用定时分析面的同款样式类（工作区模式面统一返回风格）
import backStyles from '@/pages/project-workspace.module.css';
import {
  usePluginStore,
  type RemotePlugin,
  type UpdateInfo,
} from '@/hooks/usePluginStore';

interface Props {
  onClose: () => void;
  /** UI-347 — 返回按钮文案（与各宿主页面返回语义一致；缺省「返回」）。 */
  backLabel?: string;
}

type CategoryId = 'all' | 'runtime' | 'tool';

interface Category {
  id: CategoryId;
  label: string;
  icon: IconName;
  filter: (id: string, info: RemotePlugin) => boolean;
}

const CATEGORIES: Category[] = [
  { id: 'all', label: '全部', icon: 'puzzle', filter: () => true },
  { id: 'runtime', label: '运行时', icon: 'cpu', filter: (_, info) => info.type === 'runtime' },
  {
    id: 'tool',
    label: '分析工具',
    icon: 'bar-chart',
    filter: (_, info) => !info.type || info.type !== 'runtime',
  },
];

function getCategoryIcon(info: RemotePlugin): IconName {
  if (info.type === 'runtime') return 'cpu';
  return 'bar-chart';
}

export function PluginStorePanel({ onClose, backLabel = '返回' }: Props): React.ReactElement {
  const {
    installed,
    remote,
    runtimeStatus,
    updates,
    checkingUpdates,
    install: hookInstall,
    uninstall: hookUninstall,
    checkUpdates: hookCheckUpdates,
  } = usePluginStore();
  const [installing, setInstalling] = useState<string | null>(null);
  const [installProgress, setInstallProgress] = useState<
    Record<string, { ratio: number; received: number; total: number }>
  >({});
  const [uninstalling, setUninstalling] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [runtimeJustInstalled, setRuntimeJustInstalled] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<CategoryId>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  // Use useMemo from the hook perspective: the hook already
  // memoizes via useState snapshot; useMemo only needed for
  // derived values like filteredEntries below.
  const checkForUpdates = useCallback(async () => {
    await hookCheckUpdates();
  }, [hookCheckUpdates]);

  // Updates the same way as the legacy impl — install via bridge,
  // track progress for the spinner UX, refresh on success.
  async function handleUpdate(pluginId: string) {
    const info = remote.plugins?.[pluginId];
    const isRuntime = info?.type === 'runtime';
    setUpdatingId(pluginId);
    setError(null);
    setInstallProgress((prev) => ({ ...prev, [pluginId]: { ratio: 0, received: 0, total: 0 } }));
    try {
      const result = await hookInstall(pluginId, (data) => {
        if (data) {
          setInstallProgress((prev) => ({ ...prev, [pluginId]: data }));
        }
      });
      if (result.ok) {
        if (isRuntime) setRuntimeJustInstalled(pluginId);
      } else {
        setError(result.error || '更新失败');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '更新失败');
    } finally {
      setUpdatingId(null);
      setInstallProgress((prev) => {
        const next = { ...prev };
        delete next[pluginId];
        return next;
      });
    }
  }

  async function handleInstall(pluginId: string, isRuntime?: boolean) {
    setInstalling(pluginId);
    setInstallProgress((prev) => ({ ...prev, [pluginId]: { ratio: 0, received: 0, total: 0 } }));
    setError(null);
    try {
      const result = await hookInstall(pluginId, (data) => {
        if (data) {
          setInstallProgress((prev) => ({ ...prev, [pluginId]: data }));
        }
      });
      if (result.ok) {
        if (isRuntime) setRuntimeJustInstalled(pluginId);
      } else {
        setError(result.error || '安装失败');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '安装失败');
    } finally {
      setInstalling(null);
      setInstallProgress((prev) => {
        const next = { ...prev };
        delete next[pluginId];
        return next;
      });
    }
  }

  async function handleUninstall(pluginId: string) {
    if (!confirm(`确定卸载 ${pluginId}？`)) return;
    setUninstalling(pluginId);
    setError(null);
    try {
      const result = await hookUninstall(pluginId);
      if (!result.ok) setError(result.error || '卸载失败');
    } catch (e) {
      setError(e instanceof Error ? e.message : '卸载失败');
    } finally {
      setUninstalling(null);
    }
  }

  const remotePlugins = remote.plugins || {};
  const remoteEntries = Object.entries(remotePlugins);
  const installedIds = new Set(installed.map((p) => p.id));
  const installedById = new Map(installed.map((p) => [p.id, p]));
  const driftedIds = new Set(installed.filter((p) => p.manifestDrift).map((p) => p.id));
  const updateMap = new Map(updates.map((u) => [u.id, u]));
  const hasUpdates = updates.length > 0;

  const rRuntimeInstalled = runtimeStatus
    ? runtimeStatus.r.installed
    : installedIds.has('gewu-r-runtime');
  const pyRuntimeInstalled = runtimeStatus
    ? runtimeStatus.python.installed
    : installedIds.has('gewu-py-runtime');
  const needRuntimeHint =
    runtimeStatus && (!runtimeStatus.r.installed || !runtimeStatus.python.installed);

  const categoryCounts = useMemo(() => {
    const counts: Record<CategoryId, number> = { all: 0, runtime: 0, tool: 0 };
    for (const [id, info] of remoteEntries) {
      counts.all++;
      for (const cat of CATEGORIES) {
        if (cat.id !== 'all' && cat.filter(id, info)) counts[cat.id]++;
      }
    }
    return counts;
  }, [remoteEntries]);

  const filteredEntries = useMemo(() => {
    const cat = CATEGORIES.find((c) => c.id === activeCategory);
    if (!cat) return [];
    const q = searchQuery.trim().toLowerCase();
    return remoteEntries.filter(([id, info]) => {
      if (!cat.filter(id, info)) return false;
      if (q) {
        const title = (info.title || id).toLowerCase();
        const desc = (info.description || '').toLowerCase();
        if (!title.includes(q) && !desc.includes(q) && !id.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [remoteEntries, activeCategory, searchQuery]);

  const installedCount = installed.length;
  const availableCount = remoteEntries.filter(([id]) => !installedIds.has(id)).length;

  function formatSize(bytes?: number): string {
    if (!bytes) return '';
    if (bytes >= 1024 * 1024 * 1024) return (bytes / 1024 / 1024 / 1024).toFixed(1) + 'GB';
    if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(0) + 'MB';
    if (bytes >= 1024) return (bytes / 1024).toFixed(0) + 'KB';
    return bytes + 'B';
  }

  function isPluginInstalled(pluginId: string): boolean {
    if (pluginId === 'gewu-r-runtime') return rRuntimeInstalled;
    if (pluginId === 'gewu-py-runtime') return pyRuntimeInstalled;
    return installedIds.has(pluginId);
  }

  function isPluginDrifted(pluginId: string): boolean {
    if (pluginId === 'gewu-r-runtime' || pluginId === 'gewu-py-runtime') {
      return !!installedById.get(pluginId)?.manifestDrift;
    }
    return driftedIds.has(pluginId);
  }

  return (
    <div
      className="gewu-desktop-panel gewu-plugin-store-panel"
      role="dialog"
      aria-label="插件商店"
    >
      {/* Header */}
      <div className="gewu-plugin-store__header">
        {/* UI-347 — 返回风格与其它页面对齐（定时分析面同款左上角文字按钮，
            替代原右上角 × 关闭） */}
        <button
          type="button"
          className={backStyles.scheduledWorkspaceBack}
          onClick={onClose}
          title={backLabel}
          aria-label={backLabel}
        >
          <Icon name="arrow-left" size={14} />
          <span>{backLabel}</span>
        </button>
        <span className="gewu-plugin-store__icon">
          <Icon name="puzzle" size={18} />
        </span>
        <h2 className="gewu-plugin-store__title">插件商店</h2>
        <div className="gewu-plugin-store__search">
          <input
            type="text"
            placeholder="搜索插件…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* Body: sidebar + content */}
      <div className="gewu-plugin-store__body">
        {/* Sidebar */}
        <nav className="gewu-plugin-store__sidebar">
          {CATEGORIES.map((cat) => (
            <button
              key={cat.id}
              type="button"
              className={`gewu-plugin-store__nav-item ${activeCategory === cat.id ? 'active' : ''}`}
              onClick={() => setActiveCategory(cat.id)}
            >
              <Icon name={cat.icon} size={16} />
              <span className="gewu-plugin-store__nav-label">{cat.label}</span>
              <span className="gewu-plugin-store__nav-count">{categoryCounts[cat.id]}</span>
            </button>
          ))}
        </nav>

        {/* Content */}
        <div className="gewu-plugin-store__content">
          {error && (
            <div
              className="gewu-field__result gewu-field__result--err"
              style={{ marginBottom: 14 }}
            >
              ✗ {error}
            </div>
          )}

          {runtimeJustInstalled && (
            <div
              className="gewu-field__result gewu-field__result--ok"
              style={{ marginBottom: 14 }}
            >
              ✓ {runtimeJustInstalled} 安装成功，<strong>重启应用后生效</strong>。
            </div>
          )}

          {needRuntimeHint && (
            <div className="gewu-plugin-store__hint">
              ⚠️ 未安装基础运行时：
              {!runtimeStatus!.r.installed && ' R'}
              {!runtimeStatus!.python.installed && ' Python'} —
              大部分工具无法使用，请先安装「运行时」分类中的基础环境。
            </div>
          )}

          {filteredEntries.length === 0 && !error && (
            <div className="gewu-empty">
              {searchQuery ? `没有匹配「${searchQuery}」的插件` : '此分类暂无插件'}
            </div>
          )}

          {/* Runtime 用列表样式 */}
          {activeCategory === 'all' || activeCategory === 'runtime' ? (
            <div className="gewu-plugin-store__runtime-list">
              {filteredEntries
                .filter(([, info]) => info.type === 'runtime')
                .map(([id, info]) => {
                  const isInstalled = isPluginInstalled(id);
                  return (
                    <div
                      key={id}
                      className={`gewu-plugin-store__runtime-item ${isInstalled ? 'installed' : ''}`}
                    >
                      <span className="gewu-plugin-store__runtime-icon">
                        <Icon name="cpu" size={22} />
                      </span>
                      <div className="gewu-plugin-store__runtime-main">
                        <div className="gewu-plugin-store__runtime-name">
                          {info.title || id}
                          {isInstalled && (
                            <span className="gewu-plugin-store__badge-ok">✓ 已安装</span>
                          )}
                          {isInstalled && isPluginDrifted(id) && (
                            <span className="gewu-plugin-store__badge-drift">已变更</span>
                          )}
                        </div>
                        <div className="gewu-plugin-store__runtime-meta">
                          {info.version && <span>v{info.version}</span>}
                          {info.language && <span>[{info.language}]</span>}
                          {info.size && <span>{formatSize(info.size)}</span>}
                          <span className="gewu-plugin-store__badge-required">必需</span>
                        </div>
                        {info.description && (
                          <div className="gewu-plugin-store__runtime-desc">{info.description}</div>
                        )}
                      </div>
                      <div className="gewu-plugin-store__runtime-action">
                        {isInstalled ? (
                          <div className="gewu-plugin-store__action-stack">
                            {updateMap.has(id) && (
                              <button
                                type="button"
                                className="gewu-btn gewu-btn--primary gewu-btn--sm"
                                onClick={() => handleUpdate(id)}
                                disabled={updatingId === id}
                              >
                                {updatingId === id
                                  ? '更新中…'
                                  : `更新到 v${updateMap.get(id)!.latestVersion}`}
                              </button>
                            )}
                            {installing === id &&
                              installProgress[id] &&
                              installProgress[id].total > 0 && (
                                <div className="gewu-plugin-store__progress">
                                  <div className="gewu-plugin-store__progress-text">
                                    {(installProgress[id].ratio * 100).toFixed(0)}% ·{' '}
                                    {(installProgress[id].received / 1024 / 1024).toFixed(0)}/
                                    {(installProgress[id].total / 1024 / 1024).toFixed(0)}MB
                                  </div>
                                  <div className="gewu-plugin-store__progress-bar">
                                    <div style={{ width: `${installProgress[id].ratio * 100}%` }} />
                                  </div>
                                </div>
                              )}
                            <button
                              type="button"
                              className="gewu-btn gewu-btn--danger-ghost gewu-btn--sm"
                              onClick={() => handleUninstall(id)}
                              disabled={uninstalling === id}
                            >
                              {uninstalling === id ? '卸载中…' : '卸载'}
                            </button>
                          </div>
                        ) : (
                          <>
                            {installing === id &&
                              installProgress[id] &&
                              installProgress[id].total > 0 && (
                                <div className="gewu-plugin-store__progress">
                                  <div className="gewu-plugin-store__progress-text">
                                    {(installProgress[id].ratio * 100).toFixed(0)}% ·{' '}
                                    {(installProgress[id].received / 1024 / 1024).toFixed(0)}/
                                    {(installProgress[id].total / 1024 / 1024).toFixed(0)}MB
                                  </div>
                                  <div className="gewu-plugin-store__progress-bar">
                                    <div style={{ width: `${installProgress[id].ratio * 100}%` }} />
                                  </div>
                                </div>
                              )}
                            <button
                              type="button"
                              className="gewu-btn gewu-btn--primary gewu-btn--sm"
                              onClick={() => handleInstall(id, true)}
                              disabled={installing === id}
                            >
                              {installing === id ? '安装中…' : '下载安装'}
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
            </div>
          ) : null}

          {/* 非 Runtime 插件用卡片网格 */}
          {(() => {
            const cardEntries = filteredEntries.filter(([, info]) => info.type !== 'runtime');
            if (cardEntries.length === 0) return null;
            return (
              <div className="gewu-plugin-store__grid">
                {cardEntries.map(([id, info]) => {
                  const isInstalled = isPluginInstalled(id);
                  const isInstalling = installing === id;
                  const isUpdating = updatingId === id;
                  const prog = installProgress[id];
                  const hasUpdate = updateMap.has(id);
                  return (
                    <div
                      key={id}
                      className={`gewu-plugin-card ${isInstalled ? 'installed' : ''} ${hasUpdate ? 'has-update' : ''}`}
                    >
                      <div className="gewu-plugin-card__top">
                        <span className="gewu-plugin-card__icon">
                          <Icon name={getCategoryIcon(info)} size={20} />
                        </span>
                        <div className="gewu-plugin-card__name" title={info.title || id}>
                          {info.title || id}
                        </div>
                        {isInstalled && <span className="gewu-plugin-card__badge">✓</span>}
                        {isInstalled && isPluginDrifted(id) && (
                          <span
                            className="gewu-plugin-card__badge-drift"
                            title="安装后脚本或清单已发生变化"
                          >
                            已变更
                          </span>
                        )}
                        {hasUpdate && (
                          <span
                            className="gewu-plugin-card__badge-update"
                            title={`有新版本 v${updateMap.get(id)!.latestVersion}`}
                          >
                            ↑
                          </span>
                        )}
                      </div>
                      <div className="gewu-plugin-card__desc" title={info.description}>
                        {info.description || '—'}
                      </div>
                      <div className="gewu-plugin-card__meta">
                        {info.version && <span>v{info.version}</span>}
                        {info.language && (
                          <span className={`lang-${info.language}`}>{info.language}</span>
                        )}
                        {info.size ? <span>{formatSize(info.size)}</span> : <span>—</span>}
                        {info.type === 'data' && <span className="tag-data">数据包</span>}
                        {info.optional && <span className="tag-optional">可选</span>}
                      </div>
                      <div className="gewu-plugin-card__action">
                        {isInstalled ? (
                          <div className="gewu-plugin-store__action-stack">
                            {hasUpdate && (
                              <button
                                type="button"
                                className="gewu-btn gewu-btn--primary gewu-btn--sm"
                                onClick={() => handleUpdate(id)}
                                disabled={isUpdating}
                              >
                                {isUpdating ? '更新中…' : '更新'}
                              </button>
                            )}
                            {(isUpdating || isInstalling) && prog && prog.total > 0 && (
                              <div className="gewu-plugin-store__progress">
                                <div className="gewu-plugin-store__progress-text">
                                  {(prog.ratio * 100).toFixed(0)}% ·{' '}
                                  {(prog.received / 1024 / 1024).toFixed(0)}/
                                  {(prog.total / 1024 / 1024).toFixed(0)}MB
                                </div>
                                <div className="gewu-plugin-store__progress-bar">
                                  <div style={{ width: `${prog.ratio * 100}%` }} />
                                </div>
                              </div>
                            )}
                            <button
                              type="button"
                              className="gewu-btn gewu-btn--danger-ghost gewu-btn--sm"
                              onClick={() => handleUninstall(id)}
                              disabled={uninstalling === id}
                            >
                              {uninstalling === id ? '卸载中…' : '卸载'}
                            </button>
                          </div>
                        ) : isInstalling && prog && prog.total > 0 ? (
                          <div className="gewu-plugin-store__progress">
                            <div className="gewu-plugin-store__progress-text">
                              {(prog.ratio * 100).toFixed(0)}% ·{' '}
                              {(prog.received / 1024 / 1024).toFixed(0)}/
                              {(prog.total / 1024 / 1024).toFixed(0)}MB
                            </div>
                            <div className="gewu-plugin-store__progress-bar">
                              <div style={{ width: `${prog.ratio * 100}%` }} />
                            </div>
                          </div>
                        ) : (
                          <button
                            type="button"
                            className="gewu-btn gewu-btn--primary gewu-btn--sm"
                            onClick={() => handleInstall(id)}
                            disabled={isInstalling}
                          >
                            {isInstalling ? '安装中…' : '安装'}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </div>
      </div>

      {/* Footer */}
      <div className="gewu-plugin-store__footer">
        <span className="gewu-plugin-store__footer-info">
          已安装 {installedCount} 个 · 可安装 {availableCount} 个
          {hasUpdates && (
            <span className="gewu-plugin-store__footer-updates">
              {' · '}
              <button
                type="button"
                className="gewu-plugin-store__refresh-btn"
                onClick={checkForUpdates}
                disabled={checkingUpdates}
              >
                {checkingUpdates ? '检查中…' : `${updates.length} 个可更新`}
              </button>
            </span>
          )}
        </span>
      </div>
    </div>
  );
}

export default PluginStorePanel;
