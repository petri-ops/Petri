/**
 * Home — 桌面版启动入口
 *
 * 有项目时直接进入最近项目的工作台（云平台视图），
 * 没有项目时才保留创建项目的启动页。
 */

import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { DesktopDashboard } from './_desktop-dashboard';
import { listProjects } from '@/lib/project-store';
import type { Project } from '@/lib/project-types';

function pickRecentProject(projects: Project[]): Project | null {
  if (projects.length === 0) return null;
  return [...projects].sort((a, b) => {
    const bt = new Date(b.updatedAt || b.createdAt || 0).getTime();
    const at = new Date(a.updatedAt || a.createdAt || 0).getTime();
    return bt - at;
  })[0] || null;
}

export default function Home(): React.ReactElement {
  const [status, setStatus] = useState<'loading' | 'ready'>('loading');
  const [targetProjectId, setTargetProjectId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const projects = await listProjects();
        if (cancelled) return;
        const recent = pickRecentProject(projects);
        setTargetProjectId(recent?.id || null);
      } catch {
        if (cancelled) return;
        setTargetProjectId(null);
      } finally {
        if (!cancelled) setStatus('ready');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (status === 'loading') {
    return <div style={{ minHeight: '100vh', background: 'var(--biof3-bg, #f8fafc)' }} />;
  }

  if (targetProjectId) {
    return <Navigate to={`/project/${targetProjectId}?mode=cloud`} replace />;
  }

  return <DesktopDashboard />;
}
