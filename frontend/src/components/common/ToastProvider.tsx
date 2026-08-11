import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import styles from './ToastProvider.module.css';

export type ToastVariant = 'info' | 'success' | 'warning' | 'error';

export interface ToastOptions {
  message: string;
  variant?: ToastVariant;
  duration?: number;
}

export interface ToastItem extends Required<Pick<ToastOptions, 'message' | 'variant' | 'duration'>> {
  id: string;
}

export interface ToastContextValue {
  show: (options: ToastOptions | string) => string;
  success: (message: string, duration?: number) => string;
  info: (message: string, duration?: number) => string;
  warning: (message: string, duration?: number) => string;
  error: (message: string, duration?: number) => string;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);
const DEFAULT_DURATION = 4000;
let counter = 0;

function nextId(): string {
  counter += 1;
  return `toast-${counter}-${Date.now()}`;
}

export function ToastProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const handle = timers.current.get(id);
    if (handle) {
      clearTimeout(handle);
      timers.current.delete(id);
    }
  }, []);

  const show = useCallback(
    (options: ToastOptions | string): string => {
      const normalized: ToastOptions =
        typeof options === 'string' ? { message: options } : options;
      const item: ToastItem = {
        id: nextId(),
        message: normalized.message,
        variant: normalized.variant ?? 'info',
        duration: normalized.duration ?? DEFAULT_DURATION,
      };
      setToasts((prev) => [...prev, item]);
      if (item.duration > 0) {
        const handle = setTimeout(() => dismiss(item.id), item.duration);
        timers.current.set(item.id, handle);
      }
      return item.id;
    },
    [dismiss],
  );

  const makeVariant = useCallback(
    (variant: ToastVariant) =>
      (message: string, duration?: number): string =>
        show({ message, variant, duration }),
    [show],
  );

  useEffect(() => {
    const map = timers.current;
    return () => {
      map.forEach((handle) => clearTimeout(handle));
      map.clear();
    };
  }, []);

  const value = useMemo<ToastContextValue>(
    () => ({
      show,
      dismiss,
      success: makeVariant('success'),
      info: makeVariant('info'),
      warning: makeVariant('warning'),
      error: makeVariant('error'),
    }),
    [show, dismiss, makeVariant],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      {typeof document !== 'undefined' &&
        createPortal(
          <div className={styles.viewport} aria-live="polite" data-testid="toast-viewport">
            {toasts.map((toast) => (
              <div
                key={toast.id}
                className={styles.toast}
                data-variant={toast.variant}
                role="status"
                aria-live={toast.variant === 'error' ? 'assertive' : 'polite'}
              >
                <span className={styles.message}>{toast.message}</span>
                <button
                  type="button"
                  className={styles.dismiss}
                  aria-label="Dismiss"
                  onClick={() => dismiss(toast.id)}
                >
                  &times;
                </button>
              </div>
            ))}
          </div>,
          document.body,
        )}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const value = useContext(ToastContext);
  if (!value) throw new Error('useToast must be used inside ToastProvider');
  return value;
}
