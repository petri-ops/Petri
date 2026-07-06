import React, { useState, useEffect, useCallback } from 'react';
import type { Project } from './_types';
import {
  listProjects,
  createProject,
  deleteProject,
  getProjectStats,
  updateProject,
} from './_store';
import { formatTime } from './_api';
import type { Route } from './_router';
import { Sidebar } from './_Sidebar';
import { useSidebarCollapse } from './_useSidebarCollapse';
import { useMobileDrawer } from './_useMobileDrawer';
import { requireWrite, isGuestMode, getStoredUser } from './_auth';
import { WorkbenchEmpty } from '@/components/ui/WorkbenchEmpty';

// Inline SVG icons for project cards (clean line style, matches BioF3 palette)
const ICONS = {
  // Cells/scatter — represents single-cell datasets
  cells: (color: string) => (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="8" cy="8" r="3" />
      <circle cx="16" cy="10" r="2.5" />
      <circle cx="10" cy="16" r="2" />
      <circle cx="17" cy="17" r="1.5" />
      <circle cx="5" cy="13" r="1.5" />
    </svg>
  ),
  // Chart — represents analysis results
  chart: (color: string) => (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 3v18h18" />
      <path d="M7 16l4-4 4 2 5-6" />
      <circle cx="7" cy="16" r="1.2" fill={color} stroke="none" opacity="0.5" />
      <circle cx="11" cy="12" r="1.2" fill={color} stroke="none" opacity="0.5" />
      <circle cx="15" cy="14" r="1.2" fill={color} stroke="none" opacity="0.5" />
      <circle cx="20" cy="8" r="1.2" fill={color} stroke="none" opacity="0.5" />
    </svg>
  ),
};

// Project color themes (clean, professional)
const PROJECT_COLORS = [
  {
    primary: '#0f766e',
    secondary: '#10b981',
    gradient: 'linear-gradient(135deg, #0f766e 0%, #10b981 100%)',
    light: '#f0fdf9',
    iconBg: '#e0faf4',
  },
  {
    primary: '#4f46e5',
    secondary: '#7c3aed',
    gradient: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)',
    light: '#f5f3ff',
    iconBg: '#ede9fe',
  },
  {
    primary: '#0891b2',
    secondary: '#06b6d4',
    gradient: 'linear-gradient(135deg, #0891b2 0%, #06b6d4 100%)',
    light: '#ecfeff',
    iconBg: '#cffafe',
  },
  {
    primary: '#b45309',
    secondary: '#d97706',
    gradient: 'linear-gradient(135deg, #b45309 0%, #d97706 100%)',
    light: '#fffbeb',
    iconBg: '#fef3c7',
  },
  {
    primary: '#be185d',
    secondary: '#ec4899',
    gradient: 'linear-gradient(135deg, #be185d 0%, #ec4899 100%)',
    light: '#fdf2f8',
    iconBg: '#fce7f3',
  },
  {
    primary: '#15803d',
    secondary: '#22c55e',
    gradient: 'linear-gradient(135deg, #15803d 0%, #22c55e 100%)',
    light: '#f0fdf4',
    iconBg: '#dcfce7',
  },
];

