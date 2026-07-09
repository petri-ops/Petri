# Plan 1.4 — State Decomposition (desktop app)

> Mapping all runtime state, classifying it, finding leaks, and proposing the canonical home for each piece.
>
> Scope: BioF3 desktop Electron app (root + `frontend/` + `src/main.js` + `src/preload.js` + `src/plugin-manager.js` + `src/content-sync.js`).

## 0. Summary (TL;DR)

- **Three independent backend-status pollers** run simultaneously for the same data (`useBackendStatus` at 10s, `BackendStatusProvider` at 5s, project-workspace at 15s+5s).
- **Three independent "active project / conversations" loads** for one project: SimpleChat, CopilotChat, project-workspace each fetch their own copy.
- **A module-scope mutable singleton** (`copilotContext.ts → current`) is mutated by 8+ pages with no contract; subscribers leak unless paired with the singleton module (which only ever lives once).
- **Active conversation id stored in two localStorage keys** (`biof3_copilot_active_conv` + `biof3_copilot_active_conv:${projectId}`) and held in 3 component `useState`s.
- **Plugin-store state is duplicated** between `DesktopToolbar → PluginStorePanel` and `project-workspace → ToolboxPanel` plugins tab — both call the same IPC and maintain their own copies.
- **AI model presets** are loaded twice (`SimpleChat` + `DesktopSettingsPanel`) with independent state and independent save handlers.
- **Update progress state** lives in 4 places (`_desktop-dashboard`, `DesktopSettingsPanel`, BackendDownBanner-side data, AIPanel `biof3_agent_task_*` recovery).
- **The `useResizableColumns` hook exists but is not used**; `project-workspace.tsx` re-implements the same logic inline (240 lines of duplicated resize state).
- **Project data is read via two parallel HTTP layers**: `frontend/src/lib/project-store.ts` (used by `project-workspace` + `_desktop-dashboard`) and `frontend/src/pages/single-cell/_store.ts` (used by `single-cell/*`). They call the same backend with different shapes — the latter is dead weight on the desktop branch.
- **Bare `window.biof3Desktop.foo?.bar?.baz?.()`** access is scattered across 20+ files with no central wrapper.

The recommended ordering for migration is in §7.

## 1. Inventory

### 1.1 Electron main process (`src/main.js` + siblings)

| State | Lifetime | Storage | Source of truth | Consumers |
|-------|----------|---------|-----------------|-----------|
| `mainWindow` (`let mainWindow = null`) | session | memory | main.js | `setupAutoUpdateIpc`, `setupTerminalIpc`, `setupFileDialogIpc` (all push events to it) |
| `rServerProc` (ChildProcess \| null) | session | memory | main.js → `startRServer` | `setupRuntimeIpc` → `backend:status` |
| `pyServerProc` + `pyIdleTimer` | session | memory | main.js → `startPyServer/stopPyServer` | `setupBackendLifecycleIpc` (`py:start` / `py:stop`), `backend:status` |
| `plumberProc` + `plumberIdleTimer` | session | memory | main.js → `startPlumber/stopPlumber` | `setupBackendLifecycleIpc`, `backend:status` |
| `_logStreams` (r-server, py-server) | persistent | disk (`{BIOF3_LOCAL_DATA_DIR}/logs/*.log`) | main.js | `setupDiagnosticIpc` (export bundle) |
| `autoUpdater` (`electron-updater`) | session | memory | main.js | `setupAutoUpdateIpc` → push `updater:*` events to renderer |
| `_updateInfo` | session | memory | main.js `autoUpdater.on('update-available')` | `updater:check` handler |
| `shellProc + disposeShellData/Exit` (in `setupTerminalIpc`) | session | memory | main.js → `terminal:session-*` handlers | `mainWindow.send('terminal:data'\|'exit')` |
| `spaServerUrl` (local var) | session | memory | `createWindow` | `will-navigate` filter |
| `servers` map (in `static-server.js`) | session | memory | `startStaticServer` | dev/static log only |
| `globalThis._biof3Plugins` (Map) | session | memory | `plugin-manager.registerPluginInServer` | r-server hot-load via shared-backend bridge |
| `globalThis._biof3ContentPlugins` (Map) | session | memory | `plugin-manager.registerContentPlugin` | `plugin-manager.listContentPluginDocs / readContentPluginDoc` |
| `INSTALLED_FILE` (`plugins/installed.json`) | persistent | disk | `plugin-manager.{get,save,add,remove}InstalledPlugins` | manifest merge (`getRemoteManifest`), `checkUpdates`, startup loader |
| `RUNTIMES_DIR/{R,Python}/` directory | persistent | disk | runtime plugin install flow | `getRuntimeStatus`, `startRServer` / `startPyServer` (via env) |
| `LOCAL_CONTENT_DIR` + `file-hash.json` | persistent | disk | `content-sync.syncContent` | `globalThis._biof3ContentUpdated()` callback (r-server re-read) |
| `BIOF3_DB_PATH` (sqlite db) | persistent | disk | `main.js` + `migration-runner.js` | r-server / py-server via init |
| `ai-settings.json` (via `r-server/helpers/ai-settings.js`) | persistent | disk | `ai-settings:get/save/test` IPC handlers | `DesktopSettingsPanel`, `SimpleChat` (read presets) |
| `BIOF3_R_HOME` / `BIOF3_PY_HOME` env vars | session | process env | `setupDesktopEnv` + runtime install | r-server / py-server spawn |

### 1.2 Preload bridge (`src/preload.js`)

| State | Lifetime | Storage | Notes |
|-------|----------|---------|-------|
| `window.biof3Desktop` (typed via `lib/electron.d.ts`) | session (extension of window) | window | Pure IPC forwarder — no internal state |
| `window.process.env.{BIOF3_DESKTOP, NODE_ENV}` | session | window | Synthetic env shim |
| Event subscriptions returned by `terminal.onData/onExit`, `updater.on*` | session | per-callback closure | Cleaned up by calling the returned disposer |
| `plugin:install-progress` listener | ephemeral | per-call closure | Auto-removed after install resolves/rejects |

### 1.3 Frontend global / context state

