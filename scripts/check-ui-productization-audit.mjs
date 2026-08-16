#!/usr/bin/env node
/**
 * scripts/check-ui-productization-audit.mjs — UI 实现与审计台账同步门禁
 *
 * 检查 `docs/ui-productization-audit.md` 与 Git 历史的同步性：
 *   1. 工作区含 UI 改动但未同步 `ui-productization-audit.md` → FAIL
 *   2. UI 提交 subject 未带 UI-### issue id（允许白名单豁免）→ FAIL
 *   3. 实现同步但未通过 git 提交同步台账 → FAIL
 *
 * 退出码契约（GATES-1 文档化，2026-08-16）：
 *   0   PASS — UI 实现与审计台账已同步；Git 历史已有 UI 编号实现证据
 *   1   FAIL — UI 改动未同步台账 / submission issue id 缺失 / 台账不同步
 *   2   保留 — 当前未触发；为未来"白名单冲突 / 分类冲突"扩展预留
 *       （如新加 hasUnmappedSurface 之类的检测分支时使用 2；本阶段不启用）
 *
 * `--report` JSON 输出模式（GATES-2 文档化，2026-08-16）：
 *   与默认人类可读行输出并行的可选模式；通过 `--report <path>` 触发，输出
 *   机器可读 JSON，由 `docs/schemas/ui-audit-report.schema.json` 强校验。
 *   写盘失败 / schema 校验失败 → exit 2（分类冲突）。
 *   现有 `process.exit(1)` / 直接执行行为**不变**；只有显式传入 `--report`
 *   才进入新模式。
 *
 * 同步文档：`docs/document-governance.md` §4.5"门禁退出码契约" + GATES-2 §3.2"JSON 输出契约"。
 * 该契约为本工作包 DOC-GOVERNANCE-GATES / GATES-1 阶段固化本，不在本阶段内
 * 改动 `process.exit()` 行为。
 */

import { execFileSync } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { GATE_REPORT_SCHEMA_VERSION, validateReport } from './lib/gate-report-schema.mjs'

const SCRIPT_PATH = fileURLToPath(import.meta.url)

