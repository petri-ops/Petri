// ============================================================
// CopilotProgressTracker — Phase α learning telemetry
//
// Usage:
//   <CopilotProgressTracker resource="/docs/single-cell/module01" />
//   <CopilotProgressTracker resource="/figcode#volcano" autoComplete="never" />
//
// Behavior:
//   - 30s after mount (resource visible & document visible) → POST started
//   - Scroll to bottom (>=90% of doc / scrollable container) → POST completed
//   - On unmount, if 'started' was already sent and not completed, no-op
//   - All calls go through copilotProgressClient (auth + dedupe + keepalive)
//
// Renders nothing. Side-effect only.
// ============================================================

import { useEffect, useRef } from 'react';
import { reportProgress } from '@/components/copilot/copilotProgressClient';

export interface CopilotProgressTrackerProps {
  /** Resource id, e.g. '/docs/single-cell/module01' or '/figcode#volcano' */
  resource: string;
  /** When to fire 'completed'. 'scrollEnd' (default) for docs, 'never' for figcode (the parent fires it on Run). */
  autoComplete?: 'scrollEnd' | 'never';
  /** Dwell time in ms before firing 'started' (default 30_000) */
  dwellMs?: number;
}

export function CopilotProgressTracker({
  resource,
  autoComplete = 'scrollEnd',
  dwellMs = 30_000,
}: CopilotProgressTrackerProps): null {
  const startedRef = useRef(false);
  const completedRef = useRef(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!resource) return;

    let dwellTimer: ReturnType<typeof setTimeout> | null = null;
    let visibleSinceMs = document.visibilityState === 'visible' ? Date.now() : 0;
    let accumulatedVisibleMs = 0;

    const fireStarted = () => {
      if (startedRef.current) return;
      startedRef.current = true;
      reportProgress('started', resource);
    };

    const fireCompleted = () => {
      if (completedRef.current) return;
      completedRef.current = true;
      reportProgress('completed', resource);
    };

    const checkDwell = () => {
      const now = Date.now();
      const live = visibleSinceMs > 0 ? now - visibleSinceMs : 0;
      const total = accumulatedVisibleMs + live;
      if (total >= dwellMs) {
        fireStarted();
      } else {
        dwellTimer = setTimeout(checkDwell, dwellMs - total + 200);
      }
    };

    // Begin dwell timer if visible
    if (visibleSinceMs > 0) {
      dwellTimer = setTimeout(checkDwell, dwellMs);
    }

    const onVisibility = () => {
      const now = Date.now();
      if (document.visibilityState === 'visible') {
        visibleSinceMs = now;
        if (!startedRef.current) {
          if (dwellTimer) clearTimeout(dwellTimer);
          dwellTimer = setTimeout(checkDwell, Math.max(50, dwellMs - accumulatedVisibleMs));
        }
      } else {
        if (visibleSinceMs > 0) accumulatedVisibleMs += now - visibleSinceMs;
        visibleSinceMs = 0;
        if (dwellTimer) {
          clearTimeout(dwellTimer);
          dwellTimer = null;
        }
      }
    };

    // Scroll-to-bottom completion (page-level only)
    let onScroll: ((e?: Event) => void) | null = null;
    if (autoComplete === 'scrollEnd') {
      onScroll = () => {
        if (completedRef.current) return;
        const scrollEl = document.scrollingElement || document.documentElement;
        if (!scrollEl) return;
        const seen = scrollEl.scrollTop + scrollEl.clientHeight;
        const total = scrollEl.scrollHeight;
        if (total <= 0) return;
        // Treat 'reached bottom' = scrolled past 90% of the page
        if (seen / total >= 0.9) {
          // Also require started to have fired — otherwise a quick scroll-to-bottom shouldn't count.
          if (!startedRef.current) fireStarted();
          fireCompleted();
        }
      };
      window.addEventListener('scroll', onScroll, { passive: true });
      // Edge case: very short page where there's nothing to scroll
      const scrollEl = document.scrollingElement || document.documentElement;
      if (scrollEl && scrollEl.scrollHeight <= scrollEl.clientHeight + 2) {
        // Auto-complete after dwell+small buffer for short docs.
        setTimeout(() => {
          if (startedRef.current) fireCompleted();
        }, dwellMs + 5_000);
      }
    }

    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      if (dwellTimer) clearTimeout(dwellTimer);
      document.removeEventListener('visibilitychange', onVisibility);
      if (onScroll) window.removeEventListener('scroll', onScroll);
    };
    // Depend on resource so navigating between docs in the same SPA tab resets state.
  }, [resource, autoComplete, dwellMs]);

  return null;
}

export default CopilotProgressTracker;
