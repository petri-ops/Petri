/**
 * PluginStorePanel — 插件商店浮动面板（从左下角 dock 弹出）
 *
 * 内容与 PluginStoreModal 相同，但渲染为浮动面板而非全屏遮罩模态。
 * 左侧分类导航 + 右侧卡片网格。
 *
 * BLOCK-86 P2 (UI-374) — 商店改版：pack 卡片成为唯一领域入口——
 *   ① 独立「运行时」分类收编进包视图（运行时作为包卡片的可展开子项渲染）；
 *   ② 包卡片展开显示功能模块清单（分析插件/脚本/演示数据计数）与运行时子项
 *      （状态/体积/进度），子项安装进度走 pack:install-progress 订阅；
 *   ③ 卸载走三档确认弹层（uninstallPlan 数据源：运行时回收体积/共享保留/
 *      包源目录默认保留可选删；用户数据永不触碰）；
 *   ④ 包交付的插件在「分析工具」分类可见并标注来源包；
 *   ⑤ 「必需」提示只在「包已装而运行时缺」时出现（无包不提运行时）。
 */

import React, { useState, useCallback, useMemo } from 'react';
import { Icon } from '@/components/icons/Icon';
import { getBridge } from '@/lib/desktopBridge';
// UI-347 — 返回按钮复用定时分析面的同款样式类（工作区模式面统一返回风格）
import backStyles from '@/pages/project-workspace.module.css';
import {
  usePluginStore,
} from '@/hooks/usePluginStore';
// BLOCK-92 Wave B-5 — 类型/分类常量与领域包簇外迁（./PluginStorePanel/，纯搬运零行为变化）。
import {
  CATEGORIES,
  formatSize,
  getCategoryIcon,
  type AvailablePack,
  type CategoryId,
  type Props,
} from './PluginStorePanel/types';
import { useDomainPacks } from './PluginStorePanel/useDomainPacks';

