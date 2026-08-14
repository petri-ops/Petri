// BioF3 桌面版原生 shell — App 根组件
// 路由出口 + 首次启动引导

import React, { useState, useEffect } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { DesktopOnboarding } from '@/components/desktop/DesktopOnboarding';
import { TitleBar } from '@/components/desktop/TitleBar';
import { WorkspacePanelsProvider } from '@/components/desktop/WorkspacePanelsContext';
import { BackendStatusProvider } from '@/components/backend/BackendStatusProvider';
import { CopilotContextProvider } from '@/lib/copilotContextProvider';
import { biof3Events, subscribeBioF3Event } from '@/lib/events';
import { CommandPalette, useCommandPalette } from '@/components/copilot/CommandPalette';
import { SkillsSidebar, type Skill } from '@/components/desktop/SkillsSidebar';
import { useSkillStore } from '@/hooks/useSkillStore';
import HomePage from '@/pages/home';
// NOTE: Legacy pages (tools, admin, docs, figcode, single-cell, spatial) have been removed
// as the desktop application now uses the Agent-based workflow through ProjectWorkspace.
import { ProjectWorkspace } from '@/pages/project-workspace';
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

  // Skills sidebar state
  const [isSkillsSidebarExpanded, setSkillsSidebarExpanded] = useState(false);
  const { skills } = useSkillStore({ autoLoad: false });
  const navigate = useNavigate();

  // Transform skills for SkillsSidebar
  const sidebarSkills: Skill[] = skills.map((s) => ({
    id: s.id,
    name: s.name,
    description: s.description,
    category: s.category,
    icon: 'zap',
  }));

  const handleSkillClick = (skillId: string) => {
    navigate(`/skills?skill=${skillId}`);
  };

  return (
    <BackendStatusProvider>
      <WorkspacePanelsProvider>
        <TitleBar />
        <SkillsSidebar
          expanded={isSkillsSidebarExpanded}
          onToggle={() => setSkillsSidebarExpanded((v) => !v)}
          onSkillClick={handleSkillClick}
          skills={sidebarSkills}
        />
        <CopilotContextProvider>
          <main
            className="biof3-spa-main"
            style={{
              marginTop: 0,
              paddingTop: 'var(--biof3-titlebar-height)',
              marginLeft: isSkillsSidebarExpanded ? '280px' : '44px',
              transition: 'margin-left 0.25s ease',
            }}
          >
            <Routes>
              {/* Desktop Agent-based workflow */}
              <Route path="/" element={<HomePage />} />
              {/* Skills management page */}
              <Route path="/skills" element={<SkillsPage />} />
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
