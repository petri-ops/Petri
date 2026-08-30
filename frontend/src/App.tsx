// BioF3 桌面版原生 shell — App 根组件
// 路由出口 + 首次启动引导

import React, { useState, useEffect, lazy, Suspense } from 'react';
import { useLocation } from 'react-router-dom';
// BLOCK-22 P4.6: DEV ONLY — manual file-open testing entry via window.__biof3DispatchOpenFile
// Production build: React.lazy + NODE_ENV=production → tree-shakeable, zero runtime cost
const BioF3OpenFileDevBridge = lazy(() =>
  import('./components/editor/integration/BioF3OpenFileDevBridge')
);
import { Routes, Route, Navigate } from 'react-router-dom';
import { DesktopOnboarding } from '@/components/desktop/DesktopOnboarding';
import { TitleBar } from '@/components/desktop/TitleBar';
import { WorkspacePanelsProvider, useWorkspacePanelsContext } from '@/components/desktop/WorkspacePanelsContext';
import { BackendStatusProvider } from '@/components/backend/BackendStatusProvider';
import { CopilotContextProvider } from '@/lib/copilotContextProvider';
import { biof3Events, subscribeBioF3Event } from '@/lib/events';
import { CommandPalette, useCommandPalette } from '@/components/copilot/CommandPalette';
import HomePage from '@/pages/home';
// NOTE: Legacy pages (tools, admin, docs, figcode, single-cell, spatial) have been removed
// as the desktop application now uses the Agent-based workflow through ProjectWorkspace.
import { ProjectWorkspace } from '@/pages/project-workspace';
import { ResultStudioPage } from '@/pages/result-studio/ResultStudioPage';
import SkillsPage from '@/pages/skills';
// BLOCK-28 — 主区一级审阅模式（方案 B），取代旧侧边抽屉 WorkingTreeReview
import { ReviewModePage } from '@/pages/review';
// BLOCK-28.2 — 同一组件以 dock 形态停靠右侧（TitleBar Toggle）
import { ReviewMode } from '@/components/desktop/WorkingTreeReview/ReviewMode';
import '@/components/desktop/desktop.css';
// 断点6：注入平台 API 给 @biof3/shared 渲染层组件（如 ActResultCard）
import { configureApi } from '../../core/packages/shared-copilot/api-inject';
import { getApiPrefix, getToken } from '@/lib/authClient';
configureApi({ getApiPrefix: () => getApiPrefix(), getToken });

const ONBOARDING_FLAG = 'biof3-onboarding-completed';

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

/** Lives inside WorkspacePanelsProvider — can access panel state. */
function AppShell(): React.ReactElement {
  const panels = useWorkspacePanelsContext();
  const { isOpen, open, close } = useCommandPalette();
  const location = useLocation();
  // BLOCK-28.5 — 项目工作区内审阅已并入右侧边栏 tab（ProjectWorkspace 双向同步），
  // 浮层只在 ProjectWorkspace 未挂载的路由（首页 / skills / results 页）兜底，
  // 保证 TitleBar 审阅按钮全局可用。
  const isWorkspaceRoute =
    /^\/project\/[^/]+/.test(location.pathname) && !/\/results\/?$/.test(location.pathname);

  return (
    <>
      <TitleBar />
      <CopilotContextProvider>
        <main
          className="biof3-spa-main"
          style={{
            marginTop: 0,
            paddingTop: 'var(--biof3-titlebar-height)',
            transition: 'margin-left 0.25s ease',
          }}
        >
          {/* dev mode passes through here just like production: deep-linkable
              /project/:id/<mode> and /skills routes are intentionally reachable.
              Only the dev-home skip-auto-navigate logic lives in pages/home.tsx. */}
          <Routes>
            {/* Desktop Agent-based workflow */}
            <Route path="/" element={<HomePage />} />
            {/* Skills management page */}
            <Route path="/skills" element={<SkillsPage />} />
            {/* BLOCK-28 — main-area code review mode (VS Code SCM style) */}
            <Route path="/review" element={<ReviewModePage />} />
            {/* Result Studio — standalone results view with branch tabs in TitleBar */}
            {/* MUST come before the wildcard /* route, otherwise it never matches */}
            <Route path="/project/:projectId/results" element={<ResultStudioPage />} />
            {/* T85: `*` splat lets `/project/:projectId/<mode>` resolve to the
                same workspace; mode is read from the sub-path, not `?mode=`. */}
            <Route path="/project/:projectId/*" element={<ProjectWorkspace />} />
            {/* Legacy pages (tools, admin, docs, figcode) removed - all workflows now use Agent */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
        <DesktopOnboardingMount />
        <CommandPalette
          open={isOpen}
          onClose={close}
          commands={[]}
          recentConversations={[]}
        />
        {/* BLOCK-28.5 — 浮层兜底：仅工作区外路由（工作区内为右侧边栏 review tab） */}
        {panels.workingTreeOpen && !isWorkspaceRoute && (
          <div className="wt-dock" data-testid="review-dock">
            <ReviewMode variant="dock" onClose={panels.toggleWorkingTree} />
          </div>
        )}
        {/* BLOCK-22 P4.6: DEV ONLY — do NOT use in production */}
        <Suspense fallback={null}>
          <BioF3OpenFileDevBridge />
        </Suspense>
      </CopilotContextProvider>
    </>
  );
}

export default function App(): React.ReactElement {
  useEffect(() => {
    const html = document.documentElement;
    html.classList.add('biof3-desktop');
    html.classList.remove('biof3-desktop-dock-collapsed');
    document.body.style.paddingLeft = '0';
    document.body.style.boxSizing = 'border-box';
  }, []);

  return (
    <BackendStatusProvider>
      <WorkspacePanelsProvider>
        <AppShell />
      </WorkspacePanelsProvider>
    </BackendStatusProvider>
  );
}
