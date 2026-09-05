// BioF3 桌面版原生 shell — App 根组件
// 路由出口 + 首次启动引导

import React, { useState, useEffect, lazy, Suspense } from 'react';
// BLOCK-22 P4.6: DEV ONLY — manual file-open testing entry via window.__biof3DispatchOpenFile
// Production build: React.lazy + NODE_ENV=production → tree-shakeable, zero runtime cost
const BioF3OpenFileDevBridge = lazy(() =>
  import('./components/editor/integration/BioF3OpenFileDevBridge')
);
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { DesktopOnboarding } from '@/components/desktop/DesktopOnboarding';
import { TitleBar } from '@/components/desktop/TitleBar';
import { WorkspacePanelsProvider, useWorkspacePanelsContext } from '@/components/desktop/WorkspacePanelsContext';
import { BackendStatusProvider } from '@/components/backend/BackendStatusProvider';
import { CopilotContextProvider } from '@/lib/copilotContextProvider';
import { biof3Events, subscribeBioF3Event } from '@/lib/events';
import { CommandPalette, useCommandPalette } from '@/components/copilot/CommandPalette';
// BLOCK-42 — pending-scroll 全局 Provider（见 AppShell 内注释）
import { PendingScrollProvider } from '@/lib/pendingScrollContext';
import HomePage from '@/pages/home';
// NOTE: Legacy pages (tools, admin, docs, figcode, single-cell, spatial) have been removed
// as the desktop application now uses the Agent-based workflow through ProjectWorkspace.
import { ProjectWorkspace } from '@/pages/project-workspace';
import { ResultStudioPage } from '@/pages/result-studio/ResultStudioPage';
import SkillsPage from '@/pages/skills';
// BLOCK-28 — main-area code review mode (VS Code SCM style)
import { ReviewModePage } from '@/pages/review';
// BLOCK-59 P1 — 独立窗路由面：/window/* 不走主窗 AppShell（无 TitleBar/
// Copilot 等 workspace chrome），由 WindowShell 提供最小只读 chrome。
import { WindowResultPage } from '@/pages/window/WindowResultPage';
// BLOCK-59 P2 — 终端独立窗 + 边缘活动轨道（内部专用路由）
import { TerminalWindowPage } from '@/pages/window/TerminalWindowPage';
import { RailPage } from '@/components/window/RailPage';
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

/** Lives inside WorkspacePanelsProvider. */
function AppShell(): React.ReactElement {
  const { isOpen, open, close } = useCommandPalette();

  return (
    <>
      <TitleBar />
      <CopilotContextProvider>
        {/* BLOCK-42 — pending-scroll 全局 Provider：页面级写入端（ProjectWorkspace
            事件 relay）与消费端（WorkspaceFilePreviewBridge / dev bridge / 未来
            ChatCardLinkBridge）必须在同一 Context 实例内，否则写入端拿到 FALLBACK
            no-op 静默丢弃。Provider 仅一个 useState，全局挂载零副作用。 */}
        <PendingScrollProvider>
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
        {/* BLOCK-22 P4.6: DEV ONLY — do NOT use in production */}
        <Suspense fallback={null}>
          <BioF3OpenFileDevBridge />
        </Suspense>
        </PendingScrollProvider>
      </CopilotContextProvider>
    </>
  );
}

export default function App(): React.ReactElement {
  const location = useLocation();
  const isWindowSurface = location.pathname.startsWith('/window/');

  useEffect(() => {
    const html = document.documentElement;
    html.classList.add('biof3-desktop');
    html.classList.remove('biof3-desktop-dock-collapsed');
    document.body.style.paddingLeft = '0';
    document.body.style.boxSizing = 'border-box';
  }, []);

  // BLOCK-59 P1 — 独立窗（弹出结果窗/终端窗/指挥中心）加载同一 SPA 的
  // /window/* 路由：只挂 WindowShell 级 chrome，不挂主窗 Provider 树
  // （窗口永不持有 canonical state，plan §10 治理红线）。
  if (isWindowSurface) {
    return (
      <Routes>
        <Route path="/window/result/:artifactId" element={<WindowResultPage />} />
        <Route path="/window/terminal/:sessionId" element={<TerminalWindowPage />} />
        <Route path="/window/rail" element={<RailPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    );
  }

  return (
    <BackendStatusProvider>
      <WorkspacePanelsProvider>
        <AppShell />
      </WorkspacePanelsProvider>
    </BackendStatusProvider>
  );
}
