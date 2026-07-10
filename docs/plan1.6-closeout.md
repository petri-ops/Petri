# Plan 1.6 — State Hook Refactor · Closeout

> Six HIGH-severity leaks from `docs/state-decomposition.md`
> §4.2-§4.7 fixed via React hooks + module-scope shared
> caches + a typed IPC accessor. Plan 1.6 closes; all six
> items landed, 9 test files / 74 tests, tsc + build green.

## 0. TL;DR

| # | Source (Plan 1.4) | Fix | Commit |
|---|---|---|---|
| 4.2 | Copilot context module-scope singleton, 8 writers / 0 readers | React Context (`<CopilotContextProvider>`) + `useCopilotContext()` / `useSetCopilotContext()` | `35e4baa` |
| 4.3 | Three independent conversation caches (SimpleChat / CopilotChat / project-workspace) | SWR-style `useConversations(projectId)` with `Set`-based subscriber fan-out | `75fa778` |
| 4.4 | `useResizableColumns` hook exists but `project-workspace.tsx` re-implements inline (240 LOC duplicated) | Migrate `project-workspace.tsx` to the existing hook | `3d36557` |
| 4.5 | AI model presets loaded twice (SimpleChat + DesktopSettingsPanel), two save handlers | SWR `useAiSettings()` with `Set`-fan-out (same pattern as 4.3) | `6e177a5` |
| 4.6 | Plugin store state duplicated (PluginStorePanel + ToolboxPanel) | SWR `usePluginStore({autoLoad?})` — cross-panel install/uninstall sync | `1c43813` |
| 4.7 | Bare `window.biof3Desktop.*?.foo?.bar?.()` scattered across 20+ files | Typed accessor `getBridge<K>(name)` / `requireBridge<K>(name)` + migrate the 3 hooks that re-declared sub-bridge types | `cff730e` |

**Net delta:**

```
Frontend test coverage:    0  →  74 tests (9 files)
Bundle JS main (gzip):   baseline → +1.83 KB (net)
tsc -b:                   0 errors before, 0 errors after
Plan 1.6 commits ahead:    7
```

## 1. Per-item lessons — what's generic, what's desktop-specific

> **Reading guide:** each lesson below names the *category*
> of pattern that worked. Categories are reusable on any
> React + Electron app. The "desktop-specific" notes call
> out where the desktop branch's constraints shaped the
> choice. Plan 1.4 inventory items that turn out to be
> *inapplicable on the desktop branch* are collected in §2.

### 1.1 §4.2 → CopilotContextProvider

**Pattern:** *Module-scope mutable singleton → React Context.*

The vendor package (`@biof3/shared/context`) shipped
`let current = {...}` with `setCopilotContext(patch)` /
`getCopilotContext()` / `subscribeCopilotContext(fn)`. Eight
pages wrote partial patches; nothing read; unmounts left
stale fields. The fix adds `<CopilotContextProvider>` at
`App.tsx` root — the Context holds the source of truth and
mirror-writes to the legacy singleton so older
`getCopilotContext()` callers stay consistent.

`useSetCopilotContext(patch, deps)` does the
**reset-then-apply** sequence: `reset() → setCtx(patch)`.
Pages no longer leak `page=` / `analysisId=` into the next
page's context.

**Lesson (generic):**
- When migrating a pub/sub singleton to React, **keep the
  singleton as a read-fallback shim** while making the
  Provider the write path. Avoids breaking every legacy
  caller in one shot.
- The `reset()` call before every patch is the actual
  leak-killer. A plain `{ ...prev, ...patch }` does not
  leak-fix — the *next* page's `page:` field overwrites, but
  unrelated fields like `activeArtifact` survive. Always
  reset-then-apply.

**Desktop-specific note:**
- The legacy vendor package lives in `vendor/biof3-core/`
  and is patched via a thin shim in `frontend/src/lib/`,
  not directly. We did *not* delete the singleton module
  — it still exports `CopilotContext` type +
  `detectPageFromUrl()` helpers that the Provider imports.

### 1.2 §4.3 / §4.5 / §4.6 → SWR hooks (3x same shape)

**Pattern:** *Module-scope shared cache + `Set<() => void>` subscriber fan-out.*

All three hooks (conversations / AI settings / plugin store)
share the same shape:

