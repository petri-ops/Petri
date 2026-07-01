// ============================================================
// LoginModal — site-wide login/register popup
//
// Used by UserMenu and any "登录后才能…" CTA. Renders as a portal
// to <body> so it stacks above all docusaurus chrome.
// ============================================================

import { errMsg } from '@/lib/error';
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { login, register } from '@/lib/authClient';
import './LoginModal.css';

export interface LoginModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  /** Optional starting tab. */
  defaultMode?: 'login' | 'register';
  /** Optional message shown above the form (e.g. "登录后才能保存进度"). */
  ctaMessage?: string;
}

export function LoginModal({
  open,
  onClose,
  onSuccess,
  defaultMode = 'login',
  ctaMessage,
}: LoginModalProps): React.ReactElement | null {
  const [mode, setMode] = useState<'login' | 'register'>(defaultMode);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showWelcome, setShowWelcome] = useState(false);
  const [registeredName, setRegisteredName] = useState('');
  const usernameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setError('');
      setMode(defaultMode);
      setShowWelcome(false);
      setTimeout(() => usernameRef.current?.focus(), 50);
    }
  }, [open, defaultMode]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open || typeof document === 'undefined') return null;

  const handleSubmit = async () => {
    if (!username.trim() || !password) return;
    // Frontend validation for register mode
    if (mode === 'register') {
      if (username.trim().length < 2 || username.trim().length > 20) {
        setError('用户名需要 2-20 个字符');
        return;
      }
      if (password.length < 6) {
        setError('密码至少 6 位');
        return;
      }
      if (password !== confirmPassword) {
        setError('两次输入的密码不一致');
        return;
      }
    }
    setError('');
    setLoading(true);
    try {
      let result;
      if (mode === 'login') {
        result = await login(username.trim(), password);
      } else {
        result = await register(username.trim(), password);
      }
      if (result.ok) {
        if (mode === 'register') {
          setRegisteredName(username.trim());
          setShowWelcome(true);
        } else {
          onSuccess?.();
          onClose();
        }
      } else {
        setError(result.error || '操作失败');
      }
    } catch (e: unknown) {
      setError(errMsg(e) || '网络错误');
    } finally {
      setLoading(false);
    }
  };

  // Welcome view after successful registration
  if (showWelcome) {
    const welcomeNode = (
      <div
        className="biof3-login-modal-overlay"
        onClick={() => {
          onSuccess?.();
          onClose();
        }}
      >
        <div
          className="biof3-login-modal"
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
        >
          <button
            type="button"
            className="biof3-login-modal__close"
            onClick={() => {
              onSuccess?.();
              onClose();
            }}
            aria-label="关闭"
          >
            ×
          </button>

          <div className="biof3-login-modal__welcome">
            <div className="biof3-login-modal__welcome-emoji">🎉</div>
            <h2>欢迎加入 BioF3，{registeredName}！</h2>
            <p className="biof3-login-modal__welcome-desc">
              注册成功。下面是几个快速入口，帮你 5 分钟内体验核心功能：
            </p>
            <div className="biof3-login-modal__welcome-links">
              <a
                href="/quickstart"
                className="biof3-login-modal__welcome-link"
                onClick={() => {
                  onSuccess?.();
                  onClose();
                }}
              >
                <span className="biof3-login-modal__welcome-link-icon">🚀</span>
                <span>
                  <strong>5 分钟快速上手</strong>
                  <small>跑通第一个 DESeq2 分析</small>
                </span>
              </a>
              <a
                href="/docs"
                className="biof3-login-modal__welcome-link"
                onClick={() => {
                  onSuccess?.();
                  onClose();
                }}
              >
                <span className="biof3-login-modal__welcome-link-icon">📖</span>
                <span>
                  <strong>浏览教程</strong>
                  <small>65 篇中文组学教程</small>
                </span>
              </a>
              <a
                href="/tools"
                className="biof3-login-modal__welcome-link"
                onClick={() => {
                  onSuccess?.();
                  onClose();
                }}
              >
                <span className="biof3-login-modal__welcome-link-icon">🧪</span>
                <span>
                  <strong>在线工具</strong>
                  <small>11 个 SCI 级分析工具</small>
                </span>
              </a>
            </div>
            <button
              type="button"
              className="biof3-login-modal__submit"
              onClick={() => {
                onSuccess?.();
                onClose();
              }}
            >
              开始探索
            </button>
          </div>
        </div>
      </div>
    );
    return createPortal(welcomeNode, document.body);
  }

  const node = (
    <div className="biof3-login-modal-overlay" onClick={onClose}>
      <div
        className="biof3-login-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <button
          type="button"
          className="biof3-login-modal__close"
          onClick={onClose}
          aria-label="关闭"
        >
          ×
        </button>

        <div className="biof3-login-modal__brand">
          <strong>BioF3</strong>
          <span className="biof3-login-modal__tagline">AI 陪伴的全组学学习平台</span>
        </div>

        {ctaMessage && <div className="biof3-login-modal__cta">{ctaMessage}</div>}

        <div className="biof3-login-modal__tabs">
          <button
            type="button"
            className={`biof3-login-modal__tab ${mode === 'login' ? 'is-active' : ''}`}
            onClick={() => {
              setMode('login');
              setError('');
            }}
          >
            登录
          </button>
          <button
            type="button"
            className={`biof3-login-modal__tab ${mode === 'register' ? 'is-active' : ''}`}
            onClick={() => {
              setMode('register');
              setError('');
            }}
          >
            注册
          </button>
        </div>

        <div className="biof3-login-modal__form">
          <div className="biof3-login-modal__field">
            <label>用户名</label>
            <input
              ref={usernameRef}
              type="text"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSubmit();
              }}
              placeholder="2-20 个字符"
            />
          </div>
          <div className="biof3-login-modal__field">
            <label>密码</label>
            <input
              type="password"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSubmit();
              }}
              placeholder="至少 6 位"
            />
            {mode === 'register' && password.length > 0 && password.length < 6 && (
              <span className="biof3-login-modal__hint">还需要 {6 - password.length} 个字符</span>
            )}
          </div>
          {mode === 'register' && (
            <div className="biof3-login-modal__field">
              <label>确认密码</label>
              <input
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSubmit();
                }}
                placeholder="再输入一次密码"
              />
              {confirmPassword.length > 0 && password !== confirmPassword && (
                <span className="biof3-login-modal__hint biof3-login-modal__hint--error">
                  密码不一致
                </span>
              )}
            </div>
          )}
          {error && <div className="biof3-login-modal__error">{error}</div>}
          <button
            type="button"
            className="biof3-login-modal__submit"
            onClick={handleSubmit}
            disabled={
              loading ||
              !username.trim() ||
              !password ||
              (mode === 'register' && (password.length < 6 || password !== confirmPassword))
            }
          >
            {loading ? '请稍候…' : mode === 'login' ? '登录' : '注册'}
          </button>
        </div>

        <div className="biof3-login-modal__footer">
          {mode === 'login' ? (
            <span>
              没有账号？
              <button type="button" onClick={() => setMode('register')}>
                注册
              </button>
            </span>
          ) : (
            <span>
              已有账号？
              <button type="button" onClick={() => setMode('login')}>
                登录
              </button>
            </span>
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(node, document.body);
}

export default LoginModal;
