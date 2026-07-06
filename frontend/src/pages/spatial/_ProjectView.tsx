// ============================================================
// /spatial — 项目详情（数据集列表 + 上传）
//
// 与 /single-cell `_ProjectView.tsx` 同构。Wave 3-A 差异：
//   1) accept=".h5ad,.h5,.hdf5"（spec §5：仅 accept 不同）
//   2) 文案改为空间组学语境（"上传 .h5ad 数据集" 等）
//   3) 数据集卡的"启动标准分析"按钮先标灰禁用——W3-B 才开任务派发
//   4) 合并按钮去掉（spec 未列入空间合并需求；W3-B 决定）
//   5) Sidebar / Store 用 spatial 自己的（modality 过滤）
//
// 上传按钮位置 / 进度条 / 错误提示 / 重命名 / 删除完全沿用 single-cell。
// ============================================================
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
import { formatSize, formatTime, uploadFile, getApiPrefix } from './_api';
import type { Route } from './_router';
import { Sidebar } from './_Sidebar';
import { NewAnalysisModal } from './_NewAnalysisModal';
import { useSidebarCollapse } from '../single-cell/_useSidebarCollapse';
import { useMobileDrawer } from '../single-cell/_useMobileDrawer';
import { requireWrite, getStoredUser, getAuthHeaders } from '../single-cell/_auth';
import { setCopilotContext } from '@/components/copilot';

