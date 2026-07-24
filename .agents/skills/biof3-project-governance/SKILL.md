---
name: biof3-project-governance
description: Govern BioF3 plans, Goals, work packages, canonical documentation, handoffs, audits, stage closeout, archival, and Git worktrees. Use when Codex creates or changes a plan, completes a task or phase, updates roadmap or handoff state, reconciles documentation, archives or supersedes files, creates or removes a worktree, or is about to claim that a BioF3 work package is complete.
---

# BioF3 Project Governance

Keep one recoverable project truth while preserving code, evidence, user work, and active Agent work.

## Load the governing context

1. Read `docs/AUDIT-LOG.md` before mainline work and handle red blockers or green merge items first.
2. Inspect `git status --short --branch`, recent commits, and `git worktree list`; do not overwrite unknown work in progress.
3. Read `docs/document-governance.md` and `docs/DOC-REGISTRY.json`.
4. Read `docs/worktree-governance.md` before creating, reusing, merging, pruning, or removing a worktree.
5. Read only the canonical roadmap, handoff, audit, and work-package documents relevant to the task. Do not use `docs/archive/` to determine current state.

## Route the work

### Start or change a work package

- Reuse an existing Plan ID when the scope is an increment of that package.
- Create a new stable ID only for a distinct responsibility and acceptance boundary.
- Register every new governed Markdown file in `docs/DOC-REGISTRY.json` and add a discoverable entrypoint.
- Record scope, exclusions, dependencies, evidence locations, acceptance gates, and completion semantics in the canonical plan.
- Update the canonical roadmap or handoff only when current priority or recoverable state actually changes.
- Reject a second active canonical document for the same `truthDomain`.

### Continue active work

- Reconcile the task against Git, runtime, database, Artifact, and acceptance evidence before trusting prose status.
- Update the existing canonical plan instead of creating a progress-note document.
- Preserve unrelated WIP and avoid broad document moves while another work package is active.
- Keep acceptance evidence separate from explanatory documentation.

### Close a Goal or stage

1. Verify every declared acceptance gate with current evidence.
2. Update the work package, canonical roadmap, handoff, audit ledger, and UI audit when each is in scope.
3. Change the registry status to `completed`, `reference`, or `superseded`; never infer completion from age or a final chat response.
4. Run `npm run docs:reconcile` and review every candidate.
5. Run `npm run docs:check`; do not claim completion while it fails.
6. Report evidence, remaining exceptions, deferred archival, and preserved WIP.

### Archive or supersede documentation

- Archive only an explicitly named document or Plan ID after checking inbound references and acceptance dependencies.
- Do not move or delete acceptance evidence as ordinary documentation.
- Preserve Git history; use a normal move in a focused, recoverable change.
- Do not bulk-archive while the workspace contains unknown WIP.
- Mark a replacement with `supersedes`, update all canonical entrypoints, and keep the old document discoverable as `superseded` until safe archival.
- Treat `npm run docs:reconcile` as advice. It never authorizes automatic deletion or movement.

### Use worktrees

- Obey the current LF12 barrier and `G0-RS-WT0` readiness gate in `docs/worktree-governance.md`.
- Create a worktree from a verified, committed checkpoint; map one worktree to one branch, Agent owner, and bounded work package.
- Isolate runtime ports, Electron `userData`, SQLite, results, uploads, temporary files, and logs.
- Merge through Git commits or a reviewed patch flow; never copy directories to combine work.
- Stop parallel work when file ownership overlaps or a canonical contract changes underneath another worktree.
- Remove a worktree only after commit/snapshot, merge or explicit preservation, clean-status, and Artifact/ChangeSet checks.

## Run the deterministic controls

- `npm run docs:status`: show registry coverage and current classification.
- `npm run docs:check`: enforce registry schema, paths, canonical truth uniqueness, entrypoints, and managed Markdown coverage.
- `npm run docs:reconcile`: list unregistered, orphaned, archival, and retained-reference candidates without moving files.

Run the narrowest relevant project tests as well. Documentation gates complement code, scientific, UI, Provider, packaged-app, and acceptance gates; they never replace them.

## Guardrails

- Never modify, stage, discard, commit, or archive unknown user or Agent WIP.
- Never let documentation upgrade a runtime or scientific result beyond its evidence.
- Never create a second executor, Job, Artifact, Workflow, Loop, project state, or UI truth to simplify governance.
- Never use document age alone as an archival signal.
- Never declare `completed`, `qualified`, `verified`, or `maintained` without the corresponding contract evidence.
- Block and reconcile if canonical documents disagree about the current phase, next work, or acceptance status.

## Hand off clearly

State the Plan IDs and registry entries changed, commands run, acceptance outcome, unresolved candidates, worktree/branch ownership, and any WIP deliberately left untouched.