| State | Lifetime | Storage | Source of truth | Consumers |
|-------|----------|---------|-----------------|-----------|
| `BackendStatus` (Context in `BackendStatusProvider`) | session | memory (Context) | `useEffect(5000ms) poll → window.biof3Desktop.backend.status()` | `BackendDownBanner`, `_desktop-dashboard`, `DesktopOnboarding`, `SimpleChat`, `RightPanel` |
| `polledBackendStatus` (in `useBackendStatus` hook) | session | memory | per-component `useState` | `project-workspace.tsx` (line 170) — **duplicate of `BackendStatusProvider`** |
| `backendSummary` (derived) | session | memory | `useMemo(backendStatus)` in `project-workspace` | `CenterPanel` (via ctx) |
| `copilotContext.current` (module-scope singleton) | session | memory | every `setCopilotContext()` call (8+ pages) | `subscribeCopilotContext()` listeners (none in production — pure mutation) |
| `current` listener set (in `copilotContext.ts`) | session | memory (Set) | `subscribeCopilotContext` | none currently reads (the contract is dead-on-arrival) |
| theme (`<html data-theme>`, mirrored in `biof3-theme` LS) | persistent | LS + DOM attr | `App.tsx` + `DesktopToolbar.toggleTheme` | all CSS via `data-theme` |
| `biof3-onboarding-completed` / `biof3-onboarding-mode` | persistent | LS | `DesktopOnboarding.finish / goToPluginStore` | `App.tsx DesktopOnboardingMount` |
| `biof3-backup-prompted` | persistent | LS | `_desktop-dashboard` mount | `_desktop-dashboard` banner |

### 1.4 Per-component / per-page state

#### `project-workspace.tsx` (one big component — 3078 lines)

| State (useState) | Purpose | Persistence |
|------------------|---------|-------------|
| `project` (`Project \| null`) | current project record | session; reloaded every 15s + on `biof3:soft-refresh` |
| `jobs`, `datasets` | aggregates for the project | session; reloaded with `project` |
| `loading`, `error`, `workspaceNotice` | page chrome | session |
| `workspaceMode` | `'cloud'\|'chat'\|'search'\|'scheduled'\|'tools'\|'figcode'\|'plugins'\|'settings'` | URL `?mode=` |
| `leftOpen`, `rightOpen`, `compactLayout` | responsive layout | session; `compactLayout` derived from `matchMedia` |
| `activeJobId`, `activeArtifact` | right-panel selection | session |
| `activeWorkspaceFile`, `openWorkspaceFiles` | file preview tabs | session |
| `conversations`, `activeConvId` | current project's conversations + selection | session; reloaded on project change + 5s periodically |
| `expandedProjects`, `projectConversations`, `searchConversationIndex` | left sidebar tree | session |
| `creatingProjectInline`, `newProjectName/Desc/WorkspacePath`, `creatingProject` | new-project form | session |
| `creatingConversationFor`, `newConversationTitle`, `creatingConversation` | new-conversation form | session |
| `workspaceSearchQuery`, `sidebarQuery` | search inputs | session |
| `summaryOpen`, `summarySize` (`{w,h}`) | summary card | session (resets on remount) |
| `leftWidth`, `rightWidth`, `inputHeight`, `bottomTerminalOpen`, `bottomTerminalHeight` | column / terminal sizes | session (NOT persisted — duplicated by `useResizableColumns` hook) |
| `rightTab`, `openRightTabs`, `rightToolMenuOpen`, `browserUrl` | right panel UI | session |
| `centerColWidth`, `sessionFrameWidth`, `sessionFrameHeight` | derived sizes via `ResizeObserver` | session |
| `allProjects` | full sidebar projects list | session |
| `draggingId/dockOrder` (in `DesktopToolbarInner`, separate component) | dock reordering | LS `biof3-dock-order` |
| `panelWidths`, `colorMode`, `dockCollapsed` (in `DesktopToolbarInner`) | panel chrome | LS (`biof3-panel-widths`, `biof3-theme`) |
| `terminal:data` ring buffer (in `TerminalPanel` local useState) | full process log snapshot | session |
| `text / status` in `WorkspaceFilePreview` | preview body | session |
| `tree, expandedDirs, treeWidth, treeOpen, loading` in `RightFileTree` | tree UI | session |
| Plugin state (ToolboxPanel plugins tab): `installed`, `remotePlugins`, `installing`, `uninstalling`, `pluginError`, `pluginLoaded` | duplicated from `PluginStorePanel` | session |
| `toolboxTab`, `query`, `activeCat` | toolbox UI | session |

#### `SimpleChat.tsx`

| State | Purpose | Persistence |
|-------|---------|-------------|
| `messages`, `input`, `streaming`, `loading`, `conversations` | chat body | session |
| `pendingApproval`, `paramDraft` | tool-approval card | session |
| `modelPresets`, `activeModelId`, `modelMenuOpen` | model picker | session; reloads from `ai-settings.json` IPC at mount |
| `accessMenuOpen`, `accessMode` | read-only badge | session |
| `taRef`, `scrollRef`, `abortRef`, `activeConvRef` | DOM / abort refs | session |
| Chat messages reloaded on `conversationId` change | via `getConversationMessages(convId, 200)` IPC | session |

#### `CopilotChat.tsx`

| State | Purpose | Persistence |
|-------|---------|-------------|
| `messages`, `conversations`, `activeConvId`, `activeConvTitle` | full chat state | LS `biof3_copilot_active_conv` (or `...:${projectId}`); chip fetch |
| `pendingApproval`, `paramDraft` | tool-approval | session |
| `summary`, `showSummary`, `showTrace`, `trace` | fact + trace panel | session |
| `panelOpacitySetting`, `showOpacitySlider` | opacity | LS `biof3-copilot-opacity` |
| `size`, `panelPos`, `fabPos`, `docked` | window chrome | LS (`biof3_copilot_size`, `biof3_copilot_panel_pos`, `biof3_copilot_fab_pos`, `biof3_copilot_docked`) |
| `topicShiftHint`, `activePlanId`, `planRefreshKey` | inline plan/UX | session |
| `seenUndoTokens`, `inputHistoryRef`, `historyIndexRef`, `historyDraftRef` | undo dedup + ↑/↓ history | session (refs only) |
| `abortRef`, `listRef`, `taRef`, `resizeStart`, `dragStart`, `fabHadDragRef` | DOM / drag refs | session |

