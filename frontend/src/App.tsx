// Petri 桌面版原生 shell — App 根组件
// 路由出口 + 首次启动引导

import React, { useEffect, lazy, Suspense } from 'react';

// BLOCK-22 P4.6: DEV ONLY — manual file-open testing entry via window.__petriDispatchOpenFile
// Production build: React.lazy + NODE_ENV=production → tree-shakeable, zero runtime cost
const PetriOpenFileDevBridge = lazy(() =>
  import('./components/editor/integration/PetriOpenFileDevBridge')
);
import { Routes, Route, Navigate, useLocation, useParams , useNavigate } from 'react-router-dom';
import { TitleBar } from '@/components/desktop/TitleBar';
import { TestInstanceBadge } from '@/components/desktop/TestInstanceBadge';
import { WorkspacePanelsProvider, useWorkspacePanelsContext } from '@/components/desktop/WorkspacePanelsContext';
import { AppRail } from '@/components/desktop/AppRail';
import { AppRailProvider } from '@/components/desktop/AppRailContext';
import { isProjectionMobile } from '@/components/desktop/titlebar/shared';
import { ProjectionLinkBanner } from '@/components/desktop/_ProjectionLinkBanner';
import { CrashNoticeBanner } from '@/components/desktop/CrashNoticeBanner';
import { BackendStatusProvider } from '@/components/backend/BackendStatusProvider';
import { CopilotContextProvider } from '@/lib/copilotContextProvider';
import { getBridge } from '@/lib/desktopBridge';
import { CommandPalette, useCommandPalette } from '@/components/copilot/CommandPalette';
// BLOCK-200 P1 — 键位注册表运行时面（Provider + App 级派发器）
import { KeymapProvider, useAppKeymapDispatcher } from '@/lib/appKeymapContext';
import { useAppCommands } from '@/components/copilot/useAppCommands';
import { RouteErrorBoundary } from '@/components/RouteErrorBoundary';
// BLOCK-223 — 桌面外壳渲染侧宿主（通知偏好镜像 + 退出摘要弹窗）
import { DesktopShellProvider } from '@/components/shell/DesktopShellProvider';
// BLOCK-42 — pending-scroll 全局 Provider（见 AppShell 内注释）
import { PendingScrollProvider } from '@/lib/pendingScrollContext';
// BLOCK-106 P1 — 路由级代码分割：首屏路由 `/`（欢迎页）保持直包，其余页面切
// chunk。此前 App.tsx 十个路由页全静态引入 → 主 chunk 3,061,221 B，Electron 启动
// 需解析全部页面代码（实测 dataReady 基线见 docs/block-106-*.md §0）。
import WelcomePage from '@/pages/welcome';
const HomePage = lazy(() => import('@/pages/home').then((m) => ({ default: m.default })));
// NOTE: Legacy pages (tools, admin, docs, figcode, single-cell, spatial) have been removed
// as the desktop application now uses the Agent-based workflow through ProjectWorkspace.
const ProjectWorkspace = lazy(() => import('@/pages/project-workspace').then((m) => ({ default: m.ProjectWorkspace })));
// BLOCK-156 — 扩展中心（四货架单入口）；旧 /skills /plugins 独立页退役为重定向
const ExtensionsPage = lazy(() => import('@/pages/extensions').then((m) => ({ default: m.default })));

// UI-456（PL-4c）— 旧独立结果页 URL 优雅回落工作区（hook 必须在真组件内：
// IIFE 里 useParams 读到的是父层空 params，实机抓真 /project/undefined）
function LegacyResultsRedirect(): React.ReactElement {
  const { projectId } = useParams();
  return <Navigate replace to={`/project/${projectId ?? ''}`} />;
}
const SettingsPage = lazy(() => import('@/pages/settings').then((m) => ({ default: m.default })));
const KnowledgePage = lazy(() => import('@/pages/knowledge').then((m) => ({ default: m.default })));
// BLOCK-28 — main-area code review mode (VS Code SCM style)
const ReviewModePage = lazy(() => import('@/pages/review').then((m) => ({ default: m.ReviewModePage })));
// BLOCK-59 P1 — 独立窗路由面：/window/* 不走主窗 AppShell（无 TitleBar/
// Copilot 等 workspace chrome），由 WindowShell 提供最小只读 chrome。
// BLOCK-59 P2 — 终端独立窗 + 边缘活动轨道（内部专用路由）
const TerminalWindowPage = lazy(() => import('@/pages/window/TerminalWindowPage').then((m) => ({ default: m.TerminalWindowPage })));
const RailPage = lazy(() => import('@/components/window/RailPage').then((m) => ({ default: m.RailPage })));
// BLOCK-59 P3 — 指挥中心（多任务俯瞰单例窗）
const CommandCenterPage = lazy(() => import('@/pages/window/CommandCenterPage').then((m) => ({ default: m.CommandCenterPage })));
// BLOCK-59 P4 — agent 详情窗（BLOCK-49 spawn 链路只读投影）
import '@/components/desktop/desktop.css';
// 断点6：注入平台 API 给 @petri/shared 渲染层组件（如 ActResultCard）
import { configureApi } from '../../core/packages/shared-copilot/api-inject';
import { getApiPrefix, getToken } from '@/lib/authClient';
configureApi({ getApiPrefix: () => getApiPrefix(), getToken });