// 数据集图标
const DS_ICONS = {
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

const DS_COLORS = [
  {
    primary: '#7c2d12',
    secondary: '#b45309',
    gradient: 'linear-gradient(135deg, #7c2d12 0%, #b45309 100%)',
    light: '#fef7ed',
    iconBg: '#fde7d3',
  },
  {
    primary: '#0891b2',
    secondary: '#06b6d4',
    gradient: 'linear-gradient(135deg, #0891b2 0%, #06b6d4 100%)',
    light: '#ecfeff',
    iconBg: '#cffafe',
  },
  {
    primary: '#7c3aed',
    secondary: '#a855f7',
    gradient: 'linear-gradient(135deg, #7c3aed 0%, #a855f7 100%)',
    light: '#f5f3ff',
    iconBg: '#ede9fe',
  },
  {
    primary: '#0f766e',
    secondary: '#10b981',
    gradient: 'linear-gradient(135deg, #0f766e 0%, #10b981 100%)',
    light: '#f0fdf9',
    iconBg: '#e0faf4',
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

const ACCEPT = '.h5ad,.h5,.hdf5';

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
  // W3-B: 启动标准分析弹窗
  const [standardAnalysisDs, setStandardAnalysisDs] = useState<Dataset | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
      const map: Record<string, { analyses: number; lastAnalysisAt?: string }> = {};
      await Promise.all(
        dsList.map(async (d) => {
          try {
            map[d.id] = await getDatasetStats(d.id);
          } catch (err) {
            map[d.id] = { analyses: 0 };
          }
        })
      );
      setStatsMap(map);
    } catch (e) {
      console.error('加载项目失败', e);
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    reload();
  }, [reload]);

  // W3-C: publish Copilot context (project-level) so AI knows the spatial project we're in
  useEffect(() => {
    if (!project) return;
    setCopilotContext({
      page: 'spatial-project',
      currentModule: 'spatial',
      projectId: project.id,
    });
    return () => {
      setCopilotContext({ projectId: undefined });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project?.id]);

  const handleUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (!requireWrite('上传数据集')) {
        if (fileInputRef.current) fileInputRef.current.value = '';
        return;
      }
      // 文件大小校验——空间组学 .h5ad 通常比 scRNA 更大（Visium 含组织底图），上限放到 500MB
      const MAX_SIZE_MB = 500;
      if (file.size > MAX_SIZE_MB * 1024 * 1024) {
        const sizeMB = Math.round(file.size / 1024 / 1024);
        if (
          !confirm(
            `文件大小 ${sizeMB}MB，超过推荐上限(${MAX_SIZE_MB}MB)。\n\n建议：\n• 大切片 / 高分辨率数据可以先做 spot 子集再上传\n• 确认 .h5ad 不含 raw 全基因（保留 HVG + meta 即可）\n\n确定继续上传吗？`
          )
        ) {
          if (fileInputRef.current) fileInputRef.current.value = '';
          return;
        }
      }
      // 后缀提示——空间组学只支持 .h5ad / .h5
      const lower = file.name.toLowerCase();
      if (!lower.endsWith('.h5ad') && !lower.endsWith('.h5') && !lower.endsWith('.hdf5')) {
        alert(
          `空间组学暂只支持 .h5ad / .h5 / .hdf5 格式。\n\n你的文件: ${file.name}\n\n如果是 Seurat .rds，请先在 R 中转 anndata：\nlibrary(zellkonverter); writeH5AD(sce, "out.h5ad")`
        );
        if (fileInputRef.current) fileInputRef.current.value = '';
        return;
      }
      setUploading(true);
      setUploadProgress(0);
      try {
        const result = await uploadFile(file, setUploadProgress);
        await createDataset({
          projectId,
          name: result.name,
          ossUrl: result.url,
          size: result.size,
        });
        reload();
      } catch (err) {
        alert(`上传失败: ${err.message}`);
      } finally {
        setUploading(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    },
    [projectId, reload]
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
        } catch (err) {
          alert(`删除失败: ${err.message}`);
        }
      }
    },
    [reload]
  );

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
    } catch (e: unknown) {
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
    } catch (e: unknown) {
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
                  <span style={{ fontSize: 10, color: '#9ca3af', marginLeft: 8, fontWeight: 400 }}>
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
                  accept={ACCEPT}
                  onChange={handleUpload}
                  style={{ display: 'none' }}
                  disabled={uploading}
                />
              </label>
            </div>
          </div>

          {datasets.length === 0 && !uploading && (
            <div className="sc-upload-box">
              <h3>上传第一个空间组学数据集</h3>
              <p>
                支持 <code>.h5ad</code> · <code>.h5</code> · <code>.hdf5</code>，最大 500MB
              </p>
              <p style={{ fontSize: 12, color: '#64748b', marginTop: 8, lineHeight: 1.6 }}>
                <strong>推荐格式：</strong>AnnData <code>.h5ad</code> 文件（含{' '}
                <code>obsm[&quot;spatial&quot;]</code>，可选 <code>uns[&quot;spatial&quot;]</code>{' '}
                组织底图 + scale factors）
                <br />
                <strong>10x Visium 用户：</strong>用{' '}
                <code>scanpy.read_visium(path).write(&quot;data.h5ad&quot;)</code> 转 .h5ad 上传
                <br />
                <strong>Seurat 用户：</strong>R 中{' '}
                <code>
                  zellkonverter::writeH5AD(as.SingleCellExperiment(seu), &quot;data.h5ad&quot;)
                </code>
                <br />
                <strong>没有数据？</strong>到 <a href="/tools/#spatial-standard">/tools 页面</a>{' '}
                直接用我们提供的 Visium HnE 公开 demo
              </p>
              <label className="sc-btn sc-btn-primary">
                选择文件
                <input
                  type="file"
                  accept={ACCEPT}
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
                    className={`sc-card sc-card-rich`}
                    onClick={() => {
                      if (stats.analyses > 0) navigate({ name: 'dataset', datasetId: d.id });
                    }}
                  >
                    <div className="sc-card-gradient" style={{ background: colors.gradient }} />

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
                        <div className="sc-card-icon-label">spots</div>
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

                    {/* W3-B: 任务派发已上线 */}
                    {stats.analyses === 0 ? (
                      <button
                        className="sc-card-enter-btn"
                        style={{ background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)' }}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!requireWrite('启动标准分析', e)) return;
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
                            if (!requireWrite('再次标准分析', e)) return;
                            setStandardAnalysisDs(d);
                          }}
                          title="再次标准分析"
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
                  accept={ACCEPT}
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
                      style={{ fontSize: 11, fontWeight: 600, color: '#475569', marginBottom: 8 }}
                    >
                      {uploadProgress < 100 ? '上传云服务器...' : '同步计算节点...'}
                    </div>
                    <div className="sc-progress" style={{ height: 6, borderRadius: 3 }}>
                      <div
                        className="sc-progress-fill"
                        style={{ width: `${uploadProgress}%`, transition: 'width 0.3s' }}
                      />
                    </div>
                    <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 6 }}>
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
        </div>
      </section>

      {/* W3-B: 启动标准分析（dispatch 到 py-server /api/task） */}
      {standardAnalysisDs && (
        <NewAnalysisModal
          dataset={standardAnalysisDs}
          defaultType="spatial_standard"
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
