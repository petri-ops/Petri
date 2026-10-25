---
name: petri-project-governance
description: Govern Petri (格物, formerly Petri) plans, Goals, work packages, canonical documentation, handoffs, audits, validation scope, stage closeout, archival, and Git worktrees. Use when an agent creates or changes a plan, chooses tests or acceptance gates, completes a task or phase, updates roadmap or handoff state, reconciles documentation, archives or supersedes files, creates or removes a worktree, decides whether new work on existing code should be a patch or a refactor, or is about to claim that a Petri work package is complete.
---

# Petri Project Governance（格物项目治理）

Keep one recoverable project truth while preserving code, evidence, user work, and active Agent work.

Reference files in this folder (operational detail; this file stays the entry point):

- `references/WORK-PACKAGE-LAUNCH-CHECKLIST.md` — run at launch; any unchecked box means not ready (or an explicit, recorded user waiver).
- `references/STAGE-CLOSEOUT-CHECKLIST.md` — run at every stage/Goal close, in order.
- `references/NEXT-STEP-BRIEF.md` — mandatory delivery format after every task: one Jev recommendation with confidence and concrete scope, master-plan wave order, and blueprint/global-plan progress (母纲 Q-MATRIX / 竞争力纲 / Result Studio / UI 台账 / active package).
- `references/AUDIT-LOG-ENTRY-TEMPLATE.md` — required shape of launch/closeout/audit ledger entries.
- `references/POSTMORTEM-TEMPLATE.md` — run after any incident; every postmortem must land its lesson somewhere.
- `references/DEPENDENCY-CHANGE-CHECKLIST.md` — run before proposing any new dependency; default answer is "no".
- `references/TASK-FORM-TAXONOMY.md` — classify a piece of work into the right form (BLOCK / UI / lightweight / special / batch / reconciliation…) before registering it; routing questions, BLOCK-vs-UI track criteria, the open pattern library, form-migration rules, and a porting checklist (§6) for transplanting the taxonomy to another host repo.

## Load the governing context

1. Read `docs/AUDIT-LOG.md` before mainline work and handle red blockers or green merge items first.
2. Inspect `git status --short --branch`, recent commits, and `git worktree list`; do not overwrite unknown work in progress.
3. Read `docs/document-governance.md` and `docs/DOC-REGISTRY.json`.
4. Read `docs/worktree-governance.md` before creating, reusing, merging, pruning, or removing a worktree.
5. Read only the canonical roadmap, handoff, audit, and work-package documents relevant to the task. Do not use `docs/archive/` to determine current state.

## Route the work

### Start or change a work package

Classify the work form first per `references/TASK-FORM-TAXONOMY.md` (three routing questions → main track BLOCK/UI or an auxiliary form); register it in the matching ledger with that form's anchor. For BLOCK forms, run `references/WORK-PACKAGE-LAUNCH-CHECKLIST.md` end to end, then:

- Reuse an existing Plan ID when the scope is an increment of that package.
- Create a new stable ID only for a distinct responsibility and acceptance boundary.
- Register every new governed Markdown file in `docs/DOC-REGISTRY.json` and add a discoverable entrypoint.
- Record scope, exclusions, dependencies, evidence locations, acceptance gates, and completion semantics in the canonical plan.
- Update the canonical roadmap or handoff only when current priority or recoverable state actually changes.
- Reject a second active canonical document for the same `truthDomain`.

### Judge patch vs. refactor before changing existing code

When a new requirement lands on code that already exists, decide explicitly — **before** writing either kind of change — whether it stays a patch or calls for a refactor from a higher-level view. The judgment is part of the plan, not an afterthought. Signals that another patch would stack rot instead of adding function:

- The same spot would receive its second or later layered fix: condition on condition, flag on flag, a special case wrapped around an earlier special case.
- The change needs a second variant of an existing concept (parallel code path, near-duplicate helper, per-caller workaround) instead of generalizing the original.
- The patch has to bypass or reach around an existing abstraction, or duplicate knowledge the code already owns elsewhere.

No signal: patch it, keep it local, and say so in the canonical plan. Any signal: stop and plan a scoped refactor that absorbs the accumulated cases into one structure — when that grows the work package's scope, get a user ruling first, and record the decision in the canonical plan either way. A refactor ships only with a behavioral baseline: focused tests green before, the same tests green after (BLOCK-92's 拆前基线拆后对账 precedent). Purity means fewer structures, not newer ones — never refactor a healthy spot just to showcase architecture.