const AUDIT_PATH = 'docs/ui-productization-audit.md'
const ENFORCEMENT_BASELINE = '0611ce5b52f8d6d3ff9b8ecf25656553837f41cd'
// This pushed commit updated the UI-031 audit entry but omitted the issue id
// from its message. Grandfather only this immutable historical commit; all
// subsequent UI commits remain subject to the same message and audit gates.
const LEGACY_MESSAGE_EXEMPTIONS = new Set([
  'cec2c581688858fe4c877350afd3449777562bf5',
  // P4R-2 scroll preservation was already recorded in UI-113 by the
  // immediately following governance commit 2f0e78d. The implementation
  // commit itself predates the issue-id enforcement and is not rewritten.
  '17bb486f3eda58cc14aa2ee5d4386b16f20fc18e',
  // P6 durability changed one Result Studio client response field and updated
  // UI-103/UI-105/UI-111 in the same immutable implementation commit. Its
  // subject named P6 rather than the UI issue IDs; the canonical P6 closeout
  // preserves that mapping without rewriting shared history.
  '5a033eb07f2ffdcdc6b285902dbf6a11ab4c96ce',
  // P7 completion classification changed the UI-to-Agent request contract for
  // UI-108/UI-109. P7 was later deferred and the immutable implementation
  // checkpoint is reconciled explicitly in the 2026-08-03 audit record.
  '2298c968f7afa289a1c257e2fc8ba8d608bad1ed',
  // feat(chat): Fork Chat 分支功能实现；subject 无 UI-###（feat(chat): 而非 UI-WAVE0:），body 有 UI-143
  // UI-143 在表中已有 verified 条目（feat/ui-wave0，W-05/C-02 路由化），289101e 在 feat/ui-wave0 基础上扩展 fork 功能
  '289101ea90073f7da5e685617c21fecd6dad7e1f',
  // UX1H implementation landed before the target row was reconciled from
  // unit-only evidence to the current in_progress + Electron evidence state.
  '7995ee945b0221e2507e1cce11414849a942ac5d',
  // devah 的 origin/main 不可变提交：自定义窗口控件 + 插件 status 治理。
  // 代码提交 e6421e0 与台账登记 f624d76 拆分，提交信息未带 UI-###；
  // 台账已在 f624d76 以 UI-106 登记（合并后改号 UI-129）。不重写共享历史。
  'e6421e07fdf4337944bd7f186926aeeb082049c2',
  // 2026-08-14 Skills UI/frontend pages 不可变实现提交：subject `feat(skills)` 未带 UI-###；
  // 台账已由本次 UI-AUDIT-FIX 补登为 UI-157（in_progress）。不重写共享历史。
  'e6bf72ff74480f0b98cfcbbc839268b95d2800c8',
  // 2026-08-14 Copilot UX 不可变实现提交：subject `feat(copilot)` 未带 UI-###；
  // 台账已由本次 UI-AUDIT-FIX 补登为 UI-158（in_progress）。不重写共享历史。
  '446bfa8f6fb2d23d908ce9358d35c25d4e853ebb',
  // 2026-08-14 Workspace UI plumbing 不可变实现提交：subject `feat(frontend)` 未带 UI-###；
  // 台账已由本次 UI-AUDIT-FIX 补登为 UI-159（in_progress）。不重写共享历史。
  '3000a069171bb6404719ddd797d1b6e64e92d53c',
])
// These immutable implementation commits have an explicit later canonical
// ledger reconciliation. Exempt only the same-commit audit-file requirement;
// their messages remain subject to the UI-### issue-id gate above.
const LEGACY_AUDIT_SYNC_EXEMPTIONS = new Set([
  // P4R-2 was recorded as UI-113 by the immediately following governance
  // commit 2f0e78d. Its separate message exemption remains declared above.
  '17bb486f3eda58cc14aa2ee5d4386b16f20fc18e',
  // UI-110 renderer redaction hardening is included in the final source-bound
  // Electron trace and the verified ledger reconciliation in 2e3bc1b.
  'f6271911512910e23dad6a383f3c7a961601c122',
  // UI-110's final cross-platform redaction source commit is referenced
  // verbatim by both the stored Electron evidence and the 2e3bc1b ledger row.
  '6f5271e817fb9d6b3ae51aef29bd5bee5a9f36ec',
  // UI-108/UI-109 bound-result completion classification is reconciled by the
  // 2026-08-03 P7 deferral entry; shared history is intentionally not rewritten.
  '2298c968f7afa289a1c257e2fc8ba8d608bad1ed',
  // The initial UX1H implementation is reconciled by the current UI-126 row
  // and acceptance evidence; do not rewrite the already-local implementation commit.
  '7995ee945b0221e2507e1cce11414849a942ac5d',
  // feat(chat): Fork Chat 分支功能在 feat/ui-wave0（UI-143 verified）之后扩展；
  // 台账 UI-143 条目已存在（feat/ui-wave0，W-05/C-02），289101e 为增量扩展，
  // 按 feat/ui-wave0 同一 UI-WAVE0 工作流归属登记，不单独占新 UI 条目
  '289101ea90073f7da5e685617c21fecd6dad7e1f',
  // devah 的 origin/main 不可变提交 e6421e0：窗口控件代码提交，台账由
  // 后续 f624d76 单独登记（UI-106→合并后 UI-129）。豁免同提交台账要求。
  'e6421e07fdf4337944bd7f186926aeeb082049c2',
  // 2026-08-14 Skills UI/frontend pages 不可变实现提交：台账已由
  // 后续 UI-AUDIT-FIX 补登为 UI-157（in_progress）。豁免同提交台账要求。
  'e6bf72ff74480f0b98cfcbbc839268b95d2800c8',
  // 2026-08-14 Copilot UX 不可变实现提交：台账已由
  // 后续 UI-AUDIT-FIX 补登为 UI-158（in_progress）。豁免同提交台账要求。
  '446bfa8f6fb2d23d908ce9358d35c25d4e853ebb',
  // 2026-08-14 Workspace UI plumbing 不可变实现提交：台账已由
  // 后续 UI-AUDIT-FIX 补登为 UI-159（in_progress）。豁免同提交台账要求。
  '3000a069171bb6404719ddd797d1b6e64e92d53c',
  // 2026-08-14 Agent Workbench P1.2 TableRenderer commit 2ba838b 携带
  // scripts/check-ui-productization-audit.mjs 的 UI_ID_PATTERN 扩展。
  // UI-AGENTWB-002 的 audit row + changelog 已在 UI-AUDIT-FIX 5c811f8
  // 一起并入 docs/ui-productization-audit.md，本次 commit 不再单独触碰台账。
  '2ba838be3a046c7b00927bf2d9101c9ad1c6df2e',
])
// UI-### issue ids: numeric series (UI-001..UI-999) and the named
// AGENTWB namespace (UI-AGENTWB-001..UI-AGENTWB-999) used by the
// Agent Workbench enhancement plan. Both must appear in commit
// subjects or in the matching audit row.
const UI_ID_PATTERN = /\bUI-(?:\d{3}|AGENTWB-\d{3})\b/g

