/**
 * /spatial — 空间组学云平台 SPA 路由入口
 *
 * 状态：Wave 3-A 真功能（2026-05-28）
 * 完整 spec: .kiro/drafts/spatial-spec.md
 *
 * Wave 3-A: 项目列表页 + 数据集上传 UI（与 /single-cell 操作习惯 100% 一致）
 * Wave 3-B: 数据集详情页 + spatial 任务派发 + 结果页
 * Wave 3-C: AI Copilot 跨模块识别 + e2e
 *
 * 设计原则：
 *   - 操作习惯沿用 /single-cell（spec §5）
 *   - 通用文件复用而不是复制（_auth / _Toast / _GuestTip / _useMobileDrawer / _QuotaIndicator）
 *   - /single-cell 任何代码一行不动——隔离风险
 */
import React, { useState, useEffect } from 'react';
import { useRouter } from './_router';
import { ProjectsView } from './_ProjectsView';
import { ProjectView } from './_ProjectView';
import { DatasetView } from './_DatasetView';
import { ResultView } from './_ResultView';
import { LoginModal } from '@/components/auth/LoginModal';
import { subscribeAuth } from '@/lib/authClient';
import {
  isLoggedIn,
  getStoredUser,
  fetchMe,
  ensureGuestLogin,
  type User,
} from '../single-cell/_auth';
import { ToastContainer } from '../single-cell/_Toast';
import { GuestTipContainer } from '../single-cell/_GuestTip';
import { getApiPrefix } from '../single-cell/_config';

// ============================================================
// Global error reporting — 与 /single-cell 同套机制（避免重复注册的话需注意：
// 同一会话下用户先访问 /single-cell 再访问 /spatial，handlers 各自挂一份；
// 浏览器多次绑定同一事件无副作用——sendBeacon 是幂等的）
// ============================================================
if (typeof window !== 'undefined') {
  const reportError = (message: string, source?: string, line?: number, error?: Error) => {
    try {
      const body = JSON.stringify({
        message,
        stack: error?.stack || `at ${source}:${line}`,
        url: window.location.href,
        userAgent: navigator.userAgent.slice(0, 200),
      });
      if (navigator.sendBeacon) {
        navigator.sendBeacon(getApiPrefix() + '/error-report', body);
      } else {
        fetch(getApiPrefix() + '/error-report', {
          method: 'POST',
          body,
          headers: { 'Content-Type': 'application/json' },
        }).catch(() => {});
      }
    } catch {}
  };

  window.addEventListener('error', (e) => {
    reportError(e.message, e.filename, e.lineno, e.error);
  });

  window.addEventListener('unhandledrejection', (e) => {
    const err = e.reason instanceof Error ? e.reason : new Error(String(e.reason));
    reportError(err.message, 'unhandledrejection', 0, err);
  });

  try {
    navigator.sendBeacon?.(
      getApiPrefix() + '/pageview',
      JSON.stringify({
        path: window.location.pathname + window.location.hash,
        ts: new Date().toISOString(),
      })
    );
  } catch {}
}

function AppInner() {
  const { route, navigate } = useRouter();
  const [user, setUser] = useState<User | null>(getStoredUser());
  const [authChecked, setAuthChecked] = useState(false);
  const [showLoginModal, setShowLoginModal] = useState(false);

  useEffect(() => {
    const onOpenLogin = () => setShowLoginModal(true);
    window.addEventListener('biof3:open-login', onOpenLogin);
    const unsubAuth = subscribeAuth((u) => {
      if (u) {
        setUser(u as unknown as User);
        setShowLoginModal(false);
      } else {
        setUser(null);
      }
    });
    return () => {
      window.removeEventListener('biof3:open-login', onOpenLogin);
      unsubAuth();
    };
  }, []);

  useEffect(() => {
    if (isLoggedIn()) {
      fetchMe().then((u) => {
        setUser(u);
        setAuthChecked(true);
      });
    } else {
      ensureGuestLogin().then((gu) => {
        setAuthChecked(true);
        if (gu) setUser(gu);
      });
    }
  }, []);

  if (route.name === 'login') {
    if (typeof window !== 'undefined') {
      setTimeout(() => {
        setShowLoginModal(true);
        navigate({ name: 'projects' });
      }, 0);
    }
  }

  if (!authChecked) {
    return (
      <main className="sc-page">
        <div className="sc-main">
          <div className="sc-empty">
            <div className="sc-empty-desc">验证登录状态...</div>
          </div>
        </div>
      </main>
    );
  }

  if (!user) {
    return (
      <>
        <ProjectsView navigate={navigate} />
        <LoginModal open={showLoginModal} onClose={() => setShowLoginModal(false)} />
      </>
    );
  }

  // Wave 3-B: dataset / result 启用真实视图
  if (route.name === 'project')
    return <ProjectView projectId={route.projectId} navigate={navigate} />;
  if (route.name === 'dataset')
    return <DatasetView datasetId={route.datasetId} navigate={navigate} />;
  if (route.name === 'result')
    return <ResultView analysisId={route.analysisId} navigate={navigate} />;

  return (
    <>
      <ProjectsView navigate={navigate} />
      <LoginModal open={showLoginModal} onClose={() => setShowLoginModal(false)} />
    </>
  );
}

export default function SpatialApp(): React.ReactElement {
  return (
    <>
      <AppInner />
      <ToastContainer />
      <GuestTipContainer />
    </>
  );
}
