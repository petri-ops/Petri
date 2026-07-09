import { useEffect, useState } from 'react';
import type { BackendStatus } from '@/lib/electron';

const POLL_INTERVAL_MS = 10_000;

/**
 * Polls the desktop backend status via the `window.biof3Desktop.backend.status`
 * IPC channel. Returns the latest status (or `null` while the first probe is
 * pending or the call failed).
 *
 * The poll interval is 10s — matching the legacy behaviour inlined in
 * project-workspace.tsx. Cancels on unmount.
 */
export function useBackendStatus(): BackendStatus | null {
  const [status, setStatus] = useState<BackendStatus | null>(null);

  useEffect(() => {
    let cancelled = false;

    const refresh = async () => {
      try {
        const result = await window.biof3Desktop?.backend?.status?.();
        if (!cancelled) setStatus(result || null);
      } catch {
        if (!cancelled) setStatus(null);
      }
    };

    void refresh();
    const intervalId = window.setInterval(refresh, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, []);

  return status;
}