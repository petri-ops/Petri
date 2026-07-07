// BioF3 桌面版原生 shell — App 根组件
// dock + 路由出口 + 首次启动引导

import React, { useState, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { DesktopToolbar } from '@/components/desktop/DesktopToolbar';
import { DesktopOnboarding } from '@/components/desktop/DesktopOnboarding';
import { BackendStatusProvider } from '@/components/backend/BackendStatusProvider';
import { BackendDownBanner } from '@/components/backend/BackendDownBanner';
import ToolsPage from '@/pages/tools';
import FigCodePage from '@/pages/figcode';
import SingleCellPage from '@/pages/single-cell';
import SpatialPage from '@/pages/spatial';
import AlgorithmsPage from '@/pages/algorithms';
import SkillsPage from '@/pages/skills';
import AdminPage from '@/pages/admin';
import HomePage from '@/pages/home';
import DocsPage from '@/pages/docs';
import { CopilotChat } from '@/components/copilot/CopilotChat';
import { CopilotSelectionTip } from '@/components/copilot/CopilotSelectionTip';
import '@/components/copilot/copilotActRegistryBoot';
// 断点6：注入平台 API 给 @biof3/shared 渲染层组件（ActResultCard/CopilotResultPanel/copilotActRegistry）
import { configureApi } from '../../vendor/biof3-core/packages/shared-copilot/api-inject';
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
    window.addEventListener('biof3:onboarding-done', handler);
    return () => window.removeEventListener('biof3:onboarding-done', handler);
  }, []);

  if (!show) return null;
  return <DesktopOnboarding />;
}

export default function App(): React.ReactElement {
  return (
    <BackendStatusProvider>
      <BackendDownBanner />
      <DesktopToolbar />
      <main className="biof3-spa-main">
        <Routes>
          {/* 阶段 1：8 个应用页面全部移植完成 */}
          <Route path="/" element={<HomePage />} />
          <Route path="/tools" element={<ToolsPage />} />
          <Route path="/tools/:toolId" element={<ToolsPage />} />
          <Route path="/single-cell" element={<SingleCellPage />} />
          <Route path="/single-cell/*" element={<SingleCellPage />} />
          <Route path="/spatial" element={<SpatialPage />} />
          <Route path="/spatial/*" element={<SpatialPage />} />
          <Route path="/figcode" element={<FigCodePage />} />
          <Route path="/figcode/:cardId" element={<FigCodePage />} />
          <Route path="/algorithms" element={<AlgorithmsPage />} />
          <Route path="/algorithms/:algoId" element={<AlgorithmsPage />} />
          <Route path="/skills" element={<SkillsPage />} />
          <Route path="/skills/:skillId" element={<SkillsPage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="/docs/*" element={<DocsPage />} />
          <Route path="/docs" element={<DocsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <CopilotChat />
      <CopilotSelectionTip />
      <DesktopOnboardingMount />
    </BackendStatusProvider>
  );
}
