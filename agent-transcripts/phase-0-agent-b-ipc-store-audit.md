# PHASE 0 — Subagent B Audit: Renderer ↔ Electron IPC Bridge for Skills

**Work package**: BLOCK-2-UI-157-REVIEW · commit `0a3fc46`
**Subagent**: B (IPC bridge touchpoints)
**Date**: 2026-08-16
**Mode**: READ-ONLY
**Scope**: Audit the existing IPC layer (`src/preload.js` + `src/main.js`), the renderer bridge facade (`frontend/src/lib/desktopBridge.ts`), the `useSkillStore` data flow, the Skills page consumers, and the UI-161 cleanup state. Output: a touchpoint plan for PHASE 1.

---

## §1 Electron IPC Layer (main + preload)

### 1.1 `src/preload.js` — `window.*` surface

> File: `src/preload.js` (247 lines, full read). Imports `contextBridge` + `ipcRenderer` from `electron`.

The preload exposes **three** globals on `window`:

| Global | Method | Channel | Return type |
|---|---|---|---|
| `window.petri` | `agentWorkbenchFlags.getExtraRenderers()` | none (closure read of `AGENT_WORKBENCH_FLAGS`) | `boolean` |
| `window.petri` | `agentWorkbenchFlags.set(value)` | `petri:agent-workbench-flags` (invoke) | `Promise<{ok, extraRenderers, error?}>` |
| `window.petri` | `agentWorkbenchFlags.onChange(cb)` | `petri:agent-workbench-flags` (on) | unsubscribe `() => void` |
| `window.process` | `process.env.{PETRI_DESKTOP, NODE_ENV}` | none (constant) | `'1' \| 'production'` |
| `window.petriDesktop` | `isDesktop` (constant) | — | `true` |
| `window.petriDesktop` | `platform` (constant) | — | `string` |
| `window.petriDesktop` | `arch` (constant) | — | `string` |
| `window.petriDesktop` | `backendConfig` (frozen) | — | `{rApiBase, pythonApiBase}` |
| `window.petriDesktop.window.minimize/maximize/close` | `ipcRenderer.send` | `window:minimize\|maximize\|close` | `void` |
| `window.petriDesktop.window.isMaximized` | `invoke` | `window:isMaximized` | `Promise<boolean>` |
| `window.petriDesktop.window.onMaximizeChanged(cb)` | `on` | `window:maximize-changed` | unsubscribe `() => void` |
| `window.petriDesktop.app.relaunch` | `invoke` | `app:relaunch` | `Promise<{ok, error?}>` |
| `window.petriDesktop.aiSettings.get/save/getCredential/test/listModels` | `invoke` | `ai-settings:*` (5 channels) | per type — see electron.d.ts |
| `window.petriDesktop.computeSettings.get/save` | `invoke` | `compute-settings:*` | `Promise<ComputeSettings>` / `Promise<{ok, error?, restartRequired?}>` |
| `window.petriDesktop.harnessCapabilities.list` | `invoke` | `harness-capabilities:list` | `Promise<{ok, capabilities: HarnessCapabilityEntry[], error?}>` |
| `window.petriDesktop.plugins.listInstalled/listRemote/uninstall/checkUpdates` | `invoke` | `plugin:list-installed\|list-remote\|uninstall\|check-updates` | per type |
| `window.petriDesktop.plugins.install(pluginId, onProgress?)` | `invoke` + `on('plugin:install-progress')` | `plugin:install` | `Promise<{ok, error?}>`; progress listener cleaned up via `promise.finally` |
| `window.petriDesktop.contentPlugins.list/listDocs/read` | `invoke` | `content-plugin:list\|list-docs\|read` | per type |
| `window.petriDesktop.runtime.status` | `invoke` | `runtime:status` | `Promise<{r, python}>` |
| `window.petriDesktop.backend.status` | `invoke` | `backend:status` | `Promise<BackendStatus>` |
| `window.petriDesktop.py.start/stop` | `invoke` | `py:start\|stop` | `Promise<{ok, ...}>` |
| `window.petriDesktop.plumber.start/stop` | `invoke` | `plumber:start\|stop` | `Promise<{ok, ...}>` |
| `window.petriDesktop.files.saveDialog/openDialog/openDirectoryDialog/openPath/openWorkspaceFile` | `invoke` | `file:save-dialog\|open-dialog\|open-path\|open-workspace-file` | per type |
| `window.petriDesktop.diagnostic.export` | `invoke` | `diagnostic:export` | `Promise<{ok, path?, error?}>` |
| `window.petriDesktop.telemetry.report` | `invoke` | `telemetry:report` | `Promise<{ok, reason?}>` |
| `window.petriDesktop.data.info/openDir` | `invoke` | `data:info\|open-dir` | per type |
| `window.petriDesktop.terminal.snapshot/openLogDir/openShell/startSession/writeSession/resizeSession/stopSession` | `invoke` | `terminal:*` (7 channels) | per type |
| `window.petriDesktop.terminal.onData/onExit` | `on` | `terminal:data\|exit` | unsubscribe `() => void` |
| `window.petriDesktop.updater.check/download/install` | `invoke` | `updater:check\|download\|install` | per type |
| `window.petriDesktop.updater.onUpdateAvailable/onUpdateNotAvailable/onDownloadProgress/onUpdateDownloaded/onError` | `on` | `updater:*-event` | unsubscribe `() => void` |

