// BioF3 桌面版原生 shell — App 根组件
// dock + 路由出口 + 首次启动引导

import React, { useState, useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { DesktopToolbar } from '@/components/desktop/DesktopToolbar';
import { DesktopOnboarding } from '@/components/desktop/DesktopOnboarding';

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
    <>
      <DesktopToolbar />
      <main className="biof3-spa-main">
        <Routes>
          {/* 阶段 0：占位路由，阶段 1 填入真实页面 */}
          <Route path="/" element={<PlaceholderHome />} />
          <Route path="/tools" element={<PlaceholderPage title="工具" />} />
          <Route path="/single-cell" element={<PlaceholderPage title="单细胞" />} />
          <Route path="/spatial" element={<PlaceholderPage title="空间组学" />} />
          <Route path="/figcode" element={<PlaceholderPage title="FigCode 绘图" />} />
          <Route path="/docs/*" element={<PlaceholderPage title="文档" />} />
          <Route path="/blog/*" element={<PlaceholderPage title="博客" />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <DesktopOnboardingMount />
    </>
  );
}

function PlaceholderHome(): React.ReactElement {
  return (
    <div style={{ padding: '40px 48px' }}>
      <h1 style={{ fontSize: '2rem', marginBottom: '12px' }}>BioF3 桌面版</h1>
      <p style={{ color: '#64748b', fontSize: '1rem' }}>
        Vite SPA 原生 shell — 阶段 0 骨架已就绪。dock + 路由 + 首次启动引导可用。
      </p>
      <p style={{ color: '#94a3b8', fontSize: '0.88rem', marginTop: '24px' }}>
        阶段 1 将搬入 tools / single-cell / spatial / figcode 等应用页面。
      </p>
    </div>
  );
}

function PlaceholderPage({ title }: { title: string }): React.ReactElement {
  return (
    <div style={{ padding: '40px 48px' }}>
      <h1 style={{ fontSize: '1.5rem', marginBottom: '12px' }}>{title}</h1>
      <p style={{ color: '#94a3b8', fontSize: '0.9rem' }}>
        该页面将在阶段 1 从 Docusaurus 移植过来。
      </p>
    </div>
  );
}
