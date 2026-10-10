# BLOCK-2-UI-157-REVIEW · PHASE 0 — Agent C: Build/Test Environment & Skills-Test Surface

> **Subagent**: Agent C · **Date**: 2026-08-16 · **Mode**: READ-ONLY + targeted static gates
> **Goal**: Catalog the build/test surface so PHASE 1 knows exactly what is runnable and what
> is not, before any code change touches `useSkillStore` or the Skills page.
>
> **Scope**: build scripts, TS strict config, Vitest setup, Skills test inventory, three
> targeted governance gates, dev:electron readiness, PHASE 3 real-machine evidence plan.

---

## §1 Build & Run Scripts Inventory

### Root `package.json` (selected, group by purpose)

| Script | 1-line description |
|---|---|
| `start` | `electron .` — production launch from packaged/built frontend. |
| `dev` | `node scripts/dev-electron.js` — Vite + Electron launcher (HMR + dev-tools). |
| `dev:electron` | `electron . --dev` — direct Electron launch (loads built `frontend/dist/`). |
| `mcp:server` | Runs `src/mcp-server.js` as standalone CLI (`petri-mcp` bin). |
| `prebuild` | `node --check` syntax-check on `main.js`, `preload.js`, `plugin-manager.js`, `core/r-server/plugin-loader.js`. |
| `build:spa` | `cd frontend && npm run build` — Vite SPA build. |
| `build:site` | No-op placeholder (Docusaurus site removed in desktop repo). |
| `build:all` | `build:spa` + `build:site`. |
| `build:win` / `build:mac` / `build:mac-arm64` / `build:mac-x64` | `prebuild` + `build:all` + `electron-builder` per target. |
| `test` / `test:changed` | `node scripts/test-affected.mjs --run` — Node-side affected-test runner. |
| `test:changed:list` | Same script in `--json` mode (preview scope). |
| `test:all` | `node --test test/*.test.{mjs,cjs}` — full Node test suite. |
| `test:all:frontend` | `npm --prefix frontend run test:all` (Vitest run, no --changed). |
| `test:all:workspace` | `test:all` + `test:all:frontend`. |
| `validate:runtime-first-use` | `electron scripts/validate-runtime-first-use.cjs` — runtime E2E sanity. |
| `harness:*` | Large family of harness/plug-in/scientific-task/lifecycle/loop gates (~50 scripts). |
| `g0:result-studio:*` | Result Studio P0–P7/UX1H gates (~120 scripts) — out of UI-157 scope. |
| `g0:sdc0`, `g0:sdc1`, `g0:lf0`, `g0:first-wave` … `g0:fifth-wave`, `g0:qualification:*` | Cross-cutting G0 gates. |
| `docs:status` | Print registered-doc status (no side effects). |
| `docs:check` | Governance check — gates docs vs `DOC-REGISTRY.json`. |
| `docs:reconcile` | Reconcile drift; required before announcing `completed/qualified`. |
| `ui:audit:check` | Gate: every UI commit must keep `ui-productization-audit.md` in sync. |
| `g0:start:check`, `g0:start:*`, `g0:model-anthropic-native:check` | G0 baselines. |
| `check` | Monster one-shot: `node --check` everything + every gate above. **Default OFF — leave for release/CI.** |
| `postcheck` | `g0:qualification && g0:sdc0` — gate combo. |
| `release:*` | macOS OSS publish (G1+ scope — not currently active per G0 stage discipline). |

### Touch matrix (UI-157 PHASE 1 surface)

| Concern | Root script | Notes |
|---|---|---|
| Dev Electron (renderer HMR) | `npm run dev` | Wrapper `scripts/dev-electron.js` — Vite on 3000 + Electron via `open -a`. |
| Dev Electron (packaged dist) | `npm run dev:electron` | Requires `frontend/dist/` already built (`build:spa` first). |
| Frontend Vite dev server only | `cd frontend && npm run dev` | Vite on port 3000. |
| Frontend type-check | `cd frontend && npm run check` | `tsc --noEmit`. |
| Frontend strict build | `cd frontend && npm run build:check` | `tsc -b && vite build` + dist cleanup. |
| Frontend unit tests | `cd frontend && npm test` (vitest run --changed) | Default `--changed`; explicit `npm run test:files -- <files>` for PHASE 1. |
| Frontend full tests | `cd frontend && npm run test:all` | Default OFF — release/CI only. |
| Documentation gate | `npm run docs:check` | **Mandatory in PHASE 1 before closeout.** |
| UI audit gate | `npm run ui:audit:check` | **Mandatory per commit / before declaring `verified`.** |
| Docs reconcile | `npm run docs:reconcile` | Required before closeout. |

