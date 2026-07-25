# G0-RS6 Visual and Product Acceptance

Date: 2026-07-25

Scope: `G0-RS6 / UI-104`

Fixture: `scripts/g0-rs6-visual-seed.cjs` with isolated SQLite, workspace and managed Git repository.

## Product flow

The real loopback R Server and renderer completed this state sequence:

1. baseline `v1` current, candidate `v2` in `preview_ready`;
2. adopt candidate: `v2` became current;
3. revert adopted ChangeSet: current returned to `v1`;
4. restore historical candidate: a new commit, ChangeSet and `v3` Revision became current;
5. repeat the same restore: idempotently returned the same `v3`;
6. immutable Revision Artifact download returned HTTP 200 after containment and SHA-256 verification.

No step rewrote an old Revision. The formal execution truth remained `run_tool → tool_job → artifact truth`.

## Renderer matrix

| Surface | State | Result |
|---|---|---|
| light theme | compact current/adopted summary | pass |
| light theme | SVG before/after, JSON and text diff, history | pass |
| dark theme | compact current/adopted summary and result navigation | pass |
| 820×900 | compact actions and expanded comparison | pass |
| 820×900 | page horizontal overflow | pass: `innerWidth=clientWidth=scrollWidth=820` |
| progressive disclosure | ordinary result meaning first, Git details collapsed | pass |

The expanded 820px state showed both SVG revisions, parameter/structure changes, text patch, `v1/v2/v3` history and “restore as new version”. Long identifiers were ellipsized in the main layer and remained available through detail/title or the advanced Git disclosure.

## Honest exclusions

- UI-102 remains `in_progress`: this matrix does not prove large-table selection durability, restart recovery or positional-ID caveats.
- UI-103 remains `in_progress`: this matrix does not prove a real long-running edit through failure/cancellation and history reopen.
- RS7 plugin-specific adapters and golden scientific fixtures were not implemented in RS6.
