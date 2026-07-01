import React, { useState, useEffect, useCallback } from 'react';

export interface ToastItem {
  id: string;
  type: 'success' | 'error' | 'info';
  title: string;
  message?: string;
  onClick?: () => void;
}

let toastListeners: Array<(t: ToastItem) => void> = [];

/** Call from anywhere to show a toast */
export function showToast(item: Omit<ToastItem, 'id'>) {
  const toast: ToastItem = {
    ...item,
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
  };
  toastListeners.forEach((fn) => fn(toast));

  // Browser notification when tab is not visible
  if (typeof document !== 'undefined' && document.hidden) {
    sendBrowserNotification(item.title, item.message, item.onClick);
  }
}

// ============================================================
// Browser Notification API
// ============================================================

let notificationPermission: NotificationPermission = 'default';

/** Request notification permission (call once on user interaction) */
export function requestNotificationPermission() {
  if (typeof Notification === 'undefined') return;
  if (Notification.permission === 'granted') {
    notificationPermission = 'granted';
    return;
  }
  if (Notification.permission !== 'denied') {
    Notification.requestPermission().then((p) => {
      notificationPermission = p;
    });
  }
}

function sendBrowserNotification(title: string, body?: string, onClick?: () => void) {
  if (typeof Notification === 'undefined') return;
  if (Notification.permission !== 'granted') {
    // Try requesting permission
    Notification.requestPermission().then((p) => {
      notificationPermission = p;
      if (p === 'granted') doSend();
    });
    return;
  }
  doSend();

  function doSend() {
    const n = new Notification(`BioF3 · ${title}`, {
      body: body || '',
      icon: '/img/biof3-favicon.png',
      tag: 'biof3-analysis', // replace previous notification
    });
    n.onclick = () => {
      window.focus();
      onClick?.();
      n.close();
    };
    // Auto-close after 8s
    setTimeout(() => n.close(), 8000);
  }
}

/** Mount this once at the app root */
export function ToastContainer() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  useEffect(() => {
    const handler = (t: ToastItem) => {
      setToasts((prev) => [...prev, t]);
      // Auto-dismiss after 5s
      setTimeout(() => {
        setToasts((prev) => prev.filter((x) => x.id !== t.id));
      }, 5000);
    };
    toastListeners.push(handler);
    return () => {
      toastListeners = toastListeners.filter((fn) => fn !== handler);
    };
  }, []);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((x) => x.id !== id));
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className="sc-toast-container">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`sc-toast sc-toast-${t.type}`}
          onClick={() => {
            t.onClick?.();
            dismiss(t.id);
          }}
        >
          <div className="sc-toast-icon">
            {t.type === 'success' && '✓'}
            {t.type === 'error' && '✗'}
            {t.type === 'info' && 'ℹ'}
          </div>
          <div className="sc-toast-content">
            <div className="sc-toast-title">{t.title}</div>
            {t.message && <div className="sc-toast-msg">{t.message}</div>}
          </div>
          <button
            className="sc-toast-close"
            onClick={(e) => {
              e.stopPropagation();
              dismiss(t.id);
            }}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
