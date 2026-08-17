// BioF3 桌面版原生 shell — App 根组件
// 路由出口 + 首次启动引导

import React, { useState, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { DesktopOnboarding } from '@/components/desktop/DesktopOnboarding';
import { TitleBar } from '@/components/desktop/TitleBar';
import { WorkspacePanelsProvider } from '@/components/desktop/WorkspacePanelsContext';
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

export default function App(): React.ReactElement {
  useEffect(() => {
    const html = document.documentElement;
    html.classList.add('biof3-desktop');
    html.classList.remove('biof3-desktop-dock-collapsed');
    document.body.style.paddingLeft = '0';
    document.body.style.boxSizing = 'border-box';

  }, []);

  // Command palette state and controls
  const { isOpen, open, close } = useCommandPalette();

  return (
    <BackendStatusProvider>
      <WorkspacePanelsProvider>
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
        </CopilotContextProvider>
      </WorkspacePanelsProvider>
    </BackendStatusProvider>
  );
}
