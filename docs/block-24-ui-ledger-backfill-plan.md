# BLOCK-24 UI Ledger Backfill & Impact-Map Repair Plan

## 1 Scope

Close the BLOCK-22 ledger debt (UI-191~194 were never registered in
`docs/ui-productization-audit.md` after the WIP lock lifted) and restore
`npm run test:changed:list` by repairing classification-rule overlaps in
`test/impact-map.json`.

### In scope

- Backfill UI-191 / UI-192 / UI-193 / UI-194 entries with accurate scope and
  honest verification boundaries.
- dev Electron observation for UI-193 (accept/reject widget on the Working
  Tree Review inline diff, including a real hunk reject through the BLOCK-20
  IPC with repository restore) and UI-194 (pending-scroll linkage driven
  through the mounted dev bridge `window.__biof3DispatchOpenFile`).
- Fix `test/impact-map.json` classification-rule overlaps so
  `npm run test:changed:list` reproduces and passes.
- Canonical ledger updates (roadmap / handoff / AUDIT-LOG / DOC-REGISTRY /
  ui-audit) at closeout.

### Out of scope

- Mounting `ChatCardLinkBridge` into the chat UI — business-side decision,
  recorded honestly in the UI-194 entry.
- New user-facing features, IPC channels, or npm dependencies.
- Provider / packaged / GA / notarization / P7.

## 2 Verified baseline (existing evidence)

- UI-191 / UI-192 rendering paths were exercised by the UI-200 dev Electron
  acceptance (readonly inline diff, `cm-merge-b` / `cm-changedLine` /
  `cm-insertedLine` / `cm-changedText`) with evidence at `acceptance/ui-200/`.
- Focused frontend 59/59 across `CodeMirrorEditor`, `CodeMirrorDiffView`,
  event bus, `DiffActionBar`, and `desktopBridge` (BLOCK-23 checkpoint).
- The accept/reject extension mounts unconditionally in `inline-diff` mode
  and its reject path calls the real BLOCK-20 IPC
  (`bridge.rejectHunkByInverseHunk`).

## 3 Execution phases

1. **P0 — Registration + backfill**: plan, DOC-REGISTRY active entry, README
   entrypoint, AUDIT-LOG launch row; backfill UI-191~194 sections as
   `in_progress` with their honest current boundary.
2. **P1 — UI-193 dev Electron**: create a scratch working-tree modification →
   open Working Tree Review → observe the accept/reject widgets → reject one
   hunk through the widget → verify the file is restored and the repository
   is clean → evidence `acceptance/ui-193/`.
3. **P2 — UI-194 dev Electron**: dispatch `window.__biof3DispatchOpenFile`
   → observe the preview open the file in CodeMirror and scroll to the
   target line → evidence `acceptance/ui-194/`.
4. **P3 — Impact-map repair**: remove or merge the overlapping
   classification rules reported by `npm run test:changed:list`; unknown
   paths must keep failing closed.
5. **P4 — Closeout**: transition UI-193 / UI-194 per earned evidence, update
   canonical ledgers, run gates.

## 4 Acceptance gates

- `npm run ui:audit:check` PASS.
- `npm run docs:reconcile` 0 validation issues; `npm run docs:check` PASS.
- `npm run test:changed:list` succeeds after the impact-map repair.
- Focused frontend tests for touched files (expected 0 code changes).
- Evidence JSON in `acceptance/ui-193/` and `acceptance/ui-194/` binds the
  dev Electron observation with an explicit `passed` result and honest
  boundaries.

## 5 Completion semantics

BLOCK-24 completes when the four BLOCK-22 UI items carry truthful ledger
entries (verified only where dev Electron evidence exists), the impact-map
gate is restored with fail-closed semantics intact, and canonical ledgers are
updated.

## 6 Closeout record (2026-08-28)

- P0 + backfill commit `339506a`: plan, DOC-REGISTRY active entry, README
  entrypoint, AUDIT-LOG launch row, UI-191~194 sections registered.
- P1/P2 observation commit `be9e1f8`: dev Electron session (CDP) confirmed
  the inline diff renders correctly on a scratch CHANGELOG.md modification
  (changed x2 / inserted x1) while the accept/reject widget never mounts —
  `CodeMirrorDiffView` passes a `DiffRevision` without `hunks`, so
  `getHunks()` is empty and the WTR accept/reject UX remains the BLOCK-20
  drawer action bar (`acceptance/ui-193/`, passed:false with root cause).
  The UI-194 dispatch through the mounted `window.__biof3DispatchOpenFile`
  was accepted but produced no preview — `WorkspaceFilePreviewBridge` /
  `ChatCardLinkBridge` have no JSX mount anywhere, so the pending request
  has no consumer (`acceptance/ui-194/`, passed:false with root cause).
  UI-193/UI-194 therefore stay `in_progress` with the gaps evidenced;
  UI-191/UI-192 are `verified` on the UI-200 evidence plus focused unit
  tests and the P1 re-check. Scratch modification reverted; repository
  clean.
- P3 resolved without changes: the classification-rule overlap was already
  repaired by UI-201's `852f4b4` (impact-map coverage). Verified on
  2026-08-28: 0 violations across all 114 scripts against the
  exactly-one-classifiesScripts-rule contract, `npm run test:changed:list`
  passes on a clean tree, and an explicit `--files` probe with the
  originally failing `scripts/provision-win-r-runtime.mjs` plus evidence,
  frontend, and docs files classifies cleanly (exit 0). Fail-closed
  semantics untouched (unknown files still exit 2).
- Gates at closeout: `ui:audit:check` PASS, `docs:check` PASS,
  `docs:reconcile` 0 validation issues, `git diff --check` clean.
- Follow-up candidates left for explicit user adjudication (not started):
  surfacing the UI-193 widget on a business diff path, and mounting the
  UI-194 consumer components.
G0 开发期常态 · 不外推 packaged/Provider/GA。
G0 开发期常态 · 不外推 packaged/Provider/GA。