**🚨 Critical finding — `skills` is NOT exposed in preload.js**

```
$ grep -n 'skill' src/preload.js   →   No matches found
```

Despite `frontend/src/lib/electron.d.ts` lines 114–169 declaring a `window.petriDesktop.skills.{discover, execute, getExecution}` interface and `useSkillStore.ts` calling `getBridge('skills')`, **preload.js never adds `skills:` to its `contextBridge.exposeInMainWorld('petriDesktop', { ... })` block**. At runtime `getBridge('skills')` always returns `null`, so the Skills page always renders its error state. See §3 and §6.

### 1.2 `src/main.js` — `ipcMain.handle` / `ipcMain.on` registry

> File: `src/main.js` (≈2099 lines). Grepped `ipcMain.(handle|on)('channel'`.

| Channel | Line | Direction | What it does (1-line) |
|---|---|---|---|
| `window:minimize` | 1176 | `on` | `BrowserWindow.minimize()` |
| `window:maximize` | 1179 | `on` | Toggle maximize/unmaximize on sender window |
| `window:close` | 1188 | `on` | `BrowserWindow.close()` on sender |
| `window:isMaximized` | 1191 | `handle` | Returns `isMaximized() === true` |
| `app:relaunch` | 1199 | `handle` | `app.relaunch()` then exit |
| `ai-settings:get` | 1212 | `handle` | Read persisted AI provider/profile config |
| `ai-settings:save` | 1223 | `handle` | Persist AI settings JSON |
| `ai-settings:get-credential` | 1235 | `handle` | Decrypt + return a credential's API key (k/v lookup) |
| `ai-settings:test` | 1247 | `handle` | Probe a provider/profile with API key |
| `ai-settings:list-models` | 1258 | `handle` | Probe provider for model list |
| `compute-settings:get` | 1272 | `handle` | Read compute mode (local/remote) settings |
| `compute-settings:save` | 1280 | `handle` | Persist compute settings |
| `telemetry:report` | 1294 | `handle` | Forward opt-in error report to telemetry sink |
| `plugin:list-installed` | 1307 | `handle` | Read installed plugin manifests |
| `plugin:list-remote` | 1316 | `handle` | Read remote plugin registry |
| `plugin:install` | 1325 | `handle` | Install plugin, emits `plugin:install-progress` events |
| `plugin:uninstall` | 1346 | `handle` | Uninstall plugin |
| `plugin:check-updates` | 1356 | `handle` | Diff installed vs remote versions |
| `content-plugin:list` | 1367 | `handle` | List installed content plugins (tutorial packs) |
| `content-plugin:list-docs` | 1377 | `handle` | List docs in a content plugin |
| `content-plugin:read` | (around 1391) | `handle` | Read a single doc from a content plugin |
| `runtime:status` | 1446 | `handle` | R / Python runtime install status |
| `backend:status` | 1458 | `handle` | Aggregate backend readiness (r-server, py-server, plumber, R/Python runtimes) |
| `py:start` / `py:stop` | 1496 / 1504 | `handle` | Lazy-start / stop py-server |
| `plumber:start` / `plumber:stop` | 1512 / 1520 | `handle` | Lazy-start / stop plumber |
| `updater:check` | 1532, 1560 | `handle` | macOSS updater: check for new build (twice — once in dev shim, once in prod block) |
| `updater:download` | 1536, 1579 | `handle` | Download update artifact |
| `updater:install` | 1540, 1591 | `handle` | Apply update |
| `file:save-dialog` | 1605 | `handle` | Native save dialog |
| `file:open-dialog` | 1618 | `handle` | Native open dialog |
| `file:open-path` | 1641 | `handle` | `shell.openPath()` (whitelist via `ALLOWED_OPEN_EXTENSIONS`) |
| `file:open-workspace-file` | 1664 | `handle` | Open a path inside an opened workspace |
| `diagnostic:export` | 1696 | `handle` | Bundle logs + sysinfo into a zip |
| `data:info` | 1842 | `handle` | Sizes of data dir breakdown |
| `data:open-dir` | 1887 | `handle` | `shell.openPath()` on data dir |
| `terminal:snapshot` | 1914 | `handle` | Snapshot running subprocesses + log tails |
| `terminal:open-log-dir` | 1974 | `handle` | Reveal log dir in OS file manager |
| `terminal:open-shell` | 1985 | `handle` | Open native shell session |
| `terminal:session-start` | 2022 | `handle` | `node-pty` spawn shell session |
| `terminal:session-write` | 2062 | `handle` | Write input to PTY |
| `terminal:session-resize` | 2072 | `handle` | PTY resize |
| `terminal:session-stop` | 2080 | `handle` | Kill PTY |
| `harness-capabilities:list` | 2099 | `handle` | Read-only listing of harness-provisioned bundles/runtimes |