### Default Vite dev-server port

**`3000`** (`frontend/vite.config.ts` line 191; `strictPort: true` — exits if busy).

`scripts/dev-electron.js` line 20: default `PETRI_RENDERER_DEV_URL` is `http://localhost:3000` and `waitForUrl()` polls until the server is up before launching Electron. Re-running `npm run dev` while 3000 is already serving a port-conflict error (§1 L202-207).

---

## §2 TypeScript / TS Strict Configuration

### `frontend/tsconfig.json`

```jsonc
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": false,
    "noUnusedParameters": false,
    "noFallthroughCasesInSwitch": true,
    "baseUrl": ".",
    "paths": {
      "@/*":              ["./src/*"],
      "@site/src/*":      ["./src/*"],
      "@docusaurus/useBaseUrl": ["./src/lib/useBaseUrl-mock.ts"],
      "@petri/shared":            ["../core/packages/shared-copilot/index.ts"],
      "@petri/shared/types":       ["../core/packages/shared-copilot/types.ts"],
      "@petri/shared/context":     ["../core/packages/shared-copilot/context.ts"],
      "@petri/shared/trace":       ["../core/packages/shared-copilot/trace.ts"],
      "@petri/shared/helpers":     ["../core/packages/shared-copilot/helpers.ts"],
      "@petri/shared/actions":     ["../core/packages/shared-copilot/actions.ts"],
      "@petri/shared/actionBus":   ["../core/packages/shared-copilot/actionBus.ts"],
      "@petri/shared/error":       ["../core/packages/shared-copilot/error.ts"],
      "@petri/shared/api-inject":  ["../core/packages/shared-copilot/api-inject.ts"],
      "@petri/shared/copilotMarkdown": ["../core/packages/shared-copilot/copilotMarkdown.tsx"],
      "@petri/shared/ActResultCard":    ["../core/packages/shared-copilot/ActResultCard.tsx"],
      "@petri/shared/ActionCard":       ["../core/packages/shared-copilot/ActionCard.tsx"]
    }
  },
  "include": ["src"]
}
```

**Key facts for PHASE 1**:
- `strict: true` — every new field added to `useSkillStore` Skill types must satisfy strictNullChecks/strictFunctionTypes/etc.
- `noUnusedLocals/Parameters: false` — leftover dead code will NOT trip the gate (manual hygiene needed).
- `noFallthroughCasesInSwitch: true` — relevant if a new switch on `source`/`status` is added without breaks.
- `skipLibCheck: true` — TS will not flag missing exports in third-party .d.ts.
- Paths: `@/*` → `frontend/src/*` (used by `useSkillStore` for `getBridge`). Anything new must use `@/` not `../`.
- `vitest.config.ts` only defines `@` alias; **if PHASE 1 adds a new path alias, both files need updating**.

### `frontend/src/lib/electron.d.ts` — preload typings

- 319 lines, full global `Window.petriDesktop` augmentation.
- Already declares the **`skills` sub-bridge** (lines 114–169) with `discover / execute / getExecution` typed against the same shape `useSkillStore.ts` consumes. **No new types are needed in `electron.d.ts` for PHASE 1**.
- Already declares `computeSettings`, `aiSettings`, `plugins`, `contentPlugins`, `runtime`, `backend`, `py`, `plumber`, `files`, `diagnostic`, `telemetry`, `data`, `terminal`, `updater`, `harnessCapabilities`, `window`, `app` — Skills reuses the same well-typed path.
- Window env augmentation includes `process.env.PETRI_DESKTOP` / `NODE_ENV` (line 304-307).
- `petri.agentWorkbenchFlags` augmentation at line 309–315 — only consumer is `getExtraRenderers/set/onChange`.

