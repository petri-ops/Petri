// ============================================================
// /spatial — Dataset detail
//
// 与 /single-cell `_DatasetView.tsx` 同构（同套 sc-* class）：
//   - sc-page > sc-layout > sc-sidebar + sc-main
//   - sc-header（标题 + 操作）
//   - sc-ds-tabs (数据预览 / 分析记录)
//   - 数据预览 tab: sc-data-tools-layout (左 placeholder · 右 sc-tools-card 5 类工具)
//   - 分析记录 tab: sc-analysis-cards 卡片网格
//
// 差异：
//   - 左侧"数据预览"目前只显示占位（spatial 后端不输出 metaUrl/featuresUrl，等 W4 加 .h5ad obs 表导出再填）
//   - sc-tools-card 列出 5 类 spatial 分析（spatial_standard 启用 + 4 类灰显）
//   - 不含 subsets/labels（spatial 数据更多是 spot-level，暂不引入；等 W4 评估）
//   - 不含 PlotToolsModal / ContinueMenu（W4 起再串 FigCode 空间卡）
// ============================================================
import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { Dataset, Project, Analysis } from './_types';
import { ANALYSIS_TYPES, STATUS_LABELS, type SpatialAnalysisType } from './_types';
import {
  getDataset,
  getProject,
  listAnalysesByDataset,
  updateAnalysisByTaskId,
  deleteAnalysis,
  updateDataset,
} from './_store';
import { formatSize, formatTime, formatDuration, getSpatialTaskStatus } from './_api';
import type { Route } from './_router';
import { NewAnalysisModal } from './_NewAnalysisModal';
import { Sidebar } from './_Sidebar';
import { useSidebarCollapse } from '../single-cell/_useSidebarCollapse';
import { useMobileDrawer } from '../single-cell/_useMobileDrawer';
import { showToast, requestNotificationPermission } from '../single-cell/_Toast';
import { requireWrite } from '../single-cell/_auth';
import { translateError } from '../single-cell/_errorTranslate';
import { CsvTable } from '../single-cell/_CsvTable';
import { useSetCopilotContext } from '@/lib/copilotContextProvider';

