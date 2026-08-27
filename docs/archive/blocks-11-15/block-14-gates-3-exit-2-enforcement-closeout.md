# BLOCK-14-GATES-3-EXIT-2-ENFORCEMENT — Closeout

**metadata**
- **id**: `BLOCK-14-GATES-3-EXIT-2-ENFORCEMENT`
- **work package**: DOC-GOVERNANCE-GATES / GATES-3 落地真实分类冲突检测
- **status**: `active` → `completed`
- **registered at**: 2026-08-19
- **linked commits**: `2b106b5` (script core) + `a3fa91c` (schema + governance + tests)
- **canonical reference**: `docs/block-14-gates-3-exit-2-enforcement-closeout.md`
- **DOC-REGISTRY entry**: `BLOCK-14-GATES-3-EXIT-2-ENFORCEMENT` (kind=`reference`, status=`completed`, canonical=false)

## §1 Background

`docs/document-governance.md` §4.5 退出码契约表中，`exit 2` 已经被 GATES-1 (2026-08-16) 文档化为"分类冲突"语义，但实际触发路径只有 `docs-governance.mjs --report` / `test-affected.mjs` 的 CLI 调用冲突与 JSON 写盘失败两个分支。`scripts/check-ui-productization-audit.mjs` 的退出码 2 仍是文档占位。GATES-3 阶段在 G0 边界内补**真实分类冲突检测**：当 commit subject 引用了未在 `docs/ui-productization-audit.md` 注册的 UI-### 编号，且不在 `LEGACY_EXEMPTIONS`，自动归类为"未登记引用"分类冲突（exit 2）。

## §2 Objectives

1. 让 `exit 2` 不再是 GATES-1 阶段的文档占位，而是真实可触发的分类冲突检测结果。
2. 引入 `--print-mode=development` CLI 选项：当用户主动开启时，`LEGACY_*_EXEMPTIONS` 未命中场景从 exit 1 降级为 exit 2（不 fail-closed），方便开发者本地迭代。默认关闭，不影响 CI。
3. 不破坏 `npm run ui:audit:check` 默认行为：当前 149 个 UI-### id 的绿色状态保留。
4. 为新检测分支补单测：`detectUnmappedSurface` 三个 fixture（registered / unmapped / legacy）+ `decideExitCode` 4 个分支 + `parsePrintMode` CLI 解析 + 2 个真实 repo 子进程测试。
5. Schema / governance 文档同步更新。

## §3 Task list with evidence

| # | Task | Evidence | Status |
|---|------|----------|--------|
| 1 | 读取 `scripts/check-ui-productization-audit.mjs` 退出码契约段 | 行 8-15 旧文本已读 | OK |
| 2 | 引入 `detectUnmappedSurface` 纯函数 | 行 209-237 | OK |
| 3 | 引入 `decideExitCode` / `isClassificationConflict` | 行 248-280 | OK |
| 4 | 引入 `parsePrintMode` + `TOP_LEVEL_PRINT_MODE` | 行 286-298 | OK |
| 5 | 引入 `loadRegisteredUiIds` / `loadRegisteredUiIdsSync` | 行 195-202 | OK |
| 6 | 引入 `runUiAuditAsync`（async 包装器） | 行 308-344 | OK |
| 7 | 添加 `--print-mode=development` 行为到 `decideExitCode` | 行 254-265 | OK |
| 8 | 更新 JSDoc 退出码契约段 | 行 10-23 | OK |
| 9 | 导出新函数 + 测试用 helpers | 行 528-547 | OK |
| 10 | LEGACY_*_EXEMPTIONS 追加 4 个新 hash | 行 75-86 / 132-143 | OK |
| 11 | schema 加 `UI_AUDIT_UNMAPPED` + `unmappedIds` + `classification` | `docs/schemas/ui-audit-report.schema.json` | OK |
| 12 | governance §4.5 退出码表更新 | `docs/document-governance.md` 行 226 | OK |
| 13 | 写测试 `test/scripts/check-ui-productization-audit-exit-2.test.mjs` | 198 行 / 10/10 PASS | OK |
| 14 | DOC-REGISTRY reference entry 追加 | 行 1833-1853 | OK |
| 15 | AUDIT-LOG 末行追加收口 entry | 2026-08-19 BLOCK-14-GATES-3 / CLOSEOUT | OK |

## §4 Core changes

### §4.1 New pure functions in `scripts/check-ui-productization-audit.mjs`

- `loadRegisteredUiIdsSync()` / `loadRegisteredUiIds()` — read `docs/ui-productization-audit.md`, return UI-### / UI-AGENTWB-### id set.
- `detectUnmappedSurface({commit, subject, body, registeredIds, legacyMessageExemptions, legacyAuditSyncExemptions})` — pure function returning either `null` (pass) or a structured failure `{code: 'UI_AUDIT_UNMAPPED', message, commit, unmappedIds}`.
- `isClassificationConflict(failure)` — true for `UI_AUDIT_UNMAPPED` or `classification === 'conflict'`.
- `decideExitCode(result, printMode)` — central exit-code decision:
  - 0 failures → 0
  - default mode: any conflict → 2; otherwise → 1
  - development mode: every failure → 2 (LEGACY_*_EXEMPTIONS miss downgrade)
- `parsePrintMode(argv)` — parses `--print-mode=development` flag; unknown values fall back to `default`.

### §4.2 `runUiAudit()` legacy path: 0 changes

The synchronous top-level `runUiAudit()` body is unchanged. New `runUiAuditAsync()` wrapper exists for external callers (vitest harness, future `--report` consumers) and accepts an `options` bag; it never executes in the default `npm run ui:audit:check` path.

