import { errMsg } from '@/lib/error';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { Analysis, Dataset, Project, AnalysisType } from './_types';
import { ANALYSIS_TYPES, STATUS_LABELS } from './_types';
import {
  getAnalysis,
  getDataset,
  getProject,
  listAnalysesByDataset,
  updateAnalysis,
  deleteAnalysis,
} from './_store';
import { getTaskStatus, formatTime, formatDuration, warmupReplot } from './_api';
import type { Route } from './_router';
import { NewAnalysisModal } from './_NewAnalysisModal';
import { Sidebar } from './_Sidebar';
import { useSidebarCollapse } from './_useSidebarCollapse';
import { useMobileDrawer } from './_useMobileDrawer';
import { requireWrite, getStoredUser } from './_auth';
import { getPlotMeta, buildReplotCode, type PlotMeta } from './_plotMeta';
import { getFileMeta, type FileMeta } from './_fileMeta';
import { TablePreviewModal } from './_TablePreviewModal';
import { DocModal } from './_DocModal';
import RunModal from '@/components/RunModal';
import { CsvTable } from './_CsvTable';
import { translateError } from './_errorTranslate';
import { useSetCopilotContext } from '@/lib/copilotContextProvider';
import { getApiPrefix } from './_config';
import { getAuthHeaders } from './_auth';

type Tab = 'preview' | 'plots' | 'data' | 'params';

interface PlotItem {
  name: string;
  url: string;
  filename: string;
}