### Continue active work

- Reconcile the task against Git, runtime, database, Artifact, and acceptance evidence before trusting prose status.
- Update the existing canonical plan instead of creating a progress-note document.
- Preserve unrelated WIP and avoid broad document moves while another work package is active.
- Keep acceptance evidence separate from explanatory documentation.
- Proposing a new dependency? Run `references/DEPENDENCY-CHANGE-CHECKLIST.md` first; the default answer is "no" and additions need a recorded user ruling.

### Convert recurring defects into gates

- When the same defect class appears a second time — as a commit fix, a review finding, or a live-acceptance catch — convert it into a mechanical gate entry: a targeted test, a harness check, or a `dev-verify` flow. Record the mapping inside the gate itself so the lesson survives agent turnover.
- Reference precedents: the non-main-window chrome-controls regression (commit `6ab3650b`) belongs in window-system live checks; leftover temp files and dead symlinks belong to `npm run hygiene:check`.
- Do not solidify one-off incidents or current-state facts into gates. Gates encode process and criteria only; state lives exclusively in canonical documents.
- Any incident (live-acceptance catch, production regression, environment accident, user-data mishap) gets a postmortem per `references/POSTMORTEM-TEMPLATE.md`; every postmortem must land its lesson (environment discipline, checklist item, or gate) — "recorded only" is not an outcome.

### Close a Goal or stage

Run `references/STAGE-CLOSEOUT-CHECKLIST.md` in order and write ledger entries per `references/AUDIT-LOG-ENTRY-TEMPLATE.md`, then:

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
- README 编号条目按月滚动（2026-10-13 用户裁决「每次只读取近期有效内容 按需索引更多」）：`docs/README.md` 只承载当月条目；跨月条目经 `npm run docs:roll-index`（`--check` 预览）机械迁入 `docs/doc-index-YYYY-MM.md`（搬移不改写零删除），迁出文档的 DOC-REGISTRY `entrypoint` 由脚本按链接实际在场改指（含嵌在宿主条目描述文本内的嵌链），新索引自动注册。行为以脚本与其测试（test/docs-roll-index.test.mjs）为准，不做手工迁移复刻；`docs/README.md`「## 维护规则」区条款与 skill 本条为同一规则的 README 侧表述。

### Use worktrees

- Obey the current LF12 barrier and `G0-RS-WT0` readiness gate in `docs/worktree-governance.md`.
- Create a worktree from a verified, committed checkpoint; map one worktree to one branch, Agent owner, and bounded work package.
- Isolate runtime ports, Electron `userData`, SQLite, results, uploads, temporary files, and logs.
- Merge through Git commits or a reviewed patch flow; never copy directories to combine work.
- Stop parallel work when file ownership overlaps or a canonical contract changes underneath another worktree.
- Remove a worktree only after commit/snapshot, merge or explicit preservation, clean-status, and Artifact/ChangeSet checks.

## Run the deterministic controls

- `npm run state`: aggregate recoverable state (branch/WIP, unresolved audit items, active work packages); presentation layer, not a second truth source.
- `npm run closeout`: aggregate hygiene → docs:check → ui:audit:check → test:changed with fail-fast; attach work-package gates with `--gate`. A green closeout is necessary but never sufficient — canonical write-backs below still apply.
- `npm run docs:status`: show registry coverage and current classification.
- `npm run docs:check`: enforce registry schema, paths, canonical truth uniqueness, entrypoints, and managed Markdown coverage.
- `npm run docs:reconcile`: list unregistered, orphaned, archival, and retained-reference candidates without moving files.

## Scope & independence

- All rules, criteria, checklists, and templates this skill needs are inside this folder — execution requires no external knowledge file.
- The `docs/` files named above (AUDIT-LOG, DOC-REGISTRY, document-governance, worktree-governance, roadmap, handoff) are the host repo's **operating data** this process reads and updates. They are declared touchpoints, not dependencies on external knowledge: in a host without them, create them at the listed paths (bootstrap) rather than copying them here — copying would create a second source of truth.
- Mechanical tooling (bundled scripts, dev-verify flows, product-Skill scaffold, delegation template) lives in the sibling `$petri-dev-infra` skill when present; every step of this skill remains executable as written without it.

## Choose the smallest sufficient validation scope

