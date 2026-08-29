# BLOCK-25 Codex-Parity AI Code Review Plan

## 1 Scope

Bring the OpenAI Codex `/review` experience to BioF3 Desktop, reusing the
local checkout at `desktop/codex/` (openai/codex) as the reference
implementation, on top of the existing BLOCK-20 diff IPC + BLOCK-22/23
CodeMirror diff view + UI-140 sub-agent runtime.

### Reference architecture (confirmed from codex-rs source)

- Entry: `ReviewTarget` — `UncommittedChanges` / `BaseBranch{branch}` /
  `Commit{sha,title}` / `Custom{instructions}`
  (`codex-rs/protocol/src/protocol.rs:3291`).
- Prompt: target-specific user prompt with precomputed merge-base SHA
  (`codex-rs/prompts/src/review_request.rs`) plus a rubric system prompt
  (`codex-rs/prompts/templates/review/rubric.md`): bug-worthiness rules,
  `[P0]-[P3]` priority tagging, one-paragraph findings, `suggestion` block
  discipline, AGENTS.md rule attribution, strict JSON output schema.
- Execution: a dedicated one-shot review sub-session (own review model,
  approval policy `Never`, web search / collab disabled); the reviewer runs
  read-only git commands itself (`codex-rs/core/src/tasks/review.rs`).
- Output: `ReviewOutputEvent { findings[], overall_correctness,
  overall_explanation, overall_confidence_score }`; each `ReviewFinding`
  carries `title, body, confidence_score, priority, code_location{file,
  line_range}`; parsing is robust (full JSON → first `{...}` slice →
  plain-text fallback into `overall_explanation`).
- Presentation: findings rendered as `Title — path:start-end` with indented
  body; a checkbox-selection variant (`review_format.rs`) feeds selected
  findings back to the main agent as a fix request; the review output is
  persisted into conversation history.

### In scope

- `ReviewTarget` protocol + TS types + IPC to launch a review sub-task over
  the workspace repo (default: uncommitted changes; base-branch optional).
- Read-only review sub-agent runner on the existing agent task mode
  (tool allowlist limited to read-only git/shell inspection; no write tools;
  no approval prompts), with the rubric system prompt adapted from Codex.
- Structured findings parsing with the same three-level fallback.
- Working Tree Review drawer UI: "AI 审阅" entry → findings list (priority
  badge, `file:line`, confidence, one-paragraph body) → click finding
  scrolls the CodeMirror diff to the target line (the pending-scroll
  consumer UI-194 lacked) → checkbox selection → "修复选中项" hands the
  selected findings to the main chat as a follow-up request.
- dev Electron evidence for the full loop.

### Out of scope

- Any write-side automation (review never edits files; fixes are explicit
  user-approved main-agent turns).
- Detached/parallel review sessions beyond the existing sub-agent
  concurrency rules; review model configuration UI (uses current channel
  model first).
- Guardian/auto-review, `suggestion` auto-apply, PR comment surfaces.
- Provider matrices / packaged / GA / P7.

## 2 Dependency boundary

- Consumes BLOCK-24 evidence: UI-193 (widget not on business path) and
  UI-194 (pending-scroll consumer unmounted) stay as recorded; this package
  provides the missing consumer for the finding→diff-line jump only. Wiring
  the BLOCK-22 accept/reject widget remains a separate decision unless the
  findings jump naturally lands on it.
- Reuses BLOCK-20 git IPC and UI-140 sub-agent runtime; 0 new MCP tools;
  IPC additions limited to the review launch/status channels.

## 3 Execution phases

1. **P0 — Registration**: this plan, DOC-REGISTRY active entry, README
   entrypoint, AUDIT-LOG launch row.
2. **P1 — Protocol + runner**: ReviewTarget types, review launch IPC,
   read-only sub-agent task with rubric prompt, robust output parsing +
   focused tests.
3. **P2 — Drawer UI**: findings list in Working Tree Review, priority
   badges, finding→diff-line jump, selection + "修复选中项" hand-off to
   chat.
4. **P3 — dev Electron acceptance**: real workspace diff, real review run
   against the configured development channel, DOM/screenshot evidence in
   `acceptance/ui-2xx/`.
5. **P4 — Closeout**: ledgers (roadmap / handoff / AUDIT-LOG / DOC-REGISTRY
   / ui-audit), gates.

## 4 Acceptance gates

- Focused vitest for protocol, parser, and new UI components; `tsc
  --noEmit` 0 errors; `node --check` for touched backend files.
- `npm run docs:check`, `npm run ui:audit:check`, `npm run docs:reconcile`
  PASS at closeout.
- dev Electron evidence: findings render on a real diff, finding click
  scrolls the CodeMirror diff to the finding's line, selection hands off to
  chat; evidence JSON + screenshots bound to the implementation commit.
- The review sub-task must be observable as read-only (no write tool calls
  recorded).

## 5 Completion semantics

BLOCK-25 completes when the Codex-parity review loop (target → read-only
review sub-agent → structured findings → drawer UI → jump/fix hand-off) is
implemented, unit-verified, and dev-Electron evidenced, with ledgers synced
and the review flow honest about its model-dependence (no findings when no
channel is configured is an acceptable, surfaced state).
G0 开发期常态 · 不外推 packaged/Provider/GA。

## 6 Closeout record (2026-08-29)

- P1 `0ca7e59`: review sub-agent backend (prompts / read-only git boundary /
  parser-sanitizer / bounded runner) + route `POST /api/agent/review` on the
  shared agent task store (0 new MCP tools, existing SSE + cancel reused);
  focused tests 21/21.
- P2 `c3b91fd` + `b4c1b9a`: findings panel (priority badges, verdict, jump,
  checkboxes, 修复选中项), EditorApi exposure, task-failure honesty (error
  events map to the panel instead of rendering as zero findings), and a
  review channel picker defaulting to the composer's active preset.
- Acceptance-hardening fixes `ba02c12` (six squashed): streamed final text,
  transient-transport retry, convergence nudge + tool observability,
  absolute-path file reads + workspace root in prompt, and diff embedding —
  the decisive one: models left to discover the diff themselves wandered the
  repository until the budget expired.
- Separate defect fixed under this package `c228beb`: WTR diff covered
  unstaged changes only, so staged-only edits rendered an empty diff panel
  forever (`git diff` → `git diff HEAD`).
- P3 `c09a96a` evidence: dev Electron, DeepSeek channel, real review of a
  scratch fixture with three planted bugs — 3/3 findings caught
  (P1 hardcoded key, P1 off-by-one NaN, P2 eval RCE) with accurate line
  ranges, verdict "patch is incorrect", cross-file and same-file finding
  jumps with pulse, fix hand-off delivered to chat. Evidence:
  `acceptance/ui-202/electron-codex-parity-review-dev.json` + screenshot.
  Ledger: UI-202 verified (dev Electron boundary).
- Gates: review tests 21/21, WTR vitest 8/8, tsc --noEmit 0,
  docs:check / ui:audit:check / docs:reconcile clean at closeout.
- Follow-up candidates (not started): base-branch / commit review targets
  in the picker, detached review sessions, review-model config persistence.
G0 开发期常态 · 不外推 packaged/Provider/GA。
