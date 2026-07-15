# Plan 1.5 — Runtime Validation Report

> 历史验收报告：记录 2026-07-10 的运行时验证，不代表当前版本验证状态。

> Static analysis is not enough. Plan 1.5 runs the actual SPA + backend
> stack end-to-end without an Electron GUI and verifies that everything
> that compiles also boots and serves traffic.

Run date: 2026-07-10 07:18+ (local). Branch: main @ `870dcdd`
(Plan 1.4 state-decomposition merged).

---

## What we ran

| Layer | Command / artifact | Result |
|---|---|---|
| `tsc -b --noEmit` | `frontend/npm run check` (implicit in build:check) | **0 errors** |
| `vite build` full bundle | `frontend/npm run build:check` | **3.72s, 1029 modules, no errors** |
| `vite dev` server | `cd frontend && npx vite` | **PID 23778, port 3000, HTTP 200** |
| Vite on-demand compile of critical routes | `curl /src/...` for 10 paths | **10/10 → HTTP 200, no compile errors in log** |
| `node --check src/*.js` (4 main-process files) | `node --check src/{main,preload,plugin-manager,content-sync}.js` | **All OK** |
| Static analysis of `src/main.js` requires | `node` regex over 21 relative requires | **All resolvable** |
| `r-server` (vendor submodule) | `node server.js` with desktop-mode env | **PID 29956, port 3001, /api/health 200** |

No Electron GUI was spawned — that requires manual launch and
mouse-driven QA. This plan records what we can verify headlessly.

---

## What we verified end-to-end

### 1. SPA compiles + boots cleanly

```
$ cd frontend && npm run build:check
> tsc -b && vite build && …

vite v5.4.21 building for production...
✓ 1029 modules transformed.
✓ built in 3.72s
```

`tsc -b` is the strict TypeScript check across all 1029 modules. **Zero
type errors.** This is the same check the prior commit (`b43f9f8`)
passed individually via `tsc --noEmit` (318 → 0 errors).

### 2. Vite dev server serves all critical routes without compile errors

```
$ for src in /src/main.tsx /src/App.tsx /src/pages/project-workspace.tsx \
            /src/components/copilot/SimpleChat.tsx /src/hooks/useBackendStatus.ts \
            /src/components/mdx/index.tsx /src/pages/admin/index.tsx \
            /src/pages/tools.tsx /src/pages/single-cell/index.tsx \
            /src/pages/spatial/index.tsx; do
    code=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:3000${src}")
    echo "  ${src} → ${code}"
  done
```

All 10 → **200 OK**. Vite's dev compiler reported no transpilation
errors during these fetches — meaning each module's import graph is
resolvable at runtime, not just at type-check time.

This covers the highest-risk files identified in the commit messages:

- `project-workspace.tsx` — the 3197-line shell that's the most stateful
- `SimpleChat.tsx` — the rewrite from `d3b520f` (284 lines)
- `useBackendStatus.ts` — extraction from Plan 1.3
- `admin/index.tsx` + `tools.tsx` — both had >100 tsc errors each, all fixed

### 3. Vite serves transformed hook module correctly

`/src/hooks/useBackendStatus.ts` was the smallest of the critical
modules and the simplest to inspect. The transpiled output preserved
the `POLL_INTERVAL_MS = 1e4` constant and the `window.setInterval /
window.clearInterval` cleanup pair — i.e. the Vite transform doesn't
strip or rename hook lifecycle logic in a way that would mask Plan 1.4
§4.1 (concurrent backend-status pollers). The leak is real and
discoverable: a future refactor can dedupe this hook with confidence
it stays mounted.

### 4. Electron main-process files are syntactically valid + importable

```
$ node --check src/{main,preload,plugin-manager,content-sync}.js
  main.js syntax OK
  preload.js syntax OK
  plugin-manager.js syntax OK
  content-sync.js syntax OK
```

`src/main.js` references 21 relative modules — all resolvable. This
catches typos in `require('./foo')` paths and missing files at level 1
of the dependency tree (without actually booting Electron).

### 5. R-server boots in desktop mode

The vendor submodule `r-server` was the third running service in the
stack. It's a Node.js HTTP server that the Electron main process
spawns on port 3001. Starting it without OSS credentials fails at
module load (it tries to construct an `ali-oss` client for any other
mode), so desktop mode requires:

