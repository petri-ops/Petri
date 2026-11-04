'use strict';

/**
 * BLOCK-346 T5 — IDE MCP 进程级档位（PETRI_IDE_MCP_ACCESS_MODE）。
 *
 * 背景：MCP 调用方是外部 IDE，没有 Petri 侧 accessMode 会话概念，ide_* 工具此前
 * 完全不受档位约束。协议级协商属改造，先用进程档位过渡：
 *   read            只读
 *   workspace-write 只读 + 工作区写（默认）
 *   full            全允许（含终端写/执行）
 */

import assert from 'node:assert/strict';
import { test, describe, beforeEach, afterEach } from 'node:test';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const require_ = createRequire(import.meta.url);

const { resolveIdeAccessMode, isAllowed, denyEnvelope, DEFAULT_MODE } = require_(
  path.join(ROOT, 'core/petri-server/mcp/ide-tools/access-mode.js'),
);
const { IDE_TOOL_CONTRACTS } = require_(path.join(ROOT, 'core/petri-server/mcp/ide-tools/contracts.js'));
const ide = require_(path.join(ROOT, 'core/petri-server/mcp/ide-tools/index.js'));

const ENV_KEY = 'PETRI_IDE_MCP_ACCESS_MODE';
let saved;

beforeEach(() => { saved = process.env[ENV_KEY]; delete process.env[ENV_KEY]; });
afterEach(() => {
  if (saved === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = saved;
});

describe('IDE MCP 档位（BLOCK-346 T5）', () => {
  test('未设置 env 时默认 workspace-write', () => {
    assert.equal(DEFAULT_MODE, 'workspace-write');
    const r = resolveIdeAccessMode({});
    assert.equal(r.mode, 'workspace-write');
    assert.equal(r.source, 'default');
  });

  test('env 合法值生效、非法值回落默认并标注原因', () => {
    assert.equal(resolveIdeAccessMode({ [ENV_KEY]: 'full' }).mode, 'full');
    assert.equal(resolveIdeAccessMode({ [ENV_KEY]: 'read' }).mode, 'read');
    const bad = resolveIdeAccessMode({ [ENV_KEY]: 'root' });
    assert.equal(bad.mode, DEFAULT_MODE);
    assert.match(bad.source, /env_invalid/);
  });

  test('read 档：只读放行，写与执行全拒', () => {
    assert.equal(isAllowed('read', IDE_TOOL_CONTRACTS.ide_file_read).allowed, true);
    assert.equal(isAllowed('read', IDE_TOOL_CONTRACTS.ide_file_write).allowed, false);
    assert.equal(isAllowed('read', IDE_TOOL_CONTRACTS.ide_terminal_write).allowed, false);
    assert.equal(isAllowed('read', IDE_TOOL_CONTRACTS.ide_terminal_write).requiredMode, 'full');
  });

  test('workspace-write 档：工作区写放行，执行类（terminal_write）拒', () => {
    assert.equal(isAllowed('workspace-write', IDE_TOOL_CONTRACTS.ide_file_write).allowed, true);
    assert.equal(isAllowed('workspace-write', IDE_TOOL_CONTRACTS.ide_file_delete).allowed, true);
    assert.equal(isAllowed('workspace-write', IDE_TOOL_CONTRACTS.ide_terminal_write).allowed, false);
  });

  test('full 档：全允许', () => {
    for (const name of Object.keys(IDE_TOOL_CONTRACTS)) {
      assert.equal(isAllowed('full', IDE_TOOL_CONTRACTS[name]).allowed, true, `${name} 在 full 档应放行`);
    }
  });

  test('拒绝信封带可操作提示', () => {
    const env = denyEnvelope('ide_terminal_write', 'workspace-write', 'full');
    assert.equal(env.error, 'policy_denied');
    assert.equal(env.accessMode, 'workspace-write');
    assert.equal(env.requiredMode, 'full');
    assert.match(env.message, new RegExp(ENV_KEY));
  });

  test('dispatch 层实际拦截：read 档下 ide_file_write 返回 policy_denied', async () => {
    process.env[ENV_KEY] = 'read';
    const result = await ide.callIdeTool('ide_file_write', { path: 'a.txt', content: 'x' });
    assert.equal(result.ok, false);
    assert.equal(result.error, 'policy_denied');
    assert.equal(result.requiredMode, 'workspace-write');
  });

  test('dispatch 层：full 档下 terminal_write 才走到 confirm 闸', async () => {
    process.env[ENV_KEY] = 'full';
    const result = await ide.callIdeTool('ide_terminal_write', { terminalId: 't1', data: 'ls\n' });
    assert.equal(result.ok, false);
    assert.equal(result.error, 'confirm_required');
  });
});
