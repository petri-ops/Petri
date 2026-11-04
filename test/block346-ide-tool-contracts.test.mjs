'use strict';

/**
 * BLOCK-346 T5 — IDE MCP 契约与 confirm 闸。
 *
 * 背景：18 个 `ide_*` 工具此前无契约/元数据条目，也不经统一 policy，只有零散
 * `confirm` 布尔（第二套更弱的安全模型）。本契约钉住：
 *   ① 每个 ide_* 工具都有契约条目（防新增工具再漏登记）
 *   ② 写/执行类 riskTier 非 R0，只读类为 R0
 *   ③ confirmPolicy='always' 的工具在 dispatch 层强制 confirm=true
 */

import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const require_ = createRequire(import.meta.url);

const ide = require_(path.join(ROOT, 'core/petri-server/mcp/ide-tools/index.js'));
const { IDE_TOOL_CONTRACTS, IDE_WRITE_TOOLS, checkConfirm } = require_(
  path.join(ROOT, 'core/petri-server/mcp/ide-tools/contracts.js'),
);

describe('IDE MCP 契约完备性（BLOCK-346 T5）', () => {
  test('每个 ide_* 工具都有契约条目（新增工具漏登记即红）', () => {
    const defs = ide.getIdeToolDefinitions();
    assert.ok(Array.isArray(defs) && defs.length > 0, '工具定义为空');
    const missing = defs.map((d) => d.name).filter((n) => !IDE_TOOL_CONTRACTS[n]);
    assert.deepEqual(missing, [], `未登记契约：${missing.join(', ')}`);
  });

  test('写/执行类 riskTier 非 R0，只读类为 R0', () => {
    for (const [name, contract] of Object.entries(IDE_TOOL_CONTRACTS)) {
      if (contract.sideEffect === 'none') {
        assert.equal(contract.riskTier, 'R0', `${name} 只读却非 R0`);
      } else {
        assert.notEqual(contract.riskTier, 'R0', `${name} 写类却标 R0`);
      }
    }
  });

  test('IDE_WRITE_TOOLS = sideEffect 非 none 的全集', () => {
    const expected = Object.keys(IDE_TOOL_CONTRACTS).filter((n) => IDE_TOOL_CONTRACTS[n].sideEffect !== 'none').sort();
    assert.deepEqual([...IDE_WRITE_TOOLS].sort(), expected);
    assert.ok(expected.includes('ide_file_write') && expected.includes('ide_terminal_write'));
  });

  test('confirmPolicy=always 的工具无 confirm 时被拒，带 confirm 时放行', () => {
    const alwaysTools = Object.keys(IDE_TOOL_CONTRACTS).filter((n) => IDE_TOOL_CONTRACTS[n].confirmPolicy === 'always');
    assert.ok(alwaysTools.length >= 2, '应至少有 file_delete 与 terminal_write');
    for (const name of alwaysTools) {
      const denied = checkConfirm(name, {});
      assert.ok(denied, `${name} 缺 confirm 应被拒`);
      assert.equal(denied.error, 'confirm_required');
      assert.equal(denied.toolId, name);
      assert.equal(checkConfirm(name, { confirm: true }), null, `${name} 带 confirm 应放行`);
    }
  });

  test('只读与 overwrite 细粒度工具不被 dispatch 闸拦截', () => {
    for (const name of ['ide_file_read', 'ide_file_list', 'ide_git_diff', 'ide_diff', 'ide_search']) {
      assert.equal(checkConfirm(name, {}), null, `${name} 是只读，不应被 confirm 闸拦`);
    }
    // overwrite 语义在 handler 内部判定（需先探测目标存在），dispatch 层不拦
    assert.equal(checkConfirm('ide_file_write', { path: 'a.txt', content: 'x' }), null);
  });

  test('dispatch 层实际拦截：terminal_write 无 confirm 直接返回 confirm_required', async () => {
    const result = await ide.callIdeTool('ide_terminal_write', { terminalId: 't1', data: 'ls\n' });
    assert.equal(result.ok, false);
    assert.equal(result.error, 'confirm_required');
  });
});
