# ProjectWorkspace Refactor — Next Steps

## What was done in this session (2026-07-10)

### Plan 1.2 (Panel Decomposition) — COMPLETE
All 5 workspace panels extracted into independent files under
`frontend/src/components/workspace-panels/`:

| File | Lines | Role |
|---|---|---|
| `BottomTerminal.tsx` | 60 | Embedded xterm panel, uses `useTerminalSession` |
| `CenterPanel.tsx` | 306 | 8-way `workspaceMode` router (chat/search/scheduled/tools/...) |
| `LeftPanel.tsx` | 483 | Project tree + quick actions + inline creator |
| `RightPanel.tsx` | 315 | 6-tab result panel (home/results/files/terminal/browser/chat) |
| `WorkspaceSummaryCard.tsx` | 201 | Pinned summary card on chat/scheduled |

Each panel is a **pure renderer** — it accepts a `*Context` mega-prop and
returns JSX. All state and handlers live in `ProjectWorkspace` and are passed
in. This keeps panels unit-testable without mocking react state machines.

### Plan 1.3 (Hooks extracted) — COMPLETE
| File | Lines | Role |
|---|---|---|
| `useBackendStatus.ts` | 38 | Polls backend health (R / Python / Plumber) |
| `useTerminalSession.ts` | 152 | xterm IPC state machine (write/resize/start/stop/exit/data) |
| `useResizableColumns.ts` | 108 | Column-width drag handling (reused by left/right/input) |
| `useWorkspaceRouting.ts` | 54 | URL ↔ `WorkspaceMode` router |

### Plan 1.5 (Themes + dead code) — COMPLETE
- `terminal-themes.ts` extracted (101 lines + 61 test lines)
- `ResourcePanel` dead branch deleted (plan 1.5)

### Plan 1.7 (Tests) — PARTIAL
- `useBackendStatus.test.ts` (3 tests)
- `useResizableColumns.test.ts` (5 tests)
- `terminal-themes.test.ts` (8 tests)
- **Missing**: `useTerminalSession` test (the IPC state machine — most
  complex, plan 6.3 marked it as a separate test pass)

### Final state
- `project-workspace.tsx`: **4098 → 3197 lines** (-22%)
- 17 new untracked files
- vitest: **16/16 passing**
- tsc: **0 new errors**
- sync-vendor: OK

---

## What is NOT done (plan 1.4)

`ProjectWorkspace` is still 3197 lines because it holds:
- 46 `useState` calls (planning underestimated at 36)
- 15 `useEffect` (planning said 10)
- 38 `useCallback` handlers
- 5 computed `useMemo` blocks
- 3 large `*PanelContext` mega-prop construction blocks

The body is now a thin shell that wires the panels together, but state
abstraction is still inline. Plan 1.4's "150-200 line shell" target is
**not** achieved.

---

## Recommended next session (state decomposition)

### Why not done in this session
The 46 useState + 15 useEffect + 38 handlers are **interleaved** across
domain boundaries. Examples of cross-domain coupling:

- `handleShowScheduled` reads `activeJobId` (Active) + `jobs` (Domain)
- `handleNewConversation` writes `setProjectConversations` (Domain) and
  calls `navigate` (Routing)
- `useEffect[443]` (`refreshConversations`) depends on
  `setActiveConvId` (Active) + `setConversations` (Domain) +
  `refreshConversations` handler
- `useEffect[408]` resets workspace files when `projectId` changes

Decomposing into 5 independent hooks would require either:
- **Option A**: Mega-hook (one file holds all 46 state) → defeats
  separation purpose
- **Option B**: 5 domain hooks with shared setter callbacks exposed
  across hooks → introduces implicit cross-hook contracts

Both options have higher risk than benefit at this codebase maturity.
The next session should investigate Option B carefully before committing.

### Step-by-step plan for next session

#### Phase 1: Validate runtime
The session's panel extraction is **statically validated** (tsc + vitest
pass) but **not runtime validated** (no `npm run dev` was run). The
most important first step is:

```bash
cd frontend
npm run dev
```

Open the desktop app, click through:
- leftCol: project tree, inline create, conversation switch
- centerCol: chat, scheduled, tools (embedded page)
- rightCol: each of 6 tabs, tab open/close
- bottom terminal: open, type, close

If anything misbehaves, the bug is in mega-ctx wiring — likely a missing
prop or wrong setter type (`boolean` vs `DispatchSetter<boolean>`).

#### Phase 2: Decompose state (Plan 1.4)

**Recommended order** (lowest risk first):

1. **`useProjectDomain`** — 9 state (project/jobs/datasets/allProjects/...)
   + 5 useEffect (polling, listing). Most isolated. This is the
   foundation other hooks read from.

2. **`useWorkspaceLayout`** — 13 state (leftOpen/rightOpen/.../centerColWidth)
   + 5 useEffect (matchMedia, ResizeObserver, window resize). Pure DOM,
   no business logic.

3. **`useProjectForms`** — 10 state (creatingProjectInline/...) + 3
   handlers (submitProjectCreator, openConversationCreator,
   submitConversationCreator). Self-contained form state.

4. **`useActiveSelection`** — 7 state (activeJobId/activeArtifact/.../activeConvId).
   No own useEffect; pure state.

5. **`useRightPanelTabs`** — 4 state (rightTab/openRightTabs/rightToolMenuOpen/browserUrl).
   Smallest. Easy to verify.

After each hook, the project-workspace line count should drop ~300-500
lines. End state target: ~600-800 lines (NOT plan's 150-200 — see "Why
not done" above).

#### Phase 3: Test useTerminalSession

The 152-line `useTerminalSession` hook handles the embedded terminal's
lifecycle. It's the most stateful of the 4 extracted hooks and currently
has zero tests. Plan 6.3 specifies 6-8 tests covering:
- session start/stop lifecycle
- write/resize propagation
- data flow from pty → xterm
- exit code/signal handling

This is the single highest-value test to add next.

#### Phase 4: Vendor submodule (plan 3.4)

The `vendor/biof3-core` submodule has 17 modified + 2 untracked files
that the user has not yet decided on (commit-and-push or revert). See
the conversation history; user was asked to choose A or B.

---

## File reference

### Panel contexts (mega-props)
- `CenterPanelContext` — `CenterPanel.tsx` lines 18-77
- `LeftPanelContext` — `LeftPanel.tsx` lines 7-65
- `RightPanelContext` — `RightPanel.tsx` lines 17-78
- `WorkspaceSummaryCardProps` — `WorkspaceSummaryCard.tsx` lines 7-25

### Exported types from `project-workspace.tsx`
- `ActiveArtifact`, `ActiveWorkspaceFile`
- `BackendServiceItem`, `BackendSummary`, `JobStats`
- `RightPanelMode`, `RIGHT_PANEL_ITEMS`

### Exported components from `project-workspace.tsx`
- `WorkspaceSearchPanel`
- `ScheduledWorkspacePanel`
- `EmptyResult`, `EmptyAnalysisResult`
- `ResultView`, `RightFileTree`, `TerminalPanel`, `BrowserPanel`

If a panel is moved out, these exports can be removed too.

---

## Session stats

- Session length: 1 conversation (multiple back-and-forth)
- Files created: 17
- Files modified: 1 (`project-workspace.tsx`)
- Net new lines: 2233 (panels + hooks + tests + scripts + docs)
- Net deleted lines: 694 (in `project-workspace.tsx`)
- New tests: 16 (8 terminal-themes + 3 useBackendStatus + 5 useResizableColumns)
