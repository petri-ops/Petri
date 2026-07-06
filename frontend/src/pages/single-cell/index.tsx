import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from './_router';
import { ProjectsView } from './_ProjectsView';
import { ProjectView } from './_ProjectView';
import { DatasetView } from './_DatasetView';
import { ResultView } from './_ResultView';
import { LoginModal } from '@/components/auth/LoginModal';
import { subscribeAuth } from '@/lib/authClient';
import { isLoggedIn, getStoredUser, logout, fetchMe, ensureGuestLogin, type User } from './_auth';
import { ToastContainer } from './_Toast';
import { GuestTipContainer } from './_GuestTip';
import { AdminPanel, isAdminEnabled } from './_AdminPanel';
import { PageHeader } from '@/components/ui/PageHeader';
// User menu lives in the global navbar (src/components/auth/UserMenu.tsx).
// Storage quota lives in the sidebar (src/pages/single-cell/_QuotaIndicator.tsx).
// Agent Mode toggle lives in the Copilot Memory panel (src/components/copilot/MemoryPanel.tsx).
import { getApiPrefix } from './_config';
import { installSingleCellActionHandler } from './_copilotActionHandler';

// ============================================================
// Global error reporting — sends unhandled errors to server log
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

  // Simple pageview tracking (fire-and-forget)
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

  // Subscribe to global auth changes (login modal triggers this)
  useEffect(() => {
    const onOpenLogin = () => setShowLoginModal(true);
    window.addEventListener('biof3:open-login', onOpenLogin);
    const unsubAuth = subscribeAuth((u) => {
      if (u) {
        setUser(u as Record<string, unknown>);
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

  // Check auth on mount
  useEffect(() => {
    // Install Copilot action handler once
    const unsub = installSingleCellActionHandler();
    if (isLoggedIn()) {
      fetchMe().then((u) => {
        setUser(u);
        setAuthChecked(true);
      });
    } else {
      // No token — auto guest-login if enabled
      ensureGuestLogin().then((gu) => {
        setAuthChecked(true);
        if (gu) {
          setUser(gu);
        }
        // If no guest login available, show modal (but don't block — let user see Demo first)
      });
    }
    return () => {
      unsub();
    };
  }, []);

  const _handleLogin = useCallback(() => {
    setUser(getStoredUser());
  }, []);

  const _handleLogout = useCallback(() => {
    logout();
    setUser(null);
  }, []);

  // Show login modal when route requests it
  if (route.name === 'login') {
    // Redirect to projects view and pop the global modal
    if (typeof window !== 'undefined') {
      setTimeout(() => {
        setShowLoginModal(true);
        navigate({ name: 'projects' });
      }, 0);
    }
  }

  // Auth guard — show loading state while checking auth
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

  // If not logged in (and not guest), show projects in read-only mode + login modal
  if (!user) {
    return (
      <>
        <ProjectsView navigate={navigate} />
        <LoginModal open={showLoginModal} onClose={() => setShowLoginModal(false)} />
      </>
    );
  }

  // Authenticated routes
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

export default function ScRNAApp(): React.ReactElement {
  return (
    <>
      <PageHeader
        title="单细胞云平台"
        subtitle="单细胞转录组数据分析云平台"
        icon="dna"
        breadcrumb={[{ label: '首页', href: '/' }, { label: '单细胞云平台' }]}
      />
      <AppInner />
      <ToastContainer />
      <GuestTipContainer />
      {isAdminEnabled() && <AdminPanel />}
    </>
  );
}