---

## §3 Test Runner Setup

### Vitest config (`frontend/vitest.config.ts`)

```ts
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  test: {
    environment: 'happy-dom',
    globals: false,
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: [],
  },
});
```

**Key facts**:
- `globals: false` — every test must `import { describe, it, expect, vi, beforeEach, … }` from `'vitest'` (confirmed in all 74 test files).
- `environment: 'happy-dom'` — DOM is mocked; `window` and `document` exist; Node features (net, fs) do NOT.
- `include: src/**/*.test.{ts,tsx}` — only this pattern is picked up. Co-located tests only.
- `setupFiles: []` — no global setup. Each test sets its own `window.petriDesktop` install/uninstall.
- `@` alias is the only one defined for tests. (The `tsconfig.json` aliases for `@petri/shared/*` are NOT mirrored in vitest config — tests can't import from the shared package directly. This is why `usePluginStore.test.ts` uses the bare `@/hooks/usePluginStore` import.)

### Existing test files in `frontend/src/pages/skills/`

**None.** `frontend/src/pages/skills/` contains 5 source files only (`index.tsx`, `SkillCard.tsx`, `SkillDetail.tsx`, `SkillSearch.tsx`, `skill.types.ts`, `styles.module.css`). No co-located `*.test.{ts,tsx}` exists. PHASE 1 will need to add the first set.

### Existing test files in `frontend/src/hooks/` relevant to PHASE 1

| Path | Lines | Tests |
|---|---|---|
| `frontend/src/hooks/usePluginStore.test.ts` | 195 | 9 tests — discover/install/uninstall/checkUpdates, 5-min cache dedup, multi-subscriber sync, autoLoad=false. |
| `frontend/src/hooks/useSkillStore.test.*` | **MISSING** | **No file exists.** This is the critical gap that PHASE 1 (or its test-only prep) must close. |
| `frontend/src/hooks/useAiSettings.test.ts` | — | Bridge IPC for aiSettings (precedent). |
| `frontend/src/hooks/useWorkspaceRouting.test.ts` | — | Frontend-only router state. |
| `frontend/src/hooks/useConversationJobs.test.ts` | — | Hook pattern with bridge. |
| `frontend/src/hooks/useDurableConversationLoop.test.ts` | — | Polling + persistence pattern. |
| `frontend/src/hooks/useHarnessWorkflowStatus.test.ts` | — | Bridge-driven polling (closest precedent to skill-status polling). |
| `frontend/src/hooks/useTerminalSession.test.ts` | — | Bridge with high-frequency events (precedent for `terminal.onData`). |
| `frontend/src/hooks/useAutoUpdate.test.ts` | — | Callback subscription + cleanup pattern. |
| `frontend/src/hooks/useResizableColumns.test.ts` | — | Pure UI hook (no bridge). |

### Existing tests that touch `desktopBridge` / IPC

| Path | Bridge used | Pattern |
|---|---|---|
| `frontend/src/lib/desktopBridge.test.ts` | n/a | Tests the accessor itself — installs/uninstalls `window.petriDesktop` directly; does NOT use `vi.mock`. |
| `frontend/src/hooks/usePluginStore.test.ts` | `plugins` | Direct `window.petriDesktop` install via `installBridge()` helper. **This is the canonical pattern** PHASE 1 must mirror. |
| `frontend/src/hooks/useAiSettings.test.ts` | `aiSettings` | Same pattern. |
| `frontend/src/hooks/useTerminalSession.test.ts` | `terminal` | Same pattern, exercises event callbacks. |
| `frontend/src/hooks/useConversationJobs.test.ts` | mixed | Same pattern. |
| `frontend/src/lib/copilotContextProvider.test.tsx` | mixed | Direct `window` stub. |

**No `vi.mock('@/lib/desktopBridge')` exists anywhere in the codebase.** Search returned 0 matches. The convention is to install a fake `window.petriDesktop` sub-handle and let `getBridge()` resolve through the real accessor — this exercises the type contract from `electron.d.ts` end-to-end. PHASE 1 should adopt the same pattern (do NOT introduce `vi.mock` — it would diverge from the rest of the codebase and break the type-guard test in `desktopBridge.test.ts`).

### Canonical install-bridge helper (precedent for new Skill tests)

```ts
function installBridge(overrides: Partial<BridgeHandles> = {}): BridgeHandles {
  // ...builds vi.fn() mocks...
  (window as unknown as { petriDesktop: unknown }).petriDesktop = {
    plugins: { listInstalled, listRemote, install, uninstall, checkUpdates },
    runtime,
  };
  return { /* handles for assertions */ };
}
function uninstallBridge() {
  delete (window as unknown as { petriDesktop?: unknown }).petriDesktop;
}
beforeEach(() => { __resetPluginStoreCacheForTests(); uninstallBridge(); });
```

`useSkillStore.ts` already exports `__resetSkillStoreCacheForTests()` (line 580), so the test-side reset is in place.

---

## §4 Targeted Gate Verification (PHASE 0 run results)

All four commands executed at the desktop repo root, 30 s budget each. **All passed.**

| Gate | Command | Exit | Last 20 lines (trimmed) |
|---|---|---|---|
| Frontend TS | `npx tsc --noEmit -p frontend/tsconfig.json` | **0** | `(empty — clean)` |
| UI audit | `npm run ui:audit:check` | **0** | `[ui-audit] 同步检查通过；Git 历史已有 131 个带实现证据的 UI 问题编号` |
| Docs check | `npm run docs:check` | **0** | `[docs:check] PASS (65 registered documents)` |
| Docs reconcile | `npm run docs:reconcile` | **0** | `Unregistered: 0` / `Archive candidates: 0` / `Retained completed references: 15` / `Manual review: 0` / `Validation issues: 0` |

**Interpretation**: PHASE 0 baseline is GREEN. Any PHASE 1 commit that introduces a new doc / UI编号 **must** re-run all three governance gates (`docs:check`, `docs:reconcile`, `ui:audit:check`) and `tsc --noEmit -p frontend/tsconfig.json` to stay green. The exact same four commands form the minimum CI surface for PHASE 1 — together they are sub-15 seconds total and acceptable on every commit.

Full output archived in the per-command exit codes above.

---

## §5 Skills-Specific Tests Catalog

### Existing Skills-related tests (frontend)

**NONE.** Verified with three searches:
- `frontend/src/**/*.test.{ts,tsx}` includes `usePluginStore.test.ts`, `useAiSettings.test.ts`, `useHarnessWorkflowStatus.test.ts`, `useTerminalSession.test.ts`, `useConversationJobs.test.ts`, `useDurableConversationLoop.test.ts`, `useWorkspaceRouting.test.ts`, `useResizableColumns.test.ts`, `useAutoUpdate.test.ts` — **but no `useSkillStore.test.*`**.
- `Grep -i "skill"` across `frontend/src/**/*.test.*`: **0 matches**.
- `Grep "useSkillStore|SkillCard|SkillDetail|SkillSearch"` across `frontend/src/**/*.test.*`: **0 matches**.

### Skills-related tests (Node side)

- `Grep -i "skill"` across `test/`: **0 matches**. The existing `test/*workflow*.test.mjs` files (`result-workflow-graph.test.mjs`, `agent-workflow.test.mjs`, `harness-workflow-state.test.mjs`, `harness-workflow-recovery.test.mjs`, `harness-workflow-fixtures.test.mjs`, `agent-workflow-phase6.test.mjs`) are unrelated to UI-157 Skills — they target Result Studio / harness state machines.
- `core/shared-backend/workflow-engine.js` (the backend module the work package mentions) has **no test file** under `test/`. Search: 0 matches.

### Net test inventory delta required by PHASE 1

| New test file (proposed) | Reason |
|---|---|
| `frontend/src/hooks/useSkillStore.test.ts` | Cover `discover`, `execute`, `getExecution`, optimistic execution, polling teardown, cache TTL, multi-subscriber sync, `autoLoad=false`. Mirror `usePluginStore.test.ts` pattern. |
| `frontend/src/pages/skills/SkillSearch.test.tsx` | Filter/search/clear controls. |
| `frontend/src/pages/skills/SkillCard.test.tsx` | Click → `onSelect`; disabled state. |
| `frontend/src/pages/skills/SkillDetail.test.tsx` | Render parameters, render outputs, "Execute" button. |
| `frontend/src/pages/skills/index.test.tsx` | Page-level: empty/error/loading/populated states. |
| `test/workflow-engine.test.mjs` (optional, Node side) | Covers the new `core/shared-backend/workflow-engine.js` module. |

None of these files exist yet — PHASE 1 starts with a green test surface for Skills.

---

## §6 `dev:electron` Readiness Check

### Root script (line 16)

```jsonc
"dev:electron": "electron . --dev",
```

Direct Electron launch **without** the `dev-electron.js` wrapper. **Pre-condition**: `frontend/dist/` must already exist (i.e. `npm run build:spa` first). The Electron `main.js` will load `http://localhost:3000` only when `PETRI_RENDERER_DEV_URL` is set; otherwise it loads the bundled `frontend/dist/index.html`.

### Wrapper script (line 15) — `npm run dev` (recommended)

`scripts/dev-electron.js` orchestrates:
1. Polls `http://localhost:3000` — fails fast if already serving (`urlIsAvailable()` line 161-173, aborts with "Close the previous Petri dev process" at L202-207).
2. Spawns `npm --prefix frontend run dev` (Vite) in a child process.
3. Waits for 3000 to be live (`waitForUrl()` line 175-196, default 30 s).
4. On macOS: invokes `/usr/bin/open -n -a <Electron.app>` with env vars (`ELECTRON_IS_DEV=1`, `NODE_ENV=development`, `PETRI_RENDERER_DEV_URL=http://localhost:3000`, `PETRI_ELECTRON_USER_DATA_DIR=.petri-dev-user-data`, `PETRI_LOCAL_DATA_DIR=…`) — this keeps the dev session out of the user's production Electron user-data and writes `petri-electron-main.log` / `*.error` to `$TMPDIR`.
5. On non-darwin: spawns `npx electron . --dev` directly.

### Extra Electron CLI args (the UI-126 hook)

`scripts/dev-electron.js` lines 215-218 and 258:

```js
const extraElectronArgs = (process.env.PETRI_DEV_ELECTRON_ARGS || '')
  .split(' ').map((s) => s.trim()).filter(Boolean);
// ...
openArgs.push('--args', projectRoot, '--dev', ...extraElectronArgs);
```

So the documented invocation to expose the Chrome DevTools Protocol for Playwright is:

```bash
PETRI_DEV_ELECTRON_ARGS="--remote-debugging-port=9222" npm run dev
```

This is what the work package (UI-126 evidence) refers to. The wrapper **passes through any extra flag**, including `--remote-debugging-port=9222` for CDP/Playwright. There is NO flag baked into the wrapper itself; the env var is the only knob.

### `predev` / `prebuild` impact

- **No `predev` hook** on either `dev` or `dev:electron` — they are raw launches.
- `prebuild` only runs `node --check` on `main.js`, `preload.js`, `plugin-manager.js`, `core/r-server/plugin-loader.js`. It does NOT type-check `core/shared-backend/workflow-engine.js`. If PHASE 1 ships a new `workflow-engine.js` change, **run `node --check core/shared-backend/workflow-engine.js` manually** before announcing build readiness, and add it to the `g0:result-studio:syntax` script if the change is shipping through Result Studio.
- `postinstall` runs `scripts/install-core-deps.mjs` which rebuilds `better-sqlite3` against the **system** Node ABI in dev mode (and against Electron ABI 123 at pack time via `build/afterPack.js`). This means **a fresh `npm install` may need to recompile native modules** before `npm run dev` succeeds. If dev:electron can't find better-sqlite3, run `npm rebuild better-sqlite3` (see also `node-pty` line 226 in `package.json`).

### `src/main.js` ↔ `core/shared-backend/workflow-engine.js` interaction

**Critical finding** — search of `src/main.js` for `workflow-engine|skills-sdk|skills:` returned **0 matches**. The Skills bridge has not yet been wired into Electron's main process:

- `src/main.js` does NOT `require()` `core/shared-backend/workflow-engine.js` or `core/shared-backend/skills-sdk.js`.
- `src/preload.js` (246 lines) does NOT expose a `skills` namespace on `window.petriDesktop` (search returned 0 matches for `skills`).

**Consequence**: as of PHASE 0, even a perfectly running dev Electron will hand `useSkillStore.ts` `getBridge('skills') === null` because `window.petriDesktop.skills` doesn't exist. The Skills page will render the existing **empty/bridge-unavailable** state (per the error handler at `useSkillStore.ts` L362-367). PHASE 1 must address this — either:
1. **Scope clarification**: UI-157 only changes frontend code (no preload/main changes), in which case PHASE 3 cannot demonstrate real Skill IPC traffic and must rely on **fixture-style bridge install + Playwright driving the dev URL** (Vite SPA without Electron).
2. **Scope expansion**: PHASE 1 also wires `preload.js` + `main.js` Skills handlers, in which case a real Electron run is needed and `PETRI_DEV_ELECTRON_ARGS="--remote-debugging-port=9222" npm run dev` is the way in.

PHASE 1 plan file (`docs/block-2-ui-157-review-plan.md`) should clarify which path applies. Recommendation: **scope path 2 only if BLOCK-2 explicitly demands live IPC; otherwise run with mock-installed bridge**.

### `useSkillStore.ts` → preload bridge contract

`useSkillStore.ts` lines 173-176 / 463-466 call `getBridge('skills')` and return `{ ok: false, error: 'skills bridge unavailable' }` when null. So even without any preload wiring, the page degrades gracefully — but a real load is impossible without it.

---

## §7 PHASE 3 Real-Machine Evidence Plan

> **Two scopes are possible**. Recommend reading the work package for which one applies before launching anything.

### Option A — Real Electron with Skills IPC (preferred for live evidence)

1. **Start dev Electron with CDP exposed**:
   ```bash
   PETRI_DEV_ELECTRON_ARGS="--remote-debugging-port=9222" npm run dev
   ```
   This boots Vite on 3000 + Electron via `open -a` + the `PETRI_ELECTRON_USER_DATA_DIR=.petri-dev-user-data` scratch profile. Logs go to `$TMPDIR/petri-electron-main.log` / `*.error`.

2. **Wait for renderer-ready signal**:
   - `curl -s http://localhost:9222/json/version` returns Chrome DevTools version JSON (CDP live).
   - `curl -s http://localhost:9222/json` lists targets; the Petri window has `webSocketDebuggerUrl` for Playwright.

3. **Attach Playwright MCP to the renderer**:
   - The Playwright MCP (`plugin-playwright-playwright`) supports `browser_navigate` to **either** the dev URL (`http://localhost:3000`) **or** a `chrome://`-equivalent CDP endpoint via `wsEndpoint`. Recommendation: navigate `http://localhost:3000/skills` (the Vite-served SPA) — same React tree, no Electron wrapper, full React-Testing-Library equivalent assertions possible.
   - If renderer-only IPC verification is needed, use `browser_snapshot` / `browser_console_messages` after navigating directly to `http://localhost:3000` (Vite) — `getBridge('skills')` will be null unless `window.petriDesktop.skills` is faked in dev. Workaround: monkey-patch via `browser_evaluate` with the install-bridge helper from §3 above, scoped to the page session.

4. **Capture evidence**:
   - **Screenshots**: `browser_take_screenshot` after each interaction (search, filter, click skill, click execute).
   - **Console logs**: `browser_console_messages` — capture `[SkillsPage] Execute skill:` / `[SkillsPage] Skill execution started:` lines from `pages/skills/index.tsx` L67, L72.
   - **IPC traffic**: in Electron, capture via DevTools Network panel filtered by `ipc://`; if unavailable, rely on console logs from the Skills page itself.
   - **Failure path**: navigate `http://localhost:3000/skills`, install a stub bridge that returns `{ ok: false, error: 'simulated failure' }` for `execute`, click an execute button → expect the "Retry" / error toast UI.

5. **Trigger failure path**:
   - Override `window.petriDesktop.skills.execute` via `browser_evaluate` to resolve `{ ok: false, error: 'IPC timeout' }` and trigger the retry button path.
   - Or click execute, then in DevTools disconnect the renderer from preload (e.g. via `ipcRenderer.send` interruption) — but this requires main-process restart, less clean.

### Option B — Vite-only dev server (mock bridge)

1. **Start Vite**: `cd frontend && npm run dev` (port 3000).
2. **Navigate Playwright MCP** to `http://localhost:3000/skills`.
3. **Inject mock bridge** via `browser_evaluate`:
   ```js
   window.petriDesktop = {
     isDesktop: true,
     platform: 'darwin',
     arch: 'arm64',
     backendConfig: { rApiBase: '', pythonApiBase: '' },
     skills: {
       discover: () => Promise.resolve({ ok: true, skills: [...] }),
       execute: (id, p) => Promise.resolve({ ok: true, executionId: 'mock-' + Date.now() }),
       getExecution: (id) => Promise.resolve({ ok: true, execution: { executionId: id, skillId: 'mock', status: 'completed' } }),
     },
     /* ... other required sub-bridges; can be stubs ... */
   };
   ```
4. **Capture evidence** with the same `browser_snapshot` / `browser_console_messages` flow.

**Option B is the safer choice for PHASE 3 if BLOCK-2 scope is frontend-only** — no Electron timing issues, no preload coupling, no native-module rebuild surface.

---

## §8 Risks / Open Questions

| # | Risk / Open Question | Severity | Notes |
|---|---|---|---|
| 1 | **`useSkillStore.test.*` does NOT exist.** PHASE 1 must author it (or test-only prep must). | **HIGH** | The test-only helper `__resetSkillStoreCacheForTests()` is already exported (line 580), so the precedent is in place — but no spec exists yet. |
| 2 | **No `vi.mock('@/lib/desktopBridge')` precedent.** The codebase uniformly uses **direct `window.petriDesktop` install** (see `usePluginStore.test.ts` line 38). New Skill tests MUST follow this pattern; introducing `vi.mock` would diverge from project convention and break the type-guard contract. | MEDIUM | If PHASE 1 author uses `vi.mock`, it will look like a unit test but will silently bypass `electron.d.ts` typing and the real `getBridge` branching logic. |
| 3 | **`preload.js` does not expose `skills`.** Search returned 0 matches in `src/preload.js` for `skills`. `src/main.js` does not `require('./workflow-engine')`. So **any real IPC traffic is impossible without preload+main changes**. | **HIGH** | PHASE 3 must either (a) accept that live IPC isn't achievable and use Option B (mock bridge over Vite), or (b) BLOCK-2 scope explicitly widens to preload+main. |
| 4 | **`core/shared-backend/workflow-engine.js` has no Node-side test.** (0 matches in `test/`.) Backend changes have zero coverage today. If PHASE 1 modifies workflow-engine, prefer adding `test/workflow-engine.test.mjs` in the same commit. | MEDIUM | Mirrors existing `test/*.test.mjs` pattern (Node `--test` runner, no external deps). |
| 5 | **Race between `npm run dev` and renderer attach.** `scripts/dev-electron.js` line 175-196 polls for 30 s; if Vite takes >30 s (cold `node_modules`, first MDX compile), the launcher aborts. Playwright MCP attachment must wait for both `curl http://localhost:3000` and `curl http://localhost:9222/json/version` (CDP) to be live before issuing `browser_navigate`. | LOW | Mitigation: poll loop in the PHASE 3 driver before driving. |
| 6 | **`postinstall` may rebuild native modules.** `scripts/install-core-deps.mjs` re-runs `npm rebuild better-sqlite3` when system-Node ABI mismatches the bundled binary. This adds 30–120 s to a fresh install. PHASE 3 does not need to reinstall — but if `npm run dev` complains about better-sqlite3 ABI, the rebuild is the fix. | LOW | Already documented in `install-core-deps.mjs` header comment lines 27-30. |
| 7 | **No Playwright infra exists.** Search for `playwright*` returned 0 files. The Playwright MCP `plugin-playwright-playwright` server is available, but the project has no `playwright.config.ts`, no `e2e/` directory, no `@playwright/test` dependency. PHASE 3 evidence must rely entirely on the MCP server's browser tools — there is no local-config reuse to lean on. | LOW (just informational) | If you want persistent e2e infra, propose it in a separate work package — not a BLOCK-2 deliverable. |
| 8 | **No fixture for Skills data.** The Skills registry (`core/shared-backend/skill-registry.js`, `skill-schema.js`) is referenced by `useSkillStore.ts` JSDoc but no test fixture file exists. PHASE 1 author will need to hand-roll `Skill[]` arrays in tests, mirroring the pattern from `usePluginStore.test.ts` line 70-78. | LOW | No dedicated fix; copy-paste the same shape `electron.d.ts` declares. |
| 9 | **TypeScript strict + Skill type drift.** `useSkillStore.ts` declares its own `Skill`, `ParameterSchema`, `OutputArtifact` interfaces (lines 26-105) that mirror — but are NOT derived from — `electron.d.ts` lines 117-148. PHASE 1 changes to the backend shape must update **both** files; a TS compile will not catch a drift in the opposite direction (electron.d.ts evolving without useSkillStore updating). | MEDIUM | Recommend extracting a single `Skill` type in `frontend/src/pages/skills/skill.types.ts` and importing it from both `useSkillStore.ts` and `electron.d.ts` — but the latter is a `.d.ts` global augmentation, so this requires an explicit `import type` outside `declare global`. Worth raising in PHASE 1 design review. |
| 10 | **`strictPort: true` + leftover dev process.** A previous dev Electron that crashed without clean shutdown leaves `node` listening on 3000. Subsequent `npm run dev` aborts with the "already serving" error. Cleanup: `lsof -ti :3000 \| xargs kill -9`. | LOW | Already a known issue, called out by `dev-electron.js` lines 202-207. |

---

## §9 Reference Commands (executed during PHASE 0)

All commands executed at repo root `<repo>`. Wall-clock times captured.

```bash
# §4 — Targeted gate verification
npx tsc --noEmit -p frontend/tsconfig.json        # exit 0, ~5.2 s, clean
npm run ui:audit:check                            # exit 0, ~10.3 s, 131 UI evidence entries
npm run docs:check                                # exit 0, ~1.6 s, 65 registered docs
npm run docs:reconcile                            # exit 0, ~1.7 s, 0 unregistered / 0 archive candidates
```

All exit codes captured. All gates green at PHASE 0 baseline.

Static searches (read-only, no execution):

```bash
# Skill test existence
glob "frontend/src/hooks/useSkillStore.test.*"    # 0 files
glob "**/useSkillStore.test.*"                    # 0 files
grep -l -i "skill" frontend/src/**/*.test.*       # 0 files (74 test files scanned)
grep -l -i "skill" test/                          # 0 files

# Playwright infra
glob "**/playwright*"                             # 0 files

# Mocking convention
grep "vi\.mock.*desktopBridge" frontend/src/      # 0 files

# Preload ↔ skills wiring
grep -i "skill" src/preload.js                    # 0 matches
grep -i "workflow-engine|skills-sdk" src/main.js  # 0 matches
```

---

## PHASE 1 Readiness — Key Findings (3 bullets)

- **All four governance gates are GREEN at PHASE 0** (`tsc --noEmit`, `ui:audit:check`, `docs:check`, `docs:reconcile`). PHASE 1's minimum CI surface is the same four commands — sub-15 s total and safe on every commit.
- **No `useSkillStore.test.*` exists.** PHASE 1 must author it as the first deliverable. The precedent to mirror is `frontend/src/hooks/usePluginStore.test.ts` (195 lines, 9 tests, direct `window.petriDesktop` install pattern — **no `vi.mock` anywhere in the codebase**). The test-only helper `__resetSkillStoreCacheForTests` is already exported from `useSkillStore.ts` line 580.
- **`src/preload.js` does NOT expose a `skills` namespace**, and `src/main.js` does NOT require `core/shared-backend/workflow-engine.js` or `skills-sdk.js`. Real Skill IPC traffic is impossible until those wires are added. PHASE 3 evidence collection should default to **Vite-only + Playwright MCP + mocked `window.petriDesktop.skills` bridge** (`http://localhost:3000/skills`) unless BLOCK-2 scope explicitly widens to preload/main; only then use `PETRI_DEV_ELECTRON_ARGS="--remote-debugging-port=9222" npm run dev` for live IPC.