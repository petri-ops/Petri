# BLOCK-23 Review CodeMirror Upgrade Plan

## 1 Scope

Replace the plain-text diff rendering in the Working Tree Review panel
(`frontend/src/components/desktop/WorkingTreeReview/`) with the
CodeMirror 6 unified diff extension already delivered by BLOCK-22.

### In scope

- New `CodeMirrorDiffView` component wrapping `CodeMirrorEditor` in
  `inline-diff` readonly mode for per-file diff rendering.
- Remove `DiffHunkView.tsx` and `DiffFileView.tsx` (superseded rendering).
- Remove `src/ipc/agent-doc-review.js` and its `require` / setup call in
  `src/main.js` (BLOCK-17 dead code, UI entry removed by BLOCK-18).
- Strip hunk-specific styles from `WorkingTreeReview.css`.

### Out of scope

- IPC layer (`src/ipc/working-tree-review.js`, `git-adapter.js`) — retained.
- `useWorkingTreeReview` hook state management — retained.
- Commit dialog, CodeReviewDrawer, file list, status bar — retained.
- G1+ packaged / Provider / GA.

## 2 Approach

1. `CodeMirrorDiffView.tsx` fetches HEAD + working-tree file content via
   `getBridge('workingTreeReview')`, builds a `DiffRevision`, and renders
   `CodeMirrorEditor` in `inline-diff` readonly mode with language detection.
2. `WorkingTreeReview.tsx` replaces `<DiffFileView>` with `<CodeMirrorDiffView>`.
3. Binary files and empty-diff edge cases render a simple placeholder.

## 3 Acceptance gates

- `npx tsc --noEmit` — 0 errors.
- `npm run docs:check` — PASS.
- `npm run ui:audit:check` — PASS.
- Focused vitest for affected files.

## 4 Implemented boundary

- `CodeMirrorDiffView` loads HEAD and WORKTREE text only for non-binary files,
  reports WORKTREE failures through an alert, and renders a readonly
  `CodeMirrorEditor` inline diff.
- `WorkingTreeReview` uses the new component; the superseded
  `DiffFileView` / `DiffHunkView` files and their hunk styles are removed.
- The BLOCK-17 `agentDocReview` IPC implementation, preload namespace, global
  type contract, and renderer fallback are removed.
- `working-tree-review` keeps its BLOCK-20 channels. Repository-wide status and
  diff collection now use `repositoryStatus`, and the stale scoped-status call
  after commit is aligned to the same API. No IPC channel or dependency is
  added.
- `src/preload.js` is added to the P6 canonical source-binding impact rule so
  future source-map additions fail closed with the canonical verifier.

## 5 Closeout evidence

- Implementation commit: `71d4f78` — 22 files changed, +354/−463.
- Focused frontend: 59/59 PASS across `CodeMirrorDiffView`,
  `CodeMirrorEditor`, event bus, `DiffActionBar`, and `desktopBridge`.
- TypeScript: `tsc --noEmit` 0 errors.
- Syntax: `src/ipc/working-tree-review.js`, `src/main.js`, and
  `src/preload.js` all pass `node --check`.
- Governance: `docs:reconcile` 0 validation issues, `docs:check` PASS with 143
  registered documents, and `ui:audit:check` PASS.
- UI-200 dev Electron acceptance: PASS. CDP evidence at
  `acceptance/ui-200/electron-codemirror-diff-dev.json` and
  `acceptance/ui-200/electron-codemirror-diff-dev.png` verifies the selected
  fixture path, readonly `CodeMirrorEditor`, `cm-merge-b` inline-diff classes,
  inserted fixture text, and absence of the legacy hunk view. The intent-to-add
  fixture was deleted after evidence capture.
- Test isolation commit: `e5c2ca5` — injected evidence paths are isolated from
  the canonical evidence target. Focused P6 acceptance is now 12/13; the sole
  remaining failure is the stale 204-file stored source map against the
  current 205-file binding (`p6_stored_source_map_invalid`).
- The committed-source P6 refresh remains blocked by a separate Result Studio
  issue. The canonical updater fail-closed on the pre-existing SQLite,
  migration-version, and affected-evidence mapping debts; direct capture
  reported `p6_recovery_active_electron_persisted_driver_failure`. No P6
  evidence was written. The existing P6 evidence remains honestly bound to
  `ad1e2ce`.

## 6 Closeout semantics

BLOCK-23 is accepted at the UI boundary but remains not completed: the sole
remaining gate is a truthful canonical P6 source-bound evidence refresh. The
P6 blocker belongs to Result Studio and must be resolved in a separately
governed work package after explicit user approval.
G0 开发期常态 · 不外推 packaged/Provider/GA。
