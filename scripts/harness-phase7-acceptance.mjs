#!/usr/bin/env node
/**
 * Harness Phase 7 offline product acceptance.
 *
 * Exercises the production interceptor pipeline with real workspace handlers
 * against an isolated temporary project. It uses no Provider, credential,
 * user database, or scientific analysis job.
 */
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(SCRIPT_PATH), '..');
const EVIDENCE_DIR = path.join(REPO_ROOT, 'acceptance/harness-phase7');
const EVIDENCE_JSON_PATH = path.join(EVIDENCE_DIR, 'product-acceptance.json');
const EVIDENCE_MARKDOWN_PATH = path.join(EVIDENCE_DIR, 'product-acceptance.md');
const PROJECT_ID = 'phase7-product-fixture';
const USER_ID = 'phase7-fixture-owner';
const EXPECTED_CHECK_IDS = [
  'list_hides_sensitive_entries',
  'find_project_csv',
  'search_returns_path_and_line',
  'read_is_bounded_and_hashed',
  'write_dry_run_has_no_side_effect',
  'write_then_read',
  'replace_dry_run_preserves_file',
  'sha_guarded_replace_then_read',
  'allowlisted_exec_uses_project_cwd',
  'read_only_policy_blocks_side_effects',
  'path_policy_blocks_sensitive_and_escape',
  'command_policy_blocks_remote_git',
  'project_ownership_is_enforced',
];
const EVIDENCE_KEYS = new Set([
  'ok', 'error', 'path', 'created', 'dryRun', 'replacements', 'sha256',
  'previousSha256', 'exitCode', 'truncated', 'startLine', 'endLine',
  'totalLines', 'entryCount', 'matchCount', 'contentSha256', 'cwdRedacted',
  'writeError', 'execError', 'sensitiveError', 'escapeError',
]);

const { createAgentToolInterceptor } = require('../core/r-server/agent-tools/agent-tool-interceptor.js');
const { createWorkspaceTools } = require('../core/r-server/agent-tools/workspace-tools.js');
const { getToolEntry } = require('../core/r-server/agent-tools/registry.js');

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function currentCommit() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

function safeResult(result) {
  const output = {
    ok: result?.ok === true,
    ...(result?.error ? { error: String(result.error) } : {}),
  };
  for (const key of [
    'path', 'created', 'dryRun', 'replacements', 'sha256', 'previousSha256',
    'exitCode', 'truncated', 'startLine', 'endLine', 'totalLines',
  ]) {
    if (result?.[key] !== undefined) output[key] = result[key];
  }
  if (Array.isArray(result?.entries)) output.entryCount = result.entries.length;
  if (Array.isArray(result?.matches)) output.matchCount = result.matches.length;
  return output;
}

function markdown(report) {
  const lines = [
    '# Harness Phase 7 P7-H 产品验收',
    '',
    `- 时间：${report.generatedAt}`,
    `- 基线 Commit：\`${report.sourceBaseCommit}\``,
    '- 模式：离线临时项目，经生产 interceptor / policy / preflight / workspace handler 完整链路。',
    '- 隐私：不访问真实项目、用户数据库、Provider、凭据或科学分析 Job；不保存文件正文和绝对路径。',
    '',
    '| 检查 | 结果 | 证据 |',
    '| --- | --- | --- |',
  ];
  for (const item of report.checks) {
    const evidence = Object.entries(item.evidence || {})
      .map(([key, value]) => `${key}=${String(value).replace(/\|/g, '\\|')}`)
      .join(', ');
    lines.push(`| ${item.id} | ${item.passed ? 'PASS' : 'FAIL'} | ${evidence} |`);
  }
  lines.push('', `总计：${report.passedChecks}/${report.totalChecks} PASS`, '');
  return lines.join('\n');
}

function assertEvidence(condition, message) {
  if (!condition) throw new Error(`evidence_verification_failed: ${message}`);
}