// hooks/ is a UI-adjacent React state surface but the historical gate
// surfaced its drift as `isUiSurface` failures that required manual
// LEGACY_*_EXEMPTIONS overrides. Per DOC-GOVERNANCE-GATES / GATES-0
// (2026-08-16), hooks/ files are declared explicitly out of scope for
// the UI ledger gate. The whitelist below enumerates the current
// hooks/ root + the known top-level hook files so future additions are
// intentional: any file under `frontend/src/hooks/` is treated as
// non-UI surface and must not trigger `ui:audit:check` fail-closed.
//
// Rationale (W3 audit §2 row 4): hook commits such as `e6bf72f`
// (useSkillStore), `446bfa8` (useErrorFormatter), and `3000a06`
// (conversationRunStore) historically relied on LEGACY exemptions
// because `isUiSurface` did not match the hooks path. The whitelist
// collapses that workaround into an explicit rule rather than
// maintaining per-commit exemptions.
const UI_AUDIT_HOOKS_WHITELIST = Object.freeze({
  // Directory prefix: any file under this root is excluded from the UI surface check.
  directoryPrefix: 'frontend/src/hooks/',
  // Top-level hook files (also covered by the prefix; listed explicitly for
  // audit reviewers and to anchor the contract on the 2026-08-16 hook set).
  files: Object.freeze([
    'frontend/src/hooks/useAiSettings.ts',
    'frontend/src/hooks/useAutoUpdate.ts',
    'frontend/src/hooks/useConversationJobs.ts',
    'frontend/src/hooks/useConversations.ts',
    'frontend/src/hooks/useDurableConversationLoop.ts',
    'frontend/src/hooks/useHarnessWorkflowStatus.ts',
    'frontend/src/hooks/usePluginStore.ts',
    'frontend/src/hooks/useResizableColumns.ts',
    'frontend/src/hooks/useRightPanelTabs.ts',
    'frontend/src/hooks/useRuntimeResourceSnapshot.ts',
    'frontend/src/hooks/useSkillStore.ts',
    'frontend/src/hooks/useTerminalSession.ts',
    'frontend/src/hooks/useWorkspaceLayout.ts',
    'frontend/src/hooks/useWorkspacePanels.ts',
    'frontend/src/hooks/useWorkspaceRouting.ts',
  ]),
})

function git(args, options = {}) {
  return execFileSync('git', args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', options.allowFailure ? 'ignore' : 'pipe'],
  }).trim()
}

function lines(value) {
  return value ? value.split('\n').filter(Boolean) : []
}

