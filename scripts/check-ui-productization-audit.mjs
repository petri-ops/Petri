#!/usr/bin/env node

import { execFileSync } from 'node:child_process'

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
])
const UI_ID_PATTERN = /\bUI-\d{3}\b/g

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

const failures = []

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
      failures.push(`${shortCommit}: UI 改动没有同步 ${AUDIT_PATH}`)
    }
    if (uiIds(message).length === 0 && !LEGACY_MESSAGE_EXEMPTIONS.has(commit)) {
      failures.push(`${shortCommit}: UI 提交信息缺少 UI-### 问题编号`)
    }
  }
} else {
  console.warn(`[ui-audit] 未找到执行基线 ${ENFORCEMENT_BASELINE.slice(0, 7)}，跳过历史提交检查`)
}

const trackedChanges = lines(git(['diff', '--name-only', 'HEAD']))
const untrackedChanges = lines(git(['ls-files', '--others', '--exclude-standard']))
const worktreeFiles = [...new Set([...trackedChanges, ...untrackedChanges])]

if (worktreeFiles.some(isUiSurface) && !trackedChanges.includes(AUDIT_PATH)) {
  failures.push(`当前工作区包含 UI 改动，但没有同步 ${AUDIT_PATH}`)
}

if (failures.length > 0) {
  console.error('[ui-audit] UI 实现与审计台账不同步：')
  for (const failure of failures) console.error(`- ${failure}`)
  console.error('[ui-audit] UI 状态只能在实机验证后标记 verified；代码完成请先记录为 in_progress。')
  process.exit(1)
}

const knownIds = uiIds(git(['log', '--format=%s%n%b']))
console.log(`[ui-audit] 同步检查通过；Git 历史已有 ${knownIds.length} 个带实现证据的 UI 问题编号`)
