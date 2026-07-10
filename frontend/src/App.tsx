// BioF3 桌面版原生 shell — App 根组件
// 路由出口 + 首次启动引导

import React, { useState, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { DesktopOnboarding } from '@/components/desktop/DesktopOnboarding';
import { BackendStatusProvider } from '@/components/backend/BackendStatusProvider';
import { BackendDownBanner } from '@/components/backend/BackendDownBanner';
import { CopilotContextProvider } from '@/lib/copilotContextProvider';
import { biof3Events, subscribeBioF3Event } from '@/lib/events';
import ToolsPage from '@/pages/tools';
import FigCodePage from '@/pages/figcode';
// NOTE: SingleCellPage and SpatialPage routes are intentionally disabled on the desktop
// branch. The underlying pages/pages/single-cell and pages/spatial files are preserved
// because their utilities (_Toast, _ErrorTranslate, _auth, _AdminPanel) are still
// consumed by pages/admin. Full legacy removal tracked in state-decomposition §10.
import AlgorithmsPage from '@/pages/algorithms';
import SkillsPage from '@/pages/skills';
import AdminPage from '@/pages/admin';
import HomePage from '@/pages/home';
// DocsPage 原生渲染组件保留在 pages/docs.tsx，但桌面端不再挂载教程路由。
// 如需恢复内置教程，取消下面注释并加回 /docs 路由即可。
// import DocsPage from '@/pages/docs';
import '@/components/copilot/copilotActRegistryBoot';
import { ProjectWorkspace } from '@/pages/project-workspace';
import '@/components/desktop/desktop.css';
// 断点6：注入平台 API 给 @biof3/shared 渲染层组件（ActResultCard/CopilotResultPanel/copilotActRegistry）
import { configureApi } from '../../vendor/biof3-core/packages/shared-copilot/api-inject';
import { getApiPrefix, getToken } from '@/lib/authClient';
configureApi({ getApiPrefix: () => getApiPrefix(), getToken });

const ONBOARDING_FLAG = 'biof3-onboarding-completed';
const THEME_STORAGE_KEY = 'biof3-theme';

import { biof3Events, subscribeBioF3Event } from '@/lib/events';

function DesktopOnboardingMount(): React.ReactElement | null {
  const [show, setShow] = useState(false);

  useEffect(() => {
    try {
      const done = localStorage.getItem(ONBOARDING_FLAG) === '1';
      if (!done) setShow(true);
    } catch {
      setShow(true);
    }
    const handler = () => setShow(false);
    const unsub = subscribeBioF3Event(biof3Events.onboardingDone, handler);
    return unsub;
  }, []);

  if (!show) return null;
  return <DesktopOnboarding />;
}

export default function App(): React.ReactElement {
  useEffect(() => {
    const html = document.documentElement;
    html.classList.add('biof3-desktop');
    html.classList.remove('biof3-desktop-dock-collapsed');
    document.body.style.paddingLeft = '0';
    document.body.style.boxSizing = 'border-box';

    const applyTheme = (theme: 'light' | 'dark') => {
      html.setAttribute('data-theme', theme);
    };

    let savedTheme: 'light' | 'dark' | null = null;
    try {
      const raw = localStorage.getItem(THEME_STORAGE_KEY);
      if (raw === 'light' || raw === 'dark') savedTheme = raw;
    } catch {
      savedTheme = null;
    }

    const media = window.matchMedia('(prefers-color-scheme: dark)');
    applyTheme(savedTheme || (media.matches ? 'dark' : 'light'));

    const onChange = () => {
      try {
        const raw = localStorage.getItem(THEME_STORAGE_KEY);
        if (raw === 'light' || raw === 'dark') return;
      } catch {
        // ignore and follow system
      }
      applyTheme(media.matches ? 'dark' : 'light');
    };

    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  return (
    <BackendStatusProvider>
      <BackendDownBanner />
      <CopilotContextProvider>
      <main className="biof3-spa-main">
        <Routes>
          {/* 阶段 1：8 个应用页面全部移植完成 */}
          <Route path="/" element={<HomePage />} />
          <Route path="/project/:projectId" element={<ProjectWorkspace />} />
          <Route path="/tools" element={<ToolsPage />} />
          <Route path="/tools/:toolId" element={<ToolsPage />} />
          {/* single-cell and spatial routes intentionally removed — §10 state-decomposition */}
          <Route path="/figcode" element={<FigCodePage />} />
          <Route path="/figcode/:cardId" element={<FigCodePage />} />
          <Route path="/algorithms" element={<AlgorithmsPage />} />
          <Route path="/algorithms/:algoId" element={<AlgorithmsPage />} />
          <Route path="/skills" element={<SkillsPage />} />
          <Route path="/skills/:skillId" element={<SkillsPage />} />
          <Route path="/admin" element={<AdminPage />} />
          {/* 教程路由已移除 — 桌面端不再内置教程入口。
              原生渲染组件（pages/docs.tsx / docs-frame.tsx / mdx/）保留在代码库中，
              如需恢复：import DocsPage 并加回下面两行路由即可。 */}
          {/* <Route path="/docs/*" element={<DocsPage />} /> */}
          {/* <Route path="/docs" element={<DocsPage />} /> */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <DesktopOnboardingMount />
      </CopilotContextProvider>
    </BackendStatusProvider>
  );
}
