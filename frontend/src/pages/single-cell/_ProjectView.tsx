import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { Project, Dataset } from './_types';
import {
  getProject,
  listDatasetsByProject,
  createDataset,
  deleteDataset,
  getDatasetStats,
  updateProject,
  updateDataset,
} from './_store';
import { formatSize, formatTime, uploadFile } from './_api';
import type { Route } from './_router';
import { Sidebar } from './_Sidebar';
import { useSidebarCollapse } from './_useSidebarCollapse';
import { useMobileDrawer } from './_useMobileDrawer';
import { requireWrite, getStoredUser, getAuthHeaders } from './_auth';
import { getApiPrefix } from './_config';
import { NewAnalysisModal } from './_NewAnalysisModal';

// SVG icons matching ProjectsView style
const DS_ICONS = {
  // Cells/scatter
  cells: (color: string) => (
    <svg
      width="20"
      height="20"
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
  // Bar chart
  chart: (color: string) => (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 3v18h18" />
      <path d="M7 16l4-4 4 2 5-6" />
    </svg>
  ),
};

// Color themes for dataset cards
const DS_COLORS = [
  {
    primary: '#0f766e',
    secondary: '#10b981',
    gradient: 'linear-gradient(135deg, #0f766e 0%, #10b981 100%)',
    light: '#f0fdf9',
    iconBg: '#e0faf4',
  },
  {
    primary: '#0891b2',
    secondary: '#06b6d4',
    gradient: 'linear-gradient(135deg, #0891b2 0%, #06b6d4 100%)',
    light: '#ecfeff',
    iconBg: '#cffafe',
  },
  {
    primary: '#4f46e5',
    secondary: '#7c3aed',
    gradient: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)',
    light: '#f5f3ff',
    iconBg: '#ede9fe',
  },
  {
    primary: '#15803d',
    secondary: '#22c55e',
    gradient: 'linear-gradient(135deg, #15803d 0%, #22c55e 100%)',
    light: '#f0fdf4',
    iconBg: '#dcfce7',
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
];

export function ProjectView({
  projectId,
  navigate,
}: {
  projectId: string;
  navigate: (r: Route) => void;
}) {
  const [sidebarCollapsed, toggleSidebar, sidebarWidth, startResize] = useSidebarCollapse();
  const [mobileOpen, openMobile, closeMobile] = useMobileDrawer();
  const [project, setProject] = useState<Project | null>(null);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [statsMap, setStatsMap] = useState<
    Record<string, { analyses: number; lastAnalysisAt?: string }>
  >({});
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [renamingDsId, setRenamingDsId] = useState<string | null>(null);
  const [renameDsValue, setRenameDsValue] = useState('');
  const [standardAnalysisDs, setStandardAnalysisDs] = useState<Dataset | null>(null);
  const [selectedDsIds, setSelectedDsIds] = useState<Set<string>>(new Set());
  const [merging, setMerging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Reset state immediately when projectId changes
  useEffect(() => {
    setLoading(true);
    setProject(null);
    setDatasets([]);
    setStatsMap({});
  }, [projectId]);

  const reload = useCallback(async () => {
    try {
      const [proj, dsList] = await Promise.all([
        getProject(projectId),
        listDatasetsByProject(projectId),
      ]);
      setProject(proj);
      setDatasets(dsList);
      setLoading(false);
      // Load stats in background (non-blocking)
      const map: Record<string, { analyses: number; lastAnalysisAt?: string }> = {};
      await Promise.all(
        dsList.map(async (d) => {
          try {
            map[d.id] = await getDatasetStats(d.id);
          } catch (err: any) {
            map[d.id] = { analyses: 0 };
          }
        })
      );
      setStatsMap(map);
    } catch (e: any) {
      console.error('加载项目失败', e);
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    reload();
  }, [reload]);

  // Copilot: respond to merge intent — pre-select datasets and trigger merge
  useEffect(() => {
    const onMerge = (e: Event) => {
      const detail = (e as CustomEvent).detail || {};
      const ids: string[] = detail.datasetIds || [];
      if (ids.length < 2) return;
      // Restrict to datasets in this project
      const inProject = ids.filter((id) => datasets.some((d) => d.id === id));
      if (inProject.length < 2) {
        alert('Copilot 想合并的数据集不全在这个项目里，请先确认。');
        return;
      }
      setSelectedDsIds(new Set(inProject));
      setTimeout(() => {
        handleMerge();
      }, 100);
    };
    window.addEventListener('biof3:sc-do-merge', onMerge as EventListener);
    return () => window.removeEventListener('biof3:sc-do-merge', onMerge as EventListener);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datasets]);

  // Copilot: upload data hint — highlight the upload area
  useEffect(() => {
    const onHint = () => {
      try {
        const el = document.querySelector('.sc-upload-zone, [data-upload-zone], .sc-empty');
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
          (el as HTMLElement).style.transition = 'box-shadow 0.3s';
          (el as HTMLElement).style.boxShadow = '0 0 0 4px rgba(16,185,129,0.4)';
          setTimeout(() => {
            (el as HTMLElement).style.boxShadow = '';
          }, 2400);
        }
        if (fileInputRef.current) {
          fileInputRef.current.click();
        }
      } catch {}
    };
    window.addEventListener('biof3:sc-upload-hint', onHint);
    return () => window.removeEventListener('biof3:sc-upload-hint', onHint);
  }, []);

  const handleUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (!requireWrite('上传数据集')) {
        if (fileInputRef.current) fileInputRef.current.value = '';
        return;
      }
      // File size validation
      const MAX_SIZE_MB = 200;
      if (file.size > MAX_SIZE_MB * 1024 * 1024) {
        const sizeMB = Math.round(file.size / 1024 / 1024);
        if (
          !confirm(
            `文件大小 ${sizeMB}MB，超过推荐上限(${MAX_SIZE_MB}MB)。\n\n大文件上传可能较慢且分析可能超时。\n\n建议：\n• 如果是 count matrix，筛选低表达基因后重新导出\n• 如果是 10x h5，确认不是 raw_feature_bc_matrix（用 filtered）\n\n确定继续上传吗？`
          )
        ) {
          if (fileInputRef.current) fileInputRef.current.value = '';
          return;
        }
      }
      setUploading(true);
      setUploadProgress(0);
      try {
        const result = await uploadFile(file, setUploadProgress);
        const _ds = await createDataset({
          projectId,
          name: result.name,
          ossUrl: result.url,
          size: result.size,
        });
        reload();

        // Stay on project page — user needs to start standard analysis first
      } catch (err: any) {
        alert(`上传失败: ${err.message}`);
      } finally {
        setUploading(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [projectId, reload, navigate]
  );

  const handleDelete = useCallback(
    async (id: string, name: string, size: number, e: React.MouseEvent) => {
      e.stopPropagation();
      if (!requireWrite('删除数据集', e)) return;
      const sizeStr = size > 0 ? `（释放 ${formatSize(size)}）` : '';
      if (confirm(`删除数据集「${name}」？\n所有分析记录都会被删除。${sizeStr}`)) {
        try {
          await deleteDataset(id);
          reload();
        } catch (err: any) {
          alert(`删除失败: ${err.message}`);
        }
      }
    },
    [reload]
  );

  const handleMerge = useCallback(async () => {
    if (selectedDsIds.size < 2) {
      alert('请选择 2 个以上数据集');
      return;
    }
    if (!requireWrite('合并数据集')) return;
    setMerging(true);
    try {
      const selected = datasets.filter((d) => selectedDsIds.has(d.id));
      const shortNames = selected.map((d) => d.name.replace(/\.[^.]+$/, '').slice(0, 12));
      const autoName =
        selected.length <= 2 ? `整合: ${shortNames.join(' + ')}` : `整合 ${selected.length} 个样本`;
      const totalSize = selected.reduce((sum, d) => sum + d.size, 0);
      // Use first dataset's OSS URL as primary (R script will load all)
      const ossUrls = selected.map((d) => d.ossUrl);
      const newDs = await createDataset({
        projectId,
        name: autoName,
        ossUrl: ossUrls[0], // Primary URL
        size: totalSize,
        description: `合并自 ${selected.length} 个数据集: ${selected.map((d) => d.name).join(', ')}`,
        sourceDatasetIds: selected.map((d) => d.id),
      });
      setSelectedDsIds(new Set());
      reload();
      // Navigate to the merged dataset to start integration analysis
      navigate({ name: 'dataset', datasetId: newDs.id });
    } catch (err: any) {
      alert(`合并失败: ${err.message}`);
    } finally {
      setMerging(false);
    }
  }, [selectedDsIds, datasets, projectId, reload, navigate]);

  const toggleDsSelection = useCallback((id: string) => {
    setSelectedDsIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleRename = useCallback(async () => {
    if (!project || !renameValue.trim() || renameValue.trim() === project.name) {
      setRenaming(false);
      return;
    }
    if (!requireWrite('重命名项目')) {
      setRenaming(false);
      return;
    }
    try {
      await updateProject(project.id, { name: renameValue.trim() });
      setRenaming(false);
      reload();
    } catch (e: any) {
      alert(`重命名失败: ${e.message}`);
    }
  }, [project, renameValue, reload]);

  const startDsRename = useCallback((d: Dataset, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!requireWrite('重命名数据集', e)) return;
    setRenamingDsId(d.id);
    setRenameDsValue(d.name);
  }, []);

  const commitDsRename = useCallback(async () => {
    if (!renamingDsId) return;
    const target = datasets.find((d) => d.id === renamingDsId);
    if (!target) {
      setRenamingDsId(null);
      return;
    }
    const trimmed = renameDsValue.trim();
    if (!trimmed || trimmed === target.name) {
      setRenamingDsId(null);
      return;
    }
    try {
      await updateDataset(renamingDsId, { name: trimmed });
      setRenamingDsId(null);
      reload();
    } catch (e: any) {
      alert(`重命名失败: ${e.message}`);
      setRenamingDsId(null);
    }
  }, [renamingDsId, renameDsValue, datasets, reload]);

  if (loading) {
    return (
      <main className="sc-page">
        <div className="sc-main">
          <div className="sc-empty">
            <div className="sc-empty-desc">加载中...</div>
          </div>
        </div>
      </main>
    );
  }

  if (!project) {
    return (
      <main className="sc-page">
        <div className="sc-main">
          <div className="sc-empty">
            <div className="sc-empty-title">项目不存在</div>
            <button
              className="sc-btn sc-btn-primary"
              onClick={() => navigate({ name: 'projects' })}
            >
              返回项目列表
            </button>
          </div>
        </div>
      </main>
    );
  }

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
          activeProjectId={projectId}
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
          <div className="sc-header">
            <div>
              {renaming ? (
                <input
                  className="sc-form-input"
                  style={{
                    fontSize: 16,
                    fontWeight: 700,
                    padding: '4px 8px',
                    width: '100%',
                    maxWidth: 400,
                  }}
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={handleRename}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleRename();
                    if (e.key === 'Escape') setRenaming(false);
                  }}
                  autoFocus
                />
              ) : (
                <h1
                  className="sc-header-title"
                  onDoubleClick={() => {
                    setRenameValue(project.name);
                    setRenaming(true);
                  }}
                  title="双击重命名"
                  style={{ cursor: 'text' }}
                >
                  {project.name}
                  <span style={{ fontSize: 10, color: 'var(--biof3-text-muted)', marginLeft: 8, fontWeight: 400 }}>
                    ✎
                  </span>
                </h1>
              )}
              <p className="sc-header-subtitle">
                {datasets.length} 个数据集 · 创建于 {formatTime(project.createdAt)}
                {project.description && ` · ${project.description}`}
              </p>
            </div>
            <div className="sc-header-actions">
              {getStoredUser()?.role === 'admin' && project && (
                <button
                  className="sc-btn"
                  style={{ fontSize: 11 }}
                  onClick={async () => {
                    const newVal = !project.isPublic;
                    await fetch(getApiPrefix() + `/data/admin/projects/${projectId}/public`, {
                      method: 'PUT',
                      headers: { ...getAuthHeaders() },
                      body: JSON.stringify({ isPublic: newVal }),
                    });
                    reload();
                  }}
                >
                  {project.isPublic ? '🔓 取消公开' : '🌐 设为公开'}
                </button>
              )}
              <label className="sc-btn sc-btn-primary">
                {uploading ? '上传中...' : '+ 上传数据集'}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".rds,.h5,.hdf5,.csv,.tsv,.txt,.gz"
                  onChange={handleUpload}
                  style={{ display: 'none' }}
                  disabled={uploading}
                />
              </label>
            </div>
          </div>

          {datasets.length === 0 && !uploading && (
            <div className="sc-upload-box">
              <h3>上传第一个数据集</h3>
              <p>
                支持 <code>.rds</code> · <code>.h5</code> · <code>.csv</code> · <code>.tsv</code>
                ，最大 200MB
              </p>
              <p style={{ fontSize: 12, color: 'var(--biof3-text-secondary)', marginTop: 8, lineHeight: 1.6 }}>
                <strong>推荐格式：</strong>Seurat RDS 对象 或 10x h5
                文件（filtered_feature_bc_matrix.h5）
                <br />
                <strong>10x 三件套用户：</strong>如果你有 barcodes.tsv + features.tsv + matrix.mtx，
                <br />
                请先在本地 R 中运行{' '}
                <code>Read10X(&quot;path/&quot;) |&gt; saveRDS(&quot;data.rds&quot;)</code> 转为 RDS
                再上传
              </p>
              <label className="sc-btn sc-btn-primary">
                选择文件
                <input
                  type="file"
                  accept=".rds,.h5,.hdf5,.csv,.tsv,.txt,.gz"
                  onChange={handleUpload}
                  style={{ display: 'none' }}
                />
              </label>
            </div>
          )}

          {datasets.length > 0 && (
            <div className="sc-grid">
              {datasets.map((d, idx) => {
                const stats = statsMap[d.id] || { analyses: 0 };
                const colors = DS_COLORS[idx % DS_COLORS.length];
                const ext = d.name.split('.').pop()?.toLowerCase() || 'file';
                return (
                  <div
                    key={d.id}
                    className={`sc-card sc-card-rich ${selectedDsIds.has(d.id) ? 'sc-card-selected' : ''}`}
                    onClick={() => {
                      if (stats.analyses > 0) navigate({ name: 'dataset', datasetId: d.id });
                    }}
                  >
                    {/* Selection dot */}
                    {datasets.length > 1 && (
                      <span
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleDsSelection(d.id);
                        }}
                        style={{
                          position: 'absolute',
                          top: 12,
                          right: 12,
                          width: 10,
                          height: 10,
                          borderRadius: '50%',
                          cursor: 'pointer',
                          zIndex: 2,
                          background: selectedDsIds.has(d.id)
                            ? 'var(--ifm-color-primary)'
                            : '#e2e8f0',
                          border: selectedDsIds.has(d.id)
                            ? '2px solid var(--ifm-color-primary)'
                            : '2px solid #cbd5e1',
                          transition: 'all 0.15s',
                        }}
                        title="选中用于合并"
                      />
                    )}
                    {/* 顶部渐变条 */}
                    <div className="sc-card-gradient" style={{ background: colors.gradient }} />

                    {/* 头部：名称 + 文件类型徽章 */}
                    <div className="sc-card-header-row">
                      {renamingDsId === d.id ? (
                        <input
                          className="sc-form-input"
                          style={{ fontSize: 14, fontWeight: 800, padding: '2px 6px', flex: 1 }}
                          value={renameDsValue}
                          onChange={(e) => setRenameDsValue(e.target.value)}
                          onClick={(e) => e.stopPropagation()}
                          onBlur={commitDsRename}
                          onKeyDown={(e) => {
                            e.stopPropagation();
                            if (e.key === 'Enter') commitDsRename();
                            if (e.key === 'Escape') setRenamingDsId(null);
                          }}
                          autoFocus
                        />
                      ) : (
                        <h3
                          className="sc-card-title"
                          onClick={(e) => {
                            e.stopPropagation();
                            startDsRename(d, e);
                          }}
                          title={d.name + ' (点击重命名)'}
                          style={{
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            maxWidth: '70%',
                            cursor: 'text',
                          }}
                        >
                          {d.name}
                        </h3>
                      )}
                      <span
                        className="sc-card-badge"
                        style={{ background: `${colors.primary}20`, color: colors.primary }}
                      >
                        .{ext}
                      </span>
                    </div>
                    <p className="sc-card-desc">
                      {formatSize(d.size)} · 上传于 {formatTime(d.uploadedAt)}
                    </p>

                    {/* 中间：图标区（cells / 分析次数） */}
                    <div
                      className="sc-card-icon-area"
                      style={{ background: colors.light, borderColor: `${colors.primary}20` }}
                    >
                      <div className="sc-card-icon-item">
                        <div
                          className="sc-card-icon-circle"
                          style={{ background: colors.iconBg, borderColor: `${colors.primary}30` }}
                        >
                          {DS_ICONS.cells(colors.primary)}
                        </div>
                        <div className="sc-card-icon-label">细胞数</div>
                        <div className="sc-card-icon-value" style={{ color: colors.primary }}>
                          {d.nCells ? d.nCells.toLocaleString() : '—'}
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
                          {DS_ICONS.chart(colors.secondary)}
                        </div>
                        <div className="sc-card-icon-label">分析</div>
                        <div className="sc-card-icon-value" style={{ color: colors.secondary }}>
                          {stats.analyses}
                        </div>
                      </div>
                    </div>

                    {/* 底部 */}
                    <div className="sc-card-footer">
                      <span>
                        {stats.lastAnalysisAt
                          ? `上次 ${formatTime(stats.lastAnalysisAt)}`
                          : '尚未分析'}
                      </span>
                      <button
                        className="sc-card-delete"
                        onClick={(e) => handleDelete(d.id, d.name, d.size, e)}
                      >
                        删除
                      </button>
                    </div>

                    {/* 操作按钮 */}
                    {stats.analyses === 0 ? (
                      <button
                        className="sc-card-enter-btn"
                        style={{ background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)' }}
                        onClick={(e) => {
                          e.stopPropagation();
                          setStandardAnalysisDs(d);
                        }}
                      >
                        启动标准分析
                      </button>
                    ) : (
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
                            letterSpacing: '0.5px',
                          }}
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate({ name: 'dataset', datasetId: d.id });
                          }}
                        >
                          进入数据集 →
                        </button>
                        <button
                          style={{
                            padding: '8px 12px',
                            background: 'rgba(0,0,0,0.15)',
                            border: 'none',
                            borderLeft: '1px solid rgba(255,255,255,0.3)',
                            color: 'white',
                            fontSize: 12,
                            cursor: 'pointer',
                          }}
                          onClick={(e) => {
                            e.stopPropagation();
                            setStandardAnalysisDs(d);
                          }}
                          title="重新标准分析"
                        >
                          ↻
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
              <label
                className="sc-card sc-card-new"
                style={{ cursor: uploading ? 'wait' : 'pointer' }}
              >
                <input
                  type="file"
                  accept=".rds,.h5,.hdf5,.csv,.tsv,.txt,.gz"
                  onChange={handleUpload}
                  style={{ display: 'none' }}
                  disabled={uploading}
                />
                {uploading ? (
                  <div style={{ width: '100%', padding: '0 16px' }}>
                    <div className="sc-card-new-icon" style={{ fontSize: 20, marginBottom: 8 }}>
                      ⏳
                    </div>
                    <div
                      style={{ fontSize: 11, fontWeight: 600, color: 'var(--biof3-text-secondary)', marginBottom: 8 }}
                    >
                      {uploadProgress < 100 ? '上传云服务器...' : '同步计算节点...'}
                    </div>
                    <div className="sc-progress" style={{ height: 6, borderRadius: 3 }}>
                      <div
                        className="sc-progress-fill"
                        style={{ width: `${uploadProgress}%`, transition: 'width 0.3s' }}
                      />
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--biof3-text-muted)', marginTop: 6 }}>
                      {uploadProgress}%
                    </div>
                  </div>
                ) : (
                  <div>
                    <div className="sc-card-new-icon">+</div>
                    <div className="sc-card-new-label">上传数据集</div>
                  </div>
                )}
              </label>
            </div>
          )}

          {/* Merge bar — below cards when selected */}
          {selectedDsIds.size >= 2 && (
            <div
              style={{
                margin: '16px 0',
                padding: '10px 20px',
                background: '#f8faf9',
                border: '1px solid var(--biof3-border)',
                borderRadius: 8,
                display: 'flex',
                alignItems: 'center',
                gap: 14,
                justifyContent: 'center',
              }}
            >
              <span style={{ fontSize: 12, color: 'var(--biof3-text-secondary)' }}>
                已选 <strong>{selectedDsIds.size}</strong> 个数据集
              </span>
              <button
                className="sc-btn sc-btn-primary"
                onClick={handleMerge}
                disabled={merging}
                style={{ fontSize: 12 }}
              >
                {merging ? '合并中...' : '🔗 合并为新数据集'}
              </button>
              <button
                className="sc-btn"
                onClick={() => setSelectedDsIds(new Set())}
                style={{ fontSize: 11 }}
              >
                取消
              </button>
            </div>
          )}
        </div>
      </section>

      {standardAnalysisDs && (
        <NewAnalysisModal
          dataset={standardAnalysisDs}
          defaultType="scrna_standard"
          onClose={() => setStandardAnalysisDs(null)}
          onCreated={(analysis) => {
            setStandardAnalysisDs(null);
            navigate({ name: 'result', analysisId: analysis.id });
          }}
        />
      )}
    </main>
  );
}
