// ============================================================
// CopilotContextProvider — React Context wrapper around the
// vendor `@biof3/shared/context` singleton.
//
// Why: state-decomposition §4.2 [HIGH] — the module-scope
// `let current` in `vendor/.../context.ts` has no contract. Pages
// publish partial patches and unmount, leaving stale fields in
// `current`. The fix moves the source of truth into a React
// Context provider so consumers always see the latest value via
// `useCopilotContext()` (subscribe-on-render), and writers must
// declare their intent via `useSetCopilotContext(patch, deps)` —
// which resets the previous page's fields before applying the
// new patch, so an unmounted page can never leak `page=`
// `analysisId=` `projectId=` into the next page's context.
//
// The vendor singleton is still mutated on every Provider update
// so any code path that imports `getCopilotContext()` directly
// (legacy Copilot client wiring, telemetry, custom event
// handlers) still sees consistent state. The Provider is the new
// write API; the singleton is the read-fallback shim.
//
// Mount point: App.tsx wraps `<Routes>` so every routed page can
// read & write.
// ============================================================

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  setCopilotContext,
  type CopilotContext,
} from './copilotContext';

const FALLBACK: CopilotContext = { page: 'unknown' };

interface CopilotContextStore {
  ctx: CopilotContext;
  /** Apply a partial patch (e.g. on mount of a new page). */
  setCtx: (patch: Partial<CopilotContext>) => void;
  /** Reset to `{ page: 'unknown' }`. Call before re-applying a new patch. */
  reset: () => void;
}

const StoreCtx = createContext<CopilotContextStore>({
  ctx: FALLBACK,
  setCtx: () => {},
  reset: () => {},
});

export function CopilotContextProvider({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  const [ctx, setCtxState] = useState<CopilotContext>(FALLBACK);

  // Mirror into the vendor singleton so legacy `getCopilotContext()`
  // readers stay in sync. Avoid feedback loops by tracking the
  // last value we wrote.
  const lastWritten = useRef<CopilotContext>(FALLBACK);
  useEffect(() => {
    if (ctx !== lastWritten.current) {
      setCopilotContext(ctx);
      lastWritten.current = ctx;
    }
  }, [ctx]);

  const setCtx = useCallback((patch: Partial<CopilotContext>) => {
    setCtxState((prev) => ({ ...prev, ...patch }));
  }, []);

  const reset = useCallback(() => {
    setCtxState(FALLBACK);
  }, []);

  const store = useMemo<CopilotContextStore>(
    () => ({ ctx, setCtx, reset }),
    [ctx, setCtx, reset]
  );

  return <StoreCtx.Provider value={store}>{children}</StoreCtx.Provider>;
}

/**
 * Read the current Copilot context. The returned object is the
 * Provider's snapshot — reads after a page writes via
 * `useSetCopilotContext` see the new value on the next render.
 */
export function useCopilotContext(): CopilotContext {
  return useContext(StoreCtx).ctx;
}

/**
 * Publish a partial Copilot context patch on mount, and re-apply
 * it whenever `deps` change. Resets the previous value before
 * applying the new patch so stale fields from a prior page don't
 * leak.
 *
 * Pass `[]` for one-shot publish (most pages).
 */
export function useSetCopilotContext(
  patch: Partial<CopilotContext>,
  deps: React.DependencyList = []
): void {
  const { reset, setCtx } = useContext(StoreCtx);
  // Serialize patch via JSON so React's deps array sees identity
  // changes whenever the patch contents change — not just the
  // outer object reference. Without this, callers passing a
  // freshly-built object on every render would trigger an
  // infinite update loop.
  const patchKey = JSON.stringify(patch);
   
  useEffect(() => {
    reset();
    setCtx(patch);
    // Intentionally NOT cleaning up on unmount: the next page's
    // mount will reset() before applying its own patch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patchKey, ...deps]);
}