**Streaming / progress events emitted via `mainWindow.webContents.send`:**

| Event channel | Line | Producer |
|---|---|---|
| `petri:agent-workbench-flags` | 911 | `setupAgentWorkbenchFlags` initial push |
| `app:soft-refresh` | 1081 | Dev-triggered full reload fallback |
| `updater:download-progress` | 1555 | Updater progress |
| `updater:update-downloaded` | 1582 | Updater terminal state |
| `updater:error` | 1586, 1597 | Updater error sink |
| Generic `channel` | 1910 | `sendTerminalEvent(channel, payload)` helper inside `setupTerminalIpc()` — fires `terminal:data` and `terminal:exit` |
| Generic `channel` | 1151 | Inside `app:soft-refresh` trigger (windowForEvents) |

**Pattern used**: `setupXxxIpc()` functions (e.g. `setupWindowIpc`, `setupTerminalIpc`, `setupDataIpc` — implicit by file layout) call `ipcMain.handle(channel, async (event, ...args) => { ... })` for request/response and `ipcMain.on(channel, listener)` for fire-and-forget UI commands. Streaming uses `mainWindow.webContents.send(channel, payload)` from the main process, paired with `ipcRenderer.on(channel, listener)` + cleanup in preload.

**🚨 No `skills:*` handler exists in main.js.** `grep -i 'skill' src/main.js` returns no matches. The skill registry code in `core/shared-backend/` (`skill-registry.js`, `skill-runtime.js`, `skill-schema.js`, `skills-sdk.js`) is imported by the r-server, but **the Electron main process has no wiring from IPC channels to that engine**. The renderer-side `useSkillStore` invokes a non-existent bridge.

---

## §2 Renderer Bridge Layer

### 2.1 `frontend/src/lib/desktopBridge.ts`

> File: 117 lines, full read. Pure TS facade, no React. Imports `Window['petriDesktop']` from `@/lib/electron`.

**Exported API** (5 named exports + 2 type aliases + 1 class):

| Export | Kind | Signature | JSDoc summary |
|---|---|---|---|
| `DesktopBridgeName` | type | `keyof Window['petriDesktop']` | Bridge-name key — adding a new bridge in `electron.d.ts` automatically makes it addressable. |
| `DesktopBridgeHandle<K>` | type | `Window['petriDesktop'][K]` | Sub-handle type for a given bridge name. |
| `BridgeUnavailableError` | class | `extends Error`, name `'BridgeUnavailableError'` | Thrown by `requireBridge` when the bridge is missing; message identifies which bridge. |
| `isDesktop()` | function | `() => boolean` | True if running inside the Petri desktop app (`window.petriDesktop` is set). SSR-safe (short-circuits when `typeof window === 'undefined'`). |
| `getBridge<K>(name: K)` | function | `<K extends DesktopBridgeName>(name: K) => DesktopBridgeHandle<K> \| null` | Returns the sub-bridge typed against the canonical shape, or `null` if the desktop context (or that specific bridge) is unavailable. Non-critical paths short-circuit on `null`. |
| `requireBridge<K>(name: K)` | function | `<K extends DesktopBridgeName>(name: K) => DesktopBridgeHandle<K>` | Throws `BridgeUnavailableError` if missing. For hot-path IPC where there is no graceful fallback. |

**TypeScript surface** — from the consumer's view:

```ts
// What a hook sees when calling getBridge('skills'):
const bridge = getBridge('skills');
//   ^? {
//       discover: () => Promise<{ ok: boolean; skills?: Skill[]; error?: string }>;
//       execute: (skillId: string, params: Record<string, unknown>) => Promise<{ ok: boolean; executionId?: string; error?: string }>;
//       getExecution: (executionId: string) => Promise<{ ok: boolean; execution?: SkillExecutionSnapshot; error?: string }>;
//     } | null
```

The `K extends DesktopBridgeName` constraint means a `getBridge('skills')` call **compiles fine today** even though no main.js handler exists — `electron.d.ts` already declares the bridge. The runtime `null` is what kills the Skills page (see §3, §7).