export function DatasetView({
  datasetId,
  navigate,
}: {
  datasetId: string;
  navigate: (r: Route) => void;
}) {
  const [sidebarCollapsed, toggleSidebar, sidebarWidth, startResize] = useSidebarCollapse();
  const [mobileOpen, openMobile, closeMobile] = useMobileDrawer();
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [analyses, setAnalyses] = useState<Analysis[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewModal, setShowNewModal] = useState(false);
  const [newModalConfig, setNewModalConfig] = useState<{
    defaultType?: SpatialAnalysisType;
    parentAnalysisId?: string;
  }>({});
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  // 与 single-cell 一致：默认进数据预览 tab，右侧显示工具卡
  const [tab, setTab] = useState<'data' | 'analyses'>('data');
  const [dataView, setDataView] = useState<'meta' | 'features'>('meta');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    setLoading(true);
    setDataset(null);
    setProject(null);
    setAnalyses([]);
  }, [datasetId]);

  const reload = useCallback(async () => {
    try {
      const ds = await getDataset(datasetId);
      setDataset(ds);
      if (ds) {
        const [proj, aList] = await Promise.all([
          getProject(ds.projectId),
          listAnalysesByDataset(datasetId),
        ]);
        setProject(proj);
        setAnalyses(aList);
        setLoading(false);

        // Mirror single-cell: auto-redirect to latest done standard analysis result page,
        // where the right-side tool card lives (sc-data-tools-layout in ResultView's preview tab)
        const doneStandard = aList
          .filter((a) => (a.type as string) === 'spatial_standard' && a.status === 'done')
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        if (doneStandard.length > 0) {
          navigate({ name: 'result', analysisId: doneStandard[0].id });
          return;
        }

        // No completed standard analysis — redirect back to project (mirror single-cell)
        if (proj) {
          navigate({ name: 'project', projectId: proj.id });
          return;
        }
      } else {
        setLoading(false);
      }
    } catch (e) {
      console.error('加载数据集失败', e);
      setLoading(false);
    }
  }, [datasetId, navigate]);

  useEffect(() => {
    reload();
  }, [reload]);

  // W3-C: publish Copilot context (so AI knows it's on spatial dataset page)
  useSetCopilotContext(
    dataset
      ? {
          page: 'spatial-dataset',
          currentModule: 'spatial',
          projectId: dataset.projectId,
          datasetId: dataset.id,
          datasetName: dataset.name,
          analysisId: undefined,
          analysisName: undefined,
          analysisType: undefined,
          summary: undefined,
        }
      : {},
    [dataset?.id, dataset?.projectId, dataset?.name]
  );

  // Poll running analyses to keep status in sync (mirrors single-cell pattern, but goes to py-server)
  useEffect(() => {
    const runningTaskIds = analyses
      .filter((a) => a.status === 'running' || a.status === 'pending' || a.status === 'queued')
      .map((a) => a.taskId);
    if (runningTaskIds.length === 0) return;

    const poll = async () => {
      let changed = false;
      for (const taskId of runningTaskIds) {
        try {
          const task = await getSpatialTaskStatus(taskId);
          if (task.status === 'done' || task.status === 'failed') {
            await updateAnalysisByTaskId(taskId, {
              status: task.status,
              summary: task.results?.summary,
              results: task.results,
              error: task.error,
              finishedAt: task.finishedAt,
            });
            changed = true;
            const matched = analyses.find((a) => a.taskId === taskId);
            const analysisName = matched?.name || '空间分析';
            if (task.status === 'done') {
              showToast({
                type: 'success',
                title: `${analysisName} 完成`,
                message: '点击查看结果',
                onClick: matched
                  ? () => navigate({ name: 'result', analysisId: matched.id })
                  : undefined,
              });
              if (task.results?.summary?.n_spots && dataset && dataset.nCells == null) {
                await updateDataset(dataset.id, {
                  nCells: task.results.summary.n_spots,
                  nGenes: task.results.summary.n_genes,
                });
              }
            } else {
              showToast({
                type: 'error',
                title: `${analysisName} 失败`,
                message: task.error?.slice(0, 60) || '未知错误',
              });
            }
          }
        } catch (err) {
          /* ignore */
        }
      }
      if (changed) reload();
    };

    poll();
    pollRef.current = setInterval(poll, 3000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analyses, dataset, reload]);

  const handleCreated = useCallback(
    (analysis: Analysis) => {
      setShowNewModal(false);
      setNewModalConfig({});
      reload();
      requestNotificationPermission();
      navigate({ name: 'result', analysisId: analysis.id });
    },
    [reload, navigate]
  );

  const handleDelete = useCallback(
    async (id: string, name: string, e: React.MouseEvent) => {
      e.stopPropagation();
      if (!requireWrite('删除分析', e)) return;
      if (confirm(`删除分析「${name}」？`)) {
        try {
          await deleteAnalysis(id);
          reload();
        } catch (err: any) {
          alert(`删除失败: ${err.message}`);
        }
      }
    },
    [reload]
  );

  const openNewAnalysis = useCallback((defaultType?: SpatialAnalysisType, e?: React.MouseEvent) => {
    if (!requireWrite('新建分析', e)) return;
    setNewModalConfig(defaultType ? { defaultType } : {});
    setShowNewModal(true);
  }, []);

  const handleRename = useCallback(async () => {
    if (!dataset || !renameValue.trim() || renameValue.trim() === dataset.name) {
      setRenaming(false);
      return;
    }
    if (!requireWrite('重命名数据集')) {
      setRenaming(false);
      return;
    }
    try {
      await updateDataset(dataset.id, { name: renameValue.trim() });
      setRenaming(false);
      reload();
    } catch (e: any) {
      alert(`重命名失败: ${e.message}`);
    }
  }, [dataset, renameValue, reload]);

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

  if (!dataset || !project) {
    return (
      <main className="sc-page">
        <div className="sc-main">
          <div className="sc-empty">
            <div className="sc-empty-title">数据集不存在</div>
            <button
              className="sc-btn sc-btn-primary"
              onClick={() => navigate({ name: 'projects' })}
            >
              返回
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
          activeProjectId={project.id}
          activeDatasetId={datasetId}
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
                    setRenameValue(dataset.name);
                    setRenaming(true);
                  }}
                  title="双击重命名"
                  style={{ cursor: 'text' }}
                >
                  {dataset.name}
                  <span style={{ fontSize: 10, color: 'var(--biof3-text-muted)', marginLeft: 8, fontWeight: 400 }}>
                    ✎
                  </span>
                </h1>
              )}
              <p className="sc-header-subtitle">
                {formatSize(dataset.size)}
                {dataset.nCells &&
                  ` · ${dataset.nCells.toLocaleString()} spots / ${dataset.nGenes?.toLocaleString()} genes`}
                {` · 上传于 ${formatTime(dataset.uploadedAt)}`}
              </p>
            </div>
            <div className="sc-header-actions">
              <button
                className="sc-btn sc-btn-primary"
                onClick={(e) => openNewAnalysis(undefined, e)}
              >
                + 新建分析
              </button>
            </div>
          </div>

          {/* Tabs */}
          <div className="sc-ds-tabs">
            <button
              className={`sc-ds-tab ${tab === 'data' ? 'active' : ''}`}
              onClick={() => setTab('data')}
            >
              数据预览
            </button>
            <button
              className={`sc-ds-tab ${tab === 'analyses' ? 'active' : ''}`}
              onClick={() => setTab('analyses')}
            >
              分析记录
              <span className="sc-ds-tab-count">{analyses.length}</span>
            </button>
          </div>

          {/* Data preview tab — 双列：左 obs/var 表 (CsvTable) · 右工具卡片 */}
          {tab === 'data' && (
            <div className="sc-data-tools-layout">
              <div className="sc-data-table-col">
                {!dataset.metaUrl &&
                !dataset.featuresUrl &&
                !analyses.some(
                  (a) =>
                    (a.type as string) === 'spatial_standard' && (a.status === 'done' || a.status === 'running')
                ) ? (
                  <div className="sc-data-preview-hint">
                    <div style={{ fontSize: 12, color: 'var(--biof3-text-muted)' }}>
                      请先在右侧"空间分析工具"启动「空间标准分析」
                    </div>
                  </div>
                ) : !dataset.metaUrl ? (
                  <div className="sc-data-preview-hint">
                    <div style={{ fontSize: 12, color: 'var(--biof3-status-loading)', fontWeight: 600 }}>
                      ⏳ 数据预览正在生成中...
                    </div>
                    <div style={{ marginTop: 6, fontSize: 11, color: 'var(--biof3-text-muted)' }}>
                      分析完成后刷新页面即可查看 spot 元数据和基因列表
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="sc-data-view-switch">
                      <button
                        className={`sc-data-view-btn ${dataView === 'meta' ? 'active' : ''}`}
                        onClick={() => setDataView('meta')}
                        disabled={!dataset.metaUrl}
                      >
                        spot 元数据 (obs)
                      </button>
                      <button
                        className={`sc-data-view-btn ${dataView === 'features' ? 'active' : ''}`}
                        onClick={() => setDataView('features')}
                        disabled={!dataset.featuresUrl}
                      >
                        基因列表 (var)
                      </button>
                    </div>
                    {dataView === 'meta' && dataset.metaUrl && (
                      <CsvTable
                        key={`meta-${dataset.id}`}
                        fileUrl={dataset.metaUrl}
                        pageSize={20}
                        rowKey="cell_id"
                      />
                    )}
                    {dataView === 'features' && dataset.featuresUrl && (
                      <CsvTable
                        key={`features-${dataset.id}`}
                        fileUrl={dataset.featuresUrl}
                        pageSize={20}
                        rowKey="gene_symbol"
                      />
                    )}
                  </>
                )}
              </div>

              <div className="sc-tools-card">
                <div className="sc-tools-card-header">
                  <span className="sc-tools-card-title">空间分析工具</span>
                </div>
                <div className="sc-tools-grid">
                  {(Object.keys(ANALYSIS_TYPES) as SpatialAnalysisType[]).map((key) => {
                    const m = ANALYSIS_TYPES[key];
                    const isReady = !!m.available;
                    return (
                      <button
                        key={key}
                        className={`sc-tool-item ${!isReady ? 'sc-tool-item-wip' : ''}`}
                        onClick={(e) => (isReady ? openNewAnalysis(key, e) : undefined)}
                        title={
                          isReady ? `${m.name} — ${m.desc}` : `${m.name}（开发中，Wave 4 上线）`
                        }
                        disabled={!isReady}
                      >
                        <span
                          className="sc-tool-item-icon"
                          style={{ background: isReady ? m.color : '#9ca3af' }}
                        >
                          {m.icon}
                        </span>
                        <span className="sc-tool-item-name">{m.shortName}</span>
                        {!isReady && <span className="sc-tool-item-wip-tag">开发中</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Analyses tab */}
          {tab === 'analyses' && analyses.length === 0 && (
            <div className="sc-empty">
              <div className="sc-empty-title">还没有分析</div>
              <div className="sc-empty-desc">
                建议从「空间标准分析」开始：QC + 聚类 + UMAP + 邻域富集 + Moran's I
              </div>
              <button
                className="sc-btn sc-btn-primary"
                onClick={(e) => openNewAnalysis('spatial_standard', e)}
              >
                + 启动标准分析
              </button>
            </div>
          )}

          {tab === 'analyses' && analyses.length > 0 && (
            <div className="sc-analysis-cards">
              {[...analyses]
                .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
                .map((a) => {
                  const meta = ANALYSIS_TYPES[a.type as SpatialAnalysisType] || {
                    name: a.type,
                    shortName: a.type,
                    color: 'var(--biof3-text-secondary)',
                    icon: '?',
                    desc: '',
                  };
                  const elapsed = a.finishedAt
                    ? (new Date(a.finishedAt).getTime() - new Date(a.createdAt).getTime()) / 1000
                    : 0;
                  const firstPlot = (a.results?.plots as any)?.[0]?.url || null;
                  const stats = getSpatialAnalysisStats(a);
                  return (
                    <div
                      key={a.id}
                      className="sc-acard"
                      onClick={() => navigate({ name: 'result', analysisId: a.id })}
                    >
                      <div className="sc-acard-bar" style={{ background: meta.color }} />

                      <div className="sc-acard-header">
                        <div className="sc-acard-icon" style={{ background: meta.color }}>
                          {meta.icon}
                        </div>
                        <div className="sc-acard-title-area">
                          <div className="sc-acard-name">{a.name}</div>
                          <div className="sc-acard-type">{meta.shortName}</div>
                        </div>
                        <StatusTag status={a.status} />
                      </div>

                      {a.status === 'running' || a.status === 'pending' || a.status === 'queued' ? (
                        <div className="sc-acard-thumb sc-acard-thumb-loading">
                          <div
                            className="sc-spinner"
                            style={{ width: 20, height: 20, borderWidth: 2 }}
                          />
                          <span>分析中...</span>
                        </div>
                      ) : a.status === 'failed' ? (
                        <div className="sc-acard-thumb sc-acard-thumb-error">
                          <span>✗</span>
                          <span>
                            {(() => {
                              const t = translateError(a.error || '');
                              return t ? t.message : a.error?.slice(0, 40) || '分析失败';
                            })()}
                          </span>
                        </div>
                      ) : firstPlot ? (
                        <div className="sc-acard-thumb">
                          <img src={firstPlot} alt={a.name} loading="lazy" />
                        </div>
                      ) : (
                        <div className="sc-acard-thumb sc-acard-thumb-empty">
                          <span style={{ fontSize: 28, opacity: 0.3 }}>{meta.icon}</span>
                        </div>
                      )}

                      {stats.length > 0 && (
                        <div className="sc-acard-stats">
                          {stats.map((s, i) => (
                            <div key={i} className="sc-acard-stat">
                              <span className="sc-acard-stat-value">{s.value}</span>
                              <span className="sc-acard-stat-label">{s.label}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      <div className="sc-acard-footer">
                        <span>
                          {a.finishedAt && elapsed > 0
                            ? `耗时 ${formatDuration(elapsed)}`
                            : formatTime(a.createdAt)}
                        </span>
                        <div className="sc-acard-actions" onClick={(e) => e.stopPropagation()}>
                          <button
                            className="sc-card-delete"
                            style={{ opacity: 0.7 }}
                            onClick={(e) => handleDelete(a.id, a.name, e)}
                          >
                            删除
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}

              <div className="sc-acard sc-acard-new" onClick={(e) => openNewAnalysis(undefined, e)}>
                <div className="sc-acard-new-inner">
                  <div className="sc-card-new-icon">+</div>
                  <div className="sc-card-new-label">新建分析</div>
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      {showNewModal && (
        <NewAnalysisModal
          dataset={dataset}
          defaultType={newModalConfig.defaultType}
          parentAnalysisId={newModalConfig.parentAnalysisId}
          onClose={() => {
            setShowNewModal(false);
            setNewModalConfig({});
          }}
          onCreated={handleCreated}
        />
      )}
    </main>
  );
}

// ============================================================
// Helpers
// ============================================================

function getSpatialAnalysisStats(a: Analysis): Array<{ value: string; label: string }> {
  const s = a.summary || {};
  if (a.status !== 'done') return [];
  const out: Array<{ value: string; label: string }> = [];
  if (s.n_spots != null) out.push({ value: Number(s.n_spots).toLocaleString(), label: 'spots' });
  if (s.n_clusters != null) out.push({ value: String(s.n_clusters), label: 'clusters' });
  if (s.n_significant_svgs != null)
    out.push({ value: String(s.n_significant_svgs), label: 'sig SVGs' });
  return out.slice(0, 3);
}

function StatusTag({ status }: { status: Analysis['status'] }) {
  const info = STATUS_LABELS[status] || { label: status, color: 'var(--biof3-text-secondary)' };
  return (
    <span className="sc-status-tag" style={{ background: `${info.color}20`, color: info.color }}>
      <span className={`sc-status-dot ${status}`} style={{ background: info.color }} />
      {info.label}
    </span>
  );
}
