// ============================================================
// /spatial Sidebar
//
// 与 /single-cell `_Sidebar.tsx` 同构，仅做两处改动：
//   1) 项目列表走 spatial `_store` 的 listProjects（仅 modality='spatial'）
//   2) Route 类型来自 spatial `_router`
// 其他完全沿用——Quota / Sidebar collapse / Mobile drawer hooks 共享。
// ============================================================

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import type { Project, Dataset, Analysis } from './_types';
import { STATUS_LABELS } from './_types';
// spatial 专属：listProjects 走 modality 过滤；其他 CRUD 复用 single-cell 共享端点
import { listProjects, listDatasetsByProject, listAnalysesByDataset, getDataset } from './_store';
import type { Route } from './_router';
// QuotaIndicator 跨模态共享
import { QuotaIndicator } from '../single-cell/_QuotaIndicator';

interface SidebarProps {
  navigate: (r: Route) => void;
  activeProjectId?: string;
  activeDatasetId?: string;
  activeAnalysisId?: string;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  width?: number;
  onResizeStart?: (e: React.MouseEvent) => void;
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

  const [analyses, setAnalyses] = useState<Analysis[]>([]);
  const [loadingAn, setLoadingAn] = useState(false);

  const [allAnalyses, setAllAnalyses] = useState<Record<string, Analysis[]>>({});
  const [loadingAllAn, setLoadingAllAn] = useState(false);

  useEffect(() => {
    listProjects()
      .then((ps) => {
        setProjects(ps);
        if (ps.length > 0 && !expandedProject && !activeProjectId) {
          setExpandedProject(ps[0].id);
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!activeDatasetId) {
      setActiveDataset(null);
      return;
    }
    getDataset(activeDatasetId)
      .then((ds) => setActiveDataset(ds))
      .catch(() => {});
  }, [activeDatasetId]);

  useEffect(() => {
    if (activeProjectId && activeProjectId !== expandedProject) {
      setExpandedProject(activeProjectId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProjectId]);

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

  useEffect(() => {
    if (activeDatasetId) return;
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

  const childDatasets = useMemo(() => {
    if (!activeDatasetId) return [];
    return datasets.filter((d) => d.parentDatasetId === activeDatasetId);
  }, [datasets, activeDatasetId]);

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
          </div>

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
          <button className="sc-sidebar-home" onClick={() => navigate({ name: 'projects' })}>
            ◆ 所有项目
          </button>

          <div className="sc-sidebar-section">
            <div className="sc-sidebar-label">空间组学项目</div>
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
                        // W3-A：spatial 任务派发 W3-B 上线，先按"有任意完成的分析才可点"判断
                        const hasDoneAnalysis = dsAnalyses.some((a) => a.status === 'done');
                        return (
                          <div key={d.id}>
                            <button
                              className={`sc-sidebar-item sc-sidebar-item-nested ${d.id === activeDatasetId ? 'active' : ''} ${!hasDoneAnalysis ? 'sc-sidebar-item-disabled' : ''}`}
                              onClick={() =>
                                hasDoneAnalysis
                                  ? navigate({ name: 'dataset', datasetId: d.id })
                                  : undefined
                              }
                              title={hasDoneAnalysis ? d.name : `${d.name}（暂无完成的分析）`}
                              style={
                                !hasDoneAnalysis ? { opacity: 0.5, cursor: 'default' } : undefined
                              }
                            >
                              <span className="sc-sidebar-item-icon">
                                {hasDoneAnalysis ? '·' : '○'}
                              </span>
                              <span className="sc-sidebar-item-text">{d.name}</span>
                            </button>

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

      {!collapsed && <QuotaIndicator />}
    </nav>
  );
}
