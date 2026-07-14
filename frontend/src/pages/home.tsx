/**
 * Home — 桌面版启动入口
 *
 * 有项目时直接进入最近项目的工作台（云平台视图），
 * 没有项目时才保留创建项目的启动页。
 */

import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { DesktopDashboard } from './_desktop-dashboard';
import { listProjectJobs, listProjects } from '@/lib/project-store';
import type { Project, ToolJob } from '@/lib/project-types';

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
  const [status, setStatus] = useState<'loading' | 'ready'>('loading');
  const [targetProjectId, setTargetProjectId] = useState<string | null>(null);
  const [targetJobId, setTargetJobId] = useState<string | null>(null);

  useEffect(() => {
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
          return;
        }
        const recent = pickRecentProject(projects);
        setTargetProjectId(recent?.id || null);
        setTargetJobId(null);
      } catch {
        if (cancelled) return;
        setTargetProjectId(null);
        setTargetJobId(null);
      } finally {
        if (!cancelled) setStatus('ready');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (status === 'loading') {
    return <div style={{ minHeight: '100vh', background: 'var(--biof3-bg)' }} />;
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
    return <Navigate to={`/project/${targetProjectId}?mode=cloud`} replace />;
  }

  return <DesktopDashboard />;
}
