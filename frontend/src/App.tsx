// Gewu 桌面版原生 shell — App 根组件
// 路由出口 + 首次启动引导

import React, { useState, useEffect, lazy, Suspense } from 'react';
// BLOCK-22 P4.6: DEV ONLY — manual file-open testing entry via window.__biof3DispatchOpenFile
// Production build: React.lazy + NODE_ENV=production → tree-shakeable, zero runtime cost
const GewuOpenFileDevBridge = lazy(() =>
  import('./components/editor/integration/GewuOpenFileDevBridge')
);
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { DesktopOnboarding } from '@/components/desktop/DesktopOnboarding';
import { TitleBar } from '@/components/desktop/TitleBar';
import { WorkspacePanelsProvider, useWorkspacePanelsContext } from '@/components/desktop/WorkspacePanelsContext';
import { AppRail } from '@/components/desktop/AppRail';
import { AppRailProvider } from '@/components/desktop/AppRailContext';
import { BackendStatusProvider } from '@/components/backend/BackendStatusProvider';
import { CopilotContextProvider } from '@/lib/copilotContextProvider';
import { gewuEvents, subscribeGewuEvent } from '@/lib/events';
import { getBridge } from '@/lib/desktopBridge';
import { CommandPalette, useCommandPalette } from '@/components/copilot/CommandPalette';
// BLOCK-42 — pending-scroll 全局 Provider（见 AppShell 内注释）
import { PendingScrollProvider } from '@/lib/pendingScrollContext';
import HomePage from '@/pages/home';
import WelcomePage from '@/pages/welcome';
// NOTE: Legacy pages (tools, admin, docs, figcode, single-cell, spatial) have been removed
// as the desktop application now uses the Agent-based workflow through ProjectWorkspace.
import { ProjectWorkspace } from '@/pages/project-workspace';
import { ResultStudioPage } from '@/pages/result-studio/ResultStudioPage';
import SkillsPage from '@/pages/skills';
import KnowledgePage from '@/pages/knowledge';
import BackendPage from '@/pages/backend';
// BLOCK-28 — main-area code review mode (VS Code SCM style)
import { ReviewModePage } from '@/pages/review';
// BLOCK-59 P1 — 独立窗路由面：/window/* 不走主窗 AppShell（无 TitleBar/
// Copilot 等 workspace chrome），由 WindowShell 提供最小只读 chrome。
import { WindowResultPage } from '@/pages/window/WindowResultPage';
// BLOCK-59 P2 — 终端独立窗 + 边缘活动轨道（内部专用路由）
import { TerminalWindowPage } from '@/pages/window/TerminalWindowPage';
import { RailPage } from '@/components/window/RailPage';
// BLOCK-59 P3 — 指挥中心（多任务俯瞰单例窗）
import { CommandCenterPage } from '@/pages/window/CommandCenterPage';
// BLOCK-59 P4 — agent 详情窗（BLOCK-49 spawn 链路只读投影）
import { AgentWindowPage } from '@/pages/window/AgentWindowPage';
import '@/components/desktop/desktop.css';
// 断点6：注入平台 API 给 @biof3/shared 渲染层组件（如 ActResultCard）
import { configureApi } from '../../core/packages/shared-copilot/api-inject';
import { getApiPrefix, getToken } from '@/lib/authClient';
configureApi({ getApiPrefix: () => getApiPrefix(), getToken });

// BLOCK-61：新 key + 历史 key 读兼容（已完成的引导不因改名复现）
const ONBOARDING_FLAG = 'gewu-onboarding-completed';
const LEGACY_ONBOARDING_FLAG = 'gewu-onboarding-completed';

