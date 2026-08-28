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
G0 开发期常态 · 不外推 packaged/Provider/GA。
