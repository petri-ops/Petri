---
name: petri-ui-design
description: Use when designing, reviewing, refactoring, or extending Petri's own UI/UX; also use when a user asks Petri to produce a design brief, DESIGN.md, component/state matrix, visual reference analysis, or a Gen UI prototype. 适用于设计/评审/重构 Petri 自身界面，或用户要求 Petri 产出设计说明、DESIGN.md、组件与状态矩阵、参考图分析、Gen UI 原型。
---

# Petri UI Design

## Purpose

Produce design work that is **quiet, token-governed, state-complete, and verifiable**. This skill is the single agent-side entrypoint for two modes:

1. **Internal mode** — improve Petri's own UI/UX.
2. **Product mode** — give Petri a reusable design workflow for user-facing design tasks.

Never treat a screenshot or a personal aesthetic preference as a substitute for the canonical rules.

## Governing sources

Read in this order; later sources never override earlier ones:

1. `docs/design-charter.md` — font scale, color budget, border semantics, motion tokens, control rules.
2. `docs/ui-design-acceptance-checklist-v1.md` — eight-state matrix, geometry four checks, long-content states, scorecard.
3. `docs/ui-productization-audit.md` — UI debt and per-issue evidence; do not mark `verified` without live evidence.
4. `frontend/src/styles/theme-token-contract.test.ts` — mechanical token ratchets.
5. `$petri-css-theme` — implementation-level CSS pitfalls and hard rules.
6. `resources/design-context/` — machine-readable design inputs derived mechanically from the canonical sources above; read in this order before proposing changes: `design-context.json` (font/color/border/motion baseline), `ia-map.json` (routes/redirects/high-frequency paths for information hierarchy), `visual-consistency.json` (dark ramp/slate ratchet/color budget), `responsive-a11y.json` (keyboard/focus/ARIA/contrast/breakpoint/touch-target contracts), `performance-trust.json` (streaming/memo/SSE/trust states/skeleton). Manifest and sha256 in `resources/design-context/manifest.json`; a missing or drifted source is fail-closed, never substitute memory or screenshots. These are also consumed by the `design-brief` product Skill (v1.1).

## Workflow

### Step 1: Classify the request

- **Petri's own UI change** → internal mode; route through the existing UI ledger/issue anchor.
- **User asks for a design artifact** → product mode; produce a design brief using `references/design-brief-template.md`.
- **Reference images or sites supplied** → analyze them with `references/reference-analysis.md`; never copy brand marks, copy, illustrations, or whole-page layout.
- **Request asks for a runnable prototype** → reuse the existing `visualize` product Skill / Gen UI fragment rules; do not introduce a new runtime.

### Step 2: Build the context pack before proposing changes

- Identify the canonical module and its user goal.
- Fill the module state matrix from `references/module-state-matrix.md`.
- Record primary action, secondary actions, focus order, narrow/empty/error/loading states.
- List every design decision as one of: canonical-bound, user-ruling needed (U), or evidence-backed (E).
- List tool/component candidates from `references/tool-adoption-matrix.md`; default to zero new dependencies.

### Step 3: Produce the smallest design artifact that can be checked

Use `references/design-brief-template.md` for product mode. Include:

- goal and non-goals;
- information hierarchy;
- module state matrix;
- token/component mapping;
- interaction and keyboard contract;
- anti-patterns and exclusions;
- license/source notes for any external reference;
- verification plan (static, mechanical, and human-eye).

### Step 4: Verify before claiming completion

- Run the mechanical gates relevant to the touched surface: `theme-token-contract`, UI audit, targeted tests, and `dev-verify` flows when UI behavior changes.
- Use `references/review-checklist.md` for a pre-delivery review.
- Write static scores only from current command output; never call them human-eye scores.
- Aesthetic/visual judgement: with a user preference ruling, run the preference-review loop (review → optimization suggestions → auto-optimize the presentation layer → re-verify → sign verified with per-criterion evidence); without a preference ruling, mark `pending_human_eye` and do not sign. See AGENTS.md §UI 进度自动对账 for boundaries (≤3 iterations, presentation-only changes).

## Hard rules

1. Do not create a second color/font/token system.
2. Do not widen an existing ratchet without a recorded user ruling.
3. Do not add decorative motion by default; motion must carry feedback or state change.
4. Do not replace `SimpleChat` or any product runtime with an external UI library without a separate BLOCK ruling.
5. Do not copy reference brands, logos, copy, illustrations, or whole-page layouts.
6. Do not claim `verified` from static evidence alone.
7. Keep every external component's license and source in the design brief.

## Resources

- `references/design-brief-template.md` — required output shape for a design task.
- `references/module-state-matrix.md` — eight-state and module-level contract.
- `references/reference-analysis.md` — reference-image and site analysis method.
- `references/tool-adoption-matrix.md` — article tool inventory and adoption stance.
- `references/review-checklist.md` — pre-delivery review checklist.
