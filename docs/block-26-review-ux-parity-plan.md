# BLOCK-26 Review UX Parity & Full Target Coverage Plan

## 1 Background — Codex review UX, confirmed from source

In-repo Codex (openai/codex checkout) delivers the review experience through:

1. **Preset menu** (`tui/src/chatwidget/review_popups.rs`): `/review` opens a
   4-item selection view — "Review against a base branch (PR Style)" /
   "Review uncommitted changes" / "Review a commit" / "Custom review
   instructions".
2. **Searchable pickers**: base-branch picker lists local branches as
   `current -> target` with type-to-search; commit picker lists the recent
   100 commits searchable by subject+sha; custom opens a text prompt.
3. **Transcript rendering**: `EnteredReviewMode` / `ExitedReviewMode` items
   ("review started/finished: <hint>"); findings render as a formatted
   assistant block ("Review comment:" / "Full review comments:", `- Title —
   path:start-end` + indented body) — TUI presentation is deliberately plain.
4. **Protocol semantics for richer clients**: `ReviewOutputEvent` +
   `format_review_findings_block(findings, selection)` — the checkbox
   selection variant exists so IDE clients can present per-finding selection
   and hand selected findings back as a fix request; the rubric states
   findings are presented as **inline comments** next to the diff.

The VS Code extension itself is a separate repository (not in this
checkout), so BLOCK-26 targets its *semantic* contract (inline comments,
per-finding selection/fix) realized with desktop-app patterns.

## 2 Problem — current WTR review surface (user verdict: 不好用 / 呈现差 / 交互弱)

- Findings live in a cramped 46% strip; bodies always fully expanded; no
  grouping; no severity-first ordering cues beyond a colored chip.
- Findings are disconnected from the diff: no inline annotation on the code
  lines, no gutter markers; the list and the diff fight for the same
  vertical space.
- No summary header (verdict is one line among others), no counts, no
  duration/model coverage, no elapsed time while running, tool activity is a
  single status string.
- Targets: only uncommitted changes; model channel resets every open;
  results vanish when the drawer closes (no detached/reconnect).

## 3 Scope

### In scope

- **UX overhaul (P1)**: review summary header (verdict banner, severity
  counts, elapsed time, channel); findings grouped by file with collapsible
  bodies; severity-ordered; keyboard-free click interactions kept simple;
  **inline diff annotations** — a readonly CodeMirror extension rendering
  gutter severity markers + collapsible finding cards on the finding lines,
  two-way highlighted with the list; live activity feed (tool events +
  elapsed timer) during a run; polished empty/error states with retry.
- **Targets (P2)**: base-branch and commit pickers in the panel — branches
  from the existing `branch:list` IPC, recent commits from a new focused IPC
  `git:recent-commits` (limit 100); custom-instructions entry.
- **Model persistence (P2)**: last-used review channel persisted per
  workspace (localStorage).
- **Detached results (P3)**: last review outcome per project survives drawer
  close/reopen (module-level store keyed by projectId); a running task can
  be re-attached by taskId via the existing SSE replay.
- dev Electron acceptance (P4) + ledgers.

### Out of scope

- Write-side automation, auto-apply suggestions, PR comment surfaces,
  multi-reviewer/detached parallel review UI beyond result restore.
- Provider matrices / packaged / GA / P7.

## 4 Acceptance gates

- Focused vitest for the new panel/extension; tsc --noEmit 0; node --check
  for the new IPC; review backend tests stay 21/21.
- docs:check / ui:audit:check / docs:reconcile clean at closeout.
- dev Electron evidence: inline annotations visible on the diff next to the
  list; grouped findings; verdict header; base-branch and commit flows
  launched from the pickers; channel persistence across drawer reopen;
  evidence JSON + screenshots bound to the implementation commit
  (`acceptance/ui-203/`).

## 5 Completion semantics

BLOCK-26 completes when the review surface presents as first-class code
review (summary header, grouped findings, inline diff annotations, activity
feed), all four ReviewTargets are reachable from the UI, the channel choice
persists, and results survive a drawer close/reopen — all dev-Electron
evidenced.
G0 开发期常态 · 不外推 packaged/Provider/GA。