function assertExactKeys(value, expectedKeys, label) {
  assertEvidence(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  assertEvidence(JSON.stringify(actual) === JSON.stringify(expected), `${label} keys differ`);
}

function validateReport(report, label) {
  assertExactKeys(report, [
    'schemaVersion', 'phase', 'generatedAt', 'sourceBaseCommit',
    'acceptanceScriptSha256', 'mode', 'privacy', 'passed', 'passedChecks',
    'totalChecks', 'checks',
  ], label);
  assertEvidence(report.schemaVersion === 1, `${label}.schemaVersion must be 1`);
  assertEvidence(report.phase === 'Harness Phase 7 P7-H', `${label}.phase differs`);
  assertEvidence(!Number.isNaN(Date.parse(report.generatedAt)), `${label}.generatedAt is invalid`);
  assertEvidence(/^(?:[a-f0-9]{40}|unknown)$/.test(report.sourceBaseCommit), `${label}.sourceBaseCommit is invalid`);
  assertEvidence(/^[a-f0-9]{64}$/.test(report.acceptanceScriptSha256), `${label}.acceptanceScriptSha256 is invalid`);
  assertEvidence(report.mode === 'offline-production-interceptor', `${label}.mode differs`);

  assertExactKeys(report.privacy, [
    'temporaryWorkspaceOnly', 'containsCredentials', 'containsFileBodies',
    'containsAbsolutePaths', 'touchesUserDatabase', 'createsAnalysisJobs',
  ], `${label}.privacy`);
  assertEvidence(report.privacy.temporaryWorkspaceOnly === true, `${label} must use only a temporary workspace`);
  for (const key of [
    'containsCredentials', 'containsFileBodies', 'containsAbsolutePaths',
    'touchesUserDatabase', 'createsAnalysisJobs',
  ]) {
    assertEvidence(report.privacy[key] === false, `${label}.privacy.${key} must be false`);
  }

  assertEvidence(Array.isArray(report.checks), `${label}.checks must be an array`);
  assertEvidence(
    JSON.stringify(report.checks.map((item) => item.id)) === JSON.stringify(EXPECTED_CHECK_IDS),
    `${label} check IDs or order differ`,
  );
  for (const [index, item] of report.checks.entries()) {
    assertExactKeys(item, ['id', 'passed', 'evidence'], `${label}.checks[${index}]`);
    assertEvidence(item.passed === true, `${label}.${item.id} did not pass`);
    assertEvidence(item.evidence && typeof item.evidence === 'object' && !Array.isArray(item.evidence), `${label}.${item.id}.evidence must be an object`);
    for (const [key, value] of Object.entries(item.evidence)) {
      assertEvidence(EVIDENCE_KEYS.has(key), `${label}.${item.id} contains non-whitelisted evidence key ${key}`);
      if (typeof value === 'string') {
        assertEvidence(!/[\r\n]/.test(value), `${label}.${item.id}.${key} contains multiline data`);
      }
      if (key === 'path') {
        assertEvidence(typeof value === 'string' && !path.isAbsolute(value), `${label}.${item.id}.path must be relative`);
        assertEvidence(!value.split(/[\\/]/).includes('..'), `${label}.${item.id}.path escapes the workspace`);
      }
    }
  }

  assertEvidence(report.totalChecks === EXPECTED_CHECK_IDS.length, `${label}.totalChecks differs`);
  assertEvidence(report.passedChecks === EXPECTED_CHECK_IDS.length, `${label}.passedChecks differs`);
  assertEvidence(report.passed === true, `${label}.passed must be true`);
}

function comparableReport(report) {
  const { generatedAt: _generatedAt, sourceBaseCommit: _sourceBaseCommit, ...comparable } = report;
  return comparable;
}

async function verifyEvidence(report) {
  let stored;
  let storedMarkdown;
  try {
    stored = JSON.parse(await fs.readFile(EVIDENCE_JSON_PATH, 'utf8'));
    storedMarkdown = await fs.readFile(EVIDENCE_MARKDOWN_PATH, 'utf8');
  } catch (error) {
    throw new Error(`evidence_verification_failed: cannot read committed evidence (${error?.code || 'invalid_json'})`);
  }

  validateReport(report, 'live report');
  validateReport(stored, 'committed report');
  assertEvidence(
    JSON.stringify(comparableReport(stored)) === JSON.stringify(comparableReport(report)),
    'committed JSON evidence is stale; run npm run harness:phase7:acceptance:update',
  );
  assertEvidence(
    storedMarkdown === markdown(stored),
    'committed Markdown evidence does not match committed JSON evidence',
  );
  console.log('Committed redacted evidence matches the live acceptance contract');
}

async function runAcceptance() {
  const sandboxRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'biof3-phase7-product-'));
  const workspaceRoot = path.join(sandboxRoot, 'workspace');
  const checks = [];
  const record = (id, passed, evidence = {}) => {
    checks.push({ id, passed: passed === true, evidence });
    console.log(`${passed ? 'PASS' : 'FAIL'} ${id}`);
  };

  try {
    await fs.mkdir(path.join(workspaceRoot, 'data'), { recursive: true });
    await fs.mkdir(path.join(workspaceRoot, 'notes'), { recursive: true });
    await fs.writeFile(path.join(workspaceRoot, 'data/genes.csv'), 'gene,score\nTP53,4.2\nEGFR,3.1\n', 'utf8');
    await fs.writeFile(path.join(workspaceRoot, 'notes/review.txt'), 'review_status: draft\n', 'utf8');
    await fs.writeFile(path.join(workspaceRoot, '.env'), 'FIXTURE_ONLY=not-a-credential\n', 'utf8');

    const fakeDb = {
      getProject(projectId) {
        if (projectId !== PROJECT_ID) return null;
        return { id: PROJECT_ID, user_id: USER_ID, status: 'active', workspace_path: workspaceRoot };
      },
      getUserById(userId) {
        return { id: userId, role: 'user' };
      },
    };
    const tools = createWorkspaceTools({ dbProvider: () => fakeDb });
    const handlers = {
      workspace_list: tools.listDirectory,
      workspace_find: tools.findFiles,
      workspace_search: tools.searchText,
      workspace_read: tools.readFile,
      workspace_write: tools.writeFile,
      workspace_replace: tools.replaceText,
      workspace_exec: tools.executeCommand,
    };
    const intercept = createAgentToolInterceptor({
      getToolEntry(name) {
        const entry = getToolEntry(name);
        if (!entry || !handlers[name]) return entry;
        return { ...entry, handler: handlers[name] };
      },
      preflightWorkspaceTool: tools.preflightTool,
    });
    const ctx = { projectId: PROJECT_ID, userId: USER_ID, accessMode: 'full', allowExecution: true };
    const call = (name, args, callCtx = ctx) => intercept(name, args, callCtx);

    const listed = await call('workspace_list', { path: '.', includeHidden: true });
    record('list_hides_sensitive_entries', listed.ok && listed.entries.some((entry) => entry.name === 'data') && !listed.entries.some((entry) => entry.name === '.env'), safeResult(listed));

    const found = await call('workspace_find', { pattern: '*.csv' });
    record('find_project_csv', found.ok && found.matches.some((match) => match.path === 'data/genes.csv'), safeResult(found));

    const searched = await call('workspace_search', { query: 'TP53' });
    record('search_returns_path_and_line', searched.ok && searched.matches.some((match) => match.path === 'data/genes.csv' && match.line === 2), safeResult(searched));

    const read = await call('workspace_read', { path: 'data/genes.csv', startLine: 2, maxLines: 1 });
    record('read_is_bounded_and_hashed', read.ok && read.content === 'TP53,4.2' && /^[a-f0-9]{64}$/.test(read.sha256), safeResult(read));

    const preview = await call('workspace_write', { path: 'notes/session.txt', content: 'status: created\n', dryRun: true });
    let previewCreatedFile = true;
    try { await fs.access(path.join(workspaceRoot, 'notes/session.txt')); } catch { previewCreatedFile = false; }
    record('write_dry_run_has_no_side_effect', preview.ok && preview.dryRun === true && !previewCreatedFile, safeResult(preview));

    const written = await call('workspace_write', { path: 'notes/session.txt', content: 'status: created\n' });
    const reread = await call('workspace_read', { path: 'notes/session.txt' });
    record('write_then_read', written.ok && reread.ok && reread.sha256 === written.sha256 && reread.content === 'status: created\n', { ...safeResult(written), contentSha256: sha256(reread.content || '') });

    const beforeReplace = await call('workspace_read', { path: 'notes/review.txt' });
    const replacePreview = await call('workspace_replace', {
      path: 'notes/review.txt', oldText: 'draft', newText: 'verified',
      expectedSha256: beforeReplace.sha256, dryRun: true,
    });
    const afterPreview = await fs.readFile(path.join(workspaceRoot, 'notes/review.txt'), 'utf8');
    record('replace_dry_run_preserves_file', replacePreview.ok && replacePreview.dryRun === true && afterPreview === 'review_status: draft\n', safeResult(replacePreview));

    const replaced = await call('workspace_replace', {
      path: 'notes/review.txt', oldText: 'draft', newText: 'verified',
      expectedSha256: beforeReplace.sha256,
    });
    const verified = await call('workspace_read', { path: 'notes/review.txt' });
    record('sha_guarded_replace_then_read', replaced.ok && verified.ok && verified.content === 'review_status: verified\n', { ...safeResult(replaced), contentSha256: sha256(verified.content || '') });

    const exec = await call('workspace_exec', { command: 'pwd' });
    record('allowlisted_exec_uses_project_cwd', exec.ok && exec.exitCode === 0 && exec.stdout.trim() === await fs.realpath(workspaceRoot), { ...safeResult(exec), cwdRedacted: '[project workspace]' });

    const readOnly = { ...ctx, allowExecution: false, executionPolicyReason: 'explicit_read_only_request' };
    const deniedWrite = await call('workspace_write', { path: 'notes/blocked.txt', content: 'blocked\n' }, readOnly);
    const deniedExec = await call('workspace_exec', { command: 'pwd' }, readOnly);
    record('read_only_policy_blocks_side_effects', deniedWrite.error === 'execution_not_allowed' && deniedExec.error === 'execution_not_allowed', { writeError: deniedWrite.error, execError: deniedExec.error });

    const sensitive = await call('workspace_read', { path: '.env' });
    const escaped = await call('workspace_read', { path: '../outside.txt' });
    record('path_policy_blocks_sensitive_and_escape', sensitive.error === 'sensitive_path' && escaped.error === 'path_escape', { sensitiveError: sensitive.error, escapeError: escaped.error });

    const dangerous = await call('workspace_exec', { command: 'git push origin main' });
    record('command_policy_blocks_remote_git', dangerous.error === 'command_blocked', safeResult(dangerous));

    const otherUser = await call('workspace_list', { path: '.' }, { ...ctx, userId: 'other-user' });
    record('project_ownership_is_enforced', otherUser.error === 'permission_denied', safeResult(otherUser));

    const report = {
      schemaVersion: 1,
      phase: 'Harness Phase 7 P7-H',
      generatedAt: new Date().toISOString(),
      sourceBaseCommit: currentCommit(),
      acceptanceScriptSha256: sha256(await fs.readFile(SCRIPT_PATH)),
      mode: 'offline-production-interceptor',
      privacy: {
        temporaryWorkspaceOnly: true,
        containsCredentials: false,
        containsFileBodies: false,
        containsAbsolutePaths: false,
        touchesUserDatabase: false,
        createsAnalysisJobs: false,
      },
      passed: checks.every((item) => item.passed),
      passedChecks: checks.filter((item) => item.passed).length,
      totalChecks: checks.length,
      checks,
    };
    return report;
  } finally {
    await fs.rm(sandboxRoot, { recursive: true, force: true });
  }
}

async function main() {
  const writeEvidence = process.argv.includes('--write-evidence');
  const verifyCommittedEvidence = process.argv.includes('--verify-evidence');
  assertEvidence(!(writeEvidence && verifyCommittedEvidence), '--write-evidence and --verify-evidence are mutually exclusive');

  const report = await runAcceptance();
  validateReport(report, 'live report');
  if (writeEvidence) {
    await fs.mkdir(EVIDENCE_DIR, { recursive: true });
    await fs.writeFile(EVIDENCE_JSON_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    await fs.writeFile(EVIDENCE_MARKDOWN_PATH, markdown(report), 'utf8');
    console.log('Redacted evidence written to acceptance/harness-phase7/product-acceptance.{json,md}');
  } else if (verifyCommittedEvidence) {
    await verifyEvidence(report);
  }
  console.log(`${report.passedChecks}/${report.totalChecks} product checks passed`);
  return report.passed ? 0 : 1;
}

main()
  .then((code) => { process.exit(code); })
  .catch((error) => {
    console.error(`P7-H product acceptance failed: ${error?.code || error?.message || 'unknown_error'}`);
    process.exit(1);
  });