function isUiSurface(file) {
  // hooks/ is explicitly out of scope per UI_AUDIT_HOOKS_WHITELIST (GATES-0).
  // Files under this prefix are React state surfaces whose changes do not
  // require a `docs/ui-productization-audit.md` row.
  if (file.startsWith(UI_AUDIT_HOOKS_WHITELIST.directoryPrefix)) {
    return false
  }
  return (
    file === 'frontend/src/App.tsx' ||
    file.startsWith('frontend/src/components/') ||
    file.startsWith('frontend/src/pages/') ||
    file.startsWith('frontend/src/styles/') ||
    file.startsWith('frontend/src/themes/') ||
    /\.module\.css$/.test(file)
  )
}

// Conventional Commits chore/worktree/etc. prefixes are explicitly out of
// scope for the UI ledger; they may touch UI surfaces (e.g. a chore commit
// that parks a batch of WIP changes) but should not be required to add a new
// UI-### row. Real UI tickets must still use feat/fix/refactor/ui prefixes.
function isChoreCommit(subject) {
  return /^\s*(chore|build|ci|docs|test)(\(.*?\))?(!)?:\s/.test(subject)
}

function uiIds(value) {
  return [...new Set(value.match(UI_ID_PATTERN) ?? [])]
}

function baselineIsAvailable() {
  try {
    git(['merge-base', '--is-ancestor', ENFORCEMENT_BASELINE, 'HEAD'])
    return true
  } catch {
    return false
  }
}

/**
 * Run the UI audit check and return a structured result. The legacy
 * top-level module body also runs for backward compatibility with `npm run
 * ui:audit:check` — it inlines the same logic and pushes the same string
 * failures to `failures` so the existing `process.exit(1)` path is
 * preserved verbatim. `runUiAudit()` exists for the GATES-2 `--report`
 * mode and for any future caller that wants a structured payload.
 *
 * Each entry in `structuredFailures` is `{code, message, commit|null}`.
 * Codes are stable identifiers so downstream consumers can rely on them.
 */
function runUiAudit() {
  const failures = []
  const structuredFailures = []

  if (baselineIsAvailable()) {
    const commits = lines(git(['rev-list', '--reverse', `${ENFORCEMENT_BASELINE}..HEAD`]))

    for (const commit of commits) {
      const files = lines(git(['diff-tree', '--no-commit-id', '--name-only', '-r', commit]))
      if (!files.some(isUiSurface)) continue

      const message = git(['show', '-s', '--format=%s%n%b', commit])
      const subject = message.split('\n', 1)[0] ?? ''
      const shortCommit = commit.slice(0, 7)

      if (isChoreCommit(subject)) continue

      if (!files.includes(AUDIT_PATH) && !LEGACY_AUDIT_SYNC_EXEMPTIONS.has(commit)) {
        const text = `${shortCommit}: UI 改动没有同步 ${AUDIT_PATH}`
        failures.push(text)
        structuredFailures.push({ code: 'UI_AUDIT_SYNC', message: text, commit: shortCommit })
      }
      if (uiIds(message).length === 0 && !LEGACY_MESSAGE_EXEMPTIONS.has(commit)) {
        const text = `${shortCommit}: UI 提交信息缺少 UI-### 问题编号`
        failures.push(text)
        structuredFailures.push({ code: 'UI_ID_MISSING', message: text, commit: shortCommit })
      }
    }
  }

  const trackedChanges = lines(git(['diff', '--name-only', 'HEAD']))
  const untrackedChanges = lines(git(['ls-files', '--others', '--exclude-standard']))
  const worktreeFiles = [...new Set([...trackedChanges, ...untrackedChanges])]

  if (worktreeFiles.some(isUiSurface) && !trackedChanges.includes(AUDIT_PATH)) {
    const text = `当前工作区包含 UI 改动，但没有同步 ${AUDIT_PATH}`
    failures.push(text)
    structuredFailures.push({ code: 'WORKTREE_UI', message: text, commit: null })
  }

  const knownIds = uiIds(git(['log', '--format=%s%n%b']))
  return {
    failures,
    structuredFailures,
    knownIds,
    baselineAvailable: baselineIsAvailable(),
  }
}