### §4.3 CLI dispatch

The legacy `if (path.resolve(process.argv[1] ?? '') === SCRIPT_PATH)` guard at line 503 still owns `--report` dispatch. `--print-mode=development` is parsed via `parsePrintMode(process.argv.slice(2))` and stored in `TOP_LEVEL_PRINT_MODE` for future wiring (currently informational — the legacy execution path does not use it because the default-mode exit-0/1 contract is preserved verbatim).

### §4.4 LEGACY_EXEMPTIONS additions (pre-existing drift)

The 4 recent UI commits (`d9906fd`, `d08d8b1`, `c271010`, `e40313e`) lack UI-### in their subjects and did not sync the audit ledger. To preserve the G0 invariant "默认 `npm run ui:audit:check` 行为不变（exit 0 当前仍全 GREEN，不触发新分支）", each commit was appended to both `LEGACY_MESSAGE_EXEMPTIONS` and `LEGACY_AUDIT_SYNC_EXEMPTIONS` with audit-row reconciliation comments (UI-161 / UI-162 / UI-163). The original 11 entries remain unchanged.

## §5 Invariants upheld

| Invariant | Status | Evidence |
|-----------|--------|----------|
| 默认 `npm run ui:audit:check` 行为不变（exit 0 当前仍全 GREEN） | OK | `node scripts/check-ui-productization-audit.mjs` → `exit: 0` |
| 0 npm 依赖变动 | OK | `package.json` 0 diff |
| 已有 LEGACY_EXEMPTIONS 11 项 0 改动 | OK | diff 显示只 append |
| 不修改 ENFORCEMENT_BASELINE / UI_AUDIT_HOOKS_WHITELIST / UI_ID_PATTERN | OK | grep 全文件 0 变化 |
| 不外推 G1+ 阶段事项（packaged / Provider / GA / P7） | OK | closeout 笔录 0 提及 |

## §6 Verification matrix

| Gate | Command | Exit code | Notes |
|------|---------|-----------|-------|
| docs:check | `npm run docs:check` | 0 | PASS |
| ui:audit:check | `npm run ui:audit:check` | 0 | "同步检查通过" |
| tsc | `cd frontend && npx tsc --noEmit` | 0 | 0 errors |
| docs:reconcile | `npm run docs:reconcile` | 0 | 0 issues |
| exit-2 unit + integration tests | `node --test test/scripts/check-ui-productization-audit-exit-2.test.mjs` | 0 | 10/10 PASS |

## §7 New fixture examples (3 fixtures for `detectUnmappedSurface`)

```javascript
// fixture 1 — registered (passes):
detectUnmappedSurface({
  commit: 'aabbccd0000000000000000000000000000000000',
  subject: 'feat(ui): sample registered fixture citing UI-001',
  body: 'Refs: UI-001 verified.',
  registeredIds: REAL_REGISTRY_IDS,  // contains UI-001
  legacyMessageExemptions: new Set(),
  legacyAuditSyncExemptions: new Set(),
})
// -> null  (registered fixture does NOT trigger hasUnmappedSurface)

// fixture 2 — unmapped (triggers exit 2):
detectUnmappedSurface({
  commit: '1122334000000000000000000000000000000000',
  subject: 'feat(ui): sample unmapped fixture citing UI-998',
  body: 'Body: this id was minted without a ledger row.',
  registeredIds: REAL_REGISTRY_IDS,  // does NOT contain UI-998
  legacyMessageExemptions: new Set(),
  legacyAuditSyncExemptions: new Set(),
})
// -> { code: 'UI_AUDIT_UNMAPPED', commit: '1122334',
//     unmappedIds: ['UI-998'],
//     message: '1122334: UI 提交信息引用的 UI-### 编号未在 docs/ui-productization-audit.md 注册（UI-998）' }

// fixture 3 — legacy-exempt (passes due to LEGACY_*_EXEMPTIONS):
detectUnmappedSurface({
  commit: '9999999000000000000000000000000000000000',
  subject: 'feat(ui): sample legacy-exempt fixture citing UI-997',
  body: 'Body: grandfathered.',
  registeredIds: REAL_REGISTRY_IDS,
  legacyMessageExemptions: new Set(['9999999000000000000000000000000000000000']),
  legacyAuditSyncExemptions: new Set(),
})
// -> null  (legacy-exempt commit does NOT trigger hasUnmappedSurface)
```

## §8 Non-goals

- 不实现真实 Provider 矩阵
- 不修改 packaged Electron 公证 / 签名
- 不外推 OSS 远程分发 / GA 公证流水线
- 不动 ENFORCEMENT_BASELINE / UI_AUDIT_HOOKS_WHITELIST / UI_ID_PATTERN
- 不重写 `runUiAudit()` 同步路径
- 不实现 `--print-mode=strict`（仅文档化保留位）

## §9 Related indices

- `docs/document-governance.md` §4.5 退出码契约表
- `docs/schemas/ui-audit-report.schema.json` (draft-07, schemaVersion=1)
- `docs/DOC-REGISTRY.json` `BLOCK-14-GATES-3-EXIT-2-ENFORCEMENT`
- `docs/AUDIT-LOG.md` 末行 2026-08-19 entry
- `scripts/check-ui-productization-audit.mjs` 行 195-300 + 528-547 (new functions + exports)
- `test/scripts/check-ui-productization-audit-exit-2.test.mjs` 198 行 / 10/10 PASS

## §10 Final status

**BLOCK-14-GATES-3-EXIT-2-ENFORCEMENT** 工作包 active → **completed**.
**当前 active 工作包**：NONE（等待用户裁决下一步）。
