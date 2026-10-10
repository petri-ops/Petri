# BLOCK-27 AI Review Removal Plan

## 1 Decision record

2026-08-29 user adjudication: the AI review feature (BLOCK-25/26) is
**redundant** for this product and is removed in full. Reasoning: workspace
changes are authored by the agent itself, so a second AI pass over the same
(or same-class) model's output adds token/time cost for low marginal value;
the human reviewer is already served by the deterministic Working Tree
Review panel (diff, per-hunk accept/reject, commit). Codex keeps /review as
a flagship feature because its scope includes reviewing human-authored code
(PR review); Petri's primary flow does not.

The removal is reversible: git history retains the full implementation
(commits 0ca7e59..7fc08c5, UI-202/UI-203 evidence and ledgers stay as
history).

## 2 Scope

### Removed

- Frontend: ReviewFindingsPanel (+test), useCodeReviewAgent,
  reviewResultStore, review-client.ts, review-types.ts, the AI 审阅 button
  and all drawer wiring (panel render, finding jump, pending-scroll for
  findings, editor findings mirroring, fix hand-off).
- CodeMirror: extensions/reviewFindings.ts, the reviewFindings compartment
  in useCodeMirrorEditor, EditorApi.setReviewFindings, related test mocks.
- Backend: core/r-server/agent-review/ (prompts / git boundary / output /
  runner), routes/agent-review.js + registration, POST /api/agent/review.
- Target-picker IPC added for the pickers: git:recent-branches /
  git:recent-commits (+ preload + electron.d.ts declarations).
- Tests: review-output / review-prompts / review-git.

### Kept

- Working Tree Review core (diff view, per-hunk accept/reject, commit
  review, CodeReviewDrawer) — the deterministic change tracker.
- The staged-only diff fix (`git diff HEAD`, c228beb) — a real BLOCK-20 bug
  fix independent of AI review.
- UI-202/UI-203 ledger entries and evidence as history, annotated with the
  removal decision.

## 3 Gates

- tsc --noEmit 0; WTR focused vitest PASS; node --check for touched
  ipc/preload; no review-* test files remain.
- docs:check / ui:audit:check / docs:reconcile clean at closeout.

## 4 Completion semantics

BLOCK-27 completes when the AI review surface is fully removed, the
deterministic tracker is untouched, ledgers record the decision and the
historical evidence, and gates pass.
G0 开发期常态 · 不外推 packaged/Provider/GA。