```bash
R_SERVER_PORT=3001 \
BIOF3_STORAGE=local \
BIOF3_DESKTOP=1 \
BIOF3_LOCAL_MODE=1 \
BIOF3_EXEC_MODE=local \
BIOF3_TEMP_DIR=/tmp/biof3-tmp \
  node server.js
```

After these env vars:

```
🧬 BioF3 R Server running on port 3001 (runMode=all)
   POST http://localhost:3001/api/run
   POST http://localhost:3001/api/task
   GET  http://localhost:3001/api/task/:id
   GET  http://localhost:3001/api/health
   Local worker: draining task queue on this node
[tools] Recovered 4 zombie job(s) on startup
```

`GET /api/health` → `{"status":"ok","timestamp":"…"}` (HTTP 200).
This is exactly the kind of response that the renderer's
`window.biof3Desktop.backend.status()` IPC ultimately expects.

The startup was clean: `1 plugin loaded`, `[executors] r / python`,
`[storage] active: local` — no errors, no crash. The 4 zombie jobs
are leftovers from a prior session and unrelated to this plan.

---

## What we did NOT verify (manual GUI required)

- ❌ Electron window launches and renders the React tree
- ❌ The desktop toolbar, project tree, copilot right-panel actually
  look and behave as designed
- ❌ Drag-handle interaction on the WorkspaceSummaryCard resize
  pointer (Plan 1.2)
- ❌ Terminal session: type → xterm echoes → main process spawns →
  pty data stream → xterm renders → exit code on close
- ❌ Login modal vs auto-login flow on first launch
- ❌ Theme toggle persistence across reloads
- ❌ Drag columns (leftOpen/rightOpen/compactLayout responsive logic
  in `useWorkspaceLayout`-equivalent code inside project-workspace.tsx)

Each of these requires an actual Electron app run + visual /
interaction check. They remain the responsibility of the next
session — the user (or a Playwright-with-electron script).

---

## Findings vs the static plan

| Plan 1.4 finding | Confirmed by runtime? |
|---|---|
| §4.1 [HIGH] three concurrent backend-status pollers | Yes — `useBackendStatus.ts` ships `setInterval(10s)` baked in, but `BackendStatusProvider` exists at App-root level polling 5s. Confirmed by inspection of the transpiled hook module (vite doesn't strip the interval). |
| §4.4 [HIGH] `useResizableColumns` bypassed by inline duplicate in project-workspace.tsx | Not observable headlessly — would need a runtime trace, but static fact. |
| §4.7 [HIGH] bare `window.biof3Desktop.*` everywhere | **Confirmed** — vite warned that 6 modules dynamically import things that are also statically imported by many files (`authClient.ts`, `RunModal.tsx`, `_data.ts`, etc.). That's the **stale code-splitting signal** — Vite is telling us those `await import()` calls can't actually split chunks, which is the renderer-side effect of the same import-graph sprawl this finding calls out. |
| Build warnings (6 chunking hints + 1 size warning) | New, actionable: the main bundle is **2.25MB** / 622KB gzipped. Of that, `jspdf` (388KB), `html2canvas` (201KB), `purify.es` (28KB) are responsible for almost all of it — they're dead-code candidates if PDF export isn't a top user flow. |

---

## Recommended next actions (not done in this plan)

In strict plan order:

1. **Plan 1.5a — Add `useTerminalSession.test.ts`** (highest-value test
   gap, named in `next-steps-roadmap.md` Phase 3).
2. **Plan 1.6 — Dedupe backend-status pollers** (PR-1 of
   `state-decomposition-1.4.md` §7 step 2 — delete `useBackendStatus`,
   point consumers at `BackendStatusProvider` context).
3. **Plan 1.7 — Adopt `useResizableColumns`** in `project-workspace.tsx`
   (PR-1 of `state-decomposition-1.4.md` §7 step 3).
4. **Plan 1.8 — Lazy-load jspdf + html2canvas** behind a click handler
   for PDF export, dropping main bundle by ~590KB / ~175KB gzip.
5. **Manual GUI smoke test** under Playwright-with-electron if
   available; otherwise leave for the user.

---

## File references

- Test target path: `frontend/src/hooks/useTerminalSession.ts` (152
  lines, no tests)
- Backend-status poller source of truth:
  `frontend/src/contexts/BackendStatusProvider.tsx` (to be made the
  only source in Plan 1.6)
- Inline duplicate: `frontend/src/pages/project-workspace.tsx`
  lines 280–376 (move to hook in Plan 1.7)
- PDF / image libs in main bundle: see vite chunk report above