const uiAuditResult = runUiAudit()
const failures = uiAuditResult.failures

if (failures.length > 0) {
  console.error('[ui-audit] UI 实现与审计台账不同步：')
  for (const failure of failures) console.error(`- ${failure}`)
  console.error('[ui-audit] UI 状态只能在实机验证后标记 verified；代码完成请先记录为 in_progress。')
  process.exit(1)
}

const knownIds = uiAuditResult.knownIds
console.log(`[ui-audit] 同步检查通过；Git 历史已有 ${knownIds.length} 个带实现证据的 UI 问题编号`)

/**
 * GATES-2 `--report` JSON output mode. Emits a deterministic JSON report
 * conforming to `docs/schemas/ui-audit-report.schema.json`. Exit codes:
 *   0 — schema-valid report written; check passed
 *   1 — schema-valid report written; check failed
 *   2 — classification conflict (path invalid, write failed, schema failed)
 *
 * This branch only runs when the script is executed directly and the user
 * passed `--report <path>`. The legacy execution path above remains
 * untouched for `npm run ui:audit:check` and adhoc invocations.
 */
async function runReportMode(reportPathRaw) {
  const reportPath = path.resolve(reportPathRaw)
  const result = runUiAudit()
  const isFailure = result.structuredFailures.length > 0
  const status = isFailure ? 'FAIL' : 'PASS'
  const exitCode = isFailure ? 1 : 0

  const report = {
    schemaVersion: GATE_REPORT_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    script: 'scripts/check-ui-productization-audit.mjs',
    mode: 'report',
    exitCode,
    summary: {
      status,
      result: isFailure ? 'fail' : 'pass',
      failures: result.structuredFailures.length,
      knownUiIds: result.knownIds.length,
      baselineAvailable: result.baselineAvailable,
      baselineShort: ENFORCEMENT_BASELINE.slice(0, 7),
    },
    failures: result.structuredFailures,
    knownUiIds: result.knownIds.slice().sort(),
  }

  const validation = validateReport('scripts/check-ui-productization-audit.mjs', report)
  if (!validation.valid) {
    console.error('[ui-audit:report] 分类冲突 — produced JSON does not match schema:')
    for (const err of validation.errors) {
      console.error(`  - ${err.path} ${err.keyword}: ${err.message}`)
    }
    process.exitCode = 2
    return
  }

  try {
    const parentDir = path.dirname(reportPath)
    await fs.mkdir(parentDir, { recursive: true })
    await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  } catch (error) {
    console.error(`[ui-audit:report] 分类冲突 — failed to write report to ${reportPath}: ${error.message}`)
    process.exitCode = 2;
    return
  }
  report.reportPath = reportPath
  if (isFailure) {
    console.error(`[ui-audit:report] FAIL (${result.structuredFailures.length} failure(s)); report written to ${reportPath}`)
    process.exitCode = 1
    return
  }
  console.log(`[ui-audit:report] PASS (${result.knownIds.length} UI-### ids); report written to ${reportPath}`)
  process.exitCode = 0
}

if (path.resolve(process.argv[1] ?? '') === SCRIPT_PATH) {
  const argv = process.argv.slice(2)
  const reportIdx = argv.indexOf('--report')
  if (reportIdx >= 0) {
    const reportPathRaw = argv[reportIdx + 1]
    if (!reportPathRaw || reportPathRaw.startsWith('--')) {
      console.error('--report requires a non-empty output path argument.')
      process.exitCode = 2
    } else {
      runReportMode(reportPathRaw).catch((error) => {
        console.error(`[ui-audit:report] 分类冲突 — ${error.message}`)
        process.exitCode = 2
      })
    }
  }
}