---

## §3 useSkillStore — Current Data Flow

> File: `frontend/src/hooks/useSkillStore.ts` (586 lines, full read).

### 3.1 Exported hooks / helpers

| Export | Kind | Description |
|---|---|---|
| `useSkillStore(opts?)` | hook | The only public hook. Options: `{ autoLoad?: boolean = true; forceRefresh?: boolean = false }`. Returns `UseSkillStoreResult`. |
| `__resetSkillStoreCacheForTests()` | function | Clears module-level `_cache`, `_inflight`, `_subscribers`, stops all polls. Test-only. |

### 3.2 `UseSkillStoreResult` shape

```ts
{
  // state
  skills: Skill[];                          // unfiltered
  filteredSkills: Skill[];                  // search + category + source filter applied
  loading: boolean;
  error: string | null;
  searchQuery: string;
  categoryFilter: string | null;
  sourceFilter: SkillSource | null;
  categories: string[];                     // derived from cache
  tags: string[];                           // derived from cache
  executions: Map<string, SkillExecution>;  // optimistic + polled
  // actions
  discover: () => Promise<void>;            // re-fetches via bridge (forceRefresh path)
  search: (query: string) => Promise<void>;  // local filter only — server-side reserved
  execute: (skillId: string, params?: Record<string, unknown>) => Promise<ExecuteResult>;
  getExecution: (executionId: string) => SkillExecution | undefined;
  invalidateCache: () => void;
}
```

### 3.3 Data source for each hook action

| Action | Current data source | Lines | Notes |
|---|---|---|---|
| `discover` (initial + forceRefresh) | **IPC via `getBridge('skills').discover()`** — calls back into `window.petriDesktop.skills.discover()` | `_discoverSkills()` at 170–212; `discover` callback at 437–450 | Module-level cache (`_cache`) + 5-min TTL + in-flight de-dup. **🚨 Returns `{ ok: false, error: 'skills bridge unavailable' }` because no preload expose exists.** |
| `search` | local-only (`useMemo` filter on `snapshot.skills`) | 452–456 | Reserved for future server-side search; today only sets the local `searchQuery`. |
| `execute` | **IPC via `getBridge('skills').execute(skillId, params)`** | `execute` callback at 458–540 | Generates optimistic `SkillExecution` record with id `exec-${Date.now()}-${rand}`, awaits bridge promise, swaps optimistic id for real `executionId`, then starts `_startPolling`. **🚨 Returns `{ ok: false, error: 'skills bridge unavailable' }`.** |
| `getExecution` | local `Map<string, SkillExecution>` lookup | 542–547 | No IPC. |
| `invalidateCache` | local cache reset | 549–552 | No IPC. |
| Background polling on `execId` | **IPC via `getBridge('skills').getExecution(executionId)`** every 2 s | `_startPolling` at 218–266 | Stops polling on terminal state (`completed`/`failed`). **🚨 Falls through on first poll cycle.** |

### 3.4 Hook methods that need to be rewired to real IPC

For PHASE 1 the rewiring is **not in `useSkillStore` itself** — the calls already target `getBridge('skills').{discover,execute,getExecution}`. What's missing is:

