/**
 * gate:m5-security 门自身防假绿负测（M5 / BLOCK-431）。
 * 注入篡改模块，验证 6 类判据必红；不改生产文件、不放宽基线。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { adjudicateSecurity, collectSecurityModule } from '../scripts/m-blueprint-m5-security-gate.mjs';

test('门基线：真实模块判据全绿', () => {
  assert.equal(adjudicateSecurity(collectSecurityModule()).length, 0);
});

test('植入「空 Origin 放行」→ EMPTY_ORIGIN_TOKEN_NOT_ENFORCED 必红', () => {
  const M = { ...collectSecurityModule(), adjudicateLocalRequest: () => ({ ok: true }) };
  assert.ok(adjudicateSecurity(M).some((i) => i.includes('EMPTY_ORIGIN_TOKEN_NOT_ENFORCED')));
});

test('植入「任意 stdio command 放行」→ MCP_COMMAND_WHITELIST_MISSING 必红', () => {
  const M = { ...collectSecurityModule(), adjudicateMcpCommand: () => ({ ok: true }) };
  assert.ok(adjudicateSecurity(M).some((i) => i.includes('MCP_COMMAND_WHITELIST_MISSING')));
});

test('植入「drag 路径穿越放行」→ DRAG_PATH_TRAVERSAL_ALLOWED 必红', () => {
  const M = { ...collectSecurityModule(), adjudicateDragPath: () => ({ ok: true }) };
  assert.ok(adjudicateSecurity(M).some((i) => i.includes('DRAG_PATH_TRAVERSAL_ALLOWED')));
});

test('植入「静默 DDL 判成功」→ SILENT_DDL_TREATED_AS_SUCCESS 必红', () => {
  const M = { ...collectSecurityModule(), ddlOutcome: () => ({ ok: true }) };
  assert.ok(adjudicateSecurity(M).some((i) => i.includes('SILENT_DDL_TREATED_AS_SUCCESS')));
});

test('植入「git 错误静默 PASS」→ GIT_ERROR_SILENT_PASS 必红', () => {
  const M = { ...collectSecurityModule(), adjudicateGitGrepResult: () => ({ status: 'no-match' }) };
  const issues = adjudicateSecurity(M);
  assert.ok(issues.some((i) => i.includes('GIT_ERROR_SILENT_PASS')));
  assert.ok(issues.some((i) => i.includes('GIT_MISSING_SILENT_PASS')));
});

test('植入「异常返回空 {} 假成功」→ FALSE_SUCCESS_ENVELOPE_BROKEN 必红', () => {
  const M = { ...collectSecurityModule(), failureEnvelope: () => ({ ok: true, stats: {} }) };
  assert.ok(adjudicateSecurity(M).some((i) => i.includes('FALSE_SUCCESS_ENVELOPE_BROKEN')));
});
