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

- Focused frontend: 59/59 PASS across `CodeMirrorDiffView`,
  `CodeMirrorEditor`, event bus, `DiffActionBar`, and `desktopBridge`.
- TypeScript: `tsc --noEmit` 0 errors.
- Syntax: `src/ipc/working-tree-review.js`, `src/main.js`, and
  `src/preload.js` all pass `node --check`.
- Governance: `docs:reconcile` 0 validation issues, `docs:check` PASS with 143
  registered documents, and `ui:audit:check` PASS.
- UI-200 remains `in_progress` until dev Electron review is observed.

## 6 Closeout semantics

BLOCK-23 is closeout-ready, not completed: the verified changeset has user commit
approval and still needs dev Electron UI-200 review plus the canonical P6
source-bound evidence refresh. P6 requires committed source bytes, so its live
update runs only after the implementation commit exists.
G0 开发期常态 · 不外推 packaged/Provider/GA。
