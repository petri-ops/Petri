/**
 * BLOCK-240 — Q8 余项轻量批：MCP 四 hint 进策略。
 *
 * 钉住：
 * - 无 annotations 的 MCP 工具零漂移（R2/execution）；
 * - readOnlyHint=true 仍降档 R1/retrieval；
 * - destructiveHint/openWorldHint=true **覆盖** readOnlyHint 的降档（R2/execution）；
 * - idempotentHint=true 记录在 hints 但不改变风险档；
 * - 显式 contractMode 覆盖仍优先（用户显式声明，不是 hint）。
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { mcpToolContract } = require('../core/petri-server/agent-tools/mcp-projection.js');

test('BLOCK-240 — 无 annotations 零漂移：R2/execution + hints 全 false', () => {
  const contract = mcpToolContract({ name: 'plain' });
  assert.equal(contract.category, 'action');
  assert.equal(contract.sideEffect, 'execution');
  assert.equal(contract.riskTier, 'R2');
  assert.deepEqual(contract.hints, {
    readOnly: false, destructive: false, openWorld: false, idempotent: false,
  });
});

test('BLOCK-240 — readOnlyHint=true → R1/retrieval', () => {
  const contract = mcpToolContract({ name: 'ro', annotations: { readOnlyHint: true } });
  assert.equal(contract.category, 'retrieval');
  assert.equal(contract.sideEffect, 'none');
  assert.equal(contract.riskTier, 'R1');
  assert.equal(contract.hints.readOnly, true);
});

test('BLOCK-240 — destructiveHint 覆盖 readOnlyHint 降档（保守 R2）', () => {
  const contract = mcpToolContract({
    name: 'danger',
    annotations: { readOnlyHint: true, destructiveHint: true },
  });
  assert.equal(contract.category, 'action');
  assert.equal(contract.sideEffect, 'execution');
  assert.equal(contract.riskTier, 'R2');
  assert.match(contract.notes, /destructiveHint=true overrides readOnlyHint=true/);
  assert.equal(contract.hints.readOnly, true);
  assert.equal(contract.hints.destructive, true);
});

test('BLOCK-240 — openWorldHint 覆盖 readOnlyHint 降档（保守 R2）', () => {
  const contract = mcpToolContract({
    name: 'open',
    annotations: { readOnlyHint: true, openWorldHint: true },
  });
  assert.equal(contract.category, 'action');
  assert.equal(contract.sideEffect, 'execution');
  assert.equal(contract.riskTier, 'R2');
  assert.match(contract.notes, /openWorldHint=true/);
  assert.equal(contract.hints.openWorld, true);
});

test('BLOCK-240 — idempotentHint 记录但不改变风险档', () => {
  const contract = mcpToolContract({
    name: 'idem',
    annotations: { readOnlyHint: true, idempotentHint: true },
  });
  assert.equal(contract.category, 'retrieval');
  assert.equal(contract.sideEffect, 'none');
  assert.equal(contract.riskTier, 'R1');
  assert.equal(contract.hints.idempotent, true);
  assert.match(contract.notes, /idempotentHint=true/);
});

test('BLOCK-240 — 显式 contractMode 仍优先于 hints（用户声明，不是 hint）', () => {
  const forcedReadOnly = mcpToolContract(
    { name: 'danger', annotations: { destructiveHint: true } },
    'read-only',
  );
  assert.equal(forcedReadOnly.riskTier, 'R1');
  assert.equal(forcedReadOnly.sideEffect, 'none');
  assert.equal(forcedReadOnly.hints.destructive, true);

  const forcedMutating = mcpToolContract(
    { name: 'ro', annotations: { readOnlyHint: true } },
    'mutating',
  );
  assert.equal(forcedMutating.riskTier, 'R2');
  assert.equal(forcedMutating.sideEffect, 'execution');
});

test('BLOCK-240 — 非对象 tool 不抛，按保守默认', () => {
  const contract = mcpToolContract(null);
  assert.equal(contract.riskTier, 'R2');
  assert.equal(contract.sideEffect, 'execution');
  assert.deepEqual(contract.hints, {
    readOnly: false, destructive: false, openWorld: false, idempotent: false,
  });
});
