/**
 * PluginStorePanel — 领域扩展面板（原「插件商店」，BLOCK-158 商店面退役后收敛）
 *
 * BLOCK-158：商店安装卡片/分类导航/更新徽标随 OSS 商店通道退役；
 * 本面板现承载 = 领域包卡片（整包装卸/启停/运行时子项）+ 包交付插件行 +
 * 运行时缺失提示。插件分发 = 领域包通道；运行时安装 = 包一键内链。
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

import React, { useState, useMemo } from 'react';
import { Icon } from '@/components/icons/Icon';
import { getBridge } from '@/lib/desktopBridge';
// UI-347 — 返回按钮复用定时分析面的同款样式类（工作区模式面统一返回风格）
import backStyles from '@/pages/project-workspace.module.css';
import {
  usePluginStore,
} from '@/hooks/usePluginStore';
// BLOCK-92 Wave B-5 — 类型/分类常量与领域包簇外迁（./PluginStorePanel/，纯搬运零行为变化）。
import {
  formatSize,
  type AvailablePack,
  type Props,
} from './PluginStorePanel/types';
import { useDomainPacks } from './PluginStorePanel/useDomainPacks';

export function PluginStorePanel({ onClose, backLabel = '返回', embedded = false }: Props): React.ReactElement {
  const { installed, remote, runtimeStatus } = usePluginStore();
  const [searchQuery, setSearchQuery] = useState('');

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
    packUpdates,
    handlePackUpdate,
    handleRuntimeTopUp,
    handlePackInstall,
    handlePackSetEnabled,
    beginPackUninstall,
    handlePackUninstall,
    runtimeTitleOf,
    runtimeSizeLabelOf,
    packsRequiringRuntimes,
  } = useDomainPacks({ remote });

  const installedIds = new Set(installed.map((p) => p.id));

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

      {/* Body */}
      <div className="gewu-plugin-store__body">
        {/* Content */}
        <div className="gewu-plugin-store__content">
          {/* UI-374 — 有包缺运行时才提示，且文案挂包名；无包不提运行时 */}
          {needRuntimeHint && (
            <div className="gewu-plugin-store__hint">
              ⚠️ 已安装领域包 {packsRequiringRuntimes.map((n) => `「${n}」`).join('、')} 需要
              {' '}{missingRuntimeNames.join(' 与 ')} 运行时——请在本页领域包卡片内补装，否则对应分析工具无法使用。
            </div>
          )}

          {/* BLOCK-84：领域包分区——整包一键装/卸（记录制，重启生效）
              UI-374：pack 卡片 = 唯一领域入口（运行时子项收编进卡片） */}
          {(availablePacks.length > 0 || installedPacks.length > 0) && (
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
                            {pack.installed && (() => {
                              // BLOCK-163 W3 P7（DIST-5）— 更新徽标：包根版本 > 已装版本
                              const update = packUpdates.get(pack.packId);
                              return update ? (
                                <span
                                  data-testid={`pack-update-${pack.packId}`}
                                  style={{ marginLeft: 6, fontSize: 'var(--gewu-font-size-caption, 12px)', color: 'var(--gewu-warning, #d97706)' }}
                                  title={`有新版本 v${update.latestVersion}（当前 v${update.installedVersion}）`}
                                >
                                  ↑ v{update.latestVersion}
                                </span>
                              ) : null;
                            })()}
                          </div>
                          <div style={{ color: 'var(--gewu-text-tertiary)', fontSize: 'var(--gewu-font-size-caption, 12px)' }}>
                            {contents
                              ? `${contents.pluginCount} 个分析插件 · ${contents.scriptCount} 个脚本模块 · ${contents.demoDataCount} 个演示数据集`
                              : (pack.description || pack.packId)}
                          </div>
                        </div>
                        {pack.installed ? (
                          <div style={{ display: 'flex', gap: 8 }}>
                            {(() => {
                              const row = installedPacks.find((p) => p.packId === pack.packId);
                              const isEnabled = row ? row.enabled !== false : true;
                              return (
                                <button
                                  type="button"
                                  className="gewu-btn gewu-btn--ghost"
                                  data-testid={`pack-toggle-${pack.packId}`}
                                  title={isEnabled ? '停用后重启生效：该包全部分析插件不再注册到 run_tool/MCP/目录（可随时启用，免重装）' : '启用后重启生效（免重装）'}
                                  disabled={packBusy !== null}
                                  onClick={() => void handlePackSetEnabled(pack.packId, !isEnabled)}
                                >
                                  {packBusy === pack.packId ? '处理中…' : isEnabled ? '停用' : '启用'}
                                </button>
                              );
                            })()}
                            {(() => {
                              const update = packUpdates.get(pack.packId);
                              if (!update) return null;
                              return (
                                <button
                                  type="button"
                                  className="gewu-btn gewu-btn--primary"
                                  data-testid={`pack-update-btn-${pack.packId}`}
                                  title={`更新到 v${update.latestVersion}（覆盖装，同一安装链）`}
                                  disabled={packBusy !== null}
                                  onClick={() => void handlePackUpdate(pack)}
                                >
                                  {packBusy === pack.packId ? '处理中…' : `更新到 v${update.latestVersion}`}
                                </button>
                              );
                            })()}
                            <button
                              type="button"
                              className="gewu-btn"
                              disabled={packBusy !== null}
                              onClick={() => void beginPackUninstall(pack)}
                            >
                              {packBusy === pack.packId ? '处理中…' : '卸载'}
                            </button>
                          </div>
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
                                    disabled={packBusy !== null}
                                    onClick={() => void handleRuntimeTopUp(req.pluginId)}
                                  >
                                    {packBusy === req.pluginId ? '安装中…' : '补装'}
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

          {packDeliveredPlugins.length === 0 && (
            <div className="gewu-empty">
              {searchQuery ? `没有匹配「${searchQuery}」的插件` : '暂无插件（领域插件随领域包交付）'}
            </div>
          )}

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
        <span className="gewu-plugin-store__footer-info">已安装 {installedCount} 个</span>
      </div>
    </div>
  );
}