export function ProjectsView({ navigate }: { navigate: (r: Route) => void }) {
  const [sidebarCollapsed, toggleSidebar, sidebarWidth, startResize] = useSidebarCollapse();
  const [mobileOpen, openMobile, closeMobile] = useMobileDrawer();
  const [projects, setProjects] = useState<Project[]>([]);
  const [statsMap, setStatsMap] = useState<Record<string, { datasets: number; analyses: number }>>(
    {}
  );
  const [loading, setLoading] = useState(true);
  const [showNewModal, setShowNewModal] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const reload = useCallback(async () => {
    try {
      const list = await listProjects();
      setProjects(list);
      setLoading(false);
      // Load stats in background (non-blocking — UI renders immediately)
      const map: Record<string, { datasets: number; analyses: number }> = {};
      await Promise.all(
        list.map(async (p) => {
          try {
            map[p.id] = await getProjectStats(p.id);
          } catch (err) {
            map[p.id] = { datasets: 0, analyses: 0 };
          }
        })
      );
      setStatsMap(map);
    } catch (e) {
      console.error('加载项目列表失败', e);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  // Copilot upload hint
  useEffect(() => {
    const onHint = () => {
      try {
        const el = document.querySelector(
          '.sc-empty, [data-upload-zone], .sc-upload-zone, .sc-projects-grid'
        );
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          (el as HTMLElement).style.transition = 'box-shadow 0.3s';
          (el as HTMLElement).style.boxShadow = '0 0 0 4px rgba(16,185,129,0.4)';
          setTimeout(() => {
            (el as HTMLElement).style.boxShadow = '';
          }, 2400);
        }
      } catch {}
    };
    window.addEventListener('biof3:sc-upload-hint', onHint);
    return () => window.removeEventListener('biof3:sc-upload-hint', onHint);
  }, []);

  const handleCreate = useCallback(
    async (e?: React.MouseEvent) => {
      if (!requireWrite('创建项目', e)) return;
      if (!newName.trim()) return;
      try {
        const p = await createProject(newName.trim(), newDesc.trim() || undefined);
        setNewName('');
        setNewDesc('');
        setShowNewModal(false);
        navigate({ name: 'project', projectId: p.id });
      } catch (e: unknown) {
        alert(`创建失败: ${e.message}`);
      }
    },
    [newName, newDesc, navigate]
  );

  const handleDelete = useCallback(
    async (id: string, name: string, e: React.MouseEvent) => {
      e.stopPropagation();
      if (!requireWrite('删除项目', e)) return;
      if (confirm(`删除项目「${name}」？所有关联的数据集和分析记录都会被删除。`)) {
        try {
          await deleteProject(id);
          reload();
        } catch (err) {
          alert(`删除失败: ${err.message}`);
        }
      }
    },
    [reload]
  );

  const startRename = useCallback((p: Project, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!requireWrite('重命名', e)) return;
    setRenamingId(p.id);
    setRenameValue(p.name);
  }, []);

  const commitRename = useCallback(async () => {
    if (!renamingId) return;
    const target = projects.find((p) => p.id === renamingId);
    if (!target) {
      setRenamingId(null);
      return;
    }
    const trimmed = renameValue.trim();
    if (!trimmed || trimmed === target.name) {
      setRenamingId(null);
      return;
    }
    try {
      await updateProject(renamingId, { name: trimmed });
      setRenamingId(null);
      reload();
    } catch (e: unknown) {
      alert(`重命名失败: ${e.message}`);
      setRenamingId(null);
    }
  }, [renamingId, renameValue, projects, reload]);

  return (
    <main className="sc-page">
      <section
        className={`sc-layout ${sidebarCollapsed ? 'sc-layout-collapsed' : ''}`}
        style={{ '--sidebar-w': `${sidebarWidth}px` } as React.CSSProperties}
      >
        {/* Sidebar (slide-in drawer on mobile) */}
        <Sidebar
          navigate={(r) => {
            closeMobile();
            navigate(r);
          }}
          collapsed={sidebarCollapsed}
          onToggleCollapse={toggleSidebar}
          width={sidebarWidth}
          onResizeStart={startResize}
          mobileOpen={mobileOpen}
        />
        {mobileOpen && <div className="sc-mobile-backdrop" onClick={closeMobile} />}

        {/* Main */}
        <div className="sc-main">
          <button className="sc-mobile-menu-btn" onClick={openMobile} aria-label="打开导航">
            <span className="sc-mobile-menu-btn-icon">
              <span />
            </span>
            导航
          </button>
          {isGuestMode() && (
            <div className="sc-guest-banner">
              <span className="sc-guest-icon">👁</span>
              <span>
                <strong>游客预览模式</strong> · 可浏览 Demo 数据，登录后可创建项目和分析
              </span>
              <button
                className="sc-btn sc-btn-sm"
                onClick={() => window.dispatchEvent(new CustomEvent('biof3:open-login'))}
              >
                登录
              </button>
            </div>
          )}
          <div className="sc-header">
            <div>
              <h1 className="sc-header-title">我的项目</h1>
              <p className="sc-header-subtitle">{projects.length} 个项目 · 单细胞数据分析平台</p>
            </div>
            <div className="sc-header-actions">
              <button className="sc-btn sc-btn-primary" onClick={() => setShowNewModal(true)}>
                + 新建项目
              </button>
            </div>
          </div>

          {loading && <WorkbenchEmpty loading desc="加载中..." />}

          {!loading && projects.length === 0 && (
            <WorkbenchEmpty
              title="还没有项目"
              desc="创建你的第一个项目，上传数据开始分析"
              primaryLabel="+ 新建项目"
              onPrimary={() => setShowNewModal(true)}
            />
          )}

          {!loading && projects.length > 0 && (
            <div className="sc-grid">
              {projects.map((p, idx) => {
                const stats = statsMap[p.id] || { datasets: 0, analyses: 0 };
                const colors = PROJECT_COLORS[idx % PROJECT_COLORS.length];
                return (
                  <div
                    key={p.id}
                    className="sc-card sc-card-rich"
                    onClick={() => navigate({ name: 'project', projectId: p.id })}
                  >
                    {/* 顶部渐变条 */}
                    <div className="sc-card-gradient" style={{ background: colors.gradient }} />

                    {/* 头部：名称 + 状态 */}
                    <div className="sc-card-header-row">
                      {renamingId === p.id ? (
                        <input
                          className="sc-form-input"
                          style={{ fontSize: 14, fontWeight: 800, padding: '2px 6px', flex: 1 }}
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onClick={(e) => e.stopPropagation()}
                          onBlur={commitRename}
                          onKeyDown={(e) => {
                            e.stopPropagation();
                            if (e.key === 'Enter') commitRename();
                            if (e.key === 'Escape') setRenamingId(null);
                          }}
                          autoFocus
                        />
                      ) : (
                        <h3
                          className="sc-card-title"
                          onDoubleClick={(e) => startRename(p, e)}
                          title="双击重命名"
                        >
                          {p.name}
                        </h3>
                      )}
                      {p.isPublic && (
                        <span
                          className="sc-card-badge"
                          style={{ background: '#dbeafe', color: '#2563eb', fontSize: 9 }}
                        >
                          公开
                        </span>
                      )}
                      {stats.analyses > 0 && (
                        <span
                          className="sc-card-badge"
                          style={{ background: `${colors.primary}20`, color: colors.primary }}
                        >
                          活跃
                        </span>
                      )}
                    </div>
                    {p.description && <p className="sc-card-desc">{p.description}</p>}

                    {/* 中间：图标区 */}
                    <div
                      className="sc-card-icon-area"
                      style={{ background: colors.light, borderColor: `${colors.primary}20` }}
                    >
                      <div className="sc-card-icon-item">
                        <div
                          className="sc-card-icon-circle"
                          style={{ background: colors.iconBg, borderColor: `${colors.primary}30` }}
                        >
                          {ICONS.cells(colors.primary)}
                        </div>
                        <div className="sc-card-icon-label">数据集</div>
                        <div className="sc-card-icon-value" style={{ color: colors.primary }}>
                          {stats.datasets}
                        </div>
                      </div>
                      <div className="sc-card-icon-item">
                        <div
                          className="sc-card-icon-circle"
                          style={{
                            background: `${colors.secondary}15`,
                            borderColor: `${colors.secondary}30`,
                          }}
                        >
                          {ICONS.chart(colors.secondary)}
                        </div>
                        <div className="sc-card-icon-label">分析</div>
                        <div className="sc-card-icon-value" style={{ color: colors.secondary }}>
                          {stats.analyses}
                        </div>
                      </div>
                    </div>

                    {/* 底部 */}
                    <div className="sc-card-footer">
                      <span>更新于 {formatTime(p.updatedAt)}</span>
                      {!p.isPublic && (
                        <button
                          className="sc-card-delete"
                          onClick={(e) => handleDelete(p.id, p.name, e)}
                        >
                          删除
                        </button>
                      )}
                      {p.isPublic && (
                        <span style={{ fontSize: 10, color: '#9ca3af' }}>只读示例</span>
                      )}
                    </div>

                    {/* 进入/复制按钮 */}
                    {p.isPublic && getStoredUser()?.role !== 'admin' ? (
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'stretch',
                          marginTop: 10,
                          borderRadius: 6,
                          overflow: 'hidden',
                        }}
                      >
                        <button
                          style={{
                            flex: 1,
                            padding: '8px 0',
                            background: colors.gradient,
                            border: 'none',
                            color: 'white',
                            fontSize: 12,
                            fontWeight: 600,
                            cursor: 'pointer',
                          }}
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate({ name: 'project', projectId: p.id });
                          }}
                        >
                          查看 Demo →
                        </button>
                        <button
                          style={{
                            padding: '8px 12px',
                            background: 'rgba(0,0,0,0.15)',
                            border: 'none',
                            borderLeft: '1px solid rgba(255,255,255,0.3)',
                            color: 'white',
                            fontSize: 11,
                            cursor: 'pointer',
                            whiteSpace: 'nowrap',
                          }}
                          onClick={async (e) => {
                            e.stopPropagation();
                            try {
                              const {
                                createProject,
                                listDatasetsByProject,
                                createDataset: createDs,
                              } = await import('./_store');
                              const myProject = await createProject(`${p.name} (我的副本)`);
                              const datasets = await listDatasetsByProject(p.id);
                              for (const d of datasets) {
                                await createDs({
                                  projectId: myProject.id,
                                  name: d.name,
                                  ossUrl: d.ossUrl,
                                  size: d.size,
                                  description: `从公开示例复制`,
                                });
                              }
                              navigate({ name: 'project', projectId: myProject.id });
                            } catch (err) {
                              alert(`复制失败: ${err.message}`);
                            }
                          }}
                          title="复制到我的项目后可自由分析"
                        >
                          📋 复制
                        </button>
                      </div>
                    ) : (
                      <button
                        className="sc-card-enter-btn"
                        style={{ background: colors.gradient }}
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate({ name: 'project', projectId: p.id });
                        }}
                      >
                        进入项目 →
                      </button>
                    )}
                  </div>
                );
              })}
              <div className="sc-card sc-card-new" onClick={() => setShowNewModal(true)}>
                <div>
                  <div className="sc-card-new-icon">+</div>
                  <div className="sc-card-new-label">新建项目</div>
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* New project modal */}
      {showNewModal && (
        <div className="sc-modal-overlay" onClick={() => setShowNewModal(false)}>
          <div className="sc-modal" onClick={(e) => e.stopPropagation()}>
            <div className="sc-modal-header">
              <h2 className="sc-modal-title">新建项目</h2>
              <button className="sc-modal-close" onClick={() => setShowNewModal(false)}>
                ×
              </button>
            </div>
            <div className="sc-modal-body">
              <div className="sc-form-group">
                <label className="sc-form-label">项目名称</label>
                <input
                  className="sc-form-input"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="例如：PBMC 免疫细胞实验"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && newName.trim()) handleCreate();
                  }}
                />
              </div>
              <div className="sc-form-group">
                <label className="sc-form-label">描述（可选）</label>
                <textarea
                  className="sc-form-textarea"
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  placeholder="简要描述项目背景、研究目的等"
                />
              </div>
            </div>
            <div className="sc-modal-footer">
              <button className="sc-btn" onClick={() => setShowNewModal(false)}>
                取消
              </button>
              <button
                className="sc-btn sc-btn-primary"
                onClick={handleCreate}
                disabled={!newName.trim()}
              >
                创建
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
