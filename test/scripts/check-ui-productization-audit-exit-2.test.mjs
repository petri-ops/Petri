#!/usr/bin/env node
/**
 * test/scripts/check-ui-productization-audit-exit-2.test.mjs — GATES-3 / BLOCK-14-GATES-3-EXIT-2-ENFORCEMENT
 *
 * Verifies the three mock fixtures for the new `hasUnmappedSurface` exit-2
 * detection branch:
 *   1. `registered` — commit subject cites a UI-### id that IS present in
 *      `docs/ui-productization-audit.md` → no unmapped failure (PASS).
 *   2. `unmapped`  — commit subject cites a UI-### id that IS NOT present in
 *      `docs/ui-productization-audit.md` and the commit is NOT in either
 *      LEGACY_*_EXEMPTIONS set → triggers `UI_AUDIT_UNMAPPED` → exit 2.
 *   3. `legacy`    — commit subject cites a UI-### id that IS NOT in the
 *      registry, but the commit IS in `LEGACY_MESSAGE_EXEMPTIONS`
 *      (representing the BLOCK-13 grandfathered set) → exempt → PASS.
 *
 * The test exercises:
 *   • `detectUnmappedSurface` — pure function (3 fixture unit tests)
 *   • `decideExitCode` — pure exit-code logic (4 unit tests covering all branches)
 *   • Subprocess invocation of `scripts/check-ui-productization-audit.mjs`
 *     against the real repo to confirm the default-mode exit code matches
 *     the documented contract (exit 0 on a green repo).
 *
 * Total expected: 3 fixture tests + 4 exit-code-decision tests + 2
 * subprocess tests + 1 cli-flag test = 10 PASS.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { test } from 'node:test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  AUDIT_PATH,
  detectUnmappedSurface,
  decideExitCode,
  isClassificationConflict,
  parsePrintMode,
  UI_ID_PATTERN,
} from '../../scripts/check-ui-productization-audit.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(__dirname, '..', '..')
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'check-ui-productization-audit.mjs')

// Stable fixture ids. UI-001 is a verified row in the real registry
// since 2026-07-17; UI-997/998 are intentionally absent.
const FIXTURE_REGISTERED_ID = 'UI-001'
const FIXTURE_LEGACY_ID = 'UI-997'
const FIXTURE_UNMAPPED_ID = 'UI-998'

const FIXTURE_SUBJECT_REGISTERED = `feat(ui): sample registered fixture citing ${FIXTURE_REGISTERED_ID}`
const FIXTURE_SUBJECT_UNMAPPED = `feat(ui): sample unmapped fixture citing ${FIXTURE_UNMAPPED_ID} (which is not in registry)`
const FIXTURE_SUBJECT_LEGACY = `feat(ui): sample legacy-exempt fixture citing ${FIXTURE_LEGACY_ID}`

// Load the real registry synchronously from docs/ui-productization-audit.md
// using the same UI_ID_PATTERN as the script. The audit file is small
// (<200KB) and the regex-driven extraction runs in microseconds, so the
// synchronous read is safe and removes any cross-test ordering dependency
// (node:test runs tests concurrently by default).
const AUDIT_FILE_PATH = path.join(REPO_ROOT, AUDIT_PATH)
const REAL_REGISTRY_IDS = [
  ...new Set((readFileSync(AUDIT_FILE_PATH, 'utf8').match(UI_ID_PATTERN) ?? [])),
]
assert.ok(REAL_REGISTRY_IDS.length > 50, `Real registry must have > 50 ids, got ${REAL_REGISTRY_IDS.length}`)
assert.ok(
  REAL_REGISTRY_IDS.includes(FIXTURE_REGISTERED_ID),
  `Test pre-condition: ${FIXTURE_REGISTERED_ID} must be present in the real registry`,
)

// ---------------------------------------------------------------------------
// Pure-function fixture tests: detectUnmappedSurface (3 mock fixtures)
// ---------------------------------------------------------------------------

test('fixture [registered]: UI-### id present in registry → no unmapped failure', () => {
  const result = detectUnmappedSurface({
    commit: 'aabbccd0000000000000000000000000000000000',
    subject: FIXTURE_SUBJECT_REGISTERED,
    body: 'Refs: UI-001 verified; wires title bar collapse animation.',
    registeredIds: REAL_REGISTRY_IDS,
    legacyMessageExemptions: new Set(),
    legacyAuditSyncExemptions: new Set(),
  })
  assert.equal(result, null, 'registered fixture must NOT trigger hasUnmappedSurface')
})

test('fixture [unmapped]: UI-### id absent from registry and not legacy-exempt → UI_AUDIT_UNMAPPED', () => {
  const result = detectUnmappedSurface({
    commit: '1122334000000000000000000000000000000000',
    subject: FIXTURE_SUBJECT_UNMAPPED,
    body: 'Body: this id was minted without a ledger row.',
    registeredIds: REAL_REGISTRY_IDS,
    legacyMessageExemptions: new Set(),
    legacyAuditSyncExemptions: new Set(),
  })
  assert.ok(result, 'unmapped fixture must produce a non-null failure')
  assert.equal(result.code, 'UI_AUDIT_UNMAPPED')
  assert.equal(result.commit, '1122334')
  assert.deepEqual(result.unmappedIds, [FIXTURE_UNMAPPED_ID])
  assert.match(result.message, new RegExp(FIXTURE_UNMAPPED_ID))
  assert.match(result.message, /docs\/ui-productization-audit\.md/)
})

test('fixture [legacy]: UI-### id absent from registry but commit in LEGACY_MESSAGE_EXEMPTIONS → exempt', () => {
  const fixtureCommit = '9999999000000000000000000000000000000000'
  const result = detectUnmappedSurface({
    commit: fixtureCommit,
    subject: FIXTURE_SUBJECT_LEGACY,
    body: 'Body: real commit subject can reference an id not yet in registry when grandfathered.',
    registeredIds: REAL_REGISTRY_IDS,
    legacyMessageExemptions: new Set([fixtureCommit]),
    legacyAuditSyncExemptions: new Set(),
  })
  assert.equal(result, null, 'legacy-exempt commit must NOT trigger hasUnmappedSurface')
})

// ---------------------------------------------------------------------------
// BLOCK-44 — 提取边界大小写归一（uiIds() 输出 canonical 大写）
// ---------------------------------------------------------------------------

test('fixture [case-normalized]: lowercase ui-### in subject maps to uppercase registered id → no unmapped', () => {
  const result = detectUnmappedSurface({
    commit: 'aabbccd111000000000000000000000000000000',
    subject: 'feat(ui): sample lowercase fixture citing ui-001 and ui-agentwb-001',
    body: '',
    registeredIds: REAL_REGISTRY_IDS,
    legacyMessageExemptions: new Set(),
    legacyAuditSyncExemptions: new Set(),
  })
  assert.equal(result, null, 'lowercase subject ids must normalize to canonical uppercase before registry lookup')
})

test('fixture [case-normalized-unmapped]: lowercase unknown id reports uppercase canonical unmappedIds', () => {
  const result = detectUnmappedSurface({
    commit: '1122335000000000000000000000000000000000',
    subject: 'feat(ui): lowercase unknown fixture citing ui-998',
    body: '',
    registeredIds: REAL_REGISTRY_IDS,
    legacyMessageExemptions: new Set(),
    legacyAuditSyncExemptions: new Set(),
  })
  assert.ok(result, 'lowercase unknown id must still trigger UI_AUDIT_UNMAPPED')
  assert.equal(result.code, 'UI_AUDIT_UNMAPPED')
  assert.deepEqual(result.unmappedIds, ['UI-998'], 'unmappedIds must be canonical uppercase for schema conformance')
})

// ---------------------------------------------------------------------------
// Exit-code decision logic (decideExitCode)
// ---------------------------------------------------------------------------

test('decideExitCode returns 0 when no structured failures', () => {
  const result = { structuredFailures: [], failures: [] }
  assert.equal(decideExitCode(result, 'default'), 0)
  assert.equal(decideExitCode(result, 'development'), 0)
})

test('decideExitCode returns 2 for UI_AUDIT_UNMAPPED in default mode', () => {
  const result = {
    structuredFailures: [{ code: 'UI_AUDIT_UNMAPPED', message: 'x', commit: '1122334' }],
    failures: ['x'],
  }
  assert.equal(decideExitCode(result, 'default'), 2)
  assert.equal(isClassificationConflict(result.structuredFailures[0]), true)
})

test('decideExitCode returns 1 for hard FAIL (UI_AUDIT_SYNC) in default mode', () => {
  const result = {
    structuredFailures: [{ code: 'UI_AUDIT_SYNC', message: 'x', commit: '1122334' }],
    failures: ['x'],
  }
  assert.equal(decideExitCode(result, 'default'), 1)
  assert.equal(
    decideExitCode(result, 'development'),
    2,
    'development mode downgrades UI_AUDIT_SYNC miss to 2',
  )
})

test('decideExitCode returns 2 for UI_ID_MISSING in development mode (LEGACY_*_EXEMPTIONS miss downgrade)', () => {
  const result = {
    structuredFailures: [
      { code: 'UI_ID_MISSING', message: 'x', commit: '1122334' },
    ],
    failures: ['x'],
  }
  assert.equal(decideExitCode(result, 'development'), 2)
})

// ---------------------------------------------------------------------------
// CLI flag parsing
// ---------------------------------------------------------------------------

test('parsePrintMode recognises --print-mode=development', () => {
  assert.equal(parsePrintMode(['--print-mode=development']), 'development')
  assert.equal(parsePrintMode(['--print-mode=default']), 'default')
  assert.equal(parsePrintMode(['--print-mode=other']), 'default', 'unknown values fall back to default')
  assert.equal(parsePrintMode([]), 'default')
  assert.equal(parsePrintMode(['--report', '/tmp/x.json']), 'default', 'unrelated flags do not switch modes')
})

// ---------------------------------------------------------------------------
// Subprocess tests against the real script (default mode stays GREEN).
// ---------------------------------------------------------------------------

function runScript(args = []) {
  return spawnSync('node', [SCRIPT, ...args], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    // 真实仓扫描要遍历 ENFORCEMENT_BASELINE..HEAD 的全部提交（本机实测约 170s，
    // 且只随历史增长而变慢）。原来的 60s 上限会让 spawnSync 杀死子进程并把
    // status 变成 null —— 门是绿的、断言却假红。给足余量，并在超时时把原因写明。
    timeout: Number(process.env.UI_AUDIT_GATE_TEST_TIMEOUT_MS || 300000),
  })
}

test('default `npm run ui:audit:check` against the real repo still PASSes with exit 0', () => {
  const r = runScript([])
  assert.equal(r.status, 0, `default mode must remain exit 0; got ${r.status}${r.status === null ? '（被 timeout 杀死，非门禁判红；可调 UI_AUDIT_GATE_TEST_TIMEOUT_MS）' : ''}\n${r.stderr}`)
  assert.match(r.stdout, /同步检查通过/, 'default mode stdout must show PASS message')
})

test('default `npm run ui:audit:check --print-mode=development` against the real repo also PASSes with exit 0', () => {
  const r = runScript(['--print-mode=development'])
  assert.equal(
    r.status,
    0,
    `development mode against a green repo must remain exit 0; got ${r.status}\n${r.stderr}`,
  )
  assert.match(r.stdout, /同步检查通过/, 'development mode stdout must show PASS message')
})