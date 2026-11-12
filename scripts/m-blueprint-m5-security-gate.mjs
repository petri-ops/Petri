#!/usr/bin/env node
/**
 * gate:m5-security — M5（BLOCK-431）专项门：八类安全判据植入必红。
 * 纯函数 adjudicateSecurity 可被负测注入篡改（门自身防假绿）。
 * 用法：node scripts/m-blueprint-m5-security-gate.mjs --check [--report <path>]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
export const collectSecurityModule = () => require(path.join(ROOT, 'core/petri-server/agent-tools/security-boundaries.js'));

export function adjudicateSecurity(M) {
  const issues = [];
  const boot = M.createBootToken({ seed: 9 });
  // ① 空 Origin 无 token / 常量 Bearer / 伪造 Origin
  if (M.adjudicateLocalRequest({ origin: '', method: 'GET', token: null, bootToken: boot, trusted: true }).ok !== false) issues.push('EMPTY_ORIGIN_TOKEN_NOT_ENFORCED');
  if (M.adjudicateLocalRequest({ origin: '', method: 'GET', token: 'desktop-local', bootToken: boot, trusted: true }).ok !== false) issues.push('DEPRECATED_BEARER_ACCEPTED');
  if (M.adjudicateLocalRequest({ origin: 'https://evil.example', method: 'POST', token: boot, bootToken: boot }).ok !== false) issues.push('FORGED_ORIGIN_ACCEPTED');
  if (M.adjudicateMcpCommand({ command: '/bin/sh', args: ['-lc', 'echo x'] }).ok !== false) issues.push('MCP_COMMAND_WHITELIST_MISSING');

  // ② drag 根 / basename / 长度
  if (M.adjudicateDragPath({ localPath: '/x/../../etc/passwd', registeredRoots: ['/workspace'], realpath: '/etc/passwd', name: '../../etc/passwd', bytes: 10 }).ok !== false) issues.push('DRAG_PATH_TRAVERSAL_ALLOWED');
  // ③ 导航 + session 覆盖
  if (M.adjudicateFrameNavigation({ url: 'https://u:p@evil.example', allowlist: ['https://ok.example'] }).ok !== false) issues.push('FRAME_NAVIGATION_ALLOWLIST_MISSING');
  if (M.adjudicatePermissionSessions({ sessions: ['defaultSession', 'persist:petri-browser'], sessionCreatedHook: false, denied: ['defaultSession'] }).ok !== false) issues.push('PERMISSION_SESSION_COVERAGE_INCOMPLETE');
  // ④ tar + zip 清理
  if (M.adjudicateTarEntry({ path: '../evil' }).ok !== false) issues.push('TAR_TRAVERSAL_ALLOWED');
  if (!M.cleanupPlan({ destDir: '/tmp/x', failed: true }).remove) issues.push('ZIP_FAILURE_CLEANUP_MISSING');
  // ⑤ 假成功 + git fail-closed + 分页
  const env = M.failureEnvelope({ error: new Error('x'), operation: 'o' });
  if (env.ok !== false || !env.code || env.stats !== null) issues.push('FALSE_SUCCESS_ENVELOPE_BROKEN');
  if (M.ddlOutcome({ succeeded: false, suppressed: true }).ok !== false) issues.push('SILENT_DDL_TREATED_AS_SUCCESS');
  if (M.adjudicateGitGrepResult({ exitCode: 128, stderr: 'fatal' }).status !== 'fail-closed') issues.push('GIT_ERROR_SILENT_PASS');
  if (M.adjudicateGitGrepResult({ exitCode: -1, stderr: 'ENOENT' }).status !== 'fail-closed') issues.push('GIT_MISSING_SILENT_PASS');
  if (M.adjudicatePaging({ limit: -1 }).ok !== false) issues.push('PAGING_ASSERTION_MISSING');
  if (!M.atomicWritePlan({ target: '/d/x.json' }).tmp.includes('.tmp')) issues.push('ATOMIC_WRITE_MISSING');
  if (M.redactLog('token=SYNTHETIC-TEST-VALUE').includes('SYNTHETIC-TEST-VALUE')) issues.push('LOG_REDACTION_MISSING');
  return issues;
}

function main() {
  const args = process.argv.slice(2);
  if (!args.includes('--check')) {
    process.stderr.write('用法：node scripts/m-blueprint-m5-security-gate.mjs --check [--report <path>]\n');
    process.exit(2);
  }
  const issues = adjudicateSecurity(collectSecurityModule());
  const report = { schemaVersion: 1, script: 'scripts/m-blueprint-m5-security-gate.mjs', mode: 'report', exitCode: issues.length ? 1 : 0, summary: { status: issues.length ? 'FAIL' : 'PASS', issues } };
  const idx = args.indexOf('--report');
  if (idx >= 0 && args[idx + 1]) fs.writeFileSync(path.resolve(ROOT, args[idx + 1]), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`[gate:m5-security] 8 类判据 → ${issues.length ? 'FAIL' : 'PASS'}（${issues.length} issues）\n`);
  for (const i of issues) process.stdout.write(`  ✖ ${i}\n`);
  process.exit(issues.length ? 1 : 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