export function ResultView({
  analysisId,
  navigate,
}: {
  analysisId: string;
  navigate: (r: Route) => void;
}) {
  const [sidebarCollapsed, toggleSidebar, sidebarWidth, startResize] = useSidebarCollapse();
  const [mobileOpen, openMobile, closeMobile] = useMobileDrawer();
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [dataset, setDataset] = useState<Dataset | null>(null);
  const [project, setProject] = useState<Project | null>(null);
  const [_sibAnalyses, setSibAnalyses] = useState<Analysis[]>([]);
  const [taskData, setTaskData] = useState<any>(null);
  const [tab, setTab] = useState<Tab>('plots');
  const [dataView, setDataView] = useState<'meta' | 'features'>('meta');
  const [selectedCells, setSelectedCells] = useState<string[]>([]);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [showContinueModal, setShowContinueModal] = useState<AnalysisType | null>(null);
  const [selectedPlot, setSelectedPlot] = useState<PlotItem | null>(null);
  const [selectedFile, setSelectedFile] = useState<{
    name: string;
    url: string;
    description?: string;
  } | null>(null);
  const [replotModal, setReplotModal] = useState<{ title: string; code: string } | null>(null);
  const [tablePreview, setTablePreview] = useState<{ name: string; url: string } | null>(null);
  const [docModal, setDocModal] = useState<any>(null); // DocSection
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [warmupStatus, setWarmupStatus] = useState<'idle' | 'warming' | 'ready' | 'failed'>('idle');
  // GENERATE_METHODS_v1 — Methods generation modal state
  const [methodsModal, setMethodsModal] = useState<{
    loading: boolean;
    text: string;
    lang: 'zh' | 'en' | 'both';
    error?: string;
  } | null>(null);
  // EXPORT_REPORT_v1 — PDF report export state
  const [reportState, setReportState] = useState<{
    loading: boolean;
    url?: string;
    error?: string;
    sizeBytes?: number;
  } | null>(null);
  // EXPORT_SCRIPT_v1 — script export modal state
  const [scriptModal, setScriptModal] = useState<{
    loading: boolean;
    lang: 'r' | 'python';
    filename?: string;
    script?: string;
    error?: string;
  } | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Reset state immediately when analysisId changes
  useEffect(() => {
    setAnalysis(null);
    setDataset(null);
    setProject(null);
    setSibAnalyses([]);
    setTaskData(null);
    setTab('plots'); // Will be overridden to 'preview' once analysis loads
    setSelectedPlot(null);
    setSelectedFile(null);
    setWarmupStatus('idle');
  }, [analysisId]);

  const reload = useCallback(async () => {
    try {
      const a = await getAnalysis(analysisId);
      setAnalysis(a);
      if (a) {
        const ds = await getDataset(a.datasetId);
        setDataset(ds);
        if (ds) {
          const [proj, sibs] = await Promise.all([
            getProject(ds.projectId),
            listAnalysesByDataset(ds.id),
          ]);
          setProject(proj);
          setSibAnalyses(sibs);
        }
      }
    } catch (e) {
      console.error('加载分析结果失败', e);
    }
  }, [analysisId]);

  useEffect(() => {
    reload();
  }, [reload]);

  // Publish context to Copilot whenever analysis/dataset/results change.
  // Replaces the original useEffect that did a partial cleanup on
  // unmount; useSetCopilotContext resets before re-applying, so
  // analysis transitions get a clean context instead of inheriting
  // stale fields from the previous analysis.
  useSetCopilotContext(
    analysis
      ? (() => {
          const summary =
            analysis.results?.summary ||
            taskData?.results?.summary ||
            analysis.summary;
          const clusterIds = summary?.clusters
            ? summary.clusters.map((c: Record<string, unknown>) =>
                c.cluster ?? c.id ?? c
              )
            : undefined;
          return {
            page: 'single-cell-result',
            projectId: project?.id,
            datasetId: dataset?.id,
            datasetName: dataset?.name,
            analysisId: analysis.id,
            analysisName: analysis.name,
            analysisType: analysis.type,
            summary,
            clusterIds,
          };
        })()
      : {},
    [
      analysis?.id,
      analysis?.name,
      analysis?.type,
      dataset?.id,
      dataset?.name,
      project?.id,
      // eslint-disable-next-line react-hooks/exhaustive-deps
      JSON.stringify(analysis?.summary),
    ]
  );

  // Listen for Copilot UI control events
  useEffect(() => {
    const onSwitchTab = (e: Event) => {
      const t = (e as CustomEvent).detail?.tab;
      if (t === 'preview' || t === 'plots' || t === 'data' || t === 'params') {
        setTab(t as Tab);
      }
    };
    const onFocusCluster = (e: Event) => {
      const cluster = (e as CustomEvent).detail?.cluster;
      if (cluster == null) return;
      // Switch to plots tab and try to focus a UMAP plot named "umap_cluster" or fall back to first
      setTab('plots');
      const plots = (taskData?.results?.plots || analysis?.results?.plots || []) as PlotItem[];
      // Prefer a plot whose filename contains the cluster id ("cluster_3.png") or generic UMAP
      const target =
        plots.find((p) => p.filename?.includes(`cluster_${cluster}`)) ||
        plots.find((p) => /umap.*cluster/i.test(p.filename || p.name || '')) ||
        plots.find((p) => /umap/i.test(p.filename || p.name || '')) ||
        plots[0];
      if (target) setSelectedPlot(target);
      // Briefly highlight the result page header
      try {
        const el = document.querySelector('.sc-result-summary, .sc-result-header');
        if (el) {
          (el as HTMLElement).style.transition = 'box-shadow 0.3s';
          (el as HTMLElement).style.boxShadow = '0 0 0 3px #10b98180';
          setTimeout(() => {
            (el as HTMLElement).style.boxShadow = '';
          }, 1500);
        }
      } catch (err) {}
    };
    const onHighlightGene = (e: Event) => {
      const gene = (e as CustomEvent).detail?.gene;
      if (!gene) return;
      setTab('plots');
      const plots = (taskData?.results?.plots || analysis?.results?.plots || []) as PlotItem[];
      // Prefer a plot whose filename / name contains the gene
      const target =
        plots.find((p) => (p.filename || '').toLowerCase().includes(String(gene).toLowerCase())) ||
        plots.find((p) => /featureplot|feature_plot/i.test(p.filename || p.name || '')) ||
        plots[0];
      if (target) setSelectedPlot(target);
    };
    window.addEventListener('biof3:sc-switch-tab', onSwitchTab as EventListener);
    window.addEventListener('biof3:sc-focus-cluster', onFocusCluster as EventListener);
    window.addEventListener('biof3:sc-highlight-gene', onHighlightGene as EventListener);
    return () => {
      window.removeEventListener('biof3:sc-switch-tab', onSwitchTab as EventListener);
      window.removeEventListener('biof3:sc-focus-cluster', onFocusCluster as EventListener);
      window.removeEventListener('biof3:sc-highlight-gene', onHighlightGene as EventListener);
    };
  }, [taskData?.results?.plots, analysis?.results?.plots]);

  // Open Replot from Copilot
  useEffect(() => {
    const onOpenReplot = (e: Event) => {
      const detail = (e as CustomEvent).detail || {};
      // Only handle if it's for the currently displayed analysis (or ignore)
      if (detail.analysisId && detail.analysisId !== analysis?.id) return;
      const _cachePath = (taskData?.cachePath ||
        (analysis?.results as Record<string, unknown>)?.cachePath) as string | undefined;
      const template = `# Copilot 打开的在线绘图：基于当前分析的 RDS 自由作图\nlibrary(Seurat)\nlibrary(ggplot2)\n\n# 已为你加载 Seurat 对象到变量 obj\n# 例：UMAP 按 cluster 着色\nDimPlot(obj, reduction = "umap", label = TRUE) +\n  ggtitle("UMAP — clusters") +\n  theme_classic()\n`;
      setReplotModal({ title: analysis?.name || '自由绘图', code: template });
    };
    window.addEventListener('biof3:sc-open-replot', onOpenReplot as EventListener);
    return () => window.removeEventListener('biof3:sc-open-replot', onOpenReplot as EventListener);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysis?.id, analysis?.name, taskData]);

  // Set default tab to 'preview' for standard/recluster analyses
  useEffect(() => {
    if (
      analysis &&
      (analysis.type === 'scrna_standard' || analysis.type === 'recluster') &&
      analysis.status === 'done'
    ) {
      setTab('preview');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysis?.id, analysis?.type, analysis?.status]);

  // Fetch task data + poll if running
  // If analysis is already done and has persisted results, use those directly
  useEffect(() => {
    if (!analysis) return;
    let cancelled = false;

    // If results are already persisted in DB (survives restart), use them
    if ((analysis.status === 'done' || analysis.status === 'failed') && analysis.results) {
      setTaskData({
        status: analysis.status,
        results: analysis.results,
        error: analysis.error,
        cachePath: (analysis.results as any)?.cachePath,
      });
      return;
    }

    const fetchOnce = async () => {
      try {
        const task = await getTaskStatus(analysis.taskId);
        if (cancelled) return;
        setTaskData(task);

        if (task.status !== analysis.status) {
          await updateAnalysis(analysis.id, {
            status: task.status,
            summary: task.results?.summary,
            error: task.error,
            finishedAt: task.finishedAt,
          });
          reload();
        }
      } catch (err) {
        // Task not found in memory (server restarted) — check if analysis has summary
        if (analysis.status === 'done' && analysis.summary) {
          // We have summary but no full results — show what we can
          setTaskData({
            status: 'done',
            results: { summary: analysis.summary, plots: [], files: [] },
          });
        }
      }
    };

    fetchOnce();

    if (
      analysis.status === 'running' ||
      analysis.status === 'pending' ||
      analysis.status === 'queued'
    ) {
      pollRef.current = setInterval(fetchOnce, 2500);
    }

    return () => {
      cancelled = true;
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [analysis?.taskId, analysis?.status]); // eslint-disable-line

  // Auto-warmup R session when analysis is done and has cachePath
  // This pre-loads packages + data so online plotting is fast
  useEffect(() => {
    if (!analysis || analysis.status !== 'done' || warmupStatus !== 'idle') return;

    // Determine cache path: prefer taskData.cachePath (live), fallback to analysis.results
    const cachePath =
      taskData?.cachePath ||
      (analysis.results as Record<string, unknown>)?.cachePath ||
      `/app/data/biof3-cache/task-${analysis.taskId}.rds`;

    // Only warmup for analyses with RDS results (Seurat-based)
    const files = analysis.results?.files || taskData?.results?.files || [];
    const hasRds = files.some((f: Record<string, any>) => f.name?.endsWith('.rds'));
    // For standard/recluster analyses, always attempt warmup (they always produce RDS)
    const isStandardType = analysis.type === 'scrna_standard' || analysis.type === 'recluster';
    if (!hasRds && !isStandardType) return;

    setWarmupStatus('warming');
    warmupReplot(analysis.taskId, cachePath).then((result) => {
      setWarmupStatus(result.ok ? 'ready' : 'failed');
      if (!result.ok) console.warn('Warmup failed:', result.error);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysis?.taskId, analysis?.status, analysis?.type, taskData?.cachePath, warmupStatus]);

  // Auto-select first plot when results are ready
  useEffect(() => {
    if (taskData?.results?.plots?.length > 0 && !selectedPlot) {
      setSelectedPlot(taskData.results.plots[0]);
    }
  }, [taskData?.results?.plots, selectedPlot]);

  // Auto-select first file
  useEffect(() => {
    if (taskData?.results?.files?.length > 0 && !selectedFile) {
      setSelectedFile(taskData.results.files[0]);
    }
  }, [taskData?.results?.files, selectedFile]);

  // Switch right panel target based on active tab
  const activePanelMeta: PanelTarget = (() => {
    if (tab === 'data' && selectedFile) {
      const fm = getFileMeta(selectedFile.name);
      if (fm) return { kind: 'file', meta: fm, plot: null, file: selectedFile };
      return { kind: 'file', meta: null, plot: null, file: selectedFile };
    }
    if (tab === 'plots' && selectedPlot) {
      const pm = getPlotMeta(selectedPlot.filename || selectedPlot.name);
      return { kind: 'plot', meta: pm, plot: selectedPlot, file: null };
    }
    return { kind: 'none', meta: null, plot: null, file: null };
  })();

  const handleDelete = useCallback(
    async (e?: React.MouseEvent) => {
      if (!analysis || !dataset) return;
      if (!requireWrite('删除分析', e)) return;
      if (confirm(`删除「${analysis.name}」？`)) {
        try {
          await deleteAnalysis(analysis.id);
          navigate({ name: 'dataset', datasetId: dataset.id });
        } catch (err: any) {
          alert(`删除失败: ${err.message}`);
        }
      }
    },
    [analysis, dataset, navigate]
  );

  // GENERATE_METHODS_v1 — opens modal and fetches Methods paragraph
  const generateMethods = useCallback(
    async (lang: 'zh' | 'en' | 'both') => {
      if (!analysis) return;
      setMethodsModal({ loading: true, text: '', lang });
      try {
        const resp = await fetch(getApiPrefix() + '/ai/generate-methods', {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify({ analysisId: analysis.id, language: lang }),
        });
        const data = await resp.json();
        if (data.status === 'ok') {
          setMethodsModal({ loading: false, text: data.methods || '', lang });
        } else {
          setMethodsModal({
            loading: false,
            text: '',
            lang,
            error: data.error || data.message || '生成失败',
          });
        }
      } catch (e: any) {
        setMethodsModal({ loading: false, text: '', lang, error: errMsg(e) || '网络错误' });
      }
    },
    [analysis]
  );

  // EXPORT_REPORT_v1 — generate PDF report
  const exportReport = useCallback(
    async (lang: 'zh' | 'en' | 'both' = 'zh') => {
      if (!analysis) return;
      setReportState({ loading: true });
      try {
        const resp = await fetch(getApiPrefix() + '/ai/export-report', {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify({ analysisId: analysis.id, language: lang }),
        });
        const data = await resp.json();
        if (data.status === 'ok' && data.url) {
          setReportState({ loading: false, url: data.url, sizeBytes: data.sizeBytes });
        } else {
          setReportState({ loading: false, error: data.error || data.message || '生成失败' });
        }
      } catch (e: any) {
        setReportState({ loading: false, error: errMsg(e) || '网络错误' });
      }
    },
    [analysis]
  );

  // EXPORT_SCRIPT_v1 — generate reproducible R / Python script
  const exportScript = useCallback(
    async (lang: 'r' | 'python') => {
      if (!analysis) return;
      setScriptModal({ loading: true, lang });
      try {
        const resp = await fetch(getApiPrefix() + '/ai/export-script', {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify({ analysisId: analysis.id, language: lang }),
        });
        const data = await resp.json();
        if (data.status === 'ok' && data.script) {
          setScriptModal({ loading: false, lang, filename: data.filename, script: data.script });
        } else {
          setScriptModal({ loading: false, lang, error: data.error || data.message || '生成失败' });
        }
      } catch (e: any) {
        setScriptModal({ loading: false, lang, error: errMsg(e) || '网络错误' });
      }
    },
    [analysis]
  );

  const handleRename = useCallback(async () => {
    if (!analysis || !renameValue.trim() || renameValue.trim() === analysis.name) {
      setRenaming(false);
      return;
    }
    if (!requireWrite('重命名')) {
      setRenaming(false);
      return;
    }
    try {
      await updateAnalysis(analysis.id, { name: renameValue.trim() });
      setRenaming(false);
      reload();
    } catch (e: any) {
      alert(`重命名失败: ${e.message}`);
    }
  }, [analysis, renameValue, reload]);

  const handleContinueCreated = useCallback(
    (newAnalysis: Analysis) => {
      setShowContinueModal(null);
      navigate({ name: 'result', analysisId: newAnalysis.id });
    },
    [navigate]
  );

  // Check if current project is public and not owned by current user
  const isPublicReadOnly = project?.isPublic && getStoredUser()?.role !== 'admin';

  // Handle tool click — show hint if public readonly
  const handleToolClick = useCallback(
    (type: AnalysisType) => {
      if (isPublicReadOnly) {
        alert('此为公开示例（只读）。请返回项目列表，点击「📋 复制」后再进行分析。');
        return;
      }
      setShowContinueModal(type);
    },
    [isPublicReadOnly]
  );

  // Open replot modal for a plot
  const handleReplot = useCallback(
    (plot: PlotItem) => {
      if (!taskData?.results) return;
      const meta = getPlotMeta(plot.filename || plot.name);
      if (!meta) {
        alert('该图表暂无重绘配置');
        return;
      }
      // If R session is warmed up, use replot service (faster, no data loading)
      const useReplotService = warmupStatus === 'ready';
      const result = buildReplotCode(
        meta,
        taskData.results.files || [],
        taskData.cachePath,
        useReplotService
      );
      if (!result.ok) {
        alert(result.message || '无法重绘');
        return;
      }
      setReplotModal({ title: meta.title, code: result.code });
    },
    [taskData, warmupStatus]
  );

  if (!analysis || !dataset || !project) {
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

  const meta = ANALYSIS_TYPES[analysis.type];
  const statusInfo = STATUS_LABELS[analysis.status];
  const isRunning =
    analysis.status === 'running' || analysis.status === 'pending' || analysis.status === 'queued';
  const isDone = analysis.status === 'done';
  const results = taskData?.results;
  const elapsed = analysis.finishedAt
    ? (new Date(analysis.finishedAt).getTime() - new Date(analysis.createdAt).getTime()) / 1000
    : 0;

  // Suggested next steps based on type
  const nextSteps: Array<{ type: AnalysisType; label: string; hint: string }> =
    analysis.type === 'scrna_standard'
      ? [
          { type: 'deg', label: '差异表达', hint: 'cluster 间差异基因' },
          { type: 'cell_annotation', label: '细胞注释', hint: 'SingleR 识别细胞类型' },
          { type: 'trajectory', label: '轨迹分析', hint: 'Monocle3 发育路径' },
          { type: 'communication', label: '细胞通讯', hint: 'CellChat 互作网络' },
        ]
      : analysis.type === 'deg'
        ? [{ type: 'enrichment', label: '富集分析', hint: 'GO/KEGG 功能富集' }]
        : [];

  return (
    <main className="sc-page">
      <section
        className={`sc-layout ${tab !== 'preview' ? 'sc-layout-3col' : ''} ${sidebarCollapsed ? 'sc-layout-collapsed' : ''}`}
        style={{ '--sidebar-w': `${sidebarWidth}px` } as React.CSSProperties}
      >
        {/* ===== Left Sidebar (slide-in drawer on mobile) ===== */}
        <div
          className={`sc-sidebar-col ${sidebarCollapsed ? 'sc-sidebar-col-collapsed' : ''} ${mobileOpen ? 'is-mobile-open' : ''}`}
        >
          <Sidebar
            navigate={(r) => {
              closeMobile();
              navigate(r);
            }}
            activeProjectId={project.id}
            activeDatasetId={dataset.id}
            activeAnalysisId={analysisId}
            collapsed={sidebarCollapsed}
            onToggleCollapse={toggleSidebar}
            width={sidebarWidth}
            onResizeStart={startResize}
            mobileOpen={mobileOpen}
          />

          {/* Continue analysis suggestions */}
          {nextSteps.length > 0 && isDone && (
            <div className="sc-sidebar-extra">
              <div className="sc-sidebar-divider" />
              <div className="sc-sidebar-section">
                <div className="sc-sidebar-label">继续分析</div>
                {nextSteps.map((s) => (
                  <button
                    key={s.type}
                    className="sc-sidebar-item"
                    onClick={(e) => {
                      if (requireWrite('新建分析', e)) handleToolClick(s.type);
                    }}
                    title={s.hint}
                  >
                    <span className="sc-sidebar-item-icon">+</span>
                    <span className="sc-sidebar-item-text">{s.label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        {mobileOpen && <div className="sc-mobile-backdrop" onClick={closeMobile} />}

        {/* ===== Center Content ===== */}
        <div className="sc-main">
          <button className="sc-mobile-menu-btn" onClick={openMobile} aria-label="打开导航">
            <span className="sc-mobile-menu-btn-icon">
              <span />
            </span>
            导航
          </button>
          <div className="sc-header">
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                <span
                  className="sc-analysis-badge"
                  style={{ width: 28, height: 28, fontSize: 12, background: meta.color }}
                >
                  {meta.icon}
                </span>
                <h1 className="sc-header-title" style={{ margin: 0 }}>
                  {renaming ? (
                    <input
                      className="sc-form-input"
                      style={{ fontSize: 16, fontWeight: 700, padding: '2px 6px', width: 260 }}
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
                    <span
                      onDoubleClick={() => {
                        setRenameValue(analysis.name);
                        setRenaming(true);
                      }}
                      title="双击重命名"
                      style={{ cursor: 'text' }}
                    >
                      {analysis.name}
                      <span
                        style={{ fontSize: 10, color: 'var(--biof3-text-muted)', marginLeft: 6, fontWeight: 400 }}
                      >
                        ✎
                      </span>
                    </span>
                  )}
                </h1>
                <span
                  className="sc-status-tag"
                  style={{ background: `${statusInfo.color}20`, color: statusInfo.color }}
                >
                  <span
                    className={`sc-status-dot ${analysis.status}`}
                    style={{ background: statusInfo.color }}
                  />
                  {statusInfo.label}
                </span>
                {warmupStatus === 'warming' && (
                  <span
                    className="sc-status-tag"
                    style={{ background: '#f59e0b20', color: 'var(--biof3-status-loading)' }}
                    title="正在预加载 R 会话以加速在线绘图"
                  >
                    <span className="sc-status-dot running" style={{ background: '#f59e0b' }} />
                    预热中
                  </span>
                )}
                {warmupStatus === 'ready' && (
                  <span
                    className="sc-status-tag"
                    style={{ background: '#10b98120', color: 'var(--biof3-status-online)' }}
                    title="R 会话已就绪，在线绘图 < 5 秒"
                  >
                    ⚡ 极速绘图
                  </span>
                )}
                <span style={{ fontSize: 10, color: 'var(--biof3-text-muted)', fontWeight: 400, marginLeft: 8 }}>
                  {meta.name}
                  {isDone && elapsed > 0 && ` · 耗时 ${formatDuration(elapsed)}`}
                  {` · ${formatTime(analysis.createdAt)}`}
                </span>
              </div>
            </div>
            <div className="sc-header-actions">
              <button className="sc-btn" onClick={handleDelete}>
                删除
              </button>
              {isDone && (
                <button
                  className="sc-btn"
                  onClick={() => generateMethods('zh')}
                  title="基于此分析（含父链）生成可直接放入论文 Methods 部分的段落"
                >
                  📄 Methods
                </button>
              )}
              {isDone && (
                <button
                  className="sc-btn"
                  onClick={() => exportReport('zh')}
                  title="生成完整 PDF 报告（封面 + plan + 图表 + Methods + 引用），24 小时签名链接"
                  disabled={reportState?.loading}
                >
                  {reportState?.loading ? '⏳ 生成中...' : '📋 报告 PDF'}
                </button>
              )}
              {isDone && (
                <button
                  className="sc-btn"
                  onClick={() => exportScript('r')}
                  title="导出可复现 R / Python 脚本（含真实参数和引用），离线可重跑"
                  disabled={scriptModal?.loading}
                >
                  {scriptModal?.loading ? '⏳ 生成中...' : '💻 复现脚本'}
                </button>
              )}
              {isDone && results?.files?.[0]?.url && (
                <a className="sc-btn sc-btn-primary" href={results.files[0].url} download>
                  下载结果
                </a>
              )}
            </div>
          </div>

          {/* Running banner */}
          {isRunning && (
            <div className="sc-running">
              <div className="sc-spinner" />
              <div className="sc-running-msg">
                {taskData?.queuePosition > 0 ? (
                  <>
                    排队中 · 前面还有 <strong>{taskData.queuePosition}</strong> 个任务
                    <span style={{ color: 'var(--biof3-text-muted)', marginLeft: 8 }}>
                      （服务器同时处理 {taskData.maxConcurrent || 2} 个任务，请稍候）
                    </span>
                  </>
                ) : (
                  taskData?.progressMessage || '正在启动...'
                )}
              </div>
              <div className="sc-running-bar">
                <div
                  className="sc-running-bar-fill"
                  style={{ width: `${taskData?.progress || 0}%` }}
                />
              </div>
              <div className="sc-running-pct">{taskData?.progress || 0}%</div>
            </div>
          )}

          {/* Failed banner */}
          {analysis.status === 'failed' &&
            (() => {
              const rawErr = analysis.error || taskData?.error || '未知错误';
              const translated = translateError(rawErr);
              return (
                <div className="sc-error-box">
                  <strong>❌ {translated ? translated.message : '分析失败'}</strong>
                  {translated && (
                    <div
                      style={{
                        margin: '8px 0',
                        padding: '8px 12px',
                        background: '#fef3c7',
                        borderRadius: 6,
                        fontSize: 12,
                        color: '#92400e',
                      }}
                    >
                      💡 {translated.suggestion}
                    </div>
                  )}
                  <details style={{ marginTop: 8 }}>
                    <summary style={{ cursor: 'pointer', fontSize: 11, color: 'var(--biof3-text-muted)' }}>
                      原始错误信息
                    </summary>
                    <pre style={{ marginTop: 6, fontSize: 10 }}>{rawErr}</pre>
                  </details>
                </div>
              );
            })()}

          {/* Result content */}
          {isDone && results && (
            <>
              {/* Tabs */}
              <div className="sc-result-tabs">
                {(analysis.type === 'scrna_standard' || analysis.type === 'recluster') && (
                  <button
                    className={`sc-tab ${tab === 'preview' ? 'active' : ''}`}
                    onClick={() => setTab('preview')}
                  >
                    数据预览
                  </button>
                )}
                <button
                  className={`sc-tab ${tab === 'plots' ? 'active' : ''}`}
                  onClick={() => setTab('plots')}
                >
                  图表 {results.plots?.length > 0 && `(${results.plots.length})`}
                </button>
                <button
                  className={`sc-tab ${tab === 'data' ? 'active' : ''}`}
                  onClick={() => setTab('data')}
                >
                  数据文件 {results.files?.length > 0 && `(${results.files.length})`}
                </button>
                <button
                  className={`sc-tab ${tab === 'params' ? 'active' : ''}`}
                  onClick={() => setTab('params')}
                >
                  参数
                </button>
              </div>

              {tab === 'preview' &&
                (analysis.type === 'scrna_standard' || analysis.type === 'recluster') && (
                  <div className="sc-data-tools-layout">
                    <div className="sc-data-table-col">
                      {/* Meta / Features toggle */}
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
                      {dataView === 'meta' && dataset.metaUrl ? (
                        <CsvTable
                          key={`meta-${dataset.id}`}
                          fileUrl={dataset.metaUrl}
                          pageSize={20}
                          rowKey="cell_id"
                          selectable
                          onSelectionChange={(ids) => setSelectedCells(ids)}
                        />
                      ) : dataView === 'features' && dataset.featuresUrl ? (
                        <CsvTable
                          key={`feat-${dataset.id}`}
                          fileUrl={dataset.featuresUrl}
                          pageSize={20}
                          rowKey="gene_symbol"
                        />
                      ) : (
                        <div className="sc-data-preview-hint">
                          <div style={{ fontSize: 12, color: 'var(--biof3-status-loading)', fontWeight: 600 }}>
                            ⏳ 数据预览正在生成中...
                          </div>
                          <div style={{ marginTop: 6, fontSize: 11, color: 'var(--biof3-text-muted)' }}>
                            分析完成后刷新页面即可查看
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="sc-tools-card">
                      <div className="sc-tools-card-header">
                        <span className="sc-tools-card-title">分析工具</span>
                        {selectedCells.length > 0 && !isPublicReadOnly && (
                          <span className="sc-tools-card-hint">
                            已选 <strong>{selectedCells.length}</strong> cells
                          </span>
                        )}
                        {isPublicReadOnly && (
                          <span style={{ fontSize: 9, color: 'var(--biof3-text-muted)' }}>只读</span>
                        )}
                      </div>
                      <div className="sc-tools-grid">
                        {Object.entries(ANALYSIS_TYPES).map(([key, typeMeta]) => {
                          if (key === 'scrna_standard') return null;
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
                              onClick={() =>
                                isReady ? handleToolClick(key as AnalysisType) : undefined
                              }
                              title={
                                isReady
                                  ? `${typeMeta.name} — ${typeMeta.desc}`
                                  : `${typeMeta.name}（开发中）`
                              }
                              disabled={!isReady}
                            >
                              <span
                                className="sc-tool-item-icon"
                                style={{ background: isReady ? typeMeta.color : '#9ca3af' }}
                              >
                                {typeMeta.icon}
                              </span>
                              <span className="sc-tool-item-name">{typeMeta.shortName}</span>
                              {!isReady && <span className="sc-tool-item-wip-tag">开发中</span>}
                            </button>
                          );
                        })}
                      </div>
                      {/* Export selected cells */}
                      {selectedCells.length > 0 && (
                        <div
                          style={{
                            borderTop: '1px solid #e5ebe8',
                            marginTop: 10,
                            paddingTop: 10,
                            paddingLeft: 12,
                            paddingRight: 12,
                          }}
                        >
                          <button
                            className="sc-btn sc-btn-primary sc-btn-sm"
                            style={{ width: '100%', fontSize: 11 }}
                            onClick={() => {
                              const csv = 'cell_id\n' + selectedCells.join('\n');
                              const blob = new Blob([csv], { type: 'text/csv' });
                              const url = URL.createObjectURL(blob);
                              const a = document.createElement('a');
                              a.href = url;
                              a.download = `selected_${selectedCells.length}_cells.csv`;
                              a.click();
                              URL.revokeObjectURL(url);
                            }}
                          >
                            ↓ 导出选中 {selectedCells.length} 个细胞
                          </button>
                        </div>
                      )}
                      {/* Stats summary */}
                      {results?.summary && (
                        <div
                          style={{
                            borderTop: '1px solid #e5ebe8',
                            marginTop: 12,
                            paddingTop: 10,
                            paddingLeft: 12,
                            paddingRight: 12,
                          }}
                        >
                          <div
                            style={{
                              fontSize: 10,
                              fontWeight: 800,
                              color: 'var(--biof3-text-muted)',
                              marginBottom: 6,
                            }}
                          >
                            统计摘要
                          </div>
                          <div className="sc-stats-list">
                            {Object.entries(results.summary).map(([k, v]) => {
                              if (v == null || typeof v === 'object') return null;
                              const label = k.replace(/_/g, ' ');
                              const value = typeof v === 'number' ? v.toLocaleString() : String(v);
                              return (
                                <div key={k} className="sc-stats-item">
                                  <span className="sc-stats-label">{label}</span>
                                  <span className="sc-stats-value">{value}</span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

              {tab === 'plots' && (
                <>
                  {results.plots?.length > 0 ? (
                    <div className="sc-plots-grid">
                      {results.plots.map((p: PlotItem, i: number) => {
                        const isSelected = selectedPlot?.url === p.url;
                        const pMeta = getPlotMeta(p.filename || p.name);
                        const canReplot = pMeta?.replot != null;
                        // FigCode-style card: English (subtitle) on top, Chinese (title) on bottom
                        const topName = pMeta?.subtitle || (p.name || '').replace(/_/g, ' ');
                        const bottomLabel = pMeta?.title || p.name;
                        return (
                          <div
                            key={i}
                            className={`sc-plot-card ${isSelected ? 'selected' : ''}`}
                            onClick={() => setSelectedPlot(p)}
                            onDoubleClick={() => setLightboxSrc(p.url)}
                            title="单击查看介绍，双击放大"
                          >
                            <div className="sc-plot-card-title">{topName}</div>
                            <div className="sc-plot-card-image">
                              <img src={p.url} alt={p.name} loading="lazy" />
                            </div>
                            <div className="sc-plot-card-info">
                              <span className="sc-plot-card-label" title={bottomLabel}>
                                {bottomLabel}
                              </span>
                              <div className="sc-plot-card-btns">
                                <button
                                  className="sc-card-btn"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (pMeta) setDocModal({ ...pMeta, imageUrl: p.url });
                                    else setLightboxSrc(p.url);
                                  }}
                                  title="查看图表说明文档"
                                >
                                  HTML
                                </button>
                                <button
                                  className="sc-card-btn"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (pMeta) setDocModal({ ...pMeta, imageUrl: p.url });
                                    else setLightboxSrc(p.url);
                                  }}
                                  title="下载说明文档 PDF"
                                >
                                  PDF
                                </button>
                                <button
                                  className="sc-card-btn-primary"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (canReplot) handleReplot(p);
                                    else alert('该图表暂不支持在线绘图');
                                  }}
                                  disabled={!canReplot}
                                  title={canReplot ? '在线编辑代码并重绘' : '暂不支持'}
                                >
                                  在线绘图
                                </button>
                                <button
                                  className="sc-card-btn"
                                  onClick={async (e) => {
                                    e.stopPropagation();
                                    if (!analysis) return;
                                    const btn = e.currentTarget;
                                    btn.textContent = '...';
                                    btn.disabled = true;
                                    try {
                                      const resp = await fetch(
                                        getApiPrefix() + '/ai/generate-caption',
                                        {
                                          method: 'POST',
                                          headers: getAuthHeaders(),
                                          body: JSON.stringify({
                                            analysisId: analysis.id,
                                            plotName: p.name,
                                            plotFilename: p.filename,
                                            language: 'zh',
                                          }),
                                        }
                                      );
                                      const data = await resp.json();
                                      if (data.status === 'ok' && data.caption) {
                                        await navigator.clipboard.writeText(data.caption);
                                        btn.textContent = '✓';
                                        setTimeout(() => {
                                          btn.textContent = '📝';
                                          btn.disabled = false;
                                        }, 1500);
                                        const div = document.createElement('div');
                                        div.textContent =
                                          '图注已复制: ' + data.caption.slice(0, 40) + '...';
                                        div.style.cssText =
                                          'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#10b981;color:white;padding:8px 14px;border-radius:8px;font-size:12px;z-index:99999;max-width:400px';
                                        document.body.appendChild(div);
                                        setTimeout(() => div.remove(), 3000);
                                      } else {
                                        alert('生成失败: ' + (data.error || ''));
                                        btn.textContent = '📝';
                                        btn.disabled = false;
                                      }
                                    } catch (err: any) {
                                      alert('网络错误: ' + (errMsg(err) || ''));
                                      btn.textContent = '📝';
                                      btn.disabled = false;
                                    }
                                  }}
                                  title="AI 生成图注（自动复制到剪贴板）"
                                >
                                  📝
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="sc-empty">
                      <div className="sc-empty-desc">暂无图表输出</div>
                    </div>
                  )}
                </>
              )}

              {tab === 'data' && (
                <>
                  {results.files?.length > 0 ? (
                    <div className="sc-plots-grid">
                      {results.files.map((f: Record<string, any>, i: number) => {
                        const isCSV = /\.(csv|tsv|txt)$/i.test(f.name);
                        const isRds = /\.rds$/i.test(f.name);
                        const topName = f.name.replace(/\.[^.]+$/, '').replace(/_/g, ' ');
                        const bottomLabel = isCSV ? '数据表' : isRds ? 'R 对象' : '数据文件';
                        return (
                          <div
                            key={i}
                            className={`sc-plot-card sc-data-card ${selectedFile?.name === f.name ? 'selected' : ''}`}
                            onClick={() => setSelectedFile(f as any)}
                          >
                            <div className="sc-plot-card-title">{topName}</div>
                            <div className="sc-plot-card-image sc-data-card-icon">
                              <span>{isCSV ? '📊' : isRds ? '🧬' : '📄'}</span>
                              <span style={{ fontSize: 11, color: 'var(--biof3-text-muted)', marginTop: 6 }}>
                                {f.name}
                              </span>
                              {f.description && (
                                <span
                                  style={{
                                    fontSize: 10,
                                    color: 'var(--biof3-text-muted)',
                                    marginTop: 4,
                                    padding: '0 12px',
                                    textAlign: 'center',
                                  }}
                                >
                                  {f.description}
                                </span>
                              )}
                            </div>
                            <div className="sc-plot-card-info">
                              <span className="sc-plot-card-label">{bottomLabel}</span>
                              <div className="sc-plot-card-btns">
                                {isCSV && (
                                  <button
                                    className="sc-card-btn"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setTablePreview({ name: f.name, url: f.url });
                                    }}
                                  >
                                    预览
                                  </button>
                                )}
                                <a className="sc-card-btn-primary" href={f.url} download>
                                  下载
                                </a>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="sc-empty">
                      <div className="sc-empty-desc">暂无数据文件</div>
                    </div>
                  )}
                </>
              )}

              {tab === 'params' && (
                <div className="sc-param-group">
                  <div className="sc-param-title">分析参数</div>
                  <pre style={{ fontSize: 11, background: 'transparent', margin: 0 }}>
                    {JSON.stringify(analysis.params, null, 2)}
                  </pre>
                </div>
              )}
            </>
          )}
        </div>

        {/* ===== Right Info Panel (FigCode-style) — hidden on preview tab ===== */}
        {tab !== 'preview' && (
          <RightInfoPanel
            target={activePanelMeta}
            analysisId={analysis.id}
            onShowDoc={(meta) => setDocModal(meta)}
          />
        )}
      </section>

      {lightboxSrc && (
        <div className="sc-lightbox" onClick={() => setLightboxSrc(null)}>
          <img src={lightboxSrc} alt="" />
        </div>
      )}

      {showContinueModal && dataset && (
        <NewAnalysisModal
          dataset={dataset}
          defaultType={showContinueModal}
          parentAnalysisId={analysis.id}
          onClose={() => setShowContinueModal(null)}
          onCreated={handleContinueCreated}
        />
      )}

      {/* Online replot — reuses FigCode's RunModal */}
      {replotModal && (
        <RunModal
          isOpen={true}
          onClose={() => setReplotModal(null)}
          title={`在线绘图 — ${replotModal.title}`}
          initialCode={replotModal.code}
          subtitle={analysis?.name ?? ''}
          replotTaskId={warmupStatus === 'ready' ? analysis.taskId : undefined}
        />
      )}

      {/* Table preview */}
      {tablePreview && (
        <TablePreviewModal
          fileName={tablePreview.name}
          fileUrl={tablePreview.url}
          onClose={() => setTablePreview(null)}
        />
      )}

      {/* Doc modal (HTML/PDF view) */}
      {docModal && <DocModal meta={docModal} onClose={() => setDocModal(null)} />}

      {/* EXPORT_SCRIPT_v1 — Script modal */}
      {scriptModal && (
        <div className="sc-modal-overlay" onClick={() => setScriptModal(null)}>
          <div
            className="sc-modal"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 760, width: '92vw' }}
          >
            <div className="sc-modal-header">
              <h2 className="sc-modal-title">💻 可复现脚本</h2>
              <button className="sc-modal-close" onClick={() => setScriptModal(null)}>
                ×
              </button>
            </div>
            <div className="sc-modal-body" style={{ minHeight: 200 }}>
              <div style={{ display: 'flex', gap: 6, marginBottom: 14, alignItems: 'center' }}>
                <span style={{ fontSize: 12, color: 'var(--biof3-text-secondary)' }}>语言：</span>
                {(['r', 'python'] as const).map((l) => (
                  <button
                    key={l}
                    className="sc-btn"
                    style={{
                      padding: '4px 12px',
                      fontSize: 12,
                      background: scriptModal.lang === l ? '#10b981' : 'transparent',
                      color: scriptModal.lang === l ? 'white' : 'inherit',
                      borderColor: scriptModal.lang === l ? '#10b981' : undefined,
                    }}
                    onClick={() => exportScript(l)}
                    disabled={scriptModal.loading}
                  >
                    {l === 'r' ? 'R (Seurat)' : 'Python (scanpy)'}
                  </button>
                ))}
                <span style={{ flex: 1 }} />
                {scriptModal.filename && (
                  <span style={{ fontSize: 11, color: 'var(--biof3-text-muted)', fontFamily: 'monospace' }}>
                    {scriptModal.filename}
                  </span>
                )}
              </div>

              {scriptModal.loading && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: 20,
                    color: 'var(--biof3-text-secondary)',
                  }}
                >
                  <div className="sc-spinner" />
                  <span>生成中...</span>
                </div>
              )}

              {scriptModal.error && (
                <div
                  style={{
                    padding: 14,
                    background: '#fef2f2',
                    border: '1px solid #fca5a5',
                    borderRadius: 8,
                    color: '#991b1b',
                    fontSize: 13,
                  }}
                >
                  生成失败：{scriptModal.error}
                </div>
              )}

              {!scriptModal.loading && scriptModal.script && (
                <>
                  <pre
                    style={{
                      padding: 14,
                      background: '#1e293b',
                      color: '#e2e8f0',
                      borderRadius: 8,
                      fontSize: 11.5,
                      lineHeight: 1.6,
                      maxHeight: 400,
                      overflowY: 'auto',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-all',
                      fontFamily: '"JetBrains Mono", "Fira Code", "SF Mono", Menlo, monospace',
                    }}
                  >
                    {scriptModal.script}
                  </pre>
                  <div
                    style={{ marginTop: 10, display: 'flex', gap: 6, justifyContent: 'flex-end' }}
                  >
                    <button
                      className="sc-btn"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(scriptModal.script!);
                          const div = document.createElement('div');
                          div.textContent = '已复制脚本';
                          div.style.cssText =
                            'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#10b981;color:white;padding:8px 14px;border-radius:8px;font-size:13px;z-index:99999';
                          document.body.appendChild(div);
                          setTimeout(() => div.remove(), 2000);
                        } catch (err) {
                          alert('复制失败');
                        }
                      }}
                    >
                      📋 复制
                    </button>
                    <button
                      className="sc-btn"
                      onClick={() => {
                        const blob = new Blob([scriptModal.script!], { type: 'text/plain' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download =
                          scriptModal.filename ||
                          'script' + (scriptModal.lang === 'python' ? '.py' : '.R');
                        a.click();
                        URL.revokeObjectURL(url);
                      }}
                    >
                      💾 下载文件
                    </button>
                  </div>
                  <div
                    style={{ marginTop: 8, fontSize: 10.5, color: 'var(--biof3-text-muted)', textAlign: 'right' }}
                  >
                    脚本包含真实参数和数据路径 · 离线可直接运行 · 请确保已安装对应 R/Python 包
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* EXPORT_REPORT_v1 — PDF result modal */}
      {reportState && (
        <div className="sc-modal-overlay" onClick={() => setReportState(null)}>
          <div
            className="sc-modal"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 480, width: '90vw' }}
          >
            <div className="sc-modal-header">
              <h2 className="sc-modal-title">📋 PDF 报告</h2>
              <button className="sc-modal-close" onClick={() => setReportState(null)}>
                ×
              </button>
            </div>
            <div className="sc-modal-body" style={{ minHeight: 160 }}>
              {reportState.loading && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: 20,
                    color: 'var(--biof3-text-secondary)',
                  }}
                >
                  <div className="sc-spinner" />
                  <div>
                    <div>AI 正在生成 PDF 报告...</div>
                    <div style={{ fontSize: 11, color: 'var(--biof3-text-muted)', marginTop: 4 }}>
                      包含数据集摘要、分析参数、图表和 Methods 段落，约 15-25 秒
                    </div>
                  </div>
                </div>
              )}
              {reportState.error && (
                <div
                  style={{
                    padding: 14,
                    background: '#fef2f2',
                    border: '1px solid #fca5a5',
                    borderRadius: 8,
                    color: '#991b1b',
                    fontSize: 13,
                  }}
                >
                  生成失败：{reportState.error}
                </div>
              )}
              {!reportState.loading && reportState.url && (
                <>
                  <div
                    style={{
                      padding: 14,
                      background: '#ecfdf5',
                      border: '1px solid #a7f3d0',
                      borderRadius: 8,
                      fontSize: 13,
                      color: '#065f46',
                      marginBottom: 12,
                    }}
                  >
                    ✅ PDF 报告已生成（
                    {reportState.sizeBytes ? Math.round(reportState.sizeBytes / 1024) : '?'} KB）
                    <br />
                    <span style={{ fontSize: 11, color: 'var(--biof3-text-secondary)' }}>
                      签名链接 24 小时内有效，可分享给同事或保存到本地。
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <a
                      className="sc-btn sc-btn-primary"
                      href={reportState.url}
                      target="_blank"
                      rel="noopener"
                    >
                      📂 打开 PDF
                    </a>
                    <a
                      className="sc-btn"
                      href={reportState.url}
                      download={`BioF3-report-${analysis?.name || 'analysis'}.pdf`}
                    >
                      💾 下载
                    </a>
                    <button
                      className="sc-btn"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(reportState.url!);
                          alert('链接已复制（24 小时内有效）');
                        } catch (err) {
                          alert('复制失败');
                        }
                      }}
                    >
                      🔗 复制链接
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* GENERATE_METHODS_v1 — Methods modal */}
      {methodsModal && (
        <div className="sc-modal-overlay" onClick={() => setMethodsModal(null)}>
          <div
            className="sc-modal"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: 720, width: '90vw' }}
          >
            <div className="sc-modal-header">
              <h2 className="sc-modal-title">📄 论文 Methods 段落</h2>
              <button className="sc-modal-close" onClick={() => setMethodsModal(null)}>
                ×
              </button>
            </div>
            <div className="sc-modal-body" style={{ minHeight: 240 }}>
              <div style={{ display: 'flex', gap: 6, marginBottom: 14, alignItems: 'center' }}>
                <span style={{ fontSize: 12, color: 'var(--biof3-text-secondary)' }}>语言：</span>
                {(['zh', 'en', 'both'] as const).map((l) => (
                  <button
                    key={l}
                    className="sc-btn"
                    style={{
                      padding: '4px 12px',
                      fontSize: 12,
                      background: methodsModal.lang === l ? '#10b981' : 'transparent',
                      color: methodsModal.lang === l ? 'white' : 'inherit',
                      borderColor: methodsModal.lang === l ? '#10b981' : undefined,
                    }}
                    onClick={() => generateMethods(l)}
                    disabled={methodsModal.loading}
                  >
                    {l === 'zh' ? '中文' : l === 'en' ? 'English' : '中英对照'}
                  </button>
                ))}
                <span style={{ flex: 1 }} />
                <span style={{ fontSize: 11, color: 'var(--biof3-text-muted)' }}>
                  基于「{analysis?.name}」及父链分析
                </span>
              </div>

              {methodsModal.loading && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: 20,
                    color: 'var(--biof3-text-secondary)',
                  }}
                >
                  <div className="sc-spinner" />
                  <span>AI 正在整理方法学描述（约 3-5 秒）...</span>
                </div>
              )}

              {methodsModal.error && (
                <div
                  style={{
                    padding: 14,
                    background: '#fef2f2',
                    border: '1px solid #fca5a5',
                    borderRadius: 8,
                    color: '#991b1b',
                    fontSize: 13,
                  }}
                >
                  生成失败：{methodsModal.error}
                  {methodsModal.error === 'no_analyses' && (
                    <div style={{ marginTop: 8, fontSize: 11, color: 'var(--biof3-text-secondary)' }}>
                      该分析及其父链中没有 done 状态的记录。等分析完成后再试。
                    </div>
                  )}
                </div>
              )}

              {!methodsModal.loading && methodsModal.text && (
                <>
                  <div
                    style={{
                      padding: 16,
                      background: '#f9fafb',
                      border: '1px solid #e5e7eb',
                      borderRadius: 8,
                      fontSize: 13.5,
                      lineHeight: 1.75,
                      whiteSpace: 'pre-wrap',
                      fontFamily: 'system-ui, -apple-system, sans-serif',
                      maxHeight: 360,
                      overflowY: 'auto',
                    }}
                  >
                    {methodsModal.text}
                  </div>
                  <div
                    style={{ marginTop: 10, display: 'flex', gap: 6, justifyContent: 'flex-end' }}
                  >
                    <button
                      className="sc-btn"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(methodsModal.text);
                          const div = document.createElement('div');
                          div.textContent = '已复制 Methods 段落';
                          div.style.cssText =
                            'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#10b981;color:white;padding:8px 14px;border-radius:8px;font-size:13px;z-index:99999';
                          document.body.appendChild(div);
                          setTimeout(() => div.remove(), 2000);
                        } catch (err) {
                          alert('复制失败，请手动选中文字');
                        }
                      }}
                    >
                      📋 复制
                    </button>
                    <button
                      className="sc-btn"
                      onClick={() => generateMethods(methodsModal.lang)}
                      disabled={methodsModal.loading}
                    >
                      🔄 重新生成
                    </button>
                  </div>
                  <div
                    style={{ marginTop: 10, fontSize: 10.5, color: 'var(--biof3-text-muted)', textAlign: 'right' }}
                  >
                    AI 生成 · 学术风格 · 引用 Seurat / scanpy / Leiden 等版本号 ·
                    仅供参考，请核对参数后使用
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

// ============================================================
// Right info panel (FigCode-style) — supports plot OR file metadata
// ============================================================

// ============================================================
// Helper: extract top markers per cluster from analysis results
// ============================================================

function _extractTopMarkers(
  results: Record<string, any>
): Record<string, string[]> | undefined {
  if (!results?.summary?.clusters) return undefined;
  const out: Record<string, string[]> = {};
  for (const c of results.summary.clusters) {
    if (c.id != null && Array.isArray(c.topMarkers)) {
      out[String(c.id)] = c.topMarkers.slice(0, 5);
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

interface PanelTarget {
  kind: 'plot' | 'file' | 'none';
  meta: PlotMeta | FileMeta | null;
  plot: PlotItem | null;
  file: { name: string; url: string; description?: string } | null;
}

function RightInfoPanel({
  target,
  analysisId,
  onShowDoc,
}: {
  target: PanelTarget;
  analysisId: string;
  onShowDoc: (meta: Record<string, unknown>) => void;
}) {
  if (target.kind === 'none' || (!target.plot && !target.file)) {
    return (
      <aside className="sc-info-panel">
        <div className="sc-info-empty">
          <p>点击卡片查看详细介绍</p>
        </div>
      </aside>
    );
  }

  const meta = target.meta;
  const fallbackName = target.plot?.name || target.file?.name || '';
  const commentPath = `/single-cell/${analysisId}/${target.plot?.filename || target.file?.name || fallbackName}`;

  return (
    <aside className="sc-info-panel">
      <div className="sc-info-content">
        {meta ? (
          <>
            <span className="sc-info-badge">{meta.category}</span>
            <h3 className="sc-info-title">{meta.title}</h3>
            <p className="sc-info-subtitle">{meta.subtitle}</p>

            <div className="sc-info-section">
              <strong>解决的生物学问题</strong>
              <p>{meta.biologicalQuestion}</p>
            </div>

            <div className="sc-info-section">
              <strong>应用场景</strong>
              <ul className="sc-info-list">
                {meta.scenarios.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </div>

            <div className="sc-info-section">
              <strong>{target.kind === 'file' ? '内容字段' : '输入格式'}</strong>
              <p>{meta.inputFormat}</p>
            </div>

            <div className="sc-info-section">
              <strong>{target.kind === 'file' ? '关键字段' : '关键参数'}</strong>
              <ul className="sc-info-param-list">
                {meta.keyParams.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            </div>

            <div className="sc-info-section">
              <strong>依赖包</strong>
              <div className="sc-info-pkg-list">
                {meta.packages.length > 0 ? (
                  meta.packages.map((pkg) => (
                    <span key={pkg} className="sc-info-pkg-tag">
                      {pkg}
                    </span>
                  ))
                ) : (
                  <span style={{ fontSize: 11, color: 'var(--biof3-text-muted)' }}>无</span>
                )}
              </div>
            </div>

            <div className="sc-info-section">
              <button
                className="sc-btn sc-btn-sm"
                style={{ width: '100%' }}
                onClick={() =>
                  onShowDoc({
                    ...meta,
                    imageUrl: target.plot?.url,
                  })
                }
              >
                查看完整文档
              </button>
            </div>
          </>
        ) : (
          <>
            <h3 className="sc-info-title">{fallbackName}</h3>
            <p className="sc-info-subtitle">{target.plot?.filename || target.file?.name}</p>
            <div className="sc-info-section">
              <p style={{ color: 'var(--biof3-text-muted)' }}>暂无该项的详细介绍。</p>
            </div>
          </>
        )}
      </div>
    </aside>
  );
}