```ts
let cache = initialValue;
let loaded = false;
let inflight: Promise<Cache> | null = null;
const subscribers = new Set<() => void>();

function notify() { subscribers.forEach(fn => fn()); }

export function useStore() {
  const [snap, setSnap] = useState(cache);
  useEffect(() => {
    const onChange = () => setSnap(cache);
    subscribers.add(onChange);
    return () => { subscribers.delete(onChange); };
  }, []);
  return { ...snap, refresh: async () => {...} };
}
```

Every consumer reads from the same cache; every mutation
re-fetches and `notify()`s. A second `<usePluginStore>`
mounted elsewhere picks up the install/uninstall the first
panel triggered — no manual refresh.

**Lessons (generic):**
- **SWR without a library.** A 60-line module beats pulling
  in `swr` / `react-query` for our scale. We don't need
  in-flight dedup across the network (IPC is a single
  function call), we don't need `mutate()` semantics
  (mutations trigger a re-fetch that *is* the source of
  truth), and we don't need pagination. The hand-rolled
  pattern fits.
- **Subscriber fan-out > React Context for cross-cutting
  reads.** The plugins cache is read by both a sidebar panel
  and a toolbox tab, neither of which is the parent of the
  other. Context would force a Provider high up the tree,
  re-rendering everything. The fan-out only re-renders
  consumers that subscribed.
- **`autoLoad: false` is an opt-out for lazy panels.**
  ToolboxPanel only needs the catalog when its "plugins" tab
  is opened. Adding one boolean kept the hook generic.

**Desktop-specific note:**
- The hook lives in `frontend/src/hooks/`, not in the
  shared vendor package, because the cache shape depends on
  the Electron IPC surface (`window.biof3Desktop.plugins.*`),
  which the web SPA doesn't have.

### 1.3 §4.4 → `useResizableColumns` adoption

**Pattern:** *Adopt existing hook, don't re-implement.*

This one is the cleanest lesson — the hook existed; the
giant `project-workspace.tsx` re-implemented its logic
inline (240 LOC across 4 resize handlers). The fix was
*purely* a deletion of inline state and a call to the
existing hook.

**Lesson (generic):**
- Before extracting a new hook, grep for existing ones. The
  hook here had been written in a previous PR but never
  adopted — a typical "we wrote it but the inline copy
  predates the hook" failure mode.
- The migration is mechanical (and 100% behaviour-preserving)
  when the hook's API matches the inline code. We did not
  need to add LS persistence here (out of scope for §4.4);
  the hook still loses resize state on remount, same as
  before.

**Desktop-specific note:** none — this is a pure React
refactor.

### 1.4 §4.7 → `getBridge<K>(name)` typed accessor

**Pattern:** *Centralise the boundary.*

Every React component went through
`window.biof3Desktop?.x?.foo?.bar?.()` chains with
hand-rolled defensive checks. Three hooks
(`useAiSettings`, `usePluginStore`, `useTerminalSession`)
each re-declared a local sub-bridge interface that mirrored
the canonical shape in `lib/electron.d.ts`.

The accessor:

```ts
type DesktopBridge = NonNullable<Window['biof3Desktop']>;
type DesktopBridgeName = keyof DesktopBridge;

getBridge<K>(name):   DesktopBridgeHandle<K> | null
requireBridge<K>(name): DesktopBridgeHandle<K>  // throws
```

uses a **mapped type** — `Keyof<DesktopBridge>` — so adding
a new bridge in `electron.d.ts` automatically makes it
available here without a second declaration site.

**Lessons (generic):**
- **`Keyof<Shape>` is the cheap type for "give me one of
  the named fields, fully typed".** The mapped-type pattern
  saves us from declaring `getBridge('aiSettings'):
  AiSettingsBridge | null` 14 times.
- **Mirror the canonical declaration, don't shadow it.**
  The previous hooks used `as ElectronAiSettingsBridge |
  undefined` casts — these lied about the shape on `save`
  (loose `Record<string, unknown>`) and `test` (loose
  `Promise<unknown>`). The mapped type from
  `electron.d.ts` is the *real* contract.
- **`null` vs `throw` is a UX choice per call site.**
  `getBridge` returns null (caller chooses to early-return);
  `requireBridge` throws `BridgeUnavailableError` for hot
  paths that have no graceful fallback. Mixing the two
  keeps the call sites readable: `if (!bridge) return
  <empty UI>` reads better than `try { requireBridge(...) }
  catch { return <empty UI> }`.

