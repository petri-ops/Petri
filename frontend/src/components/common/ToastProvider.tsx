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
  /** 已消失提示的有界历史（POST-S7 H2/B-07）：最新在前，去重，最多 HISTORY_LIMIT 条。 */
  history: ToastItem[];
  historyOpen: boolean;
  openHistory: () => void;
  closeHistory: () => void;
  clearHistory: () => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);
const DEFAULT_DURATION = 4000;
// POST-S7 H2/B-07——4 秒提示消失后用户无从回看（尤其 error/warning 一闪而过）。
// 这里不新建第二套通知中心：历史就是「已经播报过的 toast」的有界队列，
// 上限 50 条、同 (variant,message) 去重合并，只做回看，不做投递。
const HISTORY_LIMIT = 50;
let counter = 0;

function nextId(): string {
  counter += 1;
  return `toast-${counter}-${Date.now()}`;
}

export function ToastProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [history, setHistory] = useState<ToastItem[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const openHistory = useCallback(() => setHistoryOpen(true), []);
  const closeHistory = useCallback(() => setHistoryOpen(false), []);
  const clearHistory = useCallback(() => setHistory([]), []);

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
      // 历史在「播报时」就记，而不是「消失时」：duration<=0（常驻提示）也必须可回看。
      setHistory((prev) => {
        const dedup = prev.filter((t) => !(t.variant === item.variant && t.message === item.message));
        return [item, ...dedup].slice(0, HISTORY_LIMIT);
      });
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
      history,
      historyOpen,
      openHistory,
      closeHistory,
      clearHistory,
    }),
    [show, dismiss, makeVariant, history, historyOpen, openHistory, closeHistory, clearHistory],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      {typeof document !== 'undefined' &&
        createPortal(
          <div className={styles.viewport} aria-live="polite" data-testid="toast-viewport">
            {history.length > 0 && (
              <div className={styles.historyBar}>
                <button
                  type="button"
                  className={styles.historyToggle}
                  data-testid="toast-history-toggle"
                  aria-expanded={historyOpen}
                  aria-controls="toast-history-panel"
                  onClick={() => (historyOpen ? closeHistory() : openHistory())}
                >
                  通知历史（{history.length}）
                </button>
                {historyOpen && (
                  <div
                    className={styles.historyPanel}
                    id="toast-history-panel"
                    data-testid="toast-history-panel"
                    role="log"
                    aria-label="通知历史（最近 50 条，最新在前）"
                  >
                    <div className={styles.historyHeader}>
                      <span>最近通知</span>
                      <button type="button" className={styles.historyClear} onClick={clearHistory}>
                        清空
                      </button>
                    </div>
                    <ul className={styles.historyList}>
                      {history.map((item) => (
                        <li key={`history-${item.id}`} className={styles.historyItem} data-variant={item.variant}>
                          <span className={styles.historyVariant}>{item.variant}</span>
                          <span className={styles.historyMessage}>{item.message}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
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
