/**
 * DesktopDashboard — 桌面版首页工作台
 *
 * 取代 Web 版的营销首页，提供软件化的启动体验：
 * - 最近运行任务（从 /tools/history API 拉取）
 * - 结果与项目入口（常用结果一键回看）
 * - 推荐教程 / 学习进度
 * - 全局搜索快捷方式
 */

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getToken, getApiPrefix, getStoredUser, isLoggedIn } from '@/lib/authClient';
import { Icon } from '@/components/icons/Icon';
import { tools } from '@/pages/_data';
import { useBackendStatus } from '@/components/backend/BackendStatusProvider';
import { useAutoUpdate } from '@/hooks/useAutoUpdate';
import { listProjects, createProject } from '@/lib/project-store';
import type { Project } from '@/lib/project-types';
import styles from './_desktop-dashboard.module.css';

interface Job {
  id: string;
  tool_id: string;
  status: string;
  created_at: number;
  completed_at?: number;
  error?: string;
  name?: string;
  project_id?: string | null;
}

/**
 * 2.3 — 将 job 列表按时间段分组（今天/昨天/本周/更早）
 */
function groupJobsByTime(jobs: Job[]): { label: string; jobs: Job[] }[] {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const yesterdayStart = todayStart - 86_400_000;
  const weekStart = todayStart - 7 * 86_400_000;

  const buckets: { label: string; jobs: Job[] }[] = [
    { label: '今天', jobs: [] },
    { label: '昨天', jobs: [] },
    { label: '本周', jobs: [] },
    { label: '更早', jobs: [] },
  ];

  for (const job of jobs) {
    const ts = job.created_at;
    if (ts >= todayStart) buckets[0].jobs.push(job);
    else if (ts >= yesterdayStart) buckets[1].jobs.push(job);
    else if (ts >= weekStart) buckets[2].jobs.push(job);
    else buckets[3].jobs.push(job);
  }

  return buckets.filter((b) => b.jobs.length > 0);
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const now = Date.now();
  const diff = now - d.getTime();
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

function formatProjectTime(ts?: string): string {
  if (!ts) return '刚创建';
  const time = new Date(ts).getTime();
  if (Number.isNaN(time)) return '最近更新';
  return formatTime(time);
}

function statusLabel(s: string): string {
  const map: Record<string, string> = {
    completed: '已完成',
    failed: '失败',
    running: '运行中',
    pending: '排队中',
    uploading: '提交中',
  };
  return map[s] || s;
}

function statusClass(s: string): string {
  if (s === 'completed') return styles.statusCompleted;
  if (s === 'failed') return styles.statusFailed;
  if (s === 'running' || s === 'pending' || s === 'uploading') return styles.statusRunning;
  return '';
}

export function DesktopDashboard({
  embedded = false,
  activeProject = null,
}: {
  embedded?: boolean;
  activeProject?: Project | null;
} = {}): React.ReactElement {
  const [recentJobs, setRecentJobs] = useState<Job[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(true);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [showNewProject, setShowNewProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectDesc, setNewProjectDesc] = useState('');
  const [creatingProject, setCreatingProject] = useState(false);
  const [dataDir, setDataDir] = useState<string>('');
  // §7 useAutoUpdate: all update state consolidated in hook
  const [updOpen, setUpdOpen] = useState(false);
  const {
    available: hasUpdate,
    availableVersion: updateVersion,
    downloading: updDownloading,
    progress: updProgress,
    downloaded: updDownloaded,
    error: updError,
    installing: updInstalling,
    download,
    install,
  } = useAutoUpdate();
  // M2-8：备份/导出闭环
  const [exporting, setExporting] = useState(false);
  const [exportMsg, setExportMsg] = useState('');
  const user = getStoredUser();
  const backendStatus = useBackendStatus();
  const navigate = useNavigate();

  const fetchRecentJobs = useCallback(async () => {
    if (!isLoggedIn()) {
      setLoadingJobs(false);
      return;
    }
    try {
      const token = getToken();
      const resp = await fetch(getApiPrefix() + '/tools/history', {
        headers: token ? { Authorization: 'Bearer ' + token } : {},
      });
      const data = await resp.json();
      if (data.ok) {
        // 只取最近 6 条
        setRecentJobs((data.jobs || []).slice(0, 6));
      }
    } catch {
      // ignore
    } finally {
      setLoadingJobs(false);
    }
  }, []);

  const fetchProjects = useCallback(async () => {
    try {
      const list = await listProjects();
      setProjects(list);
    } catch {
      // ignore — may not be logged in
    } finally {
      setLoadingProjects(false);
    }
  }, []);

  const handleCreateProject = useCallback(async () => {
    if (!newProjectName.trim()) return;
    setCreatingProject(true);
    try {
      const p = await createProject({
        name: newProjectName.trim(),
        description: newProjectDesc.trim() || undefined,
        modality: 'general',
      });
      setProjects((prev) => [p, ...prev]);
      setShowNewProject(false);
      setNewProjectName('');
      setNewProjectDesc('');
      navigate(`/project/${p.id}`);
    } catch (e) {
      // ignore
    } finally {
      setCreatingProject(false);
    }
  }, [newProjectName, newProjectDesc, navigate]);

  // M2-1：拉数据目录信息
  useEffect(() => {
    (async () => {
      try {
        const info = await window.biof3Desktop?.data?.info();
        if (info?.ok && info.dataDir) setDataDir(info.dataDir);
      } catch {
        // ignore
      }
    })();
  }, []);

  // M2-8：导出我的数据（zip 打包整个数据目录 + 日志）
  const handleExportData = useCallback(async () => {
    if (exporting) return;
    setExporting(true);
    setExportMsg('');
    try {
      const r = await window.biof3Desktop?.diagnostic?.export();
      if (r?.ok) {
        setExportMsg(`已导出到：${r.path}`);
      } else {
        setExportMsg(r?.error === 'cancelled' ? '已取消' : `导出失败：${r?.error || '未知错误'}`);
      }
    } catch (e: unknown) {
      setExportMsg(`导出失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setExporting(false);
      // 3 秒后清空消息
      setTimeout(() => setExportMsg(''), 3000);
    }
  }, [exporting]);

  useEffect(() => {
    fetchRecentJobs();
    const id = setInterval(fetchRecentJobs, 30_000);
    return () => clearInterval(id);
  }, [fetchRecentJobs]);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  const sortedProjects = useMemo(
    () =>
      [...projects].sort((a, b) => {
        const bt = new Date(b.updatedAt || b.createdAt || 0).getTime();
        const at = new Date(a.updatedAt || a.createdAt || 0).getTime();
        return bt - at;
      }),
    [projects]
  );
  const recentProject = sortedProjects[0] || null;
  const runningJobs = useMemo(
    () => recentJobs.filter((job) => ['running', 'pending', 'uploading'].includes(job.status)).length,
    [recentJobs]
  );
  const focusProject = activeProject || recentProject;
  const focusProjectJobs = useMemo(
    () =>
      focusProject
        ? recentJobs.filter((job) => job.project_id === focusProject.id)
        : [],
    [focusProject, recentJobs]
  );
  const focusProjectRunning = focusProjectJobs.filter((job) =>
    ['running', 'pending', 'uploading'].includes(job.status)
  ).length;
  const focusProjectDone = focusProjectJobs.filter((job) => job.status === 'completed').length;
  const latestFocusJob = focusProjectJobs[0] || null;
  const handleOpenScheduled = useCallback(() => {
    const targetProject = focusProject || sortedProjects[0] || null;
    if (targetProject) {
      navigate(`/project/${targetProject.id}?mode=scheduled`);
      return;
    }
    navigate('/tools');
  }, [focusProject, navigate, sortedProjects]);

  const runtimeLoading = !backendStatus.isReady && !backendStatus.downReason;
  const runtimeState = (installed: boolean) => {
    if (runtimeLoading) return 'loading';
    return installed ? 'ready' : 'missing';
  };
  const runtimeLabel = (name: string, installed: boolean) => {
    if (runtimeLoading) return `${name} 检测中…`;
    return installed ? `${name} 已就绪` : `${name} 未安装`;
  };
  const runtimeChipLabel = (name: string, installed: boolean) => {
    if (runtimeLoading) return `${name} 检测中…`;
    return installed ? '已就绪' : '未安装';
  };

  return (
    <div className={`${styles.dashboard} ${embedded ? styles.dashboardEmbedded : ''}`}>
      <div className={`${styles.commandRow} ${embedded ? styles.commandRowEmbedded : ''}`}>
        <span
          className={`${styles.commandChip} ${styles.runtimeChip}`}
          data-state={runtimeState(backendStatus.rRuntime)}
          title={runtimeLabel('R 运行时', backendStatus.rRuntime)}
        >
          <span className={styles.runtimeChipDot} data-state={runtimeState(backendStatus.rRuntime)} />
          <strong>R</strong>
          <span>{runtimeChipLabel('R', backendStatus.rRuntime)}</span>
        </span>
        <span
          className={`${styles.commandChip} ${styles.runtimeChip}`}
          data-state={runtimeState(backendStatus.pyRuntime)}
          title={runtimeLabel('Python 运行时', backendStatus.pyRuntime)}
        >
          <span className={styles.runtimeChipDot} data-state={runtimeState(backendStatus.pyRuntime)} />
          <strong>Python</strong>
          <span>{runtimeChipLabel('Python', backendStatus.pyRuntime)}</span>
        </span>
        <span className={styles.commandChip}>
          <Icon name="folder" size={14} />
          <strong>{sortedProjects.length}</strong>
          <span>项目</span>
        </span>
        <button type="button" className={styles.commandChipBtn} onClick={handleOpenScheduled}>
          <Icon name="clock" size={14} />
          <strong>{runningJobs}</strong>
          <span>运行中</span>
        </button>
        {dataDir && (
          <button
            type="button"
            className={styles.commandChipBtn}
            onClick={() => window.biof3Desktop?.data?.openDir()}
            title={dataDir}
          >
            <Icon name="folder" size={14} />
            <span className={styles.commandPath}>{dataDir}</span>
          </button>
        )}
        <button
          type="button"
          className={styles.commandChipBtn}
          onClick={handleExportData}
          disabled={exporting}
          title="将数据目录（数据库 + 结果 + 上传文件）打包成 zip 导出"
        >
          <Icon name="download" size={14} />
          <span>{exporting ? '导出中…' : '导出数据'}</span>
        </button>
        {hasUpdate && (
          <button
            type="button"
            className={`${styles.commandChipBtn} ${styles.commandChipWarn}`}
            onClick={() => setUpdOpen(true)}
            title={`有新版本 ${updateVersion}，点击下载并打开安装包`}
          >
            <Icon name="download" size={14} />
            <span>更新 {updateVersion || ''}</span>
          </button>
        )}
        {exportMsg && <span className={styles.commandNotice} title={exportMsg}>{exportMsg}</span>}
      </div>

      <div className={`${styles.workspaceGrid} ${embedded ? styles.workspaceGridEmbedded : ''}`}>
        <div className={styles.primaryCol}>
          {focusProject && (
            <section className={`${styles.heroPanel} ${embedded ? styles.heroPanelEmbedded : ''}`}>
              <div className={styles.heroMain}>
                <div className={styles.heroBadge}>{embedded ? '当前项目' : '最近项目'}</div>
                <h2 className={styles.heroTitle}>{focusProject.name}</h2>
                <p className={styles.heroDesc}>
                  {focusProject.description || '继续这个项目中的对话、结果浏览和后续分析。'}
                </p>
                <div className={styles.heroMeta}>
                  <span>{focusProject.modality || 'general'}</span>
                  <span>最近更新 {formatProjectTime(focusProject.updatedAt)}</span>
                  {focusProject.workspacePath ? <span>{focusProject.workspacePath}</span> : null}
                </div>
              </div>
              <div className={styles.heroAside}>
                <div className={styles.heroStats}>
                  <div className={styles.heroStat}>
                    <span>最近任务</span>
                    <strong>{focusProjectJobs.length}</strong>
                  </div>
                  <div className={styles.heroStat}>
                    <span>运行中</span>
                    <strong>{focusProjectRunning}</strong>
                  </div>
                  <div className={styles.heroStat}>
                    <span>已完成</span>
                    <strong>{focusProjectDone}</strong>
                  </div>
                </div>
                <div className={styles.heroLatest}>
                  <span className={styles.heroLatestLabel}>最新分析</span>
                  <strong className={styles.heroLatestTitle}>
                    {latestFocusJob?.name || latestFocusJob?.tool_id || '还没有分析记录'}
                  </strong>
                  <span className={styles.heroLatestMeta}>
                    {latestFocusJob ? `${statusLabel(latestFocusJob.status)} · ${formatTime(latestFocusJob.created_at)}` : '从对话或工具开始第一次运行'}
                  </span>
                </div>
                <div className={styles.heroActions}>
                  <button
                    className={styles.primaryBtn}
                    onClick={() => navigate(`/project/${focusProject.id}?mode=chat`)}
                  >
                    <Icon name="arrow-right" size={16} />
                    <span>继续工作</span>
                  </button>
                  <button
                    className={styles.secondaryBtn}
                    onClick={() => navigate(`/project/${focusProject.id}?mode=scheduled`)}
                  >
                    <Icon name="clock" size={15} />
                    <span>分析记录</span>
                  </button>
                </div>
              </div>
            </section>
          )}

          <section className={styles.panel}>
            <div className={styles.sectionHeader}>
              <h2 className={styles.sectionTitle}>
                <Icon name="folder" size={18} />
                项目
              </h2>
              <button type="button" className={styles.secondaryBtn} onClick={() => setShowNewProject(true)}>
                <Icon name="plus" size={14} />
                <span>新建项目</span>
              </button>
            </div>

            {loadingProjects ? (
              <div className={styles.emptyState}><p>加载中…</p></div>
            ) : sortedProjects.length === 0 ? (
              <div className={styles.emptyState}>
                <p>还没有项目，先创建一个工作区吧。</p>
                <button className={styles.emptyCta} onClick={() => setShowNewProject(true)}>
                  创建第一个项目
                </button>
              </div>
            ) : (
              <div className={styles.projectList}>
                {sortedProjects.map((p) => (
                  <Link key={p.id} className={styles.projectRow} to={`/project/${p.id}`} title={p.description || p.name}>
                    <div className={styles.projectRowIcon}>
                      <Icon name="folder" size={18} />
                    </div>
                    <div className={styles.projectRowBody}>
                      <div className={styles.projectRowTitle}>{p.name}</div>
                      <div className={styles.projectRowMeta}>
                        <span>{p.description || p.modality || '一般分析'}</span>
                        <span>更新于 {formatProjectTime(p.updatedAt)}</span>
                        {p.workspacePath ? <span>{p.workspacePath}</span> : null}
                      </div>
                    </div>
                    <span className={styles.projectRowAction}>打开</span>
                  </Link>
                ))}
              </div>
            )}
          </section>

          <section className={styles.panel}>
            <div className={styles.sectionHeader}>
              <h2 className={styles.sectionTitle}>
                <Icon name="clock" size={18} />
                最近活动
              </h2>
              <Link className={styles.sectionLink} to="/tools">
                查看全部
              </Link>
            </div>
            {loadingJobs ? (
              <div className={styles.emptyState}>
                <div className={styles.spinner} />
                加载中…
              </div>
            ) : recentJobs.length === 0 ? (
              <div className={styles.emptyState}>
                <p>暂无运行记录</p>
                <Link className={styles.emptyCta} to="/tools">
                  去结果工作区开始第一次分析
                </Link>
              </div>
            ) : (
              <div className={styles.timeline}>
                {groupJobsByTime(recentJobs).map((group) => (
                  <div key={group.label} className={styles.timelineGroup}>
                    <div className={styles.timelineDateLabel}>{group.label}</div>
                    <div className={styles.timelineItems}>
                      {group.jobs.map((job) => {
                        const tool = tools.find((t) => t.id === job.tool_id);
                        const project = job.project_id
                          ? projects.find((p) => p.id === job.project_id)
                          : null;
                        return (
                          <Link
                            key={job.id}
                            className={styles.timelineItem}
                            to={project ? `/project/${project.id}` : `/tools#${job.tool_id}`}
                            title={project ? `项目：${project.name}` : undefined}
                          >
                            <span
                              className={`${styles.timelineDot} ${statusClass(job.status)}`}
                              title={statusLabel(job.status)}
                            />
                            <div className={styles.timelineContent}>
                              <span className={styles.timelineTitle}>
                                {job.name || tool?.title || job.tool_id}
                              </span>
                              <span className={styles.timelineMeta}>
                                {formatTime(job.created_at)}
                                {project ? ` · ${project.name}` : ''}
                              </span>
                            </div>
                            <span className={`${styles.jobStatusBadge} ${statusClass(job.status)}`}>
                              {statusLabel(job.status)}
                            </span>
                          </Link>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>

      {/* 新建项⽬对话框 */}
      {showNewProject && (
        <div
          className={styles.updOverlay}
          onClick={() => !creatingProject && setShowNewProject(false)}
        >
          <div className={styles.updModal} onClick={(e) => e.stopPropagation()}>
            <h3 className={styles.updTitle}>新建项⽬</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '12px' }}>
              <input
                type="text"
                placeholder="项⽬名称"
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                style={{
                  padding: '8px 12px',
                  borderRadius: '8px',
                  border: '1px solid var(--biof3-border)',
                  fontSize: '14px',
                }}
                autoFocus
              />
              <textarea
                placeholder="项⽬描述（可选）"
                value={newProjectDesc}
                onChange={(e) => setNewProjectDesc(e.target.value)}
                rows={3}
                style={{
                  padding: '8px 12px',
                  borderRadius: '8px',
                  border: '1px solid var(--biof3-border)',
                  fontSize: '14px',
                  resize: 'vertical',
                }}
              />
            </div>
            <div className={styles.updActions}>
              <button
                type="button"
                className={styles.updBtn}
                onClick={() => setShowNewProject(false)}
                disabled={creatingProject}
              >
                取消
              </button>
              <button
                type="button"
                className={`${styles.updBtn} ${styles.updBtnPrimary}`}
                onClick={handleCreateProject}
                disabled={creatingProject || !newProjectName.trim()}
              >
                {creatingProject ? '创建中…' : '创建'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 推荐教程 — 桌面端已移除教程入口，此区块已删除。
          如需恢复，取消下面注释即可。 */}
      {/*
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>
          <Icon name="book" size={18} />
          推荐教程
        </h2>
        <div className={styles.tutorialGrid}>
          {[
            { title: '单细胞标准分析流程', href: '/docs/single-cell/module01', tag: '单细胞' },
            { title: 'DESeq2 差异表达分析', href: '/docs/bulk-rnaseq/module01', tag: 'bulk' },
            { title: '空间转录组入门', href: '/docs/single-cell/module10', tag: '空间组学' },
            { title: '机器学习生存预测', href: '/docs/machine-learning/module01', tag: 'ML' },
          ].map((item) => (
            <Link key={item.href} className={styles.tutorialCard} to={item.href}>
              <span className={styles.tutorialTag}>{item.tag}</span>
              <span className={styles.tutorialTitle}>{item.title}</span>
            </Link>
          ))}
        </div>
      </section>
      */}

      {/* M2-6 / E4：下载并打开安装包对话框 */}
      {updOpen && (
        <div
          className={styles.updOverlay}
          onClick={() => !updDownloading && !updInstalling && setUpdOpen(false)}
        >
          <div className={styles.updModal} onClick={(e) => e.stopPropagation()}>
            <h3 className={styles.updTitle}>
              发现新版本{updateVersion ? ` ${updateVersion}` : ''}
            </h3>
            <p className={styles.updBody}>
              {updDownloaded
                ? '更新已下载并通过校验，点击下方按钮打开安装包。'
                : updDownloading
                  ? '正在下载更新，请勿关闭应用…'
                  : '下载最新版本并校验，完成后打开 DMG 覆盖安装。'}
            </p>

            {(updDownloading || updDownloaded) && (
              <div>
                <div className={styles.updBar}>
                  <div
                    className={styles.updBarFill}
                    style={{ width: `${Math.round((updProgress ?? 0) * 100)}%` }}
                  />
                </div>
                <div className={styles.updPct}>{Math.round((updProgress ?? 0) * 100)}%</div>
              </div>
            )}

            {updError && <div className={styles.updErr}>{updError}</div>}

            <div className={styles.updActions}>
              <button
                type="button"
                className={styles.updBtn}
                onClick={() => !updDownloading && !updInstalling && setUpdOpen(false)}
                disabled={updDownloading || updInstalling}
              >
                取消
              </button>
              {updDownloaded ? (
                <button
                  type="button"
                  className={`${styles.updBtn} ${styles.updBtnPrimary}`}
                  onClick={install}
                  disabled={updInstalling}
                >
                  {updInstalling ? '正在打开…' : '打开安装包'}
                </button>
              ) : (
                <button
                  type="button"
                  className={`${styles.updBtn} ${styles.updBtnPrimary}`}
                  onClick={download}
                  disabled={updDownloading}
                >
                  {updDownloading ? '下载中…' : '下载更新'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default DesktopDashboard;