**Desktop-specific note:**
- Only the **3 hooks with re-declared types** were
  migrated in this commit. The remaining 12+ call sites
  (`PluginStorePanel`, `project-workspace`, `DesktopSettings
  Panel`, `BackendStatusProvider`, `RunModal`, `figcode`,
  `docs`, `_desktop-dashboard`, `BackendDownBanner`) keep
  their existing `window.biof3Desktop?.x?.y?.()` form for
  now. They get the same readability win when they migrate;
  the accessor is ready. We chose not to scope-creep this
  commit.

## 2. Plan 1.4 inventory items that don't apply to the desktop branch

> **This is the heart of the closeout.** Plan 1.4 was a
> general SPA inventory; several findings are artefacts of
> the legacy cloud-platform shape (single-cell/spatial/
> admin routes, web-token auth, magic event bus) that the
> desktop branch has either already moved past, or is
> structurally immune to. We documented each so future
> contributors don't re-add the lesson-learned label.

### 2.1 §3.9 / §4.10 — "Project data layer duplication" — DOES NOT APPLY

> Plan 1.4 §3.9: "`lib/project-store.ts` is the canonical
> one. `pages/single-cell/_store.ts` is a parallel copy ...
> desktop branch doesn't actually need the single-cell
> module — but the route is still mounted in `App.tsx`."

**Status: route still mounted, but canonical layer is the only one used by desktop-first surfaces.**

`frontend/src/App.tsx` lines 99-102 still mount
`<SingleCellPage>` and `<SpatialPage>`:

```tsx
<Route path="/single-cell" element={<SingleCellPage />} />
<Route path="/single-cell/*" element={<SingleCellPage />} />
<Route path="/spatial" element={<SpatialPage />} />
<Route path="/spatial/*" element={<SpatialPage />} />
```

`project-workspace.tsx` (the desktop front door per `HomePage`)
and `_desktop-dashboard.tsx` (the home page) both use
`lib/project-store.ts`. The legacy `_store.ts` HTTP layer
is *only* reachable through the single-cell / spatial
pages.

**Desktop-first lesson:**
- The duplication is real but inert on the desktop
  branch's hot paths. The duplication is **only harmful** if
  a user lands on `/single-cell` from a deep link (rare).
- Removing the routes is a content-preservation question,
  not a state-cleanup question. Out of scope for Plan 1.6
  because it touches user-facing routes, not React state.
- We **explicitly do not** carry forward §4.10's lesson
  ("drop the legacy store") until the route removal
  decision is made.

### 2.2 §3.10 / §4.14 — "`biof3_token` LS writes still occur" — DOES NOT APPLY (structural)

> Plan 1.4 §3.10: "`pages/single-cell/_auth.ts` (legacy)
> still writes `biof3_token` to LS on `login()` and reads
> it in `getToken()`. ... desktop branch ignores it, but
> the LS writes keep happening if any page accidentally
> calls `login()`."

**Status: writes happen, but only via the dead-routes of §2.1.**

`frontend/src/lib/authClient.ts` (`IS_DESKTOP = true`)
returns hardcoded `DESKTOP_USER` + `'desktop-local'`
token. Copilot client, plans client, conversations
client, summary client, progress client, memories
client, facts client, privacy client and
`project-store.ts`'s `authHeaders()` all read `biof3_token`
from LS first, **but on the desktop branch the desktop
auth wins** (the `IS_DESKTOP` branch short-circuits
before the LS read in `authClient.ts`).

The dead LS writes are:
- `pages/single-cell/_AdminPanel.tsx:767` —
  `localStorage.setItem('biof3_token', data.token)` inside
  an admin login flow.
- `pages/single-cell/_AdminPanel.tsx:1971` — same.
- `pages/single-cell/_auth.ts:58, 144, 158` — `setStoredUser`
  and `login()`.

**Desktop-first lesson:**
- The reads-first behaviour is *defensive*, not a leak:
  every desktop-first client tries the LS token, falls
  back to `'desktop-local'`. If a future contributor
  accidentally calls `login()` from a desktop page,
  the desktop branch keeps using the hardcoded token —
  the LS write is a no-op for any desktop reach.
- The lesson *does* apply if the §2.1 routes are removed:
  the LS writes disappear with the pages that produce
  them. We **explicitly do not** carry forward §4.14's
  lesson as a Plan 1.6 task.

### 2.3 §3.3 / §4.8 — "Active conversation id stored under two LS keys" — DOES NOT APPLY (legacy component removed)