#### `DesktopSettingsPanel.tsx`

| State | Purpose | Persistence |
|-------|---------|-------------|
| `settings`, `deepseekKey`, `dashscopeKey` | AI keys | session; saved → `ai-settings.json` via IPC |
| `chatProvider`, `embedProvider` | defaults | session; IPC |
| `chatModelPresets`, `activeChatModelId` | model presets | session; **this is the second copy** (SimpleChat also holds one) |
| `telemetryEnabled` | telemetry opt-in | session; saved to `ai-settings.json` |
| `testing`, `testResult` | per-key test UX | session |
| `saving`, `saved` | save button UX | session |
| `UpdateSection` local: `version`, `downloading`, `progress`, `updateInfo`, `updateDownloaded`, `installing`, `error`, `checking`, `msg` | update flow | session |
| `ExportDiagnostic`: `exporting`, `msg` | export UX | session |
| `DataManagement`: `info`, `opening` | data dir UX | session |

#### `PluginStorePanel.tsx`

| State | Purpose | Persistence |
|-------|---------|-------------|
| `installed`, `remote`, `installProgress` | plugin list | session |
| `installing`, `uninstalling`, `error` | operation UX | session |
| `runtimeJustInstalled`, `runtimeStatus` | runtime hint | session |
| `activeCategory`, `searchQuery`, `updates`, `checkingUpdates`, `updatingId` | filter / updates UX | session |
| `loadPlugins` re-runs on every mount + after every install/uninstall/update | session |

#### `_desktop-dashboard.tsx`

| State | Purpose | Persistence |
|-------|---------|-------------|
| `recentJobs`, `loadingJobs` | recent task history | session; polled every 30s |
| `projects`, `loadingProjects` | project list | session |
| `showNewProject`, `newProjectName`, `newProjectDesc`, `creatingProject` | new-project form | session |
| `dataDir` | from `window.biof3Desktop.data.info()` | session |
| `hasUpdate`, `updateVersion` | update notice | session |
| `updOpen`, `updDownloading`, `updProgress`, `updDownloaded`, `updError`, `updInstalling` | update flow | session |
| `exporting`, `exportMsg`, `backupPromptDismissed` | backup UX | session (with LS `biof3-backup-prompted`) |

#### `DesktopToolbarInner` / `DesktopOnboarding`

| State | Purpose | Persistence |
|-------|---------|-------------|
| `activePanel` (`PanelKind \| null`) | which side panel is open | session |
| `panelWidths`, `draggingId`, `dragOverId`, `itemRefs` | panel resize/reorder | session (panel widths saved LS) |
| `dockCollapsed`, `dockOrder`, `colorMode` | dock chrome | LS (`biof3-dock-order`, `biof3-theme`) |
| `resizingRef`, `resizeKindRef`, `startXRef`, `startWRef` | drag refs | session |
| Onboarding: `step` (0\|1\|2), `mode` (`learn\|practice\|null`) | 3-step wizard | LS (`biof3-onboarding-completed`, `biof3-onboarding-mode`) |

#### Other page-level state worth noting

- `pages/single-cell/_useSidebarCollapse.ts` — sidebar collapsed + width (`biof3_sidebar_collapsed` + `biof3_sidebar_width` LS). Solid hook, single source of truth.
- `pages/figcode.tsx`, `pages/tools.tsx` — left/right column widths (`biof3-figcode-left-w`, `biof3-tools-left-w` etc.)
- `pages/single-cell/_ProjectsView`, `_DatasetView`, `_ProjectView`, `_ResultView` — module-scope `useState`-driven CRUD flow; many `useState`s per page.
- `pages/single-cell/_QuotaIndicator.tsx`, `_Sidebar.tsx` — multiple useState per page.
- `pages/spatial/_*` — mirror of single-cell (separate copy).
- `pages/skills/_SkillDetailPanel.tsx`, `algorithms/_AlgorithmDetailPanel.tsx` — local detail-panel state.

### 1.5 Hooks / library state

| Hook | Owns | Persistence |
|------|------|-------------|
| `useBackendStatus()` | 10s polling of `backend.status()` | session only (independent of `BackendStatusProvider`) |
| `useTerminalSession(opts)` | xterm.js instance + IPC `terminal.onData/onExit/resizeSession/start/stopSession` | session |
| `useWorkspaceRouting(defaultMode)` | URL ↔ WorkspaceMode bridge | URL only |
| `useResizableColumns(initial)` | L / R / input / bottomTerminal sizes — **NOT USED** in `project-workspace.tsx` | session (NOT persisted) |
| `project-store.ts` (`listProjects`, `createProject`, etc.) | HTTP CRUD wrappers | stateless |
| `authClient.ts` (desktop branch) | hardcoded `DESKTOP_USER` + `'desktop-local'` token | stateless (overrides login/web token) |
| `copilotContext.ts` | module-scope singleton + subscribe API | session (no persistence) |
| `copilotConversationsClient.ts`, `copilotClient.ts`, `copilotMemoriesClient.ts`, `copilotFactsClient.ts`, `copilotSummaryClient.ts`, `copilotPlansClient.ts`, `copilotPrivacyClient.ts`, `copilotProgressClient.ts`, `copilotIndexClient.ts` | API clients | stateless |

### 1.6 Cross-module "bare" event-bus state

| Event name | Producer | Consumer | Channel | Notes |
|------------|----------|----------|---------|-------|
| `biof3:soft-refresh` | main.js (preload) on Cmd+R | `project-workspace` `useEffect` line 712-713 | window | single source / single consumer — fine |
| `biof3:onboarding-done` | `DesktopOnboarding.finish/goToPluginStore` | `App.tsx DesktopOnboardingMount` | window | ok |
| `biof3:project-open-result` | right-panel handlers | `project-workspace` `useEffect` line 868-877 | window | ok |
| `biof3:copilot-ask` | `project-workspace.handleAskAgent` / `_desktop-dashboard` | SimpleChat via `useEffect` | window | ad-hoc, no contract |

## 2. State map

