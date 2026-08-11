/**
 * Home — 桌面版启动入口
 *
 * 有项目时直接进入最近项目的工作台，
 * 没有项目时才保留创建项目的启动页。
 *
 * ⚠️ 首次运行死锁修复（见 .workbuddy/memory）：
 * 项目列表走 r-server(:3001)，而 r-server 需要 R 运行时；R 运行时又只能从
 * 插件商店安装，而商店此前唯一入口在「项目工作台」内部 —— 于是形成死锁：
 *   没装 R → 进不了工作台 → 进不了工作台就装不了 R。
 * 修复：检测到 R 运行时缺失时，本页直接渲染「首次配置」引导页，并内嵌
 * PluginStorePanel（纯 IPC，不依赖任何 HTTP 后端），装完就地重启应用。
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Icon } from '@/components/icons/Icon';
import { useBackendStatus } from '@/components/backend/BackendStatusProvider';
import { PluginStorePanel } from '@/components/desktop/PluginStorePanel';
import { createProject, listProjectJobs, listProjects } from '@/lib/project-store';
import type { Project, ToolJob } from '@/lib/project-types';
import styles from './home.module.css';

function pickRecentProject(projects: Project[]): Project | null {
  if (projects.length === 0) return null;
  return [...projects].sort((a, b) => {
    const bt = new Date(b.updatedAt || b.createdAt || 0).getTime();
    const at = new Date(a.updatedAt || a.createdAt || 0).getTime();
    return bt - at;
  })[0] || null;
}

function pickRecentCompletedJob(jobs: ToolJob[], projects: Project[]): ToolJob | null {
  const projectIds = new Set(projects.map((project) => project.id));
  return (
    [...jobs]
      .filter((job) => job.project_id && projectIds.has(job.project_id) && job.status === 'done')
      .sort((a, b) => {
        const bt = b.completed_at || b.created_at || 0;
        const at = a.completed_at || a.created_at || 0;
        return bt - at;
      })[0] || null
  );
}

export default function Home(): React.ReactElement {
  const backendStatus = useBackendStatus();
  const navigate = useNavigate();
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [targetProjectId, setTargetProjectId] = useState<string | null>(null);
  const [targetJobId, setTargetJobId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [storeOpen, setStoreOpen] = useState(false);
  const [relaunching, setRelaunching] = useState(false);
  // 后端就绪等待超时 —— 避免"永远转圈"的无出路状态
  const [waitedTooLong, setWaitedTooLong] = useState(false);

  useEffect(() => {
    if (!backendStatus.isReady) return;
    let cancelled = false;
    (async () => {
      try {
        const projects = await listProjects();
        if (cancelled) return;
        const jobsByProject = await Promise.all(
          projects.map((project) => listProjectJobs(project.id).catch(() => []))
        );
        if (cancelled) return;
        const jobs = jobsByProject.flat();
        const recentJob = pickRecentCompletedJob(jobs, projects);
        if (recentJob?.project_id) {
          setTargetProjectId(recentJob.project_id);
          setTargetJobId(recentJob.id);
          setStatus('ready');
          return;
        }
        const recent = pickRecentProject(projects);
        setTargetProjectId(recent?.id || null);
        setTargetJobId(null);
        setStatus('ready');
      } catch {
        if (cancelled) return;
        setTargetProjectId(null);
        setTargetJobId(null);
        setStatus('error');
        return;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [backendStatus.isReady, loadAttempt]);

  // 后端 12s 还没就绪 → 放出「打开插件商店 / 重启」出路，不再干转圈
  useEffect(() => {
    if (backendStatus.isReady) {
      setWaitedTooLong(false);
      return;
    }
    const timer = setTimeout(() => setWaitedTooLong(true), 12000);
    return () => clearTimeout(timer);
  }, [backendStatus.isReady]);

  const handleCreateProject = useCallback(async () => {
    if (creating) return;
    setCreating(true);
    try {
      const selectedPath = await window.biof3Desktop?.files?.openDirectoryDialog?.();
      if (!selectedPath) return;
      const normalizedPath = selectedPath.replace(/[\\/]+$/, '');
      const name = normalizedPath.split(/[\\/]/).pop()?.trim() || '新项目';
      const project = await createProject({
        name,
        modality: 'general',
        workspacePath: selectedPath,
      });
      navigate(`/project/${project.id}`, { replace: true });
    } finally {
      setCreating(false);
    }
  }, [creating, navigate]);

  const handleRelaunch = useCallback(async () => {
    if (relaunching) return;
    setRelaunching(true);
    try {
      await window.biof3Desktop?.app?.relaunch?.();
    } finally {
      // relaunch 成功时进程已退出，这里只兜底 relaunch 不可用的情况
      setRelaunching(false);
    }
  }, [relaunching]);

  // ── 首次配置引导：R 运行时缺失（或后端久等未起）时的唯一出路 ──
  // 注意用 `=== false` 而非 `!rRuntime`：main.js 的 backend:status handler 在
  // 状态查询异常时返回的对象**不含** rRuntime（undefined = 未知）。把"未知"
  // 当成"缺失"会让偶发 IPC 异常误弹首次配置页，所以只认显式 false。
  const runtimeMissing = backendStatus.loaded && backendStatus.rRuntime === false;
  const needsSetupGate = runtimeMissing || (!backendStatus.isReady && waitedTooLong);

  if (needsSetupGate && status !== 'ready') {
    if (storeOpen) {
      return (
        <div className={styles.setupStoreShell}>
          <div className={styles.setupStoreFrame}>
            <PluginStorePanel onClose={() => setStoreOpen(false)} />
          </div>
          {backendStatus.rRuntime && (
            <div className={styles.setupStoreFooter}>
              <span>
                <Icon name="check" size={14} /> R 运行时已就绪，重启应用即可开始分析
              </span>
              <button className="biof3-btn biof3-btn--ghost biof3-btn--sm" type="button" onClick={() => void handleRelaunch()} disabled={relaunching}>
                {relaunching ? '正在重启…' : '立即重启应用'}
              </button>
            </div>
          )}
        </div>
      );
    }

    return (
      <section className={styles.setupHome} aria-label="首次配置运行时">
        <div className={styles.setupIcon}>
          <Icon name="cpu" size={26} />
        </div>
        <h1>先安装分析运行时</h1>
        <p className={styles.setupLead}>
          BioF3 的分析能力依赖 R / Python 运行时。运行时体积较大未随安装包分发，
          需在插件商店按需下载，装好后即可离线使用。
        </p>

        <div className={styles.setupChecklist}>
          <div className={`${styles.setupCheckItem} ${backendStatus.rRuntime ? styles.setupCheckOk : ''}`}>
            <Icon name={backendStatus.rRuntime ? 'check' : 'cpu'} size={15} />
            <span className={styles.setupCheckName}>R 运行时</span>
            <span className={styles.setupCheckMeta}>约 657MB · 必需</span>
            <span className={styles.setupCheckState}>
              {backendStatus.rRuntime ? '已安装' : '未安装'}
            </span>
          </div>
          <div className={`${styles.setupCheckItem} ${backendStatus.pyRuntime ? styles.setupCheckOk : ''}`}>
            <Icon name={backendStatus.pyRuntime ? 'check' : 'cpu'} size={15} />
            <span className={styles.setupCheckName}>Python 运行时</span>
            <span className={styles.setupCheckMeta}>约 503MB · 推荐</span>
            <span className={styles.setupCheckState}>
              {backendStatus.pyRuntime ? '已安装' : '未安装'}
            </span>
          </div>
        </div>

        <div className={styles.setupActions}>
          <button
            type="button"
            className={styles.setupPrimary}
            onClick={() => setStoreOpen(true)}
          >
            <Icon name="puzzle" size={15} />
            打开插件商店安装
          </button>
          {backendStatus.rRuntime && (
            <button
              type="button"
              className={styles.setupSecondary}
              onClick={() => void handleRelaunch()}
              disabled={relaunching}
            >
              {relaunching ? '正在重启…' : '重启应用'}
            </button>
          )}
        </div>

        {backendStatus.downReason && (
          <p className={styles.setupReason}>{backendStatus.downReason}</p>
        )}
      </section>
    );
  }

  if (status === 'loading') {
    return (
      <div className={styles.homeState} aria-label="正在启动 BioF3">
        <span className={styles.homeStateDot} />
        <span>{backendStatus.downReason || '正在准备项目工作台…'}</span>
      </div>
    );
  }

  if (targetProjectId) {
    if (targetJobId) {
      return (
        <Navigate
          to={`/project/${targetProjectId}?mode=scheduled&job=${encodeURIComponent(targetJobId)}`}
          replace
        />
      );
    }
    return <Navigate to={`/project/${targetProjectId}`} replace />;
  }

  if (status === 'error') {
    return (
      <div className={styles.homeState}>
        <Icon name="flag" size={18} />
        <span>项目列表加载失败</span>
        <button className="biof3-btn biof3-btn--ghost biof3-btn--sm" type="button" onClick={() => {
          setStatus('loading');
          setLoadAttempt((value) => value + 1);
        }}>
          重试
        </button>
      </div>
    );
  }

  return (
    <section className={styles.emptyHome} aria-label="创建第一个项目">
      <div className={styles.emptyHomeIcon}><Icon name="folder" size={22} /></div>
      <h1>创建第一个项目</h1>
      <p>选择工作目录后，将以目录名称创建项目。</p>
      <div className={styles.emptyHomeCreate}>
        <button className="biof3-btn biof3-btn--ghost biof3-btn--sm" type="button" onClick={() => void handleCreateProject()} disabled={creating}>
          {creating ? '创建中…' : '选择工作目录并创建'}
        </button>
      </div>
    </section>
  );
}
