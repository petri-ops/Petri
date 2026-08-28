# UI-201 Result Studio P6 Evidence Repair Plan

## 1 Scope

Repair the Result Studio P6 evidence chain and refresh the canonical
source-bound P6 evidence without weakening its fail-closed verifier.

### In scope

- Declare the verification owner for `acceptance/ui-200/**` in the impact map.
- Repair remaining P6 capture-chain defects exposed by the canonical updater.
- Capture a new canonical P6 observation from a clean committed source tree.
- Restore the 205-file source binding that includes `src/preload.js`.
- Close UI-201 only when canonical P6 evidence verifies against current source.

### Out of scope

- New Result Studio user features.
- Relaxing source-map, sanitization, artifact-truth, or evidence checks.
- Provider matrices, packaged Electron, GA, notarization, or P7 qualification.
- Rewriting older evidence to pretend it was captured from a newer commit.

## 2 Dependency boundary

BLOCK-23 remains a committed UI checkpoint: implementation `71d4f78` and dev
Electron UI-200 evidence are accepted. Its `completed` transition waits on this
package because canonical P6 is the sole remaining gate.

## 3 Execution phases

1. **P0 — Chain diagnosis**: reproduce the stored-source-map and impact-map
   failures; confirm already-repaired SQLite and migration scopes stay green.
2. **P1 — Evidence ownership**: map the UI-200 evidence tree to its declared
   owner and keep unknown evidence trees fail-closed.
3. **P2 — Capture repair**: run the explicit P6 update matrix, fixing only
   defects that block truthful observation or verification.
4. **P3 — Canonical refresh**: from a clean committed tree, regenerate
   `acceptance/g0-result-studio/rs-p6-durability-recovery-performance.json`
   with the current source map and exact hashes.
5. **P4 — Closeout**: verify BLOCK-23 against refreshed P6 evidence and update
   canonical work-package, roadmap, handoff, audit, and UI ledgers.

## 4 Acceptance gates

- `node --test test/test-affected.test.mjs` — all PASS.
- `npm run g0:result-studio:p6` — syntax, focused Node, focused frontend, and
  canonical evidence recomputation all PASS.
- `npm run docs:reconcile` — 0 validation issues.
- `npm run docs:check` — PASS.
- `npm run ui:audit:check` — PASS.
- Canonical evidence must retain `qualificationEligible: false`, real Provider
  exclusion, and packaged Electron exclusion.

## 5 Completion semantics

UI-201 is complete only when the canonical P6 evidence is regenerated from a
real local development-boundary capture, its 205-file source binding verifies,
all P6 gates pass, and BLOCK-23 is updated from `P6-blocked` to `completed`.

## 6 Closeout record (2026-08-28)

- Earlier package phases landed on `main` as `852f4b4` (SQLite init,
  migration count, impact-map coverage), `44a4b7e` (driver-observable
  diagnostics + deep-link routing), `e5c2ca5` (evidence write-gate
  isolation), and `def5fdf` (renderer warmup + canonical route repair).
- P3 canonical refresh: `node scripts/g0-rs-p6-product-acceptance.mjs
  --write-evidence --verbose` captured from the clean committed tree
  `1f276de`, which also repairs the verifier's stale `EVIDENCE_PATH`
  reference left by the write-gate isolation (focused scope, 1 line).
- Canonical evidence
  `acceptance/g0-result-studio/rs-p6-durability-recovery-performance.json`:
  capturedAt 2026-08-28T14:11:01Z, 10/10 canonical checks recomputed, 206-file
  source binding including `src/preload.js`,
  `sourceCommitMatchesSourceHashes: true`,
  `sourceBindingStableDuringCapture: true`, `qualificationEligible: false`.
- Failure history kept honest: one recovery cold-boot fetch failure and two
  load-sensitive Electron pressure (P6-06) budget failures occurred under
  residual machine load; the standalone recovery slice and the quiet-machine
  full captures passed without any change to verifier, budget, sanitizer, or
  Artifact Truth rules. No evidence was hand-edited or backfilled.
- Acceptance gates: `node --test test/test-affected.test.mjs` 0 fail;
  `npm run g0:result-studio:p6` PASS with 10/10 canonical checks recomputed;
  `npm run docs:reconcile`, `npm run docs:check`, `npm run ui:audit:check`,
  and `git diff --check` clean at closeout commit time.
- UI-201 completed / verified; BLOCK-23 completed; no active work package
  remains.
G0 开发期常态 · 不外推 packaged/Provider/GA。