> Plan 1.4 §3.3 / §4.8: "`biof3_copilot_active_conv`
> (legacy) and `biof3_copilot_active_conv:${projectId}`
> (per-project). ... The legacy key is read first if
> `ctx.page !== 'desktop-project'`."

**Status: removed in `437d7d5 kill(fab)`.**

The legacy floating Copilot panel (`CopilotChat.tsx`) was
deleted in commit `437d7d5 kill(fab): remove site-wide
floating Copilot assistant`. The legacy LS key
`biof3_copilot_active_conv` was owned entirely by that
component.

`project-workspace.tsx` uses the per-project key via
`useConversations(projectId)` (Plan 1.6 §4.3). The legacy
key never gets written by any code path that survives.

**Desktop-first lesson:**
- The two-key duplication was a property of the legacy
  Copilot panel coexisting with the project workspace.
  Killing the panel collapsed the keys back to one.
- Plan 1.6 §4.3's `useConversations(projectId)` does not
  own the per-project LS key directly — it goes through
  the active conversation id passed by SimpleChat. If
  future contributors re-introduce a legacy floating
  copilot, they'll re-introduce the second key, but
  that's a route back to the legacy state rather than
  a fresh regression.

### 2.4 §4.9 — "Update flow state duplicated" — DEFERRED (not a §4.x HIGH)

> Plan 1.4 §4.9: "`_desktop-dashboard.tsx` holds
> `updOpen/updDownloading/updProgress/updDownloaded/...`.
> `DesktopSettingsPanel` holds the same fields."

**Status: still duplicated; deferred.**

Plan 1.6 scoped the HIGH items (§4.2-§4.7) only. §4.9 is
[MED], not [HIGH], and the update flow is a one-shot UX
where duplicate state causes visible glitches (mid-flight
overwrite) but no data loss. Migration pattern would be
identical to §4.5/§4.6's SWR shape: `useAutoUpdate()`
hooking into `window.biof3Desktop.updater.on*` events.

**Desktop-first lesson:**
- The same SWR-with-fan-out pattern from §4.3/§4.5/§4.6
  applies directly. Future PR can copy
  `usePluginStore.ts` and replace the bridge name.
- One subtle difference: the update flow is **push-driven**
  (events from preload), not **fetch-driven** (RPC on
  mount). The cache write happens in the event listener,
  not in a manual refresh — `notify()` fires from the
  listener, same fan-out.

### 2.5 §4.11 — "Terminal snapshot polled twice" — STILL APPLIES

> Plan 1.4 §4.11: "`TerminalPanel` (5s `terminal:snapshot`)
> + `BackendStatusProvider.backend:status` (5s
> `backend:status`). Both read overlapping info."

**Status: still duplicated; Plan 1.6 did NOT address it.**

`project-workspace.tsx` line 2830-2834 still mounts a
`setInterval(refresh, 5000)` on the terminal snapshot
panel:

```tsx
useEffect(() => {
  refresh();
  const timer = window.setInterval(refresh, 5000);
  return () => window.clearInterval(timer);
}, [refresh]);
```

`refresh()` itself calls
`window.biof3Desktop?.terminal?.snapshot?.()` and stores
the full process list. `BackendStatusProvider` polls
`backend.status` at 5s. The two read overlapping process
state but write to different React trees.

**Desktop-first lesson:**
- Plan 1.6 scoped the HIGH items (§4.2-§4.7) only. §4.11
  is [MED], not [HIGH], so it slipped through.
- The §4.11 fix is a small React refactor (drop the
  interval in this useEffect, add a manual "刷新" button
  if not already there — `BottomTerminal.tsx` already has
  one), not a hook extraction. ~20 LOC change.
- The §4.11 lesson **carries forward** as a follow-up.

### 2.6 §4.12 — "Soft-refresh event duplicates the fetch loop" — STILL APPLIES

> Plan 1.4 §4.12: "`project-workspace.tsx` line 698-714:
> `fetchData` interval (15s) + `biof3:soft-refresh` handler
> re-running `fetchData`, `refreshConversations`, and
> `listProjects`. ... Wasted CPU on every soft-refresh."

**Status: still duplicated; Plan 1.6 did NOT address it.**

`project-workspace.tsx` line 703 still holds the 15s
`setInterval(fetchData, 15_000)`:

```tsx
const id = setInterval(fetchData, 15_000);
```

The `biof3:soft-refresh` handler also calls `fetchData`.
Both fire on Cmd+R — the handler's call wins, but the
interval keeps ticking.

