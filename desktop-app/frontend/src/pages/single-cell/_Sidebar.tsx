import React, { useState, useEffect, useCallback, useMemo } from 'react';
import type { Project, Dataset, Analysis } from './_types';
import { STATUS_LABELS } from './_types';
import { listProjects, listDatasetsByProject, listAnalysesByDataset, getDataset } from './_store';
import type { Route } from './_router';
import { QuotaIndicator } from './_QuotaIndicator';

interface SidebarProps {
  navigate: (r: Route) => void;
  /** Current context IDs for highlighting */
  activeProjectId?: string;
  activeDatasetId?: string;
  activeAnalysisId?: string;
  /** When true, sidebar is collapsed (only show toggle button) */
  collapsed?: boolean;
  /** Click handler for the collapse toggle button */
  onToggleCollapse?: () => void;
  /** Sidebar width in px */
  width?: number;
  /** Mouse down handler for resize drag */
  onResizeStart?: (e: React.MouseEvent) => void;
  /** When true, slide in as a mobile drawer (≤768px only) */
  mobileOpen?: boolean;
}

export function Sidebar({
  navigate,
  activeProjectId,
  activeDatasetId,
  activeAnalysisId,
  collapsed,
  onToggleCollapse,
  width,
  onResizeStart,
  mobileOpen,
}: SidebarProps) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [expandedProject, setExpandedProject] = useState<string | null>(activeProjectId || null);
  const [datasets, setDatasets] = useState<Dataset[]>([]);
  const [loadingDs, setLoadingDs] = useState(false);
  const [activeDataset, setActiveDataset] = useState<Dataset | null>(null);

  // Dataset-focused mode: analyses for the active dataset
  const [analyses, setAnalyses] = useState<Analysis[]>([]);
  const [loadingAn, setLoadingAn] = useState(false);

  // Project tree mode: all analyses grouped by dataset
  const [allAnalyses, setAllAnalyses] = useState<Record<string, Analysis[]>>({});
  const [loadingAllAn, setLoadingAllAn] = useState(false);

  // Load projects on mount
  useEffect(() => {
    listProjects()
      .then((ps) => {
        setProjects(ps);
        // Auto-expand first project if none is active
        if (ps.length > 0 && !expandedProject && !activeProjectId) {
          setExpandedProject(ps[0].id);
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load active dataset info (to know if it has a parent)
  useEffect(() => {
    if (!activeDatasetId) {
      setActiveDataset(null);
      return;
    }
    getDataset(activeDatasetId)
      .then((ds) => setActiveDataset(ds))
      .catch(() => {});
  }, [activeDatasetId]);

  // Auto-expand active project
  useEffect(() => {
    if (activeProjectId && activeProjectId !== expandedProject) {
      setExpandedProject(activeProjectId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProjectId]);

  // Load datasets when a project is expanded (or when in dataset-focused mode)
  useEffect(() => {
    const projectId = expandedProject || activeProjectId;
    if (!projectId) {
      setDatasets([]);
      return;
    }
    setLoadingDs(true);
    listDatasetsByProject(projectId)
      .then((ds) => {
        setDatasets(ds);
        setLoadingDs(false);
      })
      .catch(() => setLoadingDs(false));
  }, [expandedProject, activeProjectId]);

  // Dataset-focused mode: load analyses for active dataset
  useEffect(() => {
    if (!activeDatasetId) {
      setAnalyses([]);
      return;
    }
    setLoadingAn(true);
    listAnalysesByDataset(activeDatasetId)
      .then((a) => {
        setAnalyses(a);
        setLoadingAn(false);
      })
      .catch(() => setLoadingAn(false));
  }, [activeDatasetId]);

  // Project tree mode: load ALL analyses for all datasets when project is expanded
  useEffect(() => {
    if (activeDatasetId) return; // Skip in dataset-focused mode
    if (datasets.length === 0) {
      setAllAnalyses({});
      return;
    }
    setLoadingAllAn(true);
    const rootDatasets = datasets.filter((d) => !d.parentDatasetId);
    Promise.all(
      rootDatasets.map((d) =>
        listAnalysesByDataset(d.id)
          .then((a) => ({ dsId: d.id, analyses: a }))
          .catch(() => ({ dsId: d.id, analyses: [] }))
      )
    ).then((results) => {
      const map: Record<string, Analysis[]> = {};
      results.forEach((r) => {
        map[r.dsId] = r.analyses;
      });
      setAllAnalyses(map);
      setLoadingAllAn(false);
    });
  }, [datasets, activeDatasetId]);

  // Derived: child datasets of the active dataset
  const childDatasets = useMemo(() => {
    if (!activeDatasetId) return [];
    return datasets.filter((d) => d.parentDatasetId === activeDatasetId);
  }, [datasets, activeDatasetId]);

  // Is the active dataset a child (subset)?
  const isChildDataset = activeDataset?.parentDatasetId != null;
  const parentDataset = useMemo(() => {
    if (!isChildDataset || !activeDataset) return null;
    return datasets.find((d) => d.id === activeDataset.parentDatasetId) || null;
  }, [datasets, activeDataset, isChildDataset]);

  const handleProjectClick = useCallback(
    (id: string) => {
      if (expandedProject === id) {
        navigate({ name: 'project', projectId: id });
      } else {
        setExpandedProject(id);
      }
    },
    [expandedProject, navigate]
  );

  return (
    <nav
      className={`sc-sidebar ${collapsed ? 'sc-sidebar-collapsed' : ''} ${mobileOpen ? 'is-mobile-open' : ''}`}
      style={!collapsed && width ? { width } : undefined}
    >
      {/* Collapse toggle + resize handle */}
      {onToggleCollapse && (
        <div
          className="sc-sidebar-toggle"
          onMouseDown={onResizeStart}
          onDoubleClick={onToggleCollapse}
          title={collapsed ? '展开导航' : '拖拽调整宽度 · 双击收起'}
        >
          {collapsed ? '▸' : '⋮'}
        </div>
      )}

      {collapsed ? null : activeDatasetId ? (
        <>
          {/* Dataset-focused mode */}
          {isChildDataset && parentDataset ? (
            <button
              className="sc-sidebar-home"
              onClick={() => navigate({ name: 'dataset', datasetId: parentDataset.id })}
            >
              ◂ 返回父数据集
            </button>
          ) : (
            <button
              className="sc-sidebar-home"
              onClick={() =>
                activeProjectId
                  ? navigate({ name: 'project', projectId: activeProjectId })
                  : navigate({ name: 'projects' })
              }
            >
              ◂ 返回项目
            </button>
          )}

          {/* Current dataset name */}
          {activeDataset && (
            <div className="sc-sidebar-section">
              <div
                className="sc-sidebar-label"
                style={{ fontWeight: 700, color: '#1e293b', fontSize: 12 }}
              >
                {activeDataset.name}
              </div>
              {isChildDataset && (
                <div className="sc-sidebar-hint" style={{ fontSize: 10, color: '#9ca3af' }}>
                  子集 · 来自 {parentDataset?.name || '父数据集'}
                </div>
              )}
            </div>
          )}

          <div className="sc-sidebar-section">
            <div className="sc-sidebar-label">分析记录</div>
            {loadingAn && <div className="sc-sidebar-hint">加载中...</div>}
            {!loadingAn && analyses.length === 0 && <div className="sc-sidebar-hint">暂无分析</div>}
            {analyses
              .filter((a) => !a.parentAnalysisId)
              .map((a) => (
                <button
                  key={a.id}
                  className={`sc-sidebar-item ${a.id === activeAnalysisId ? 'active' : ''}`}
                  onClick={() => navigate({ name: 'result', analysisId: a.id })}
                  title={a.name}
                >
                  <span
                    className="sc-sidebar-item-icon"
                    style={{ color: STATUS_LABELS[a.status].color }}
                  >
                    ●
                  </span>
                  <span className="sc-sidebar-item-text">{a.name}</span>
                </button>
              ))}
            {analyses
              .filter(
                (a) => a.parentAnalysisId && analyses.some((p) => p.id === a.parentAnalysisId)
              )
              .map((a) => (
                <button
                  key={a.id}
                  className={`sc-sidebar-item sc-sidebar-item-nested ${a.id === activeAnalysisId ? 'active' : ''}`}
                  onClick={() => navigate({ name: 'result', analysisId: a.id })}
                  title={a.name}
                  style={{ marginLeft: 16 }}
                >
                  <span className="sc-sidebar-item-icon">↳</span>
                  <span className="sc-sidebar-item-text">{a.name}</span>
                </button>
              ))}
            {analyses
              .filter(
                (a) => a.parentAnalysisId && !analyses.some((p) => p.id === a.parentAnalysisId)
              )
              .map((a) => (
                <button
                  key={a.id}
                  className={`sc-sidebar-item ${a.id === activeAnalysisId ? 'active' : ''}`}
                  onClick={() => navigate({ name: 'result', analysisId: a.id })}
                  title={a.name}
                >
                  <span
                    className="sc-sidebar-item-icon"
                    style={{ color: STATUS_LABELS[a.status].color }}
                  >
                    ●
                  </span>
                  <span className="sc-sidebar-item-text">{a.name}</span>
                </button>
              ))}
          </div>

          {/* Child datasets (subsets) */}
          {childDatasets.length > 0 && (
            <div className="sc-sidebar-section">
              <div className="sc-sidebar-label">子集 ({childDatasets.length})</div>
              {childDatasets.map((d) => (
                <button
                  key={d.id}
                  className={`sc-sidebar-item sc-sidebar-item-nested`}
                  onClick={() => navigate({ name: 'dataset', datasetId: d.id })}
                  title={d.name}
                >
                  <span className="sc-sidebar-item-icon">↳</span>
                  <span className="sc-sidebar-item-text">{d.name}</span>
                </button>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          {/* Home link */}
          <button className="sc-sidebar-home" onClick={() => navigate({ name: 'projects' })}>
            ◆ 所有项目
          </button>

          {/* Projects tree — fully expanded when project is clicked */}
          <div className="sc-sidebar-section">
            <div className="sc-sidebar-label">项目</div>
            {projects.map((p) => (
              <div key={p.id}>
                <button
                  className={`sc-sidebar-item ${p.id === activeProjectId ? 'active' : ''}`}
                  onClick={() => handleProjectClick(p.id)}
                  title={p.name}
                >
                  <span className="sc-sidebar-item-icon">
                    {expandedProject === p.id ? '▾' : '▸'}
                  </span>
                  <span className="sc-sidebar-item-text">{p.name}</span>
                </button>

                {/* All content auto-expanded under project */}
                {expandedProject === p.id && (
                  <div className="sc-sidebar-nested">
                    {loadingDs && <div className="sc-sidebar-hint">加载中...</div>}
                    {!loadingDs && datasets.length === 0 && (
                      <div className="sc-sidebar-hint">暂无数据集</div>
                    )}
                    {datasets
                      .filter((d) => !d.parentDatasetId)
                      .map((d) => {
                        const dsAnalyses = allAnalyses[d.id] || [];
                        const dsSubsets = datasets.filter((cd) => cd.parentDatasetId === d.id);
                        const hasDoneAnalysis = dsAnalyses.some(
                          (a) =>
                            (a.type === 'scrna_standard' || a.type === 'recluster') &&
                            a.status === 'done'
                        );
                        return (
                          <div key={d.id}>
                            {/* Dataset name — only navigable if has completed standard analysis */}
                            <button
                              className={`sc-sidebar-item sc-sidebar-item-nested ${d.id === activeDatasetId ? 'active' : ''} ${!hasDoneAnalysis ? 'sc-sidebar-item-disabled' : ''}`}
                              onClick={() =>
                                hasDoneAnalysis
                                  ? navigate({ name: 'dataset', datasetId: d.id })
                                  : undefined
                              }
                              title={hasDoneAnalysis ? d.name : `${d.name}（需先完成标准分析）`}
                              style={
                                !hasDoneAnalysis ? { opacity: 0.5, cursor: 'default' } : undefined
                              }
                            >
                              <span className="sc-sidebar-item-icon">
                                {hasDoneAnalysis ? '·' : '○'}
                              </span>
                              <span className="sc-sidebar-item-text">{d.name}</span>
                            </button>

                            {/* Analyses under this dataset (auto-expanded) */}
                            {(dsAnalyses.length > 0 || dsSubsets.length > 0) && (
                              <div className="sc-sidebar-nested">
                                {loadingAllAn && dsAnalyses.length === 0 && (
                                  <div className="sc-sidebar-hint">加载中...</div>
                                )}
                                {dsAnalyses
                                  .filter((a) => !a.parentAnalysisId)
                                  .map((a) => (
                                    <button
                                      key={a.id}
                                      className={`sc-sidebar-item sc-sidebar-item-deep ${a.id === activeAnalysisId ? 'active' : ''}`}
                                      onClick={() => navigate({ name: 'result', analysisId: a.id })}
                                      title={a.name}
                                    >
                                      <span
                                        className="sc-sidebar-item-icon"
                                        style={{ color: STATUS_LABELS[a.status].color }}
                                      >
                                        ●
                                      </span>
                                      <span className="sc-sidebar-item-text">{a.name}</span>
                                    </button>
                                  ))}
                                {dsAnalyses
                                  .filter((a) => a.parentAnalysisId)
                                  .map((a) => (
                                    <button
                                      key={a.id}
                                      className={`sc-sidebar-item sc-sidebar-item-deep ${a.id === activeAnalysisId ? 'active' : ''}`}
                                      onClick={() => navigate({ name: 'result', analysisId: a.id })}
                                      title={a.name}
                                      style={{ marginLeft: 16 }}
                                    >
                                      <span className="sc-sidebar-item-icon">↳</span>
                                      <span className="sc-sidebar-item-text">{a.name}</span>
                                    </button>
                                  ))}
                                {/* Subsets */}
                                {dsSubsets.map((cd) => (
                                  <button
                                    key={cd.id}
                                    className={`sc-sidebar-item sc-sidebar-item-deep ${cd.id === activeDatasetId ? 'active' : ''}`}
                                    onClick={() => navigate({ name: 'dataset', datasetId: cd.id })}
                                    title={`子集: ${cd.name}`}
                                    style={{ marginLeft: 16 }}
                                  >
                                    <span className="sc-sidebar-item-icon">↳</span>
                                    <span className="sc-sidebar-item-text">{cd.name}</span>
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                  </div>
                )}
              </div>
            ))}
            {projects.length === 0 && <div className="sc-sidebar-hint">暂无项目</div>}
          </div>
        </>
      )}

      {/* User info + logout moved to global navbar (src/components/auth/UserMenu.tsx).
          Storage / analysis quota lives here in the sidebar — single-cell only. */}
      {!collapsed && <QuotaIndicator />}
    </nav>
  );
}