/** BLOCK-106 P1 — chunk 加载期间的占位：撑满 main 高度，避免页面切换时布局跳动。
 *  刻意不画 spinner（本地 file/http 加载通常 <1 帧，闪一下比空白更扰人）。 */
function RouteFallback(): React.ReactElement {
  return <div style={{ height: '100%', minHeight: 240 }} aria-busy="true" data-testid="route-suspense-fallback" />;
}

/** Lives inside WorkspacePanelsProvider. */
function AppShell(): React.ReactElement {
  const { isOpen, close } = useCommandPalette();
  const location = useLocation();
  const navigate = useNavigate();
  // BLOCK-171 CP-3 — 命令面板真命令源（五类：导航/项目/会话/技能/设置深链）。
  const currentProjectId = (() => {
    const m = location.pathname.match(/^\/project\/([^/]+)/);
    return m ? m[1] : null;
  })();
  // react-router navigate 返回 void | Promise<void>；面板契约约定 void，
  // 包装消掉 no-misused-promises（异步导航语义不外泄）。
  const navigateForPalette = (to: string): void => {
    void navigate(to);
  };
  const { commands, recentConversations, selectConversation } = useAppCommands({
    enabled: isOpen,
    navigate: navigateForPalette,
    currentProjectId,
  });
  // BLOCK-200 P1 — App 级键位派发器：读键位注册表执行命令源里的 nav-* 动作，
  // 以及指挥中心独立窗（原 App 根里写死 Ctrl/Cmd+Shift+C 的那处Effect已收编到这里）。
  // 挂在这里而非根组件：命令源在此、且弹出窗（/window/*）不挂本壳，路由门语义与迁移前一致。
  const keymapActions = React.useMemo<Record<string, () => void>>(() => {
    const actions: Record<string, () => void> = {};
    for (const command of commands) {
      if (command.id.startsWith('nav-') && typeof command.action === 'function') {
        actions[command.id] = command.action;
      }
    }
    actions['command-center.popOut'] = () => {
      void getBridge('windowManager')?.popOut('command-center');
    };
    return actions;
  }, [commands]);
  useAppKeymapDispatcher(keymapActions);
  const panels = useWorkspacePanelsContext();
  // (/project/:id/results) 与其余路由维持原状。归一化尾斜杠后取 :id 后的子段判定。
  // BLOCK-62 P0 — 列体化壳：仅 ProjectWorkspace 路由（/project/:id/*）走「列容器
  // 占满视口 + 列内让位固定顶栏」新地基，main 不再 paddingTop 让位；ResultStudio
  // (/project/:id/results) 与其余路由维持原状。归一化尾斜杠后取 :id 后的子段判定。
  const isColumnizedWorkspace = (() => {
    const path = location.pathname.replace(/\/+$/, '') || '/';
    const m = path.match(/^\/project\/[^/]+(?:\/(.*))?$/);
    return !!m;
  })();
  // BLOCK-87 L3 — 投影+窄屏（手机浏览器）：壳层 AppRail 转抽屉浮层。
  // L3-2（用户裁决「左上角的左侧展开栏就直接控制左侧栏的展开和收缩」）：
  // 撤掉独立 ☰ 浮层按钮——标题栏左上「展开/收起左侧栏」（panels.toggleLeft）
  // 直接开合抽屉，leftOpen 在该形态下即抽屉开合单一真相；leftOpen 初始值
  // 已由 useWorkspacePanels 在投影窄屏下置 false（手机首屏不被抽屉盖住）。
  // 桌面端恒 false 不受影响（UI-341 常驻裁决仅针对桌面窗口）。
  const projectionMobile = isProjectionMobile();
  const { setLeftOpen } = panels;
  useEffect(() => {
    // 路由变化即收起抽屉（点导航项跳转后不残留遮罩；含挂载首帧的兜底收起）
    if (projectionMobile) setLeftOpen(false);
  }, [projectionMobile, setLeftOpen, location.pathname]);

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
        {projectionMobile && panels.leftOpen && (
          <>
            <button
              type="button"
              aria-label="关闭导航"
              onClick={() => setLeftOpen(false)}
              style={{ position: 'fixed', inset: 0, zIndex: 78, background: 'rgba(24,24,27,0.4)', border: 'none', cursor: 'default' }}
            />
            <div
              style={{
                position: 'fixed', top: 0, bottom: 0, left: 0, zIndex: 79,
                width: 'min(300px, 86vw)', overflowY: 'auto', height: '100%',
                background: 'var(--petri-bg-surface)', boxShadow: 'var(--petri-shadow-menu)',
              }}
              data-testid="projection-rail-overlay"
            >
              <AppRail />
            </div>
          </>
        )}
        {(!projectionMobile) && <AppRail />}
        <main
          className="petri-spa-main"
          style={{
            flex: 1,
            minWidth: 0,
            marginTop: 0,
            paddingTop: isColumnizedWorkspace ? 0 : 'var(--petri-titlebar-height)',
            transition: 'margin-left 0.25s ease',
          }}
        >
          {/* dev mode passes through here just like production: deep-linkable
              /project/:id/<mode> and /skills routes are intentionally reachable.
              Only the dev-home skip-auto-navigate logic lives in pages/home.tsx. */}
          {/* 路由级错误边界：任何路由页渲染异常不再白屏整树（健壮性兜底） */}
          <RouteErrorBoundary>
          <Suspense fallback={<RouteFallback />}>
          <Routes>
            {/* BLOCK-80 — / 为欢迎页（问候+项目/分支+首问直发）；原工作台（项目卡+创建流）退役至 /projects 项目管理 */}
            <Route path="/" element={<WelcomePage />} />
            <Route path="/projects" element={<HomePage />} />
            {/* BLOCK-156 — 扩展中心（领域插件/领域技能/通用技能/MCP 服务四货架，
                D1 裁决单页货签）；旧 /skills /plugins 深链 fail-closed 重定向保底 */}
            <Route path="/extensions" element={<ExtensionsPage />} />
            <Route path="/skills" element={<Navigate to="/extensions?tab=domain-skills" replace />} />
            <Route path="/plugins" element={<Navigate to="/extensions?tab=domain-plugins" replace />} />
            {/* UI-365 — 设置独立页（设备级能力，不绑项目；与 /skills 同形态） */}
            <Route path="/settings" element={<SettingsPage />} />
            {/* BLOCK-72 / UI-320 → UI-366 — 知识空间保留全局页；「后端」页退役，
                诊断并入设置「运行时与诊断」分区 */}
            <Route path="/knowledge" element={<KnowledgePage />} />
            {/* BLOCK-28 — main-area code review mode (VS Code SCM style) */}
            <Route path="/review" element={<ReviewModePage />} />
            {/* UI-456（PL-4c）— 独立结果页退役：旧 URL/收藏优雅回落工作区（双轨收敛，
                JSON dump 原型面随之消除；数据层 IPC 去留另行裁决，见勘察文档）。
                相对 to 按 route 层级解析不可用（`..` 会落到根），params 显式跳转。 */}
            <Route path="/project/:projectId/results" element={<LegacyResultsRedirect />} />
            {/* T85: `*` splat lets `/project/:projectId/<mode>` resolve to the
                same workspace; mode is read from the sub-path, not `?mode=`. */}
            <Route path="/project/:projectId/*" element={<ProjectWorkspace />} />
            {/* Legacy pages (tools, admin, docs, figcode) removed - all workflows now use Agent */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          </Suspense>
          </RouteErrorBoundary>
        </main>
        </div>
        <TestInstanceBadge />
        <CommandPalette
          open={isOpen}
          onClose={close}
          commands={commands}
          recentConversations={recentConversations}
          onSelectConversation={selectConversation}
        />
        {/* BLOCK-22 P4.6: DEV ONLY — do NOT use in production */}
        <Suspense fallback={null}>
          <PetriOpenFileDevBridge />
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
    html.classList.add('petri-desktop');
    html.classList.remove('petri-desktop-dock-collapsed');
    document.body.style.paddingLeft = '0';
    document.body.style.boxSizing = 'border-box';
  }, []);

  // BLOCK-64 P2-d / BLOCK-200 P1 — 指挥中心快捷键入口改由**键位注册表**派发
  // （此前此处写死 Ctrl/Cmd+Shift+C，用户改了设置页不会跟着变）。派发器已上收到
  // AppShell（命令源在那里），弹出窗走上面的 WindowShell 分支提前返回，路由门语义不变。

  // BLOCK-59 P1 — 独立窗（弹出结果窗/终端窗/指挥中心）加载同一 SPA 的
  // /window/* 路由：只挂 WindowShell 级 chrome，不挂主窗 Provider 树
  // （窗口永不持有 canonical state，plan §10 治理红线）。
  if (isWindowSurface) {
    return (
      <RouteErrorBoundary>
      <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/window/terminal/:sessionId" element={<TerminalWindowPage />} />
        <Route path="/window/command-center" element={<CommandCenterPage />} />
        <Route path="/window/rail" element={<RailPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </Suspense>
      </RouteErrorBoundary>
    );
  }

  return (
    <DesktopShellProvider>
      <BackendStatusProvider>
        {/* BLOCK-159 P1-9 / UI-482 — 投影断连横幅（仅投影环境渲染，桌面零行为） */}
        <ProjectionLinkBanner />
        <CrashNoticeBanner />
        <AppRailProvider>
          <WorkspacePanelsProvider>
            {/* BLOCK-200 P1 — 键位注册表：命令面板徽章、App 级派发器、工作区/档位快捷键同源 */}
            <KeymapProvider>
              <AppShell />
            </KeymapProvider>
          </WorkspacePanelsProvider>
        </AppRailProvider>
      </BackendStatusProvider>
    </DesktopShellProvider>
  );
}