```
┌─────────────────────────────────────────────────────────── ELECTRON MAIN ───────────────────────────────────────────────────────────┐
│  persistent disk:                                                             session memory:                                │
│    • {dataDir}/biof3.db                  ← migration-runner.js → r-server    • mainWindow                                      │
│    • {dataDir}/plugins/installed.json    ← plugin-manager                      • rServerProc / pyServerProc / plumberProc         │
│    • {dataDir}/runtimes/{R,Python}       ← plugin install path                 • pyIdleTimer / plumberIdleTimer                   │
│    • {dataDir}/ai-settings.json          ← r-server/helpers/ai-settings        • _logStreams[name]                                │
│    • {dataDir}/content/file-hash.json    ← content-sync                        • _updateInfo                                      │
│    • {dataDir}/logs/{r,py,plumber,main}.log                                              • shellProc / dispose*                            │
│  globalThis bridges:                                                          • globalThis._biof3Plugins (Map)                   │
│    • _biof3Plugins / _biof3ContentPlugins /                                                 • globalThis._biof3ContentPlugins (Map)          │
│      _biof3ContentUpdated (consumed by r-server)                              • servers[] (static-server.js)                    │
└──────────────┬────────────────────────────────────────────────────────────────────────┬────────────────────────────────────────────────────┘
               │ ipcMain.handle('...')                                              │ webContents.send('...')
               │ (sync returns, async invokes)                                     │ (push channels)
┌──────────────▼─────────────────────────────────────────────── PRELOAD ─────────▼──────────────────────────────────────────────────┐
│  contextBridge.exposeInMainWorld('biof3Desktop', { /* 11 namespaces */ })       │
│  contextBridge.exposeInMainWorld('process', { env: { BIOF3_DESKTOP: '1' } })     │
│  ipcRenderer.on('app:soft-refresh') → window.dispatchEvent('biof3:soft-refresh')│
└───────────────────────┬────────────────────────────────────────────────────────┴───────────────────────────────────────────────────┘
                        │ window.biof3Desktop.*  /  window.biof3:* events
┌───────────────────────▼──────────────────────────────────────── RENDERER ──────────────────────────────────────────────────────────┐
│                                                                                                                          │
│  ┌────────────────────────────────────────────────────── App.tsx ─────────────────────────────────────────────────────────┐  │
│  │  BackendStatusProvider ─── Ctx value: BackendStatus (5s poll)                                                          │  │
│  │    • useBackendStatus() ─► consumers: BackendDownBanner, _desktop-dashboard,                                         │  │
│  │                               DesktopOnboarding, SimpleChat, project-workspace RightPanel                              │  │
│  │  theme / data-theme (LS: biof3-theme)                                                                                 │  │
│  │  onboarding mount (LS: biof3-onboarding-completed)                                                                     │  │
│  └─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                                                          │
│  ┌── global singletons ──┐                          ┌── per-route components ───────────────────────────────────────┐  │
│  │ copilotContext     │ written: 8+ pages (single- │ project-workspace (1078-line beast)                          │  │
│  │ (current + subscribe)│  cell/spatial/figcode/  │   • useBackendStatus() → local backendStatus (line 169-176)│  │
│  │                     │  tools/docs/blog/...)    │   • listProjects / getProject (lib/project-store)         │  │
│  │                     │ listened by: 0           │   • listConversations / createConversation local cache    │  │
│  │ theme (DOM attr)    │                          │   • useResizableColumns-LIKE inline duplication         │  │
│  │                     │                          │   • terminal snapshot useState (5s setInterval)            │  │
│  │                     │                          │   • plugin list useState (duplicated from PluginStore)    │  │
│  │                     │                          │   • activeProject, conversations, jobs, datasets          │  │
│  │                     │                          │   • workflow-mode, summary card, summary size, panel sizes │  │
│  │                     │                          │   • 15s setInterval refetch + biof3:soft-refresh refetch  │  │
│  │                     │                          │                                                           │  │
│  │                     │                          │ SimpleChat (in CenterPanel)                                │  │
│  │                     │                          │   • messages / streaming / conversations (own copy)       │  │
│  │                     │                          │   • modelPresets from IPC aiSettings.get (own copy)       │  │
│  │                     │                          │   • pendingApproval / paramDraft                          │  │
│  │                     │                          │                                                           │  │
│  │                     │                          │ CopilotChat (legacy global panel, still mounted)          │  │
│  │                     │                          │   • own conversations cache                               │  │
│  │                     │                          │   • own activeConvId (LS: biof3_copilot_active_conv)      │  │
│  │                     │                          │   • own size / panelPos / fabPos / docked (LS)            │  │
│  │                     │                          │   • own pendingApproval / paramDraft                      │  │
│  │                     │                          │                                                           │  │
│  │                     │                          │ DesktopToolbarInner                                       │  │
│  │                     │                          │   • activePanel / panelWidths / dockOrder / colorMode    │  │
│  │                     │                          │                                                           │  │
│  │                     │                          │ _desktop-dashboard                                        │  │
│  │                     │                          │   • recentJobs (30s poll) / projects / dataDir /         │  │
│  │                     │                          │     update flow / export flow                             │  │
│  │                     │                          │                                                           │  │
│  │                     │                          │ DesktopSettingsPanel (inside DesktopToolbar)              │  │
│  │                     │                          │   • settings / modelPresets / telemetry / UpdateSection │  │
│  │                     │                          │   • ExportDiagnostic / DataManagement                    │  │
│  │                     │                          │                                                           │  │
│  │                     │                          │ PluginStorePanel (inside DesktopToolbar)                  │  │
│  │                     │                          │   • installed / remote / progress (own copy)              │  │
│  │                     │                          │                                                           │  │
│  │                     │                          │ DesktopOnboardingMount                                    │  │
│  │                     │                          │   • step / mode (LS flags)                                │  │
│  │                     │                          │                                                           │  │
│  │                     │                          │ TerminalPanel / BottomTerminal / useTerminalSession       │  │
│  │                     │                          │   • snapshot useState (5s) + xterm.js + IPC stream       │  │
│  │                     │                          │                                                           │  │
│  │                     │                          │ single-cell / spatial page modules (useState per page)   │  │
│  │                     │                          │   • _store.ts HTTP CRUD + active project / analyses       │  │
│  │                     │                          │   • _auth.ts LS biof3_token — DEAD on desktop branch     │  │
│  │                     │                          │                                                           │  │
│  │                     │                          │ figcode / tools / skills / algorithms (own UI state)    │  │
│  │                     │                          │   • LS column widths / LS tool run task keys             │  │
│  └─────────────────────┴──────────────────────────┴───────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

## 3. Classified findings

> Tagging convention: **L**ifetime (E=ephemeral, S=session, P=persistent) · **Store** (mem, LS, electron-store, sqlite, IPC-only) · **Source** (where the value is first written) · **Consumers** (who reads/writes).

### 3.1 Backend readiness — duplicated pollers

| State | L | Store | Source | Consumers |
|-------|---|-------|--------|-----------|
| `BackendStatus` (Ctxt) | S | mem | `BackendStatusProvider` (5s interval → `backend:status()`) | `BackendDownBanner`, `_desktop-dashboard`, `DesktopOnboarding`, `RightPanel`, `SimpleChat` |
| `polledBackendStatus` (hook) | S | mem | `useBackendStatus` hook (10s) | `project-workspace.tsx` (line 169-176) — **redundant with Context** |
| `backendStatus` (local React state) | S | mem | `setBackendStatus(polledBackendStatus)` effect | `project-workspace.backendSummary` |
| `processes[]` from `terminal:snapshot` | S | mem | IPC invoke (5s) | `TerminalPanel` |

### 3.2 Conversations — three independent caches

| State | L | Store | Source | Consumers |
|-------|---|-------|--------|-----------|
| `conversations` in `project-workspace` | S | mem | `listConversations('active', projectId)` on mount | left sidebar, search panel |
| `projectConversations` map (other projects) | S | mem | lazy on expand | sidebar query |
| `searchConversationIndex` | S | mem | `Promise.all` on search mode | workspace search |
| `conversations` in `SimpleChat` | S | mem | `listConversations(...)` + on stream `onDone` | chat header dropdown |
| `conversations` + `activeConvId` in `CopilotChat` | S + P (LS) | mem + LS `biof3_copilot_active_conv` / `...:${projectId}` | fetch + LS restore | `CopilotChat` panel |

### 3.3 Active conversation id — two storage keys, three holders

`biof3_copilot_active_conv` (legacy / global) and `biof3_copilot_active_conv:${projectId}` (per-project).
The per-project key is set in `CopilotChat.tsx:593-594` (`copilotChat` knows its current `ctx.projectId`).

### 3.4 Copilot page context — singleton + 8 writers + 0 readers

`copilotContext.ts` has `let current` (module scope) with `setCopilotContext` (8+ callers) and `subscribeCopilotContext` (no production subscriber). Every page calls `setCopilotContext({ ...patch })` from a `useEffect` and the new context is read inside SimpleChat's `streamChat` via `getCopilotContext()` once per send.

### 3.5 AI settings & model presets — two loaders, two handlers

| State | Owner | Notes |
|-------|-------|-------|
| `chatModelPresets`, `activeChatModelId` | `DesktopSettingsPanel.tsx` (`loadSettings`) | writes back via `aiSettings.save({...})` |
| `chatModelPresets`, `activeModelId` | `SimpleChat.tsx` (`loadModelSettings`) | only reads at mount, also writes on select |

### 3.6 Plugin list — two panels, two caches

`PluginStorePanel` (`DesktopToolbar`) holds `installed`/`remote`/`installProgress`. `ToolboxPanel` (in `project-workspace.tsx`) holds `installed`/`remotePlugins`/`installing`/`uninstalling`/`pluginError`/`pluginLoaded`. Both call the same `window.biof3Desktop.plugins.*` IPC.

### 3.7 Update progress — duplicated across panels

`_desktop-dashboard.tsx` holds `updOpen/updDownloading/updProgress/updDownloaded/updError/updInstalling`. `DesktopSettingsPanel` holds the same fields (`UpdateSection`). Both subscribe to `window.biof3Desktop.updater.on*` events.

### 3.8 Layout / resize state — duplicated and un-persisted

`project-workspace.tsx` re-implements the `useResizableColumns` hook inline (line 280-307 for left/right/input, line 357-376 for bottom terminal). The hook exists at `frontend/src/hooks/useResizableColumns.ts` but isn't called. The same module saves `summarySize` as bare `useState` (no persistence, no min/max guards, sets on every drag).

### 3.9 Project CRUD — two HTTP layers

`frontend/src/lib/project-store.ts` is the canonical one. `frontend/src/pages/single-cell/_store.ts` is a parallel copy (scoped by `SC_MODALITY = 'single-cell'`), still hit by `pages/single-cell/_store.ts` and `pages/single-cell/_ProjectView.tsx` etc. Desktop single-cell page still routes here. On the desktop branch only `HomePage` (which mounts `_desktop-dashboard`, not single-cell) is the front door; but pages remain reachable via `/single-cell/*` routes in `App.tsx`.

### 3.10 Auth — desktop branch is a stub; old branch still writes LS

`lib/authClient.ts` (`IS_DESKTOP = true`) returns a hardcoded `DESKTOP_USER` and `'desktop-local'` token. `pages/single-cell/_auth.ts` (legacy) still writes `biof3_token` to LS on `login()` and reads it in `getToken()`. Copilot client, plans client, conversations client, summary client, progress client, memories client, facts client, privacy client and `project-store.ts`'s `authHeaders()` all read `biof3_token` from LS first — desktop branch ignores it, but the LS writes keep happening if any page accidentally calls `login()`.

## 4. Leaks and risks (prioritized)

### 4.1 [HIGH] Three backend-status pollers for the same IPC

- Where: `useBackendStatus` (10s) + `BackendStatusProvider` (5s) + `project-workspace` poll (15s) + `TerminalPanel.snapshot` (5s, subset).
- Risk: Each renderer hook fires its own `backend:status` IPC; if `project-workspace` mounts, the hook's 10s interval runs concurrent to the App-level 5s interval. Each triggers a fresh server-side aggregate. Wasted CPU on render; flicker on state.
- Fix: Drop the `useBackendStatus` hook. All consumers should read from `BackendStatusProvider` Context. Remove the local `setBackendStatus(polledBackendStatus)` effect.

### 4.2 [HIGH] Copilot context singleton has no contract

- Where: `frontend/src/lib/copilotContext.ts` (`let current`), read directly via `getCopilotContext()` inside SimpleChat.
- Risk: A page unmounts → leaves a stale `current`. Next page sets a partial patch; context silently overwrites. No subscriber unsubscribes the data side. Any future eager consumer (e.g. "X heard you were on /spatial") reads stale `page`.
- Fix: Replace singleton with a React Context (`<CopilotContextProvider>`), scope to where SimpleChat is mounted (project-workspace only needs project context; CopilotChat feeds itself). Each page sets within its own effect; provider diffs and resets `page: 'unknown'` on unmount.

### 4.3 [HIGH] Three independent conversation caches

- Where: `SimpleChat`, `CopilotChat`, `project-workspace` (sidebar).
- Risk: User opens the same project in chat and in legacy Copilot — only the chat that writes wins the active id. Refresh / soft-reload: each panel issues its own `listConversations`. New conversation created from left panel doesn't reach SimpleChat until its next reload (5s).
- Fix: One source of truth — `useConversations(projectId)` hook (SWR-style with revalidate-on-focus). SimpleChat reads from hook; project-workspace sidebar reads from same hook; legacy CopilotChat page-key points at the same cache.

### 4.4 [HIGH] `useResizableColumns` exists but is bypassed by inline duplicate

- Where: `frontend/src/hooks/useResizableColumns.ts` vs `project-workspace.tsx` line 280-376.
- Risk: Future hooks changes won't reach project-workspace. `bottomTerminalHeight` and summary card lives on `useState` — lost on remount. No persistence.
- Fix: Replace inline state with the hook; add LS persistence in the hook (one-key-per-dimension with clamping), or split into `useLocalStorageState('biof3-pw-cols', {left:240,right:340,input:120,bottom:240})`.

### 4.5 [HIGH] AI model preset state duplicated

- Where: `SimpleChat.tsx:103-104`, `DesktopSettingsPanel.tsx:263-264`.
- Risk: User adds a preset in Settings → SimpleChat still has the stale list. Selecting a preset in SimpleChat (no save path) reverts the next time the user opens Settings.
- Fix: Hoist to context (or zustand) with single `loadModelSettings()` action. Both panels render from one source; both writes funnel through one save IPC.

### 4.6 [HIGH] Plugin store state duplicated

- Where: `PluginStorePanel.tsx` vs `ToolboxPanel` (`project-workspace.tsx` line 2010-2015).
- Risk: Install from one panel → other panel still shows "未安装" until its 5s timer expires (or never, if the plugin tab isn't open). `installProgress` map and `installing` strings drift.
- Fix: Single hook `usePluginStore()` with `load()`, `install()`, `uninstall()`, `installProgress`. Both panels consume; one toolbar's progress feeds both views.

### 4.7 [HIGH] Bare `window.biof3Desktop.*` everywhere

- Where: 20+ files in `frontend/src` make direct optional-chain calls.
- Risk: No contract; if preload drops a namespace (e.g. `figcode.cardStatus` rename), every call site silently returns undefined. No type-checking at the boundary except `electron.d.ts` types.
- Fix: Wrap each bridge in a typed accessor module (`frontend/src/lib/electron-bridge.ts`). Components import e.g. `getTerminalPlugin().startSession(path)`. Optional-chain lives in one place.

### 4.8 [MED] Active conversation id stored under two LS keys

- Where: `CopilotChat.tsx:113, 128, 559-594`.
- Risk: The legacy key is read first if `ctx.page !== 'desktop-project'`; for the project workspace the per-project key is read. Two reads, two writes — the global key can become stale and continue to drive the "wrong project" state.
- Fix: One canonical key (e.g. always `biof3_copilot_active_conv:${ctx.projectId ?? 'global'}`). Migrate read path; delete the unprefixed key.

### 4.9 [MED] Update flow state duplicated

- Where: `_desktop-dashboard.tsx:127-131`, `DesktopSettingsPanel.tsx UpdateSection`.
- Risk: Dashboard starts download (`updDownloading=true`); user opens Settings — Settings gets `updateInfo` from its own poll at `useEffect` line 73/92 of `DesktopSettingsPanel.tsx`, may overwrite mid-flight.
- Fix: One hook `useAutoUpdate()` that exposes `{availableVersion, downloading, ratio, downloaded, error, install}`. Both panels render.

### 4.10 [MED] Project data layer duplication

- Where: `frontend/src/lib/project-store.ts` (used by project-workspace and dashboard) vs `frontend/src/pages/single-cell/_store.ts` (still used inside `single-cell/*` and `spatial/*` page modules).
- Risk: Two sets of mappers, two retry loops, two auth header resolvers. Desktop branch doesn't actually need the single-cell module — but the route is still mounted in `App.tsx`.
- Fix: Route `/single-cell/*` and `/spatial/*` should redirect to `/` (or mount `_desktop-dashboard`) since `ToolsPage`, `FigCodePage`, `AlgorithmsPage`, `SkillsPage` are the SPA's primary entry points. Then delete `single-cell/_store.ts` and its callers — replaces the legacy HTTP layer with `lib/project-store.ts`.

### 4.11 [MED] Terminal snapshot polled twice

- Where: `TerminalPanel` (5s `terminal:snapshot`) + `BackendStatusProvider.backend:status` (5s `backend:status`). Both read overlapping info.
- Fix: `TerminalPanel` reads `backendStatus` from Context (subset it cares about) and refreshes log tails only on demand (manual refresh button).

### 4.12 [MED] Soft-refresh event has a single consumer, but the fetch loop is duplicated inside

- Where: `project-workspace.tsx` line 698-714: `fetchData` interval (15s) + `biof3:soft-refresh` handler re-running `fetchData`, `refreshConversations`, and `listProjects`.
- Risk: Cmd+R does nothing useful if it lands between poll cycles — handler immediately re-fetches. Wasted CPU on every soft-refresh.
- Fix: One subscribe point (the workspace page); remove the 15s setInterval (poll on focus / on soft-refresh only).

### 4.13 [MED] `biof3_agent_task_*` recovery sweeps LS by string prefix

- Where: `frontend/src/components/copilot/copilotClient.ts:191-210`.
- Risk: The sweep removes entries without telling the user. If two panels both invoke the sweep on mount, the earlier one could be dropping the other's task.
- Fix: Scope the sweep to the current conversation id; or split into a hook that polls the agent task queue explicitly.

### 4.14 [MED] `biof3_token` / `biof3_user` LS writes still occur

- Where: `pages/single-cell/_AdminPanel.tsx` line 767-773, 1971-1972; `pages/single-cell/_auth.ts` `login` / `setStoredUser`.
- Risk: On the desktop branch these writes are dead — every page still reads them first.
- Fix: Same as 4.10 — remove the dead path. Make `authClient.ts` the only auth implementation; have it ignore / actively no-op writes.

### 4.15 [LOW] `globalThis._biof3ContentUpdated` callback

- Where: `content-sync.js:163-167`.
- Risk: r-server might define `_biof3ContentUpdated` once at startup, then `content-sync` re-runs every 4h; if r-server removes or replaces the function ref, content-sync silently no-ops.
- Fix: Use IPC → renderer → renderer (broadcast back to main) instead of a global-this bridge, or document the invariant.

### 4.16 [LOW] `_updateInfo` in `setupAutoUpdateIpc` is unbounded

- Where: `src/main.js:1142-1146`.
- Risk: Holds the last seen update info for the lifetime of the process. Minor — main.js is session-scoped.
- Fix: None urgent.

### 4.17 [LOW] `biof3-backup-prompted` write on every mount

- Where: `_desktop-dashboard.tsx` `useEffect` line 204-215.
- Risk: In StrictMode the effect runs twice on dev mount; first run writes the flag, second run sees the flag and treats banner as dismissed — first-render flicker.
- Fix: Read-then-write in same effect; or single write inside an `if (typeof localStorage !== 'undefined')`.

### 4.18 [LOW] Magic-event bus

- Where: `biof3:soft-refresh`, `biof3:onboarding-done`, `biof3:project-open-result`, `biof3:copilot-ask` — typed only by string.
- Risk: A typo in a producer / consumer silently fails; no TypeScript.
- Fix: Centralize event names + payload types in one `frontend/src/lib/events.ts`.

### 4.19 [LOW] Theme write happens in two places

- Where: `App.tsx` reads `biof3-theme` and writes `data-theme`; `DesktopToolbar.toggleTheme` does both.
- Risk: Both `setColorMode` (in DesktopToolbar) and `App.tsx` effect can run → second one wins; mismatch between React state and DOM attr if either direction isn't synchronised.
- Fix: One source — keep theme state in `App.tsx`; pass toggle handler to `DesktopToolbar` as a prop.

### 4.20 [LOW] File-tree expanded dirs are not persisted

- Where: `RightFileTree.expandedDirs` (project-workspace.tsx).
- Risk: Modest UX — losing which folder the user had open is annoying.
- Fix: Persist per-project in LS.

## 5. Proposed canonical location per state class

### 5.1 Backend readiness (single owner)

```
BackendStatusProvider (App.tsx root)
  └─ useBackendStatus() → React Context value (existing)
                ↓
   polled by one setInterval(5s) in Provider
                ↓
   any consumer reads ctx; no local copies anywhere
```

- **Remove `hooks/useBackendStatus.ts`**'s polling; keep the file but have it just `useContext(useBackendStatusSymbol)`.
- `project-workspace.tsx` line 169-176: delete local `backendStatus` state and the re-syncing effect.
- `TerminalPanel`: stop the 5s `terminal:snapshot` poll; rely on `backendStatus` for summary cards; keep manual "刷新" button for log tails only.

### 5.2 Copilot page context (move to React Context)

```
<CopilotContextProvider> wrapped around routes that need it
  • useCopilotContext() hook returns { page, pageTitle, ..., projectId, activeJobId, ... }
  • useSetCopilotContext(patch) hook applies patch on mount, clears on unmount
  • pages stop using module-scope setCopilotContext directly
```

- Keep the shared type in `@biof3/shared/context` (already re-exported by `frontend/src/components/copilot/copilotContext.ts`).
- Remove the singleton `let current` + listener set.
- SimpleChat continues to read via `getCopilotContext()` but now backed by Context via a thin shim.

### 5.3 Conversation cache (single hook)

```
useConversations(projectId)
  → { conversations, activeConvId, refresh, create, switch, delete, loading, error }
  → internal: SWR-style or useState + manual refresh trigger
  → mutation APIs also publish 'biof3:conversations-changed' event so other panels revalidate
```

- All three consumers (`SimpleChat`, `CopilotChat`, `project-workspace` sidebar) call `useConversations(project.id)`.
- `CopilotChat` reads activeConvId from LS only as bootstrap; thereafter from the hook.

### 5.4 AI model presets (single source)

```
useAiSettings()    → exposes {chatPresets, activeChatId, embedProvider, telemetryEnabled, ...}
                    reads/writes via window.biof3Desktop.aiSettings.{get,save,test}
```

- `SimpleChat` and `DesktopSettingsPanel` both call this hook.
- Save handler is one (`updateChatPresets(presets, activeId)`).

### 5.5 Plugin store (single hook)

```
usePluginStore()  → { installed, remote, installProgress, install, uninstall, update, checkUpdates }
```

- `PluginStorePanel` and `ToolboxPanel` both call it. Both render sections from the same data.

### 5.6 Update flow (single hook)

```
useAutoUpdate()   → { availableVersion, progress, downloaded, error, installing,
                     available, check, download, install, dismiss }
```

- `_desktop-dashboard` and `DesktopSettingsPanel.UpdateSection` both call it.

### 5.7 Resizable layout (single hook + persistence)

```
useResizableColumns('biof3-pw-cols', { left:240, right:340, input:120, bottomTerminal:240 })
  → adds LS-backed persistence to the existing hook
```

- `project-workspace.tsx` line 280-376 deleted in favour of `useResizableColumns(...)`. The summary card stays inline because it's a float.

### 5.8 Project CRUD (single layer)

- `lib/project-store.ts` is the only HTTP layer.
- `pages/single-cell/_store.ts` deleted once the legacy routes are removed (or kept as legacy-only adapter if `/single-cell` page still ships).

### 5.9 Auth (single layer)

- `lib/authClient.ts` for desktop branch is the sole auth API.
- `pages/single-cell/_auth.ts` deleted; its callers rewrite to import from `@/lib/authClient`.

### 5.10 Custom-event bus (typed)

```
frontend/src/lib/events.ts
  export const biof3Events = {
    softRefresh: 'biof3:soft-refresh',
    onboardingDone: 'biof3:onboarding-done',
    projectOpenResult: 'biof3:project-open-result',
    copilotAsk: 'biof3:copilot-ask',
    conversationsChanged: 'biof3:conversations-changed',
    ...
  } as const;
  export function dispatch<E>(key, detail?) / subscribe<E>(key, cb) → unsubscribe
```

- Producers and consumers import the typed shim; payloads are typed via generic `DetailMap`.

### 5.11 Terminal snapshot (split)

- `BackendStatusProvider` owns `{rRuntime, pyRuntime, rServerUp, pyServerUp, plumberUp, isReady, downReason}`.
- A separate `useTerminalLogTail(logKey)` hook reads `terminal:snapshot` on demand (manual refresh + on first mount).

### 5.12 Plugin install progress (per-plugin)

- Lifted to `usePluginStore` (see 5.5). One `installProgress: Record<pluginId, {ratio, received, total}>` map, single source, both panels read.

## 6. State map (consolidated)

```
┌────────────── ELECTRON MAIN ──────────────┐
│  SQLite (biof3.db) ← r-server owns schema  │
│  JSON files in {dataDir}/:                 │
│    • installed.json      ← plugin-manager  │
│    • ai-settings.json    ← IPC ai-settings │
│    • logs/*.log          ← main + children │
│  process env (BIOF3_R_HOME / PY_HOME /     │
│                BIOF3_LOCAL_DATA_DIR / …)   │
│  session memory: procs, timers, windows    │
│  globalThis._biof3Plugins (Map) — r-server │
│  globalThis._biof3ContentPlugins — docs    │
└──────────────┬────────────────────────────┘
               │ ipcMain.handle / webContents.send
┌──────────────▼──────────── PRELOAD ────────┐
│  window.biof3Desktop ← forwarded IPC API   │
│  window.process.env ← env shim            │
│  biof3:* ← re-dispatched main events      │
└──────────────┬────────────────────────────┘
               │ window.biof3Desktop / window.biof3:*
┌──────────────▼──────────── RENDERER ───────┐
│                                             │
│  ┌── App-level providers (one each) ──────┐ │
│  │  BackendStatusProvider (5s poll)        │ │
│  │  CopilotContextProvider (Context-only)  │ │
│  │  ThemeProvider (data-theme + LS)        │ │
│  └────────────────────────────────────────┘ │
│            ↓                                │
│  ┌── shared hooks (one per concern) ───────┐ │
│  │  useConversations(projectId)            │ │
│  │  useAiSettings()                         │ │
│  │  usePluginStore()                        │ │
│  │  useAutoUpdate()                         │ │
│  │  useResizableColumns(key, initial)       │ │
│  │  useTerminalLogTail(key)                 │ │
│  └────────────────────────────────────────┘ │
│            ↓                                │
│  ┌── typed event bus (frontend/src/lib/     │
│  │   events.ts) — replaces magic strings    │
│  └────────────────────────────────────────┘ │
│            ↓                                │
│  ┌── component-local state (UI only) ──────┐ │
│  │  panel expansion / hover / drag ref /   │ │
│  │  modal open / form draft / focused tab   │ │
│  └────────────────────────────────────────┘ │
└─────────────────────────────────────────────┘
```

## 7. Recommended consolidation order

Migrations ordered by **dependency** (top can ship first, lower ones benefit from earlier cleanup):

1. **Typed event bus** (`lib/events.ts`) — replace 4 magic strings. *De-risk: 1-day, no behaviour change.*
2. **Dedupe `BackendStatusProvider`** — delete `useBackendStatus` polling, fold local `backendStatus` state in `project-workspace.tsx`. *De-risk: 1 day, surface-level change with green tests.*
3. **Persist `useResizableColumns` and adopt it in `project-workspace.tsx`** — drop the inline duplicate, save the 240 lines. *De-risk: 1-2 days, behaviour-preserving.*
4. **`useConversations(projectId)`** — co-locate with `BackendStatusProvider` (both are app-root concerns). Migrate `SimpleChat` first (it's the highest-traffic surface), then `CopilotChat`, then project-workspace. *De-risk: 2-3 days.*
5. **`useAiSettings()`** — migrate `SimpleChat` (read), then `DesktopSettingsPanel` (read+write). *De-risk: 1 day.*
6. **`usePluginStore()`** — extract to `frontend/src/hooks/usePluginStore.ts`. Migrate `PluginStorePanel` first (more comprehensive), then `ToolboxPanel`. *De-risk: 1-2 days.*
7. **`useAutoUpdate()`** — fold `_desktop-dashboard` and `DesktopSettingsPanel.UpdateSection`. *De-risk: 1 day.*
8. **`CopilotContextProvider`** — replace module singleton with Context; type the patch payload. Each page still calls its own setter, but inside a `useEffect` that clears on unmount. *De-risk: 2 days.*
9. **Custom bridge accessor (`lib/electron-bridge.ts`)** — wrap `window.biof3Desktop.*` with typed modules (terminal, plugins, ai, files, data, updater, figcode, runtime, backend, contentPlugins, telemetry). Migrate consumer files file-by-file. *De-risk: 3-4 days but mechanical.*
10. **Remove legacy single-cell/spatial routes from App.tsx** (or redirect to dashboard), then delete `pages/single-cell/_store.ts`, `pages/single-cell/_auth.ts`, `pages/spatial/_*`. *De-risk: 1-2 days plus content preservation review.*
11. **Tail: `biof3-backup-prompted` strict-mode guard, `biof3_agent_task_*` scoping, magic-event typing, theme unification, file-tree persistence.** *De-risk: 1-2 days cumulative.*

Total estimate: **~3 weeks of work**. Steps 1–3 together form a tight **PR-1** that already removes ~250 lines of duplicate state and stops a render flicker. Steps 4–6 form **PR-2** (state centralization). Step 8 is **PR-3** (lifecycle correctness). Step 9 is **PR-4** (typing + boundary). Step 10 is **PR-5** (legacy removal).

## 8. Where to keep this

This document lives at `docs/state-decomposition.md`. The accompanying implementation plan is the ordered PR list in §7.
