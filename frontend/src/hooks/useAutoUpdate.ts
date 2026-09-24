/**
 * useAutoUpdate — unified update state for the Gewu desktop shell.
 *
 * Subscribes to window.biof3Desktop.updater IPC events and exposes a
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

  // Mount: do one auto-check for a pending update
  useEffect(() => {
    const updater = window.biof3Desktop?.updater;
    if (!updater) return;

    let cancelled = false;
    void (async () => {
      try {
        const r = await updater.check();
        if (cancelled || !r?.ok) return;
        if (!r.hasUpdate) {
          setUpToDate(true);
          return;
        }
        setUpToDate(false);
        setAvailable(true);
        setAvailableVersion(r.info?.version ?? r.version ?? '');
      } catch {
        // ignore
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Subscribe to live events
  useEffect(() => {
    const updater = window.biof3Desktop?.updater;
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
    const updater = window.biof3Desktop?.updater;
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
    const updater = window.biof3Desktop?.updater;
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
    const updater = window.biof3Desktop?.updater;
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
