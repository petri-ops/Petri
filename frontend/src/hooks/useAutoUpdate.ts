/**
 * useAutoUpdate — unified update state for the Petri desktop shell.
 *
 * Subscribes to window.petriDesktop.updater IPC events and exposes a
 * single source of truth for desktop update surfaces such as DesktopSettingsPanel.
 *
 * State is session-only (lives in React state, resets on page refresh —
 * which is correct for update UX).
 */
import { useCallback, useEffect, useState } from 'react';

export interface AutoUpdateState {
  /** True after mount check finds a newer version. */
  available: boolean;
  /** Version string of the available update. */
  availableVersion: string;
  /** True while `check()` is in flight. */
  checking: boolean;
  /** True while a download is in progress. */
  downloading: boolean;
  /** Download progress 0..1 (null when not downloading). */
  progress: number | null;
  /** True after the update bundle has been downloaded. */
  downloaded: boolean;
  /** Last error message (cleared on next action). */
  error: string;
  /** True after a successful check confirms there is no newer version. */
  upToDate: boolean;
  /** True while `install()` is in flight. */
  installing: boolean;
}

export interface AutoUpdateActions {
  check: () => Promise<void>;
  download: () => Promise<void>;
  install: () => Promise<void>;
}

export function useAutoUpdate(): AutoUpdateState & AutoUpdateActions {
  const [available, setAvailable] = useState(false);
  const [availableVersion, setAvailableVersion] = useState('');
  const [checking, setChecking] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [downloaded, setDownloaded] = useState(false);
  const [error, setError] = useState('');
  const [upToDate, setUpToDate] = useState(false);
  const [installing, setInstalling] = useState(false);

  // BLOCK-453 架构修正：轮询与系统通知由主进程持有（主进程常驻，不依赖本 hook 挂载）。
  // 本 hook 只做两件事：①打开设置页时拉一次当前状态；②订阅主进程推送的检查结果。
  useEffect(() => {
    const updater = window.petriDesktop?.updater;
    if (!updater) return;

    let cancelled = false;

    // ① 初次状态：打开面板时问一次主进程（主进程 IPC handler 内部会 check 并推事件）
    void Promise.resolve()
      .then(() => updater.check())
      .then((r) => {
        if (cancelled || !r?.ok) return;
        if (!r.hasUpdate) {
          setUpToDate(true);
          return;
        }
        setUpToDate(false);
        setAvailable(true);
        setAvailableVersion(r.info?.version ?? r.version ?? '');
      })
      .catch(() => {
        // 初次探测失败静默（手动 check 才展示错误）
      });

    // ② 订阅主进程后台轮询的结果推送（preload 已包装，此前从未被消费）
    const offAvailable = updater.onUpdateAvailable?.((info?: { version?: string }) => {
      if (cancelled) return;
      setUpToDate(false);
      setAvailable(true);
      setAvailableVersion(info?.version ?? '');
    });
    const offNotAvailable = updater.onUpdateNotAvailable?.(() => {
      if (cancelled) return;
      setUpToDate(true);
    });

    return () => {
      cancelled = true;
      offAvailable?.();
      offNotAvailable?.();
    };
  }, []);

  // Subscribe to live events
  useEffect(() => {
    const updater = window.petriDesktop?.updater;
    if (!updater) return;

    const offProgress = updater.onDownloadProgress?.((p) => {
      setProgress(p?.ratio ?? 0);
    });
    const offDownloaded = updater.onUpdateDownloaded?.(() => {
      setDownloading(false);
      setProgress(1);
      setDownloaded(true);
    });
    const offError = updater.onError?.((msg: string) => {
      setDownloading(false);
      setInstalling(false);
      setError(msg || '更新失败');
    });

    return () => {
      offProgress?.();
      offDownloaded?.();
      offError?.();
    };
  }, []);

  const check = useCallback(async () => {
    const updater = window.petriDesktop?.updater;
    if (!updater || checking) return;
    setChecking(true);
    setError('');
    setUpToDate(false);
    try {
      const r = await updater.check();
      if (!r?.ok) {
        setError(r?.error || '检查失败');
      } else if (!r.hasUpdate) {
        setAvailable(false);
        setAvailableVersion('');
        setUpToDate(true);
      } else {
        setUpToDate(false);
        setAvailable(true);
        setAvailableVersion(r.info?.version ?? r.version ?? '');
      }
    } catch (e) {
      setError(String(e) || '检查失败');
    } finally {
      setChecking(false);
    }
  }, [checking]);

  const download = useCallback(async () => {
    const updater = window.petriDesktop?.updater;
    if (!updater || downloading) return;
    setError('');
    setDownloading(true);
    setProgress(0);
    setDownloaded(false);
    try {
      const result = await updater.download();
      if (result && !result.ok) {
        throw new Error(result.error || '下载失败');
      }
    } catch (e) {
      setDownloading(false);
      setError(e instanceof Error ? e.message : String(e) || '下载失败');
      return;
    }
  }, [downloading]);

  const install = useCallback(async () => {
    const updater = window.petriDesktop?.updater;
    if (!updater || installing) return;
    setError('');
    setInstalling(true);
    try {
      const result = await updater.install();
      if (result && !result.ok) {
        throw new Error(result.error || '打开安装包失败');
      }
      setInstalling(false);
    } catch (e) {
      setInstalling(false);
      setError(e instanceof Error ? e.message : String(e) || '打开安装包失败');
    }
  }, [installing]);

  return {
    available,
    availableVersion,
    checking,
    downloading,
    progress,
    downloaded,
    error,
    upToDate,
    installing,
    check,
    download,
    install,
  };
}
