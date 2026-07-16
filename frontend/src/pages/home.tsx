/**
 * Home — 桌面版启动入口
 *
 * 有项目时直接进入最近项目的工作台，
 * 没有项目时才保留创建项目的启动页。
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Icon } from '@/components/icons/Icon';
import { useBackendStatus } from '@/components/backend/BackendStatusProvider';
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
        <button type="button" onClick={() => {
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
        <button type="button" onClick={() => void handleCreateProject()} disabled={creating}>
          {creating ? '创建中…' : '选择工作目录并创建'}
        </button>
      </div>
    </section>
  );
}
