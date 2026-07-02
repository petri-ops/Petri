// ============================================================
// StudyWithCopilotButton — "🎓 让 AI 带我实战这一篇"
//
// Mounted at the top of the docs footer (see src/theme/DocItem/Footer).
// On click, fires `biof3:copilot-study` with the doc's metadata. The
// CopilotChat component listens, opens the panel, and auto-sends a
// structured tutoring prompt that nudges the agent to create a plan
// + verify learning outcomes.
//
// Renders:
//   - if doc has copilot.* metadata → the banner shows level / minutes
//   - if not → still renders, just without the meta hints. Better to have
//     the entry point everywhere than to hide it on un-tagged docs.
// ============================================================

import React, { useEffect, useState } from 'react';
import { fetchCopilotIndex, type CopilotIndexDoc } from './copilotIndexClient';
import {
  isLoggedIn,
  subscribeAuth,
  getStoredUser,
  hasModule,
  type AuthUser,
} from '@site/src/components/auth/authClient';
import { LoginModal } from '@site/src/components/auth/LoginModal';
import { Icon } from '@site/src/components/icons/Icon';
import './StudyWithCopilotButton.css';

interface StudyWithCopilotButtonProps {
  /** Doc URL, e.g. '/docs/single-cell/module01' */
  resource: string;
}

export function StudyWithCopilotButton({
  resource,
}: StudyWithCopilotButtonProps): React.ReactElement | null {
  const [doc, setDoc] = useState<CopilotIndexDoc | null>(null);
  const [showLogin, setShowLogin] = useState(false);
  const [authed, setAuthed] = useState<boolean>(false);
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    setAuthed(isLoggedIn());
    setUser(getStoredUser());
    return subscribeAuth((u) => {
      setAuthed(!!u);
      setUser(u);
    });
  }, []);

  // MODULE_PERMS_v1: AI 组学实践受 copilot 模块授权控制（默认关，管理员逐个放开）。
  const copilotAllowed = !authed || hasModule(user, 'copilot');

  useEffect(() => {
    let cancelled = false;
    fetchCopilotIndex().then((idx) => {
      if (cancelled || !idx) return;
      const norm = resource.replace(/\/$/, '');
      const found = (idx.docs || []).find((d) => d.url === norm) || null;
      setDoc(found);
    });
    return () => {
      cancelled = true;
    };
  }, [resource]);

  const meta = doc?.copilot || null;
  const level = meta?.level;
  const minutes = meta?.estimated_minutes;
  const domain = meta?.domain;

  const handleClick = () => {
    if (typeof window === 'undefined') return;
    if (!authed) {
      // Defer the actual study event until login completes
      setShowLogin(true);
      return;
    }
    if (!copilotAllowed) return; // MODULE_PERMS_v1: gated
    fireStudyEvent();
  };

  const fireStudyEvent = () => {
    if (typeof window === 'undefined') return;
    // Pull the page-level summary if we have it; otherwise take the visible
    // first paragraph as a fallback so AI has something to anchor on.
    let docSummary = doc?.summary || '';
    if (!docSummary) {
      const article = document.querySelector('article');
      const firstP = article?.querySelector('p')?.textContent || '';
      docSummary = firstP.slice(0, 600);
    }
    const docTitle = doc?.title || document.title.replace(/\s*\|.*$/, '').trim() || '当前文档';

    window.dispatchEvent(
      new CustomEvent('biof3:copilot-study', {
        detail: {
          docTitle,
          docUrl: resource,
          docSummary,
          docDomain: domain || null,
          docMinutes: minutes || null,
        },
      })
    );
  };

  return (
    <section className="biof3-study-banner" aria-labelledby="biof3-study-title">
      <div className="biof3-study-banner__text">
        <div className="biof3-study-banner__eyebrow">AI 组学实践</div>
        <h2 id="biof3-study-title">
          <Icon name="graduation-cap" size={20} className="biof3-study-banner__icon" />让 AI
          带我实战这一篇
        </h2>
        <p className="biof3-study-banner__hint">
          {meta ? (
            <>
              AI 会基于这篇的元数据
              {domain && (
                <>
                  {' '}
                  · 领域 <code>{domain}</code>
                </>
              )}
              {level && (
                <>
                  {' '}
                  · 难度 <code>{level}</code>
                </>
              )}
              {typeof minutes === 'number' && <> · 约 {minutes} 分钟</>} 给你制定 3-5
              步学习计划，逐步带你学完，最后出 1-3 道题验证。
            </>
          ) : (
            <>
              AI 会读这篇文章后给你 3-5 步学习计划， 逐步带你学完，最后出 1-3
              道题验证你掌握得怎么样。
            </>
          )}
          {!authed && (
            <>
              {' '}
              <span className="biof3-study-banner__hint-note">登录后 AI 才能记住你的进度。</span>
            </>
          )}
          {authed && !copilotAllowed && (
            <>
              {' '}
              <span className="biof3-study-banner__hint-note">
                AI 组学实践暂未对你的账号开放，如需使用请联系管理员。
              </span>
            </>
          )}
        </p>
      </div>
      <div className="biof3-study-banner__actions">
        <button
          type="button"
          className="biof3-study-banner__cta"
          onClick={handleClick}
          disabled={authed && !copilotAllowed}
          aria-label="让 AI 带我实战这一篇"
        >
          {!authed ? '登录后开始实战' : copilotAllowed ? '开始实战' : '未开放'}
        </button>
      </div>
      <LoginModal
        open={showLogin}
        onClose={() => setShowLogin(false)}
        ctaMessage="登录后让 AI 带你实战这一篇并记住进度"
        onSuccess={() => {
          setTimeout(() => fireStudyEvent(), 100);
        }}
      />
    </section>
  );
}

export default StudyWithCopilotButton;