- During implementation, run only tests and static checks that cover the changed module, contract, or observed failure. Do not run `npm test`, `npm run check`, Provider matrices, packaged-app checks, visual matrices, or soak tests after every edit.
- Before a focused commit, run affected tests plus the directly relevant TypeScript, syntax, UI-audit, or documentation gate. Documentation-only changes normally need documentation/UI gates, not unrelated scientific or runtime suites.
- At a Goal or P-stage close, run each declared full-project gate at most once after focused checks are green and the source tree is stable. Run heavyweight root gates serially; never run `npm test` and `npm run check` concurrently on the same workspace.
- Reserve Provider, packaged-app, plugin-platform, restart, long-task, performance, and soak matrices for the stage that owns that evidence or for final qualification/release. **The project is permanently in G0 development stage (see `AGENTS.md` §"当前阶段纪律")** — during G0 these matrices are not run as part of routine validation; they belong to G1+. Do not repeat them in an earlier stage without a relevant contract change or reproduced failure.
- **`qualificationEligible: false` is a permanent G0 fact**, not a regression. Do not flag it as a pending item, do not propose release/Provider/GA work in closeout notes, and do not write "maintain false / keep false / pending Provider" copy in closeout reports, AUDIT-LOG entries, or UI-audit ledger. Use the neutral phrasing "G0 开发期常态 · 不外推 packaged/Provider/GA" exactly once per closeout.
- Reuse a current last-green result only when its exact source/dependency digest still matches and the evidence belongs to the same worktree, platform, and gate contract. Any relevant source, test, environment, or contract change invalidates that reuse.
- Re-run a full gate only when it failed for a product reason, relevant code changed after the run, its evidence expired, or the governing plan explicitly requires a fresh run. Isolate and re-run a timeout or environment failure narrowly before deciding that the product is broken.
- Never replace a required acceptance class with a smaller test, and never report an unrun, skipped, deferred, or reused gate as freshly passed. Record its real evidence status.

Documentation gates complement code, scientific, UI, Provider, packaged-app, and acceptance gates; they never replace them. The objective is sufficient evidence with minimum redundant execution, not maximum test volume.

## Guardrails

- Never modify, stage, discard, commit, or archive unknown user or Agent WIP.
- Never let documentation upgrade a runtime or scientific result beyond its evidence.
- Never create a second executor, Job, Artifact, Workflow, Loop, project state, or UI truth to simplify governance.
- Never use document age alone as an archival signal.
- Never declare `completed`, `qualified`, `verified`, or `maintained` without the corresponding contract evidence.
- Block and reconcile if canonical documents disagree about the current phase, next work, or acceptance status.

## Hand off clearly

State the Plan IDs and registry entries changed, commands run, acceptance outcome, unresolved candidates, worktree/branch ownership, and any WIP deliberately left untouched.

**下一步建议唯一化（用户裁决 2026-10-24）**：收口/交接给"下一个工作包"建议时，**必须先跑一次 Jev 决策，并且只给一个建议**——不得输出"Q7 或 §6.5 继续""A / B 二选一""以下候选供你选"这类多选：

```
npm run next:suggest -- --context "<本包收口摘要 + 当前队列/未收口缺口>" \
  --candidates "Q7|Q4b|Q5-REM|Q6-REM|Q8-REM|Q9-REM|P4-REM"
```

- 取脚本返回的**单个** `suggestion` 作为唯一建议，并附 Jev confidence；Jev 不可用（`reason=jev_unavailable:*`）时按候选**首个**兜底，如实标注"Jev 不可用，按队列序默认"——仍然只给一个。
- 候选集应来自母纲 §6.5 / backlog 的**真实可开工项**（含当前未收口缺口）；单列大包（如 Q4b）可以进候选，但建议落地前需用户显式发令。
- 本规则只约束"建议形态"，不改变"新包开工需用户发令"的治理纪律；advice-only，不设门禁、不写决策阈值。
- **固定输出形态（用户裁决 2026-10-25，每次任务完成都适用）**：按 [`references/NEXT-STEP-BRIEF.md`](./references/NEXT-STEP-BRIEF.md) 交付——①单条 Jev 建议（含 confidence、具体范围、体量/类型）；②母纲波次顺序（P4-REM 最后、Q4b 单列）；③蓝图/全局计划进展（母纲 Q-MATRIX 计数与 §6.5 剩余、竞争力纲/成熟度蓝图、Result Studio、UI 台账、active 工作包）。不存在的计划写「不适用」；纯问答至少给一行「队列未变」。不得只写代号、不得多选、不得列 G1+。