1. **`skills:discover` IPC channel** — main process handler that calls `core/shared-backend/skill-registry.js#listSkills()` (or equivalent) and returns the Skill[] in the documented shape.
2. **`skills:invoke` IPC channel** (renamed from the hook's `execute` to align with the plan naming) — main process handler that calls `core/shared-backend/skill-runtime.js#invokeSkill(skillId, params)` and returns `{ ok, executionId, error? }`.
3. **`skills:status` IPC channel** — main process handler that maps to `getExecution`; returns the latest execution snapshot (no more client polling needed if we use push).
4. **`skills:progress` push channel** — `webContents.send('skills:progress', payload)` from main → preload `ipcRenderer.on` → renderer subscriber; replaces the 2-second polling loop with a push model.

So the **4 IPC methods** the plan asks for (`skills:list` / `skills:invoke` / `skills:status` / `skills:progress`) split cleanly:
- `skills:list` ↔ current `discover`
- `skills:invoke` ↔ current `execute`
- `skills:status` ↔ current `getExecution`
- `skills:progress` ↔ new push channel that **removes** the need for `_startPolling`

### 3.5 Public signature stability

`UseSkillStoreResult` is the contract callers depend on. `SkillCard`/`SkillDetail`/`SkillSearch` only read the data fields (`skills`, `filteredSkills`, `searchQuery`, `sourceFilter`, `categoryFilter`, `categories`, `stats`) and the action (`execute`). **None of these public shapes may change in PHASE 1** — only the underlying bridge wiring. The optional `executions` / `getExecution` fields are unused by the current pages (`grep` confirms only `useSkillStore.ts` itself references them) so they could be retired later but must remain compile-compatible today.

---

## §4 Pages/Skills Consumers

### 4.1 `frontend/src/pages/skills/index.tsx`

- **Imported by**: `frontend/src/App.tsx` line 17: `import SkillsPage from '@/pages/skills';` + Route at line 78 `<Route path="/skills" element={<SkillsPage />} />`.
- **Hooks consumed** (line 33–47 destructured from `useSkillStore`):
  - Data: `skills`, `filteredSkills`, `loading`, `error`, `searchQuery`, `categoryFilter`, `sourceFilter`, `categories`, `executions`
  - Actions: `setSearchQuery`, `setCategoryFilter`, `setSourceFilter`, `execute`
- **No direct IPC use.** No `useEffect`-based re-fetch. `useNavigate` for the error-state "返回首页" button.
- Compute stats locally in `computeStats(skills)` (lines 15–30) — does NOT depend on IPC.

### 4.2 `frontend/src/pages/skills/SkillCard.tsx`

- **Props** (lines 11–16):
  ```ts
  { skill: Skill;
    onViewDetail: (skill: Skill) => void;
    onExecute: (skill: Skill) => void;
    canExecute?: boolean;  // default true
  }
  ```
- **Actions dispatched**:
  - `onViewDetail(skill)` on click of `查看详情` button (line 36–38) — opens the detail modal.
  - `onExecute(skill)` on click of `执行` button (line 40–42) — also opens the detail modal in the current wiring (parent `index.tsx` line 162 maps `onExecute` to `handleViewDetail`). The **real execution** is fired later from inside the `SkillDetail` modal, **not** by this card.
- **No IPC, no store call.** Pure presentation.

### 4.3 `frontend/src/pages/skills/SkillDetail.tsx`

- **Props** (lines 11–17):
  ```ts
  { skill: Skill;
    onClose: () => void;
    onExecute: (skill: Skill, params: Record<string, unknown>) => void;
    canExecute?: boolean;
    isExecuting?: boolean;
  }
  ```
- **Invoke trigger**:
  - `handleExecute` at lines 127–129: `onExecute(skill, paramValues)`. Wired to the `执行 Skill` button at lines 287–304.
  - **Payload shape**: `(skill: Skill, params: Record<string, unknown>)` where `params` is built from `useState<ParamValues>` (lines 114–121) seeded with `skill.parameters.optional[k].default`. The hook on the other side (`useSkillStore.execute`) accepts `params?` and forwards it as-is to the bridge.
- **Internal state**: `paramValues` (local), no IPC, no store call.

### 4.4 Store-consumer contract stability

The store-consumer contract is **fully stable and side-effect free** from the page's perspective:

- All async work happens inside `useSkillStore` (`_discoverSkills`, `execute`, `_startPolling`).
- Pages destructure and only call action methods; they never reach into the bridge.
- `SkillCard` and `SkillSearch` never touch the store or IPC.

**Conclusion**: PHASE 1 can rewire the bridge underneath `useSkillStore` without changing any of `index.tsx`, `SkillCard.tsx`, `SkillDetail.tsx`, or `SkillSearch.tsx`.

---

## §5 UI-161 Cleanup Verification (5-item checklist)

| # | Item | Expected | Observed | Status |
|---|---|---|---|---|
| 1 | Dead `SkillsSidebar.tsx` component file | must NOT exist | `frontend/src/components/desktop/SkillsSidebar.tsx` → **not found** (Glob `**/SkillsSidebar.*` → 0 files) | ✅ OK |
| 2 | Dead `SkillsSidebar.module.css` | must NOT exist | `frontend/src/components/desktop/SkillsSidebar.module.css` → **not found** (Glob `**/SkillsSidebar.*` → 0 files) | ✅ OK |
| 3 | `LeftPanel` `QuickActions` array — Skills entry exists | yes, with `sparkles` icon | `LeftPanel.tsx` lines 125–133 — entry `{ key: 'skills', mode: null, label: 'Skills', icon: 'sparkles', onClick: ctx.handleNavigateToSkills, title: 'Skills' }` | ✅ OK |
| 4 | `pages/skills/index.tsx` error state — "返回首页" button | present | `pages/skills/index.tsx` lines 107–115 — `<button className={styles.retryBtn} onClick={handleReturnHome} title="返回首页">返回首页</button>` (note: `handleReturnHome` calls `navigate('/')`, line 55) | ✅ OK |
| 5 | `styles/custom.css` — 4 tokens present | all 4 | light-mode: `--petri-accent-soft` line 83, `--petri-border-color` line 74, `--petri-font-mono` line 86, `--petri-font-sans` line 85 — all present in `:root`. dark-mode overrides: lines 192 (accent-soft), 194 (border-color) — font tokens correctly inherited via the `[data-theme='dark']` block's empty font section (theme switch uses the same font tokens) | ✅ OK |

**Note on UI-161 sidebar residue**: `frontend/src/components/desktop/desktop.css` lines 1889–1897 still carry a comment block titled `SkillsSidebar — 桌面端 Skills 快速访问侧边栏布局` plus a `.petri-spa-main { transition: margin-left 0.25s ease; }` rule. These are dead comments (and one dead style rule) but not file-level references; they don't break UI but should be cleaned in a follow-up to fully retire UI-161 traces. The `.petri-spa-main` `transition` is harmless because no element currently sets `margin-left` from this rule's expectation.

---

## §6 IPC Bridge Touchpoint Plan (for PHASE 1)

### 6.1 `skills:list` (replace current `skills:discover` semantics from `electron.d.ts`)

| Layer | Action | Target location |
|---|---|---|
| main.js | **NEW** `ipcMain.handle('skills:list', async (event) => { ... })` inside a new `setupSkillsIpc()` function — call `core/shared-backend/skill-registry.js` (`require('./skill-registry')` next to existing plugin-manager requires on line 874) and normalize to the Skill shape. Place near the other `setupXxxIpc` blocks (after `setupDataIpc` at line 1900 is a natural slot). |
| preload.js | Add `skills: { list: () => ipcRenderer.invoke('skills:list'), ... }` inside the `petriDesktop` `contextBridge.exposeInMainWorld` block (around line 145, before `runtime`). |
| electron.d.ts | **Already declared** (lines 116–151) under `skills.discover()`. Either keep the existing method name or extend the interface to add `list` alongside `discover` — prefer `discover` to keep current `useSkillStore` source untouched, OR add a new `list` and switch `useSkillStore` to it. |
| desktopBridge.ts | No change needed (centralized access pattern already generic over `keyof petriDesktop`). |
| useSkillStore.ts | No change needed — `getBridge('skills').discover()` resolves at runtime once preload exposes it. |

**Risk**: Any caller that depends on `bridge === null` would break; current behavior is `bridge === null` so callers already cope. The signature (`Promise<{ ok, skills?, error? }>`) is what `useSkillStore` already expects.

### 6.2 `skills:invoke` (replace current `skills:execute`)

| Layer | Action | Target location |
|---|---|---|
| main.js | **NEW** `ipcMain.handle('skills:invoke', async (event, { skillId, params }) => { ... })` — call `core/shared-backend/skill-runtime.js#invokeSkill(skillId, params)`. Place inside the same new `setupSkillsIpc()` function. **Important**: parse `params` defensively — the bridge will receive an arbitrary object from the renderer. |
| preload.js | Add `skills.invoke = (skillId, params) => ipcRenderer.invoke('skills:invoke', { skillId, params })` (object-wrap to keep the wire payload self-describing). |
| electron.d.ts | **Already declared** (lines 152–155) as `skills.execute(skillId, params)`. Either keep the name or alias it; prefer keeping `execute` to avoid touching `useSkillStore`. |
| desktopBridge.ts | No change. |
| useSkillStore.ts | No change needed. |

**Risk**: The plan asks for `skills:invoke`; the current store calls `bridge.execute`. Pick **one** of these paths:
- **Option A** (smaller diff): keep `electron.d.ts` `execute`, name the channel `skills:invoke`, preload maps `execute → invoke('skills:invoke', ...)` — fully transparent.
- **Option B** (cleaner naming): rename `electron.d.ts` `execute` → `invoke` (or add `invoke` alongside `execute`), update `useSkillStore.ts` line 484 to call `bridge.invoke(skillId, params ?? {})`.

### 6.3 `skills:status` (replace current `skills:getExecution`)

| Layer | Action | Target location |
|---|---|---|
| main.js | **NEW** `ipcMain.handle('skills:status', async (event, executionId) => { ... })` — returns latest execution snapshot from the in-memory registry. |
| preload.js | Add `skills.status = (executionId) => ipcRenderer.invoke('skills:status', executionId)`. |
| electron.d.ts | **Already declared** (lines 156–168) as `skills.getExecution`. Either keep or rename. |
| desktopBridge.ts | No change. |
| useSkillStore.ts | No change needed. |

**Risk**: Polling cadence is currently 2 s (`_startPolling` line 263). If PHASE 1 swaps polling for a push channel, the `_startPolling` block becomes dead — remove it but keep `getExecution` returning the latest snapshot to satisfy the `SkillExecution` mapping.

### 6.4 `skills:progress` (NEW push channel — replaces polling)

| Layer | Action | Target location |
|---|---|---|
| main.js | **NEW** event push: `mainWindow.webContents.send('skills:progress', { executionId, status, result?, error?, timestamp })`. Wire into the skill runtime's completion / progress hooks. |
| preload.js | Add `skills.onProgress(callback)` factory that registers `ipcRenderer.on('skills:progress', listener)` and returns an unsubscribe function. |
| electron.d.ts | Add `onProgress: (cb: (e: SkillProgressEvent) => void) => () => void` to the `skills` sub-bridge type (lines 114–169). |
| desktopBridge.ts | No change. |
| useSkillStore.ts | Optionally swap `_startPolling` for a subscription via `getBridge('skills')?.onProgress?.(...)` — non-blocking change. |

**Risk**: If polling stays in the hook while the push channel also fires, you'll get duplicate updates. Decide PHASE 1: **either** remove `_startPolling` entirely, **or** leave it as a fallback for cases where the push channel never fires (e.g. backend hangup). The conservative path is "remove polling, add push".

---

## §7 Risks / Open Questions

### 7.1 Skills error retry button (UI-161) — does it call IPC?

**No.** The `返回首页` button at `pages/skills/index.tsx` lines 107–115 invokes `handleReturnHome` (line 55), which is `useCallback(() => navigate('/'), [navigate])`. It is a **React Router navigation**, not an IPC retry. It does not call `discover` or any bridge method.

If the intent is "retry loading skills", the button today silently routes to `/` regardless of whether the cause is a bridge outage, a network blip, or a known "no skills installed" empty cache. PHASE 1 should consider either:
- Renaming the button to `返回首页` and leaving it as a navigation-only escape hatch (current behavior), **or**
- Wiring it to `useSkillStore().discover()` to retry the bridge call.

The current label + behavior is internally consistent (label says "go home", button navigates home).

### 7.2 Are there Skills-related tests that lock in current behavior?

**No.** A `glob` for `test/**/*skill*` returns 0 files, and `grep` across `**/*.test.{ts,tsx,js,jsx}` for `useSkillStore|skills:discover|skills:execute|skills:list|window.petriDesktop.skills` returns no matches. The only adjacent test is `frontend/src/hooks/usePluginStore.test.ts` (175 lines) — it follows the same `vi.fn`-based bridge mock pattern and could serve as the template for a future `useSkillStore.test.ts`. Because there are no tests, PHASE 1 is free to add IPC handler tests without breaking existing snapshots.

### 7.3 Does main.js need any new import / require for the engine?

**Yes.** main.js currently imports:
- `./owned-backend-supervisor`, `./macos-oss-updater`, `./diagnostic-redaction`, `./platform-compat`, `./plugin-manager`, `./content-sync`, `./static-server`, `./telemetry`, `./backend-health` (lines 44–46, 874, 885, 948, 970, 1296, 1309+ etc.)

PHASE 1 will need a **new** `require('./skill-bridge')` (or inlined module) wrapping `core/shared-backend/skill-registry.js` + `skill-runtime.js` + `skill-schema.js`. These three files already exist in `core/shared-backend/` but **no main.js code imports them today**. The wiring shape should mirror the existing plugin-manager / backend-health layering: a thin wrapper that reads from the registry, normalizes to the Skill shape, and returns `{ ok, skills, error? }`.

### 7.4 TypeScript strict mode — any types that need to be declared?

- `electron.d.ts` lines 114–169 already declare `skills.{discover, execute, getExecution}`. PHASE 1 must **either** add new methods (`list`, `invoke`, `status`, `onProgress`) or repurpose the existing ones — either way a TS diff is required.
- If PHASE 1 chooses **Option B** in §6.2 (rename `execute → invoke`), the rename must propagate to `useSkillStore.ts` line 484 and the file-local `ExecuteResult` type alias at lines 129–133.
- The `getBridge('skills')` return type is `DesktopBridgeHandle<'skills'>` which collapses to `window.petriDesktop.skills`. **No `any` will be needed** if the interface is kept clean.
- `useSkillStore.ts` line 234 casts `result.execution` fields into a local `SkillExecution`. If PHASE 1 normalizes the IPC payload strictly to `SkillExecution`'s public shape, the cast at lines 235–247 can stay but should be revisited.

### 7.5 Other open questions

- **Backend status coupling**: `useSkillStore.ts` does not gate `discover` on `backend.status`. If the backend is offline, the bridge call will hang or error. Consider gating behind `getBridge('backend')?.status()`.
- **Skill ID encoding**: `skill-registry.js` schema allows `id` strings with `/` separators (categories like `omics/dge`). The IPC channel uses positional args — `skillId` is a string. No encoding issue, but the optimistic id pattern `exec-${Date.now()}-${rand}` on line 469 must not collide with the real id format returned by main.
- **Cleanup of optimistic executions**: when `bridge.execute` resolves, the hook at lines 488–498 deletes the optimistic id from the map. If the bridge promise rejects, the optimistic record stays in the map as `failed` — fine, but a `Map<string, SkillExecution>` will grow unbounded across a long session if many invocations fail. Consider LRU cap or unmount cleanup.

---

## §8 Reference Commands

```bash
# Plan + required reading
read <repo>/docs/block-2-ui-157-review-plan.md
read src/preload.js
read frontend/src/lib/desktopBridge.ts
read frontend/src/pages/skills/index.tsx

# Skill page & hooks
read frontend/src/hooks/useSkillStore.ts
read frontend/src/pages/skills/SkillCard.tsx
read frontend/src/pages/skills/SkillDetail.tsx
read frontend/src/pages/skills/SkillSearch.tsx
read frontend/src/pages/skills/skill.types.ts

# UI-161 cleanup
read frontend/src/components/workspace-panels/LeftPanel.tsx
read frontend/src/styles/custom.css
read frontend/src/App.tsx
glob '**/SkillsSidebar.*'
grep --files-with-matches SkillsSidebar   # → only agent-tools/audit-w3-gate-scripts.md, frontend/src/components/desktop/desktop.css

# Main.js IPC survey
read src/main.js   # lines 1-200, 1170-1200, 1696-1900, 1974-2099
grep -n "ipcMain\.(handle|on)\(['\"]([^'\"]+)['\"]" src/main.js
grep -i 'skill' src/main.js                # → no matches
grep -n 'webContents\.send' src/main.js
grep -n "^const .* = require" src/main.js

# Electron ↔ preload interface
read frontend/src/lib/electron.d.ts
grep -i 'skill' src/preload.js             # → no matches

# Dead-file / dead-comment verification
glob 'frontend/src/components/desktop/SkillsSidebar.*'   # → 0 files
glob '**/SkillsSidebar.*'                                  # → 0 files
grep --files-with-matches SkillsSidebar                    # → desktop.css comments + audit-w3

# Tests
glob 'test/**/*skill*'                                     # → 0 files
glob 'frontend/src/**/useSkillStore.test.*'                # → 0 files
grep -l 'useSkillStore|skills:discover|skills:execute|skills:list|window.petriDesktop.skills' '**/*.test.{ts,tsx,js,jsx}'   # → 0 files

# Tokens
grep -n -- '--petri-accent-soft|--petri-border-color|--petri-font-mono|--petri-font-sans' frontend/src/styles/custom.css

# Icons sanity
grep -n 'sparkles\|arrow-left\|alert-circle\|command\|layers' frontend/src/components/icons/Icon.tsx
```

---

## Key findings (TL;DR for PHASE 1)

1. **The Skills bridge is declared but never wired.** `electron.d.ts` declares `window.petriDesktop.skills.{discover, execute, getExecution}`, `useSkillStore` calls `getBridge('skills')`, **but `src/preload.js` has zero `skills` references and `src/main.js` has zero `skill`/`skills` references**. Every `getBridge('skills')` call returns `null` at runtime — the Skills page always renders the error state with the `返回首页` button.
2. **The renderer-side contract is fully stable.** `pages/skills/index.tsx`, `SkillCard.tsx`, `SkillDetail.tsx`, `SkillSearch.tsx` only consume `useSkillStore` data + actions; they never touch IPC. PHASE 1 can rewire underneath the store without changing a single line in `pages/skills/*`.
3. **No tests lock in the current (broken) behavior.** There are zero `skill` test files anywhere in the repo, so PHASE 1 has full freedom to add `useSkillStore.test.ts` modeled on `usePluginStore.test.ts` (175-line template ready), and to add IPC handler tests without breaking existing snapshots.
4. **The 4 new IPC channels split cleanly**: `skills:list` ↔ current `discover`, `skills:invoke` ↔ current `execute`, `skills:status` ↔ current `getExecution`, and `skills:progress` as a new push channel that should replace `_startPolling` (2 s interval) to avoid duplicate update paths.
5. **UI-161 cleanup is verified clean.** `SkillsSidebar.tsx` and `SkillsSidebar.module.css` are gone; `LeftPanel.QuickActions` carries the Skills entry (`icon: 'sparkles'`, lines 125–133); the `返回首页` button at `pages/skills/index.tsx` lines 107–115 is intact; all 4 CSS tokens are present in `custom.css` (lines 74, 83, 85, 86 in light mode; 192, 194 in dark mode). Two dead comment blocks remain in `frontend/src/components/desktop/desktop.css` lines 1889–1897 (`SkillsSidebar` comments + a vestigial `.petri-spa-main { transition: margin-left ... }` rule) — harmless but should be swept in a follow-up.

---
*End of audit. Report written, READ-ONLY phase complete.*