**Desktop-first lesson:**
- Same scope miss as §4.11: §4.12 is [MED], not [HIGH],
  and Plan 1.6 left it alone.
- The fix is mechanical (drop the 15s interval). The
  `biof3:soft-refresh` handler stays.
- §4.12 lesson **carries forward** as a follow-up.

### 2.7 §4.13 — "`biof3_agent_task_*` LS prefix sweep" — DEFERRED

> Plan 1.4 §4.13: "`copilotClient.ts:191-210` removes
> entries without telling the user. If two panels both
> invoke the sweep on mount, the earlier one could be
> dropping the other's task."

**Status: still in code; deferred.**

This is a low-frequency bug (only triggers on agent task
recovery) and the only consumer is SimpleChat. Copilot
context (Plan 1.6 §4.2) limits to one SimpleChat mount at a
time per project workspace, so the "two panels" scenario
no longer happens in practice.

**Desktop-first lesson:**
- The bug needs scoping, not de-duping. §4.13's
  recommended fix (scope sweep to current conversation id)
  applies directly; future PR.

### 2.8 §4.15 / §4.16 / §4.17 / §4.18 / §4.19 / §4.20 — LOW items

All [LOW] items from Plan 1.4. Most are minor; none are
data-loss bugs. The typed event bus (§4.18) is the only one
with a clear payoff (typo resistance) and can land as a
follow-up:

```ts
// frontend/src/lib/events.ts
export const biof3Events = {
  softRefresh: 'biof3:soft-refresh',
  onboardingDone: 'biof3:onboarding-done',
  projectOpenResult: 'biof3:project-open-result',
  copilotAsk: 'biof3:copilot-ask',
  conversationsChanged: 'biof3:conversations-changed',
} as const;
```

Not in scope for Plan 1.6.

## 3. Summary — what Plan 1.6 actually proves

The 6 commits in Plan 1.6 are not 6 independent fixes —
they're **3 patterns applied 6 times**:

1. **Singleton → React Context** (§4.2 CopilotContext)
2. **Module-scope shared cache + `Set` fan-out** (§4.3, §4.5, §4.6)
3. **Use the existing hook / extract the boundary** (§4.4, §4.7)

The third pattern is the cheapest when it applies. The
second is the most powerful when state needs to be shared
across non-parent-child component trees. The first is the
right answer when an *external* singleton (the vendor
package) is already in use.

The Plan 1.4 leftovers (§2.1-§2.8) are *not* ignored —
they fall into four buckets:

- **§2.1 / §2.2 / §2.3** — *structurally inapplicable* on
  the desktop branch's hot paths (legacy routes still
  mounted but inert; legacy LS writes never read by desktop
  surfaces; legacy component already killed).
- **§2.5 / §2.6 / §2.7** — *still applicable*, scoped out
  of Plan 1.6 because they're [MED] not [HIGH]. These
  carry forward as the next-step list (§4).
- **§2.4** — *deferred* (same SWR pattern would copy).
- **§2.8** — *[LOW] tidy-up*, mechanical follow-ups.

Each is named above so future contributors don't waste a
planning cycle re-doing the analysis.

## 4. Next steps (out of scope, for future PRs)

- **§4.11 terminal snapshot double-poll** — drop the 5s
  `setInterval` in `project-workspace.tsx:2830-2834`;
  rely on the manual "刷新" button (already in
  `BottomTerminal.tsx`). Mechanical, ~10 LOC.
- **§4.12 15s `fetchData` interval** — drop the 15s
  `setInterval(fetchData, 15_000)` in
  `project-workspace.tsx:703`; rely on `biof3:soft-refresh`.
  Mechanical, ~5 LOC.
- **§4.9 useAutoUpdate hook** — copy `usePluginStore.ts`
  pattern, swap to push-driven fan-out from
  `window.biof3Desktop.updater.on*`.
- **§4.18 typed event bus** — `lib/events.ts` with
  `biof3Events` const map.
- **§4.13 agent task sweep scoping** — limit to current
  conversation id in `copilotClient.ts`.
- **§2.1 / §2.2 route removal** — content decision first;
  if `/single-cell/*` and `/spatial/*` and `/admin`
  routes are removed, then `_store.ts` + `_auth.ts` +
  `biof3_token` LS writes disappear with them.
- **§4.7 mechanical sweep** — migrate the remaining
  12+ call sites from `window.biof3Desktop?.x?.y?.()`
  to `getBridge('x')?.y?.()`. Mechanical, no type
  changes.