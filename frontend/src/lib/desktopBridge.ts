// ============================================================
// desktopBridge — typed accessor for the window.biof3Desktop
// IPC surface declared in `@/lib/electron.d.ts`.
//
// State-decomposition §4.7 [HIGH] flagged that every
// component went through `window.biof3Desktop?.x?.y?.()`
// with hand-rolled defensive checks, and three hooks
// (`useAiSettings`, `usePluginStore`, `useTerminalSession`)
// each re-declared a local sub-bridge type that mirrored the
// shape in electron.d.ts:
//
//   - `useAiSettings.ts` (line ~70 in the pre-commit file)
//     declared `interface ElectronAiSettingsBridge` with
//     `get / save / test` even though the exact same shape
//     already lived in electron.d.ts (line 29-33).
//
//   - `usePluginStore.ts` (~line 70) declared
//     `interface PluginBridge` mirroring electron.d.ts
//     lines 34-52 — including the inline
//     `UpdateInfo` shape that was independently declared in
//     `PluginStorePanel.tsx` and `project-workspace.tsx`
//     ToolboxPanel.
//
//   - `useTerminalSession.ts` used loose
//     `window.biof3Desktop?.terminal?.writeSession?.(...)`
//     chains with `({ code, signal }: { code?: number | null; ... })`
//     inline parameter types that lost the source-of-truth
//     shape from electron.d.ts.
//
// This module centralises the access pattern:
//
//   getBridge('aiSettings')        → AiSettingsBridge | null
//   requireBridge('terminal')      → TerminalBridge | throws
//   isDesktop()                    → boolean
//
// Every consumer gets:
//   - The canonical shape from electron.d.ts via a mapped
//     type (no more drift between electron.d.ts and
//     inline interfaces).
//   - A single point that decides what "no desktop context"
//     means (returns null vs throws) — components no longer
//     spell out `if (!window.biof3Desktop?.x) return;` and
//     `window.biof3Desktop.x.y()` separately.
//   - SSR safety: all accessors short-circuit when
//     `typeof window === 'undefined'`. The legacy
//     older plot pages had hand-rolled bridge checks that are now redundant.
// ============================================================

import type {} from '@/lib/electron'; // ensure the global Window augmentation is loaded

/** Strongly-typed handle to the desktop IPC bridge, narrowing
 *  the optional `window.biof3Desktop` declared in electron.d.ts. */
// BLOCK-61：主全局名 window.gewu；biof3Desktop 为兼容别名（preload 双暴露）。
type DesktopBridge = NonNullable<Window['gewu']>;

/** Map of bridge name → its sub-handle type. Keyof the
 *  biof3Desktop declaration, so adding a new bridge in
 *  electron.d.ts automatically makes it available here. */
export type DesktopBridgeName = keyof DesktopBridge;

export type DesktopBridgeHandle<K extends DesktopBridgeName> = DesktopBridge[K];

/** Thrown by {@link requireBridge} when the desktop bridge
 *  (or the requested sub-bridge) is unavailable — i.e. the
 *  SPA is running outside Electron, the preload script has
 *  not exposed the requested surface yet, or the user is on
 *  a platform where the bridge simply doesn't exist. */
export class BridgeUnavailableError extends Error {
  constructor(public readonly bridgeName: string | number | symbol) {
    super(
      `Desktop IPC bridge "${String(bridgeName)}" is not available. ` +
        `This code path runs only inside the Gewu desktop app.`
    );
    this.name = 'BridgeUnavailableError';
  }
}

/** True if the page is running inside the Gewu desktop
 *  app (preload has populated window.biof3Desktop). */
export function isDesktop(): boolean {
  return typeof window !== 'undefined' && !!(window.gewu ?? window.biof3Desktop);
}

/** Returns the requested sub-bridge handle typed against the
 *  canonical shape from electron.d.ts, or null when the
 *  desktop context (or that specific bridge) is not
 *  available. Use this for non-critical paths — callers
 *  short-circuit on null and the UI simply hides the
 *  desktop-only affordance. */
export function getBridge<K extends DesktopBridgeName>(
  name: K
): DesktopBridgeHandle<K> | null {
  if (typeof window === 'undefined') return null;
  const desktop = window.gewu ?? window.biof3Desktop;
  if (!desktop) return null;
  // electron.d.ts marks every sub-bridge as required (no
  // `?`), but the bridge surface can still be incomplete in
  // older builds. Returning null in that case keeps callers
  // from blowing up at the call site.
  const handle = (desktop as Partial<DesktopBridge>)[name];
  return (handle ?? null) as DesktopBridgeHandle<K> | null;
}

/** Returns the requested sub-bridge, throwing
 *  {@link BridgeUnavailableError} when it isn't available.
 *  Use this for hot-path IPC where the surrounding UI only
 *  mounts inside the desktop context — there's no graceful
 *  fallback, but the error tells the user (and the dev
 *  console) exactly which bridge is missing.
 *
 *  NOTE: bridges are automatically typed via the
 *  DesktopBridgeName mapped type — no manual interface needed. */
export function requireBridge<K extends DesktopBridgeName>(
  name: K
): DesktopBridgeHandle<K> {
  const handle = getBridge(name);
  if (!handle) {
    throw new BridgeUnavailableError(name);
  }
  return handle;
}