export function PluginStorePanel({ onClose, backLabel = '返回', embedded = false }: Props): React.ReactElement {
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

  // BLOCK-92 Wave B-5 — 领域包装/卸状态簇外迁（./PluginStorePanel/useDomainPacks.ts：
  // BLOCK-84 记录制 + BLOCK-86 契约展开态 + UI-374 三档确认与运行时进度，纯搬运零行为变化）。
  const {
    availablePacks,
    installedPacks,
    packBusy,
    setPackBusy,
    setPackNotice,
    packNotice,
    expandedPackId,
    setExpandedPackId,
    packRuntimeProgress,
    setPackRuntimeProgress,
    confirmPack,
    setConfirmPack,
    confirmPlan,
    setConfirmPlan,
    confirmDeleteRuntimes,
    setConfirmDeleteRuntimes,
    confirmDeletePackSource,
    setConfirmDeletePackSource,
    refreshPacks,
    handlePackInstall,
    beginPackUninstall,
    handlePackUninstall,
    runtimeTitleOf,
    runtimeSizeLabelOf,
    packsRequiringRuntimes,
  } = useDomainPacks({ remote });

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
  // UI-374 — 缺失提示领域感知：只在「包已装而运行时缺」时出现（无包不提运行时），
  // 文案挂包名。runtimeStatus 为 null（检测未知）时维持既有语义：不提示。
  // packsRequiringRuntimes 已随 useDomainPacks 外迁。
  const missingRuntimeNames = runtimeStatus
    ? [
        !runtimeStatus.r.installed ? 'R' : null,
        !runtimeStatus.python.installed ? 'Python' : null,
      ].filter((v): v is string => Boolean(v))
    : [];
  const needRuntimeHint = missingRuntimeNames.length > 0 && packsRequiringRuntimes.length > 0;

  const categoryCounts = useMemo(() => {
    const counts: Record<CategoryId, number> = { all: 0, tool: 0 };
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

  // UI-374 — 包交付的插件（已装包），在「分析工具」分类可见并标注来源包
  const packDeliveredPlugins = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const rows: Array<{ id: string; language: string | null; version: string | null; fromPack: string }> = [];
    for (const pack of installedPacks) {
      for (const plugin of pack.contents?.plugins ?? []) {
        if (q) {
          const hit = plugin.id.toLowerCase().includes(q);
          if (!hit) continue;
        }
        rows.push({ ...plugin, fromPack: pack.name || pack.packId });
      }
    }
    return rows;
  }, [installedPacks, searchQuery]);

  const installedCount = installed.length;
  const availableCount = remoteEntries.filter(([id]) => !installedIds.has(id)).length;

  function isPluginInstalled(pluginId: string): boolean {
    if (pluginId === 'gewu-r-runtime') return rRuntimeInstalled;
    if (pluginId === 'gewu-py-runtime') return pyRuntimeInstalled;
    return installedIds.has(pluginId);
  }

  // UI-374 — 运行时在位判定：安装记录不可信（运行时可由链外供给——手动放置/
  // 系统解析，plugin installed.json 里没有记录），以 runtimeStatus 的目录+
  // 可执行探测为准，经清单 language 映射。
  function isRuntimePresent(pluginId: string): boolean {
    const info = remote.plugins?.[pluginId];
    if (runtimeStatus) {
      if (info?.language === 'r') return runtimeStatus.r.installed;
      if (info?.language === 'python') return runtimeStatus.python.installed;
    }
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
      role={embedded ? 'region' : 'dialog'}
      aria-label="插件商店"
    >
      {/* Header — BLOCK-156 embedded 模式收起返回钮/图标/标题（宿主页头承载返回），搜索行保留 */}
      <div className="gewu-plugin-store__header">
        {!embedded && (
          <>
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
          </>
        )}
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

          {/* UI-374 — 有包缺运行时才提示，且文案挂包名；无包不提运行时 */}
          {needRuntimeHint && (
            <div className="gewu-plugin-store__hint">
              ⚠️ 已安装领域包 {packsRequiringRuntimes.map((n) => `「${n}」`).join('、')} 需要
              {' '}{missingRuntimeNames.join(' 与 ')} 运行时——请在本页领域包卡片内补装，否则对应分析工具无法使用。
            </div>
          )}

          {/* BLOCK-84：领域包分区——整包一键装/卸（记录制，重启生效）
              UI-374：pack 卡片 = 唯一领域入口（运行时子项收编进卡片） */}
          {(availablePacks.length > 0 || installedPacks.length > 0) && (activeCategory === 'all') && (
            <div className="gewu-plugin-store__packs" data-testid="domain-packs-section">
              <div className="gewu-plugin-store__packs-header">
                <strong>领域包</strong>
                <span style={{ fontSize: 'var(--gewu-font-size-caption, 12px)', color: 'var(--gewu-text-tertiary)' }}>
                  整包安装/卸载一组领域能力（分析插件 + 脚本 + 运行时）；装/卸后需重启应用生效
                </span>
              </div>
              {packNotice && (
                <div role="status" style={{ padding: '6px 0', color: 'var(--gewu-text-secondary)' }}>{packNotice}</div>
              )}
              {(() => {
                const packBridge = getBridge('packs');
                return packBridge ? (
                  <button
                    type="button"
                    className="gewu-btn gewu-btn--primary"
                    style={{ marginBottom: 8 }}
                    disabled={packBusy !== null}
                    onClick={async () => {
                      setPackBusy('__dialog__');
                      setPackNotice(null);
                      setPackRuntimeProgress({});
                      try {
                        const result = await packBridge.installFromDialog();
                        if (result?.canceled) return;
                        if (result?.ok) setPackNotice('已安装——重启应用后生效');
                        else if (result?.error) setPackNotice(`安装失败：${result.error}`);
                        await refreshPacks();
                      } finally {
                        setPackBusy(null);
                        setPackRuntimeProgress({});
                      }
                    }}
                  >
                    从目录安装领域包…
                  </button>
                ) : null;
              })()}
              {(() => {
                const knownById = new Map<string, AvailablePack>();
                for (const p of availablePacks) knownById.set(p.packId, p);
                for (const p of installedPacks) {
                  if (!knownById.has(p.packId)) {
                    knownById.set(p.packId, {
                      packId: p.packId, name: p.name || p.packId, version: p.version,
                      description: '', packRoot: p.packRoot, installed: true,
                      requiresRuntimes: p.requiresRuntimes,
                      contents: p.contents,
                    });
                  }
                }
                return [...knownById.values()].map((pack) => {
                  const expanded = expandedPackId === pack.packId;
                  const requiredRuntimes = pack.requiresRuntimes ?? [];
                  const contents = pack.contents;
                  return (
                    <div
                      key={pack.packId}
                      className="gewu-plugin-store__pack-card"
                      data-testid={`domain-pack-${pack.packId}`}
                      style={{ border: '1px solid var(--gewu-border, rgba(128,128,128,0.25))', borderRadius: 8, marginBottom: 8 }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px' }}>
                        <button
                          type="button"
                          aria-expanded={expanded}
                          aria-label={expanded ? `收起 ${pack.name} 详情` : `展开 ${pack.name} 详情`}
                          onClick={() => setExpandedPackId(expanded ? null : pack.packId)}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: 'var(--gewu-text-tertiary)', display: 'flex' }}
                        >
                          <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={14} />
                        </button>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 600 }}>
                            {pack.name} <span style={{ color: 'var(--gewu-text-tertiary)', fontWeight: 400 }}>v{pack.version}</span>
                            {pack.installed && (
                              <span style={{ marginLeft: 8, fontSize: 'var(--gewu-font-size-caption, 12px)', color: 'var(--gewu-accent, #3b82f6)' }}>已安装</span>
                            )}
                          </div>
                          <div style={{ color: 'var(--gewu-text-tertiary)', fontSize: 'var(--gewu-font-size-caption, 12px)' }}>
                            {contents
                              ? `${contents.pluginCount} 个分析插件 · ${contents.scriptCount} 个脚本模块 · ${contents.demoDataCount} 个演示数据集`
                              : (pack.description || pack.packId)}
                          </div>
                        </div>
                        {pack.installed ? (
                          <button
                            type="button"
                            className="gewu-btn"
                            disabled={packBusy !== null}
                            onClick={() => void beginPackUninstall(pack)}
                          >
                            {packBusy === pack.packId ? '处理中…' : '卸载'}
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="gewu-btn gewu-btn--primary"
                            disabled={packBusy !== null}
                            onClick={() => void handlePackInstall(pack)}
                          >
                            {packBusy === pack.packId ? '处理中…' : '一键安装'}
                          </button>
                        )}
                      </div>
                      {/* UI-374 — 展开区：运行时子项（状态/体积/进度）随契约渲染 */}
                      {expanded && requiredRuntimes.length > 0 && (
                        <div style={{ borderTop: '1px dashed var(--gewu-border, rgba(128,128,128,0.25))', padding: '8px 12px 10px 36px' }} data-testid={`pack-runtimes-${pack.packId}`}>
                          <div style={{ fontSize: 'var(--gewu-font-size-caption, 12px)', color: 'var(--gewu-text-tertiary)', marginBottom: 6 }}>
                            运行时基础环境（随包安装）
                          </div>
                          {requiredRuntimes.map((req) => {
                            const rtInstalled = isRuntimePresent(req.pluginId);
                            const sizeLabel = runtimeSizeLabelOf(req.pluginId);
                            const prog = pack.installed
                              ? packRuntimeProgress[req.pluginId]
                              : undefined;
                            const missingButRequired = pack.installed && !rtInstalled;
                            return (
                              <div key={req.pluginId} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 0' }}>
                                <Icon name="cpu" size={14} />
                                <span style={{ flex: 1, minWidth: 0 }}>
                                  {runtimeTitleOf(req.pluginId)}
                                  <span style={{ color: 'var(--gewu-text-tertiary)', marginLeft: 8, fontSize: 'var(--gewu-font-size-caption, 12px)' }}>
                                    {sizeLabel}
                                    {req.version ? ` · ${req.version}` : ''}
                                  </span>
                                  {rtInstalled && (
                                    <span style={{ color: 'var(--gewu-text-tertiary)', marginLeft: 8, fontSize: 'var(--gewu-font-size-caption, 12px)' }}>✓ 已安装</span>
                                  )}
                                  {missingButRequired && (
                                    <span style={{ color: 'var(--gewu-warning, #d97706)', marginLeft: 8, fontSize: 'var(--gewu-font-size-caption, 12px)' }}>
                                      必需 · 缺失
                                    </span>
                                  )}
                                </span>
                                {pack.installed && !rtInstalled && (
                                  <button
                                    type="button"
                                    className="gewu-btn gewu-btn--primary gewu-btn--sm"
                                    disabled={installing === req.pluginId}
                                    onClick={() => void handleInstall(req.pluginId, true)}
                                  >
                                    {installing === req.pluginId ? '安装中…' : '补装'}
                                  </button>
                                )}
                                {pack.installed && !rtInstalled && prog && prog.total > 0 && (
                                  <div className="gewu-plugin-store__progress" style={{ width: 120 }}>
                                    <div className="gewu-plugin-store__progress-text">
                                      {(prog.ratio * 100).toFixed(0)}%
                                    </div>
                                    <div className="gewu-plugin-store__progress-bar">
                                      <div style={{ width: `${prog.ratio * 100}%` }} />
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                });
              })()}
            </div>
          )}

          {/* UI-374 — 卸载三档确认弹层（uninstallPlan 契约推导数据源） */}
          {confirmPack && confirmPlan && (
            <div
              role="dialog"
              aria-label="确认卸载领域包"
              data-testid="pack-uninstall-confirm"
              style={{
                position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.35)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10,
              }}
            >
              <div style={{
                background: 'var(--gewu-bg, #fff)', borderRadius: 10, padding: 18,
                width: 'min(520px, 92%)', border: '1px solid var(--gewu-border, rgba(128,128,128,0.25))',
                boxShadow: '0 12px 32px rgba(15,23,42,0.18)',
              }}>
                <div style={{ fontWeight: 600, marginBottom: 8 }}>卸载「{confirmPack.name}」</div>
                <div style={{ fontSize: 'var(--gewu-font-size-caption, 12px)', color: 'var(--gewu-text-secondary)', marginBottom: 10 }}>
                  卸载后需重启应用生效。请确认以下处置（可逐项勾选）：
                </div>
                <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '6px 0', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={confirmDeleteRuntimes}
                    onChange={(e) => setConfirmDeleteRuntimes(e.target.checked)}
                  />
                  <span>
                    删除运行时基础环境
                    {(confirmPlan.runtimes?.removable ?? []).filter((r) => r.installed).length > 0 && (
                      <span style={{ color: 'var(--gewu-text-tertiary)' }}>
                        （{confirmPlan.runtimes!.removable.filter((r) => r.installed).map((r) => runtimeTitleOf(r.pluginId)).join('、')}
                        {(() => {
                          const total = confirmPlan.runtimes!.removable.reduce((acc, r) => acc + (r.sizeBytes || 0), 0);
                          const label = formatSize(total);
                          return label ? `，约回收 ${label}` : '';
                        })()}
                        ）
                      </span>
                    )}
                    {(confirmPlan.runtimes?.removable ?? []).length === 0 && (
                      <span style={{ color: 'var(--gewu-text-tertiary)' }}>（本包契约未声明运行时）</span>
                    )}
                    {(confirmPlan.runtimes?.retained ?? []).length > 0 && (
                      <span style={{ color: 'var(--gewu-text-tertiary)' }}>
                        ；{confirmPlan.runtimes!.retained.map((r) => `${runtimeTitleOf(r.pluginId)} 被其他包共享，将保留`).join('；')}
                      </span>
                    )}
                  </span>
                </label>
                <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '6px 0', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={confirmDeletePackSource}
                    onChange={(e) => setConfirmDeletePackSource(e.target.checked)}
                  />
                  <span>
                    同时删除包源目录
                    {confirmPlan.packSource?.dir && (
                      <span style={{ color: 'var(--gewu-text-tertiary)', wordBreak: 'break-all' }}>
                        （{confirmPlan.packSource.dir}
                        {confirmPlan.packSource.sizeBytes ? `，约 ${formatSize(confirmPlan.packSource.sizeBytes)}` : ''}）
                      </span>
                    )}
                    <div style={{ color: 'var(--gewu-text-tertiary)' }}>内含分析插件、脚本与演示数据；默认保留</div>
                  </span>
                </label>
                <div style={{ padding: '8px 0', color: 'var(--gewu-text-secondary)', fontSize: 'var(--gewu-font-size-caption, 12px)' }}>
                  {confirmPlan.userDataPolicy || 'results、项目文件与数据库不受影响'}——用户数据永不删除。
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                  <button
                    type="button"
                    className="gewu-btn"
                    onClick={() => { setConfirmPack(null); setConfirmPlan(null); }}
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    className="gewu-btn gewu-btn--danger-ghost"
                    disabled={packBusy !== null}
                    data-testid="pack-uninstall-confirm-execute"
                    onClick={async () => {
                      const pack = confirmPack;
                      const options = { deleteRuntimes: confirmDeleteRuntimes, deletePackSource: confirmDeletePackSource };
                      setConfirmPack(null);
                      setConfirmPlan(null);
                      if (pack) await handlePackUninstall(pack, options);
                    }}
                  >
                    确认卸载
                  </button>
                </div>
              </div>
            </div>
          )}

          {filteredEntries.length === 0 && packDeliveredPlugins.length === 0 && !error && (
            <div className="gewu-empty">
              {searchQuery ? `没有匹配「${searchQuery}」的插件` : '此分类暂无插件'}
            </div>
          )}

          {/* 非 Runtime 插件用卡片网格（UI-374：运行时不再单独渲染，收编进包卡片） */}
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
                                onClick={() => void handleUpdate(id)}
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
                              onClick={() => void handleUninstall(id)}
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
                            onClick={() => void handleInstall(id)}
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

          {/* UI-374 — 包交付的插件：标注来源包，随包装卸（无独立安装按钮） */}
          {packDeliveredPlugins.length > 0 && (
            <div style={{ marginTop: 14 }} data-testid="pack-delivered-plugins">
              <div style={{ fontSize: 'var(--gewu-font-size-caption, 12px)', color: 'var(--gewu-text-tertiary)', marginBottom: 6 }}>
                来自已安装领域包（随包装卸，重启生效）
              </div>
              <div className="gewu-plugin-store__grid">
                {packDeliveredPlugins.map((plugin) => (
                  <div key={`${plugin.fromPack}:${plugin.id}`} className="gewu-plugin-card installed">
                    <div className="gewu-plugin-card__top">
                      <span className="gewu-plugin-card__icon">
                        <Icon name="bar-chart" size={20} />
                      </span>
                      <div className="gewu-plugin-card__name" title={plugin.id}>
                        {plugin.id}
                      </div>
                      <span className="gewu-plugin-card__badge">✓</span>
                    </div>
                    <div className="gewu-plugin-card__desc">来源包：{plugin.fromPack}</div>
                    <div className="gewu-plugin-card__meta">
                      {plugin.version && <span>v{plugin.version}</span>}
                      {plugin.language && (
                        <span className={`lang-${plugin.language}`}>{plugin.language}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
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
                onClick={() => void checkForUpdates()}
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

