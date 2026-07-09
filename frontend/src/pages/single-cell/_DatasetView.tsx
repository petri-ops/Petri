import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { Dataset, Project, Analysis, AnalysisType } from './_types';
import { ANALYSIS_TYPES, STATUS_LABELS } from './_types';
import {
  getDataset,
  getProject,
  listAnalysesByDataset,
  listDatasetsByProject,
  updateAnalysisByTaskId,
  deleteAnalysis,
  updateDataset,
  getAnalysis,
} from './_store';
import { formatSize, formatTime, getTaskStatus } from './_api';
import type { Route } from './_router';
import { NewAnalysisModal } from './_NewAnalysisModal';
import { Sidebar } from './_Sidebar';
import { useSidebarCollapse } from './_useSidebarCollapse';
import { useMobileDrawer } from './_useMobileDrawer';
import { showToast } from './_Toast';
import { requestNotificationPermission } from './_Toast';
import { requireWrite } from './_auth';
import { CsvTable } from './_CsvTable';
import { translateError } from './_errorTranslate';
import {
  createSubset,
  listSubsets,
  deleteSubset,
  createLabel,
  listLabels,
  deleteLabel,
} from './_store';
import type { Subset, LabelsSummary } from './_types';
import { setCopilotContext } from '@/components/copilot';

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
  const [_datasets, setDatasets] = useState<Dataset[]>([]);
  const [analyses, setAnalyses] = useState<Analysis[]>([]);
  const [parentMap, setParentMap] = useState<Record<string, Analysis>>({});
  const [loading, setLoading] = useState(true);
  const [showNewModal, setShowNewModal] = useState(false);
  const [newModalConfig, setNewModalConfig] = useState<{
    defaultType?: AnalysisType;
    parentAnalysisId?: string;
  }>({});
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [tab, setTab] = useState<'data' | 'analyses'>('data');
  const [dataView, setDataView] = useState<'meta' | 'features'>('meta');
  const [selectedCellIds, setSelectedCellIds] = useState<string[]>([]);
  const [subsets, setSubsets] = useState<Subset[]>([]);
  const [labels, setLabels] = useState<LabelsSummary>({});
  const [showSubsetModal, setShowSubsetModal] = useState(false);
  const [showLabelModal, setShowLabelModal] = useState(false);
  const [showPlotModal, setShowPlotModal] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Reset state immediately when datasetId changes
  useEffect(() => {
    setLoading(true);
    setDataset(null);
    setProject(null);
    setAnalyses([]);
    setParentMap({});
  }, [datasetId]);

  const reload = useCallback(async () => {
    try {
      const ds = await getDataset(datasetId);
      setDataset(ds);
      if (ds) {
        const [proj, dsList, aList] = await Promise.all([
          getProject(ds.projectId),
          listDatasetsByProject(ds.projectId),
          listAnalysesByDataset(datasetId),
        ]);
        setProject(proj);
        setDatasets(dsList);
        setAnalyses(aList);
        setLoading(false);

        // Auto-redirect to latest standard analysis result page
        const doneStandard = aList
          .filter(
            (a) => (a.type === 'scrna_standard' || a.type === 'recluster') && a.status === 'done'
          )
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        if (doneStandard.length > 0) {
          navigate({ name: 'result', analysisId: doneStandard[0].id });
          return;
        }

        // No completed standard analysis — redirect back to project
        if (proj) {
          navigate({ name: 'project', projectId: proj.id });
          return;
        }

        // Background: load subsets, labels, and parent analyses
        listSubsets(datasetId)
          .then(setSubsets)
          .catch(() => {});
        listLabels(datasetId)
          .then(setLabels)
          .catch(() => {});
        const parentIds = [
          ...new Set(aList.filter((a) => a.parentAnalysisId).map((a) => a.parentAnalysisId!)),
        ];
        if (parentIds.length > 0) {
          const pMap: Record<string, Analysis> = {};
          await Promise.all(
            parentIds.map(async (pid) => {
              const pa = await getAnalysis(pid);
              if (pa) pMap[pid] = pa;
            })
          );
          setParentMap(pMap);
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

  // Publish context to Copilot
  useEffect(() => {
    if (!dataset) return;
    setCopilotContext({
      page: 'single-cell-dataset',
      projectId: dataset.projectId,
      datasetId: dataset.id,
      datasetName: dataset.name,
      analysisId: undefined,
      analysisName: undefined,
      analysisType: undefined,
      summary: undefined,
      clusterIds: undefined,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataset?.id, dataset?.name, dataset?.projectId]);

  // Listen for Copilot action: open new analysis modal pre-filled
  useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail || detail.datasetId !== datasetId) return;
      setNewModalConfig({
        defaultType: detail.defaultType as AnalysisType,
        parentAnalysisId: detail.parentAnalysisId,
      });
      setShowNewModal(true);
    };
    window.addEventListener('biof3:open-new-analysis', onOpen as EventListener);
    return () => window.removeEventListener('biof3:open-new-analysis', onOpen as EventListener);
  }, [datasetId]);

  // Copilot UI control listeners (Stage F)
  useEffect(() => {
    const onSubsetModal = () => {
      setTab('data');
      setDataView('meta');
      setShowSubsetModal(true);
    };
    const onLabelModal = (e: Event) => {
      const detail = (e as CustomEvent).detail || {};
      setTab('data');
      setDataView('meta');
      setShowLabelModal(true);
      // Save label hint to a window var so the modal could use it (or use sessionStorage)
      try {
        sessionStorage.setItem(
          'biof3_pending_label',
          JSON.stringify({ key: detail.labelKey, value: detail.labelValue })
        );
      } catch (err: any) {}
    };
    const onMerge = (e: Event) => {
      const detail = (e as CustomEvent).detail || {};
      // Trigger via a custom event the merge modal can listen to (we open a confirm dialog if no UI exists)
      const ids = detail.datasetIds || [];
      if (ids.length < 2) return;
      const ok = confirm(
        `Copilot 想合并 ${ids.length} 个数据集为${detail.name ? ' "' + detail.name + '"' : '一个新数据集'}。是否继续？`
      );
      if (!ok) return;
      // Use the existing /merge API path through the dataset list page — emit another event
      window.dispatchEvent(new CustomEvent('biof3:sc-do-merge', { detail }));
    };
    const onUploadHint = () => {
      // Scroll to the dataset upload area / open the upload UI on the project page
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
      } catch {}
    };
    window.addEventListener('biof3:sc-open-subset-modal', onSubsetModal);
    window.addEventListener('biof3:sc-open-label-modal', onLabelModal as EventListener);
    window.addEventListener('biof3:sc-merge-datasets', onMerge as EventListener);
    window.addEventListener('biof3:sc-upload-hint', onUploadHint);
    return () => {
      window.removeEventListener('biof3:sc-open-subset-modal', onSubsetModal);
      window.removeEventListener('biof3:sc-open-label-modal', onLabelModal as EventListener);
      window.removeEventListener('biof3:sc-merge-datasets', onMerge as EventListener);
      window.removeEventListener('biof3:sc-upload-hint', onUploadHint);
    };
  }, [datasetId]);
  useEffect(() => {
    const runningTaskIds = analyses
      .filter((a) => a.status === 'running' || a.status === 'pending' || a.status === 'queued')
      .map((a) => a.taskId);
    if (runningTaskIds.length === 0) return;

    const poll = async () => {
      let changed = false;
      for (const taskId of runningTaskIds) {
        try {
          const task = await getTaskStatus(taskId);
          if (task.status === 'done' || task.status === 'failed') {
            await updateAnalysisByTaskId(taskId, {
              status: task.status,
              summary: task.results?.summary,
              results: task.results,
              error: task.error,
              finishedAt: task.finishedAt,
            });
            changed = true;

            // Toast notification
            const matchedAnalysis = analyses.find((a) => a.taskId === taskId);
            const analysisName = matchedAnalysis?.name || '分析';
            if (task.status === 'done') {
              showToast({
                type: 'success',
                title: `${analysisName} 完成`,
                message: '点击查看结果',
                onClick: matchedAnalysis
                  ? () => navigate({ name: 'result', analysisId: matchedAnalysis.id })
                  : undefined,
              });
            } else {
              showToast({
                type: 'error',
                title: `${analysisName} 失败`,
                message: task.error?.slice(0, 60) || '未知错误',
              });
            }

            // Update dataset stats from first completed standard analysis
            if (task.status === 'done' && task.results?.summary?.n_cells && dataset) {
              const hasStats = dataset.nCells != null;
              if (!hasStats) {
                await updateDataset(dataset.id, {
                  nCells: task.results.summary.n_cells,
                  nGenes: task.results.summary.n_genes,
                });
              }
            }
          }
        } catch (err: any) {
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
      requestNotificationPermission(); // Ask permission when user submits analysis
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

  const handleContinueFrom = useCallback(
    (parentAnalysis: Analysis, nextType: AnalysisType, e?: React.MouseEvent) => {
      if (!requireWrite('新建分析', e)) return;
      setNewModalConfig({ defaultType: nextType, parentAnalysisId: parentAnalysis.id });
      setShowNewModal(true);
    },
    []
  );

  const openNewAnalysis = useCallback((defaultType?: AnalysisType, e?: React.MouseEvent) => {
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
        {/* Sidebar (slide-in drawer on mobile) */}
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
                    setRenameValue(dataset.name);
                    setRenaming(true);
                  }}
                  title="双击重命名"
                  style={{ cursor: 'text' }}
                >
                  {dataset.name}
                  <span style={{ fontSize: 10, color: '#9ca3af', marginLeft: 8, fontWeight: 400 }}>
                    ✎
                  </span>
                </h1>
              )}
              <p className="sc-header-subtitle">
                {formatSize(dataset.size)}
                {dataset.nCells &&
                  ` · ${dataset.nCells.toLocaleString()} cells / ${dataset.nGenes?.toLocaleString()} genes`}
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

          {/* Data preview tab */}
          {tab === 'data' && (
            <div>
              <div className="sc-data-tools-layout">
                {/* Left: table or placeholder */}
                <div className="sc-data-table-col">
                  {!dataset.metaUrl &&
                  !dataset.featuresUrl &&
                  !analyses.some(
                    (a) =>
                      (a.type === 'scrna_standard' || a.type === 'recluster') &&
                      (a.status === 'done' || a.status === 'running')
                  ) ? (
                    <div className="sc-data-preview-hint">
                      <div style={{ fontSize: 12, color: '#9ca3af' }}>
                        请先在项目页面启动「标准分析」
                      </div>
                    </div>
                  ) : !dataset.metaUrl ? (
                    <div className="sc-data-preview-hint">
                      <div style={{ fontSize: 12, color: '#f59e0b', fontWeight: 600 }}>
                        ⏳ 数据预览正在生成中...
                      </div>
                      <div style={{ marginTop: 6, fontSize: 11, color: '#9ca3af' }}>
                        分析完成后刷新页面即可查看细胞元数据和基因列表
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
                          细胞元数据
                        </button>
                        <button
                          className={`sc-data-view-btn ${dataView === 'features' ? 'active' : ''}`}
                          onClick={() => setDataView('features')}
                          disabled={!dataset.featuresUrl}
                        >
                          基因列表
                        </button>
                      </div>
                      {dataView === 'meta' && dataset.metaUrl && (
                        <CsvTable
                          key={`meta-${dataset.id}`}
                          fileUrl={dataset.metaUrl}
                          pageSize={20}
                          rowKey="cell_id"
                          selectable
                          onSelectionChange={setSelectedCellIds}
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

                {/* Right: tool cards (always visible) */}
                <div className="sc-tools-card">
                  <div className="sc-tools-card-header">
                    <span className="sc-tools-card-title">分析工具</span>
                    {selectedCellIds.length > 0 && (
                      <span className="sc-tools-card-hint">
                        已选 <strong>{selectedCellIds.length}</strong> cells
                      </span>
                    )}
                  </div>
                  <div className="sc-tools-grid">
                    {Object.entries(ANALYSIS_TYPES).map(([key, meta]) => {
                      if (key === 'scrna_standard') return null; // 标准分析通过卡片按钮触发，工具箱里用"重新分析"入口
                      const implemented = [
                        'recluster',
                        'deg',
                        'enrichment',
                        'cell_annotation',
                        'scrna_integration',
                        'trajectory',
                        'communication',
                        'cell_cycle',
                        'doublet_detection',
                      ];
                      const isReady = implemented.includes(key);
                      return (
                        <button
                          key={key}
                          className={`sc-tool-item ${!isReady ? 'sc-tool-item-wip' : ''}`}
                          onClick={(e) => (isReady ? openNewAnalysis(key as any, e) : undefined)}
                          title={isReady ? `${meta.name} — ${meta.desc}` : `${meta.name}（开发中）`}
                          disabled={!isReady}
                        >
                          <span
                            className="sc-tool-item-icon"
                            style={{ background: isReady ? meta.color : '#9ca3af' }}
                          >
                            {meta.icon}
                          </span>
                          <span className="sc-tool-item-name">{meta.shortName}</span>
                          {!isReady && <span className="sc-tool-item-wip-tag">开发中</span>}
                        </button>
                      );
                    })}
                    <button
                      className="sc-tool-item sc-tool-item-plot"
                      onClick={() => setShowPlotModal(true)}
                      title="打开 FigCode 单细胞绘图工具"
                    >
                      <span className="sc-tool-item-icon" style={{ background: '#f59e0b' }}>
                        📊
                      </span>
                      <span className="sc-tool-item-name">绘图</span>
                    </button>
                    <button
                      className="sc-tool-item"
                      onClick={(e) => openNewAnalysis('scrna_standard', e)}
                      title="重新运行标准分析（QC + 降维 + 聚类）"
                    >
                      <span className="sc-tool-item-icon" style={{ background: '#64748b' }}>
                        S
                      </span>
                      <span className="sc-tool-item-name">重新分析</span>
                    </button>
                  </div>
                  {selectedCellIds.length > 0 && (
                    <div className="sc-tools-card-footer">
                      点击工具将使用选中的 {selectedCellIds.length} 个细胞
                    </div>
                  )}
                </div>
              </div>

              {/* Subset bar (below the two-column layout) */}
              {dataView === 'meta' && selectedCellIds.length > 0 && (
                <div className="sc-subset-bar">
                  已选中 <strong>{selectedCellIds.length.toLocaleString()}</strong> 个细胞
                  <button
                    className="sc-btn sc-btn-primary sc-btn-sm"
                    onClick={(e) => {
                      if (requireWrite('保存子集', e)) setShowSubsetModal(true);
                    }}
                  >
                    保存为子集 →
                  </button>
                  <button
                    className="sc-btn sc-btn-sm"
                    onClick={(e) => {
                      if (requireWrite('新增标签', e)) setShowLabelModal(true);
                    }}
                  >
                    + 新增标签列
                  </button>
                </div>
              )}

              {/* Existing subsets and labels */}
              {(subsets.length > 0 || Object.keys(labels).length > 0) && (
                <div className="sc-subset-list">
                  {subsets.length > 0 && (
                    <div className="sc-subset-section">
                      <div className="sc-subset-section-title">我的子集 ({subsets.length})</div>
                      <div className="sc-subset-chips">
                        {subsets.map((s) => (
                          <div key={s.id} className="sc-subset-chip" title={s.description || ''}>
                            <span className="sc-subset-chip-name">{s.name}</span>
                            <span className="sc-subset-chip-count">
                              {s.nCells.toLocaleString()} cells
                            </span>
                            <button
                              className="sc-subset-chip-del"
                              onClick={async (e) => {
                                if (!requireWrite('删除子集', e)) return;
                                if (!confirm(`删除子集「${s.name}」？`)) return;
                                await deleteSubset(s.id);
                                listSubsets(datasetId).then(setSubsets);
                              }}
                              title="删除"
                            >
                              ×
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {Object.keys(labels).length > 0 && (
                    <div className="sc-subset-section">
                      <div className="sc-subset-section-title">
                        标签列 ({Object.keys(labels).length})
                      </div>
                      {Object.entries(labels).map(([labelName, groups]) => (
                        <div key={labelName} className="sc-label-row">
                          <span className="sc-label-name">{labelName}</span>
                          {groups.map((g) => (
                            <div key={g.id} className="sc-subset-chip">
                              <span className="sc-subset-chip-name">{g.value}</span>
                              <span className="sc-subset-chip-count">
                                {g.cells.toLocaleString()}
                              </span>
                              <button
                                className="sc-subset-chip-del"
                                onClick={async (e) => {
                                  if (!requireWrite('删除标签', e)) return;
                                  if (!confirm(`删除标签 ${labelName}=${g.value}？`)) return;
                                  await deleteLabel(g.id);
                                  listLabels(datasetId).then(setLabels);
                                }}
                                title="删除"
                              >
                                ×
                              </button>
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Analyses tab */}
          {tab === 'analyses' && analyses.length === 0 && (
            <div className="sc-empty">
              <div className="sc-empty-title">还没有分析</div>
              <div className="sc-empty-desc">
                建议从「标准分析」开始：质控 → 降维 → 聚类 → Marker 基因
              </div>
              <button
                className="sc-btn sc-btn-primary"
                onClick={(e) => openNewAnalysis('scrna_standard', e)}
              >
                开始标准分析
              </button>
            </div>
          )}

          {tab === 'analyses' && analyses.length > 0 && (
            <div className="sc-analysis-cards">
              {[...analyses]
                .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
                .map((a) => {
                  const meta = ANALYSIS_TYPES[a.type];
                  const parent = a.parentAnalysisId ? parentMap[a.parentAnalysisId] || null : null;
                  const _elapsed = a.finishedAt
                    ? (new Date(a.finishedAt).getTime() - new Date(a.createdAt).getTime()) / 1000
                    : 0;
                  // Get first plot thumbnail
                  const firstPlot = (a.results?.plots as any)?.[0]?.url || null;
                  // Extract key stats from summary
                  const stats = getAnalysisStats(a);
                  return (
                    <div
                      key={a.id}
                      className="sc-acard"
                      onClick={() => navigate({ name: 'result', analysisId: a.id })}
                    >
                      {/* Top gradient bar */}
                      <div className="sc-acard-bar" style={{ background: meta.color }} />

                      {/* Header: icon + name + status */}
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

                      {/* Thumbnail / progress */}
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

                      {/* Stats row */}
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

                      {/* Footer */}
                      <div className="sc-acard-footer">
                        <span>{parent ? `基于 ${parent.name}` : formatTime(a.createdAt)}</span>
                        <div className="sc-acard-actions" onClick={(e) => e.stopPropagation()}>
                          {a.status === 'done' && a.type === 'scrna_standard' && (
                            <ContinueMenu
                              onSelect={(nextType, e) => handleContinueFrom(a, nextType, e)}
                            />
                          )}
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

              {/* Add new analysis card */}
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
          selectedCellIds={selectedCellIds}
          onClose={() => {
            setShowNewModal(false);
            setNewModalConfig({});
          }}
          onCreated={handleCreated}
        />
      )}

      {showSubsetModal && (
        <SaveSubsetModal
          datasetId={datasetId}
          cellIds={selectedCellIds}
          onClose={() => setShowSubsetModal(false)}
          onSaved={() => {
            setShowSubsetModal(false);
            listSubsets(datasetId).then(setSubsets);
          }}
        />
      )}

      {showLabelModal && (
        <AddLabelModal
          datasetId={datasetId}
          cellIds={selectedCellIds}
          onClose={() => setShowLabelModal(false)}
          onSaved={() => {
            setShowLabelModal(false);
            listLabels(datasetId).then(setLabels);
          }}
        />
      )}

      {showPlotModal && (
        <PlotToolsModal
          onClose={() => setShowPlotModal(false)}
          replotTaskId={
            analyses.find((a) => a.type === 'scrna_standard' && a.status === 'done')?.taskId
          }
        />
      )}
    </main>
  );
}

// ============================================================
// Save subset modal
// ============================================================

function SaveSubsetModal({
  datasetId,
  cellIds,
  onClose,
  onSaved,
}: {
  datasetId: string;
  cellIds: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSave = useCallback(async () => {
    if (!name.trim()) return;
    setSubmitting(true);
    try {
      await createSubset({
        datasetId,
        name: name.trim(),
        description: desc.trim() || undefined,
        cellIds,
      });
      onSaved();
    } catch (e: any) {
      alert(`保存失败: ${e.message}`);
      setSubmitting(false);
    }
  }, [datasetId, name, desc, cellIds, onSaved]);

  return (
    <div className="sc-modal-overlay" onClick={onClose}>
      <div className="sc-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460 }}>
        <div className="sc-modal-header">
          <h2 className="sc-modal-title">保存子集</h2>
          <button className="sc-modal-close" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="sc-modal-body">
          <div className="sc-form-group">
            <label className="sc-form-label">名称</label>
            <input
              className="sc-form-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：CD8 T cells"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter' && name.trim()) handleSave();
              }}
            />
          </div>
          <div className="sc-form-group">
            <label className="sc-form-label">描述（可选）</label>
            <textarea
              className="sc-form-textarea"
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              placeholder="筛选条件、来源等"
            />
          </div>
          <div
            style={{
              fontSize: 11,
              color: '#9ca3af',
              padding: '6px 10px',
              background: '#f8faf9',
              borderRadius: 5,
            }}
          >
            ● 包含 <strong>{cellIds.length.toLocaleString()}</strong> 个细胞
          </div>
        </div>
        <div className="sc-modal-footer">
          <button className="sc-btn" onClick={onClose}>
            取消
          </button>
          <button
            className="sc-btn sc-btn-primary"
            onClick={handleSave}
            disabled={!name.trim() || submitting}
          >
            {submitting ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// Add label column modal
// ============================================================

function AddLabelModal({
  datasetId,
  cellIds,
  onClose,
  onSaved,
}: {
  datasetId: string;
  cellIds: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [labelName, setLabelName] = useState('');
  const [labelValue, setLabelValue] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSave = useCallback(async () => {
    if (!labelName.trim() || !labelValue.trim()) return;
    setSubmitting(true);
    try {
      await createLabel({
        datasetId,
        labelName: labelName.trim(),
        labelValue: labelValue.trim(),
        cellIds,
      });
      onSaved();
    } catch (e: any) {
      alert(`添加失败: ${e.message}`);
      setSubmitting(false);
    }
  }, [datasetId, labelName, labelValue, cellIds, onSaved]);

  return (
    <div className="sc-modal-overlay" onClick={onClose}>
      <div className="sc-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460 }}>
        <div className="sc-modal-header">
          <h2 className="sc-modal-title">新增标签列</h2>
          <button className="sc-modal-close" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="sc-modal-body">
          <div className="sc-form-group">
            <label className="sc-form-label">列名 (label_name)</label>
            <input
              className="sc-form-input"
              value={labelName}
              onChange={(e) => setLabelName(e.target.value)}
              placeholder="例如：tumor_focus"
              autoFocus
            />
            <div className="sc-form-hint">同一列名可以有多个值（"yes" / "no"），构成一个分类列</div>
          </div>
          <div className="sc-form-group">
            <label className="sc-form-label">值 (label_value)</label>
            <input
              className="sc-form-input"
              value={labelValue}
              onChange={(e) => setLabelValue(e.target.value)}
              placeholder="例如：yes"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && labelName.trim() && labelValue.trim()) handleSave();
              }}
            />
          </div>
          <div
            style={{
              fontSize: 11,
              color: '#9ca3af',
              padding: '6px 10px',
              background: '#f8faf9',
              borderRadius: 5,
            }}
          >
            ● 给 <strong>{cellIds.length.toLocaleString()}</strong> 个细胞标记{' '}
            <code>{labelName || 'label_name'}</code> = <code>{labelValue || 'value'}</code>
          </div>
        </div>
        <div className="sc-modal-footer">
          <button className="sc-btn" onClick={onClose}>
            取消
          </button>
          <button
            className="sc-btn sc-btn-primary"
            onClick={handleSave}
            disabled={!labelName.trim() || !labelValue.trim() || submitting}
          >
            {submitting ? '保存中...' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}

function getAnalysisStats(a: Analysis): Array<{ value: string; label: string }> {
  const s: Record<string, any> = a.summary || {};
  if (a.status !== 'done') return [];

  switch (a.type) {
    case 'scrna_standard':
      return [
        ...(s.nCells ? [{ value: Number(s.nCells).toLocaleString(), label: 'cells' }] : []),
        ...(s.nClusters ? [{ value: String(s.nClusters), label: 'clusters' }] : []),
        ...(s.nGenes ? [{ value: Number(s.nGenes).toLocaleString(), label: 'genes' }] : []),
      ].slice(0, 3);
    case 'deg':
      return [
        ...(s.nUp != null ? [{ value: String(s.nUp), label: 'up' }] : []),
        ...(s.nDown != null ? [{ value: String(s.nDown), label: 'down' }] : []),
        ...(s.nTotal ? [{ value: String(s.nTotal), label: 'total' }] : []),
      ].slice(0, 3);
    case 'enrichment':
      return [
        ...(s.nGOTerms ? [{ value: String(s.nGOTerms), label: 'GO' }] : []),
        ...(s.nKEGGPathways ? [{ value: String(s.nKEGGPathways), label: 'KEGG' }] : []),
      ];
    case 'cell_annotation':
      return [
        ...(s.nCellTypes ? [{ value: String(s.nCellTypes), label: 'cell types' }] : []),
        ...(s.reference
          ? [{ value: s.reference.replace('HumanPrimaryCell', 'HPC'), label: 'ref' }]
          : []),
      ];
    case 'trajectory':
      return [
        ...(s.nBranchPoints != null ? [{ value: String(s.nBranchPoints), label: 'branches' }] : []),
        ...(s.method ? [{ value: s.method, label: 'method' }] : []),
      ];
    case 'communication':
      return [
        ...(s.nInteractions ? [{ value: String(s.nInteractions), label: 'interactions' }] : []),
        ...(s.nPathways ? [{ value: String(s.nPathways), label: 'pathways' }] : []),
      ];
    default:
      return [];
  }
}

function StatusTag({ status }: { status: Analysis['status'] }) {
  const info = STATUS_LABELS[status];
  return (
    <span className="sc-status-tag" style={{ background: `${info.color}20`, color: info.color }}>
      <span className={`sc-status-dot ${status}`} style={{ background: info.color }} />
      {info.label}
    </span>
  );
}

function ContinueMenu({ onSelect }: { onSelect: (t: AnalysisType, e: React.MouseEvent) => void }) {
  const [open, setOpen] = useState(false);
  const nextSteps: Array<{ type: AnalysisType; label: string }> = [
    { type: 'deg', label: '→ 差异表达' },
    { type: 'cell_annotation', label: '→ 细胞注释' },
    { type: 'enrichment', label: '→ 富集分析' },
    { type: 'trajectory', label: '→ 轨迹分析' },
    { type: 'communication', label: '→ 细胞通讯' },
  ];
  return (
    <div style={{ position: 'relative' }}>
      <button className="sc-btn sc-btn-sm" onClick={() => setOpen(!open)}>
        继续分析 ▾
      </button>
      {open && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 10 }} onClick={() => setOpen(false)} />
          <div
            style={{
              position: 'absolute',
              top: '100%',
              right: 0,
              marginTop: 4,
              background: 'white',
              border: '1px solid #e5ebe8',
              borderRadius: 6,
              boxShadow: '0 4px 16px rgba(0,0,0,0.1)',
              zIndex: 11,
              minWidth: 140,
            }}
          >
            {nextSteps.map((s) => (
              <button
                key={s.type}
                style={{
                  display: 'block',
                  width: '100%',
                  padding: '6px 12px',
                  fontSize: 11,
                  fontWeight: 600,
                  color: '#475569',
                  background: 'none',
                  border: 'none',
                  textAlign: 'left',
                  cursor: 'pointer',
                }}
                onClick={(e) => {
                  onSelect(s.type, e);
                  setOpen(false);
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = '#f8faf9')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
              >
                {s.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ============================================================
// Plot tools modal — FigCode single-cell plotting tools
// ============================================================

// IDs of FigCode cards relevant to single-cell analysis
const SC_FIGCODE_IDS = [
  'umap',
  'heatmap',
  'violin',
  'dotplot',
  'pca',
  'volcano',
  'cnetplot',
  'pseudotime',
  'cluster-trajectory',
  'time-trajectory',
  'chord-plot',
  'spatial-cluster',
  'feature-spatial',
  'library-size',
  'top-genes-count',
  'go-bar',
  'kegg-dotplot',
];

/** Prepend a comment to code indicating obj is available from replot session */
function adaptCodeForReplot(originalCode: string, cardId: string, hasReplot: boolean): string {
  if (!hasReplot) return originalCode;

  // Single-cell specific code templates (use pre-loaded `obj`)
  const scTemplates: Record<string, string> = {
    umap: `# UMAP 可视化 — 使用当前数据集
library(Seurat)
library(ggplot2)

# obj 已预加载（当前数据集的 Seurat 对象）
DimPlot(obj, reduction = "umap", label = TRUE, label.size = 4) +
  ggtitle("UMAP Clustering") +
  theme_classic()`,

    heatmap: `# Marker 基因热图 — 使用当前数据集
library(Seurat)
library(ggplot2)

# 找 top 5 markers per cluster
markers <- FindAllMarkers(obj, only.pos = TRUE, min.pct = 0.25, logfc.threshold = 0.5)
top5 <- markers %>% dplyr::group_by(cluster) %>% dplyr::slice_max(n = 5, order_by = avg_log2FC)
DoHeatmap(obj, features = top5$gene, size = 3) + NoLegend()`,

    violin: `# 小提琴图 — 使用当前数据集
library(Seurat)
library(ggplot2)

# 修改基因名查看不同基因的表达分布
VlnPlot(obj, features = c("CD3E", "CD8A", "MS4A1", "CD14"), ncol = 2, pt.size = 0) +
  theme_classic()`,

    dotplot: `# Dot Plot — 使用当前数据集
library(Seurat)
library(ggplot2)

# 多基因 × 多 cluster 气泡图
genes <- c("IL7R", "CCR7", "CD14", "LYZ", "MS4A1", "CD8A", "GNLY", "NKG7", "FCGR3A", "FCER1A")
DotPlot(obj, features = genes) + RotatedAxis() +
  theme(axis.text.x = element_text(size = 9))`,

    pca: `# PCA 可视化 — 使用当前数据集
library(Seurat)
library(ggplot2)

DimPlot(obj, reduction = "pca", label = TRUE) +
  ggtitle("PCA") + theme_classic()`,

    volcano: `# 火山图 — 使用当前数据集
library(Seurat)
library(ggplot2)
library(ggrepel)

# Cluster 0 vs Cluster 1 差异基因
markers <- FindMarkers(obj, ident.1 = "0", ident.2 = "1", min.pct = 0.25)
markers$gene <- rownames(markers)
markers$sig <- ifelse(markers$p_val_adj < 0.05 & abs(markers$avg_log2FC) > 0.5,
                      ifelse(markers$avg_log2FC > 0, "Up", "Down"), "NS")

ggplot(markers, aes(avg_log2FC, -log10(p_val_adj), color = sig)) +
  geom_point(alpha = 0.6, size = 1.5) +
  scale_color_manual(values = c("Up" = "#dc2626", "Down" = "#2563eb", "NS" = "#9ca3af")) +
  geom_text_repel(data = head(markers[order(markers$p_val_adj), ], 10),
                  aes(label = gene), size = 3, max.overlaps = 15) +
  labs(title = "DEG: Cluster 0 vs 1", x = "log2FC", y = "-log10(padj)") +
  theme_classic()`,

    pseudotime: `# 拟时序可视化 — 使用当前数据集
library(Seurat)
library(ggplot2)

# Feature plot 展示基因表达在 UMAP 上的分布
FeaturePlot(obj, features = c("CD3E", "CD14"), ncol = 2) +
  theme_void()`,
  };

  return (
    scTemplates[cardId] ||
    `# 当前数据集的 Seurat 对象已预加载为 obj
# 可直接使用：DimPlot(obj), FeaturePlot(obj, "CD3E") 等
library(Seurat)
library(ggplot2)

# 示例：UMAP 可视化
DimPlot(obj, reduction = "umap", label = TRUE) + theme_classic()`
  );
}

function PlotToolsModal({ onClose, replotTaskId }: { onClose: () => void; replotTaskId?: string }) {
  const [cards, setCards] = useState<any[]>([]);
  const [selectedCard, setSelectedCard] = useState<any>(null);
  const [warming, setWarming] = useState(false);
  const [warmReady, setWarmReady] = useState(false);

  // Lazy-load FigCode data
  useEffect(() => {
    import('../figcode/_data').then(({ figCards }) => {
      const filtered = figCards.filter((c) => SC_FIGCODE_IDS.includes(c.id));
      setCards(filtered);
    });
  }, []);

  // Auto-warmup replot session when modal opens
  useEffect(() => {
    if (!replotTaskId) return;
    setWarming(true);
    import('./_api').then(({ warmupReplot }) => {
      // For demo tasks, use the actual RDS file (not symlink)
      const cachePath = replotTaskId.startsWith('demo_')
        ? '/app/data/biof3-cache/demo-pbmc3k.rds'
        : `/app/data/biof3-cache/task-${replotTaskId}.rds`;
      warmupReplot(replotTaskId, cachePath).then((result) => {
        setWarming(false);
        setWarmReady(result.ok);
        if (!result.ok) console.warn('Warmup failed:', result.error);
      });
    });
  }, [replotTaskId]);

  // If a card is selected, open RunModal
  if (selectedCard) {
    const RunModal = React.lazy(() => import('@/components/RunModal'));
    return (
      <React.Suspense
        fallback={
          <div className="sc-modal-overlay">
            <div className="sc-empty-desc">加载中...</div>
          </div>
        }
      >
        <RunModal
          isOpen={true}
          onClose={() => setSelectedCard(null)}
          title={selectedCard.title}
          initialCode={adaptCodeForReplot(selectedCard.code, selectedCard.id, warmReady)}
          cardId={selectedCard.id}
          subtitle={selectedCard.subtitle}
          slogan={selectedCard.slogan}
          replotTaskId={warmReady ? replotTaskId : undefined}
        />
      </React.Suspense>
    );
  }

  return (
    <div className="sc-modal-overlay" onClick={onClose}>
      <div className="sc-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 720 }}>
        <div className="sc-modal-header">
          <h2 className="sc-modal-title">单细胞绘图工具</h2>
          <button className="sc-modal-close" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="sc-modal-body">
          <p style={{ fontSize: 11, color: '#9ca3af', marginBottom: 12 }}>
            选择图表类型，在线编辑 R 代码并绘图。由 FigCode 引擎驱动。
            {replotTaskId && warming && (
              <span style={{ display: 'block', marginTop: 4, color: '#f59e0b', fontWeight: 600 }}>
                ⏳ 正在预加载数据到 R 会话...
              </span>
            )}
            {replotTaskId && warmReady && (
              <span
                style={{
                  display: 'block',
                  marginTop: 4,
                  color: 'var(--ifm-color-primary)',
                  fontWeight: 600,
                }}
              >
                ⚡ 数据已就绪，代码中可直接使用 <code>obj</code>（Seurat 对象）
              </span>
            )}
            {replotTaskId && !warming && !warmReady && (
              <span style={{ display: 'block', marginTop: 4, color: '#9ca3af' }}>
                预加载失败，绘图将使用 demo 数据
              </span>
            )}
          </p>
          {cards.length === 0 && <div className="sc-empty-desc">加载中...</div>}
          <div className="sc-plot-tools-grid">
            {cards.map((card) => (
              <button
                key={card.id}
                className="sc-plot-tool-item"
                onClick={() => setSelectedCard(card)}
              >
                <img
                  className="sc-plot-tool-thumb"
                  src={card.image}
                  alt={card.title}
                  loading="lazy"
                />
                <div className="sc-plot-tool-info">
                  <span className="sc-plot-tool-name">{card.title}</span>
                  <span className="sc-plot-tool-desc">{card.subtitle}</span>
                </div>
              </button>
            ))}
          </div>
        </div>
        <div className="sc-modal-footer">
          <button className="sc-btn" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