function DesktopOnboardingMount(): React.ReactElement | null {
  const [show, setShow] = useState(false);

  useEffect(() => {
    try {
      const done = localStorage.getItem(ONBOARDING_FLAG) === '1'
        || localStorage.getItem(LEGACY_ONBOARDING_FLAG) === '1';
      if (!done) setShow(true);
    } catch {
      setShow(true);
    }
    const handler = () => setShow(false);
    const unsub = subscribeGewuEvent(gewuEvents.onboardingDone, handler);
    return unsub;
  }, []);

  if (!show) return null;
  return <DesktopOnboarding />;
}

/** Lives inside WorkspacePanelsProvider. */
function AppShell(): React.ReactElement {
  const { isOpen, open, close } = useCommandPalette();
  const location = useLocation();
  const panels = useWorkspacePanelsContext();
  // (/project/:id/results) 与其余路由维持原状。归一化尾斜杠后取 :id 后的子段判定。
  // BLOCK-62 P0 — 列体化壳：仅 ProjectWorkspace 路由（/project/:id/*）走「列容器
  // 占满视口 + 列内让位固定顶栏」新地基，main 不再 paddingTop 让位；ResultStudio
  // (/project/:id/results) 与其余路由维持原状。归一化尾斜杠后取 :id 后的子段判定。
  const isColumnizedWorkspace = (() => {
    const path = location.pathname.replace(/\/+$/, '') || '/';
    const m = path.match(/^\/project\/[^/]+(?:\/(.*))?$/);
    return !!m && m[1] !== 'results';
  })();
  // BLOCK-87 L3 — 投影+窄屏（手机浏览器）：壳层 AppRail 转浮层，开合由
  // TitleBar 左上「展开/收起左侧栏」按钮驱动（用户裁决：不需要额外 ☰ 按钮，
  // 点开滑出、再点收回）。桌面端恒 false 不受影响（UI-341 常驻裁决仅针对
  // 桌面窗口）。
  const projectionMobile = (() => {
    try {
      return document.documentElement.getAttribute('data-projection') === '1'
        && window.matchMedia('(max-width: 767px)').matches;
    } catch {
      return false;
    }
  })();
  const [railOverlayOpen, setRailOverlayOpen] = useState(false);

  return (
    <>
      {/* BLOCK-62 P1b — 列体化路由的顶栏归 ProjectWorkspace 自持（regular=列内
          ColumnHeader，loading/error/compact=fixed 条），AppShell 不再渲染全局条，
          避免与列内 header 双份。其余路由照旧。 */}
      {!isColumnizedWorkspace && <TitleBar />}
      <CopilotContextProvider>
        {/* BLOCK-42 — pending-scroll 全局 Provider：页面级写入端（ProjectWorkspace
            事件 relay）与消费端（WorkspaceFilePreviewBridge / dev bridge / 未来
            ChatCardLinkBridge）必须在同一 Context 实例内，否则写入端拿到 FALLBACK
            no-op 静默丢弃。Provider 仅一个 useState，全局挂载零副作用。 */}
        <PendingScrollProvider>
        {/* UI-341 加映三（档 2）——左栏上提为壳层 AppRail：所有主窗页面常驻，
            不再随 /project/:id 路由消失。main 为 flex 兄弟（高度 100%）。 */}
        <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
        {projectionMobile && (
          <>
            <button
              type="button"
              aria-label="打开导航"
              data-testid="projection-rail-toggle"
              onClick={() => setRailOverlayOpen(true)}
              style={{
                position: 'fixed', top: 54, left: 10, zIndex: 60,
                width: 40, height: 40, borderRadius: 10,
                border: '1px solid var(--gewu-border, #e4e4e7)',
                background: 'var(--gewu-bg-elevated, #fff)',
                color: 'var(--gewu-text)', fontSize: 18, lineHeight: 1,
                boxShadow: 'var(--gewu-shadow-menu)',
                cursor: 'pointer',
              }}
            >
              ☰
            </button>
            {railOverlayOpen && (
              <>
                <button
                  type="button"
                  aria-label="关闭导航"
                  onClick={() => setRailOverlayOpen(false)}
                  style={{ position: 'fixed', inset: 0, zIndex: 78, background: 'rgba(24,24,27,0.4)', border: 'none', cursor: 'default' }}
                />
                <div
                  style={{
                    position: 'fixed', top: 0, bottom: 0, left: 0, zIndex: 79,
                    width: 'min(300px, 86vw)', overflowY: 'auto', height: '100%',
                    background: 'var(--gewu-bg-surface)', boxShadow: 'var(--gewu-shadow-menu)',
                  }}
                  data-testid="projection-rail-overlay"
                >
                  <AppRail />
                </div>
              </>
            )}
          </>
        )}
        {(!projectionMobile) && <AppRail />}
        <main
          className="gewu-spa-main"
          style={{
            flex: 1,
            minWidth: 0,
            marginTop: 0,
            paddingTop: isColumnizedWorkspace ? 0 : 'var(--gewu-titlebar-height)',
            transition: 'margin-left 0.25s ease',
          }}
        >
          {/* dev mode passes through here just like production: deep-linkable
              /project/:id/<mode> and /skills routes are intentionally reachable.
              Only the dev-home skip-auto-navigate logic lives in pages/home.tsx. */}
          <Routes>
            {/* BLOCK-80 — / 为欢迎页（问候+项目/分支+首问直发）；原工作台（项目卡+创建流）退役至 /projects 项目管理 */}
            <Route path="/" element={<WelcomePage />} />
            <Route path="/projects" element={<HomePage />} />
            {/* Skills management page */}
            <Route path="/skills" element={<SkillsPage />} />
            {/* BLOCK-72 / UI-320 — 全局工作台页：知识空间（设备级域）+ 后端（全局单进程） */}
            <Route path="/knowledge" element={<KnowledgePage />} />
            <Route path="/backend" element={<BackendPage />} />
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
        </div>
        <DesktopOnboardingMount />
        <CommandPalette
          open={isOpen}
          onClose={close}
          commands={[]}
          recentConversations={[]}
        />
        {/* BLOCK-22 P4.6: DEV ONLY — do NOT use in production */}
        <Suspense fallback={null}>
          <GewuOpenFileDevBridge />
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
    html.classList.add('gewu-desktop');
    html.classList.remove('gewu-desktop-dock-collapsed');
    document.body.style.paddingLeft = '0';
    document.body.style.boxSizing = 'border-box';
  }, []);

  // BLOCK-64 P2-d — 指挥中心快捷键入口（Ctrl/Cmd+Shift+C）。仅主窗生效；
  // popOut 语义 = 单例窗已开即聚焦（同内容禁双开契约），重复按无害。
  useEffect(() => {
    if (isWindowSurface) return undefined;
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || !e.shiftKey) return;
      if (e.key.toLowerCase() !== 'c') return;
      e.preventDefault();
      void getBridge('windowManager')?.popOut('command-center');
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isWindowSurface]);

  // BLOCK-59 P1 — 独立窗（弹出结果窗/终端窗/指挥中心）加载同一 SPA 的
  // /window/* 路由：只挂 WindowShell 级 chrome，不挂主窗 Provider 树
  // （窗口永不持有 canonical state，plan §10 治理红线）。
  if (isWindowSurface) {
    return (
      <Routes>
        <Route path="/window/result/:artifactId" element={<WindowResultPage />} />
        <Route path="/window/terminal/:sessionId" element={<TerminalWindowPage />} />
        <Route path="/window/command-center" element={<CommandCenterPage />} />
        <Route path="/window/agent/:runId" element={<AgentWindowPage />} />
        <Route path="/window/rail" element={<RailPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    );
  }

  return (
    <BackendStatusProvider>
      <AppRailProvider>
        <WorkspacePanelsProvider>
          <AppShell />
        </WorkspacePanelsProvider>
      </AppRailProvider>
    </BackendStatusProvider>
  );
}
