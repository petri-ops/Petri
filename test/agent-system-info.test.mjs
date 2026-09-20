import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

// BLOCK-33 P1 — registry 导入链会拉起 db.js（要求已迁移的库），与 agent-files-changed
// 测试同款环境自举：临时库 + 按序应用 src/migrations/*.sql（提供 projects 等基线表）。
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'biof3-agent-system-info-'));
const require = createRequire(import.meta.url);
{
  const Database = require('better-sqlite3');
  const db = new Database(path.join(tempDir, 'biof3.db'));
  const migrationsDir = path.resolve('src/migrations');
  for (const file of fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(fs.readFileSync(path.join(migrationsDir, file), 'utf8'));
  }
  db.close();
}
process.env.BIOF3_DB_PATH = path.join(tempDir, 'biof3.db');

test.after(() => {
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch (e) {
    if (process.platform !== 'win32') throw e;
  }
});

test('BLOCK-33 P1 system_info 工具形状', async (_t) => {
  const { tool_system_info } = await import('../core/biof3-server/agent-tools/system-info-tools.js');
  const result = await tool_system_info({}, { projectId: 'p_test' });
  assert.equal(result.ok, true);
  assert.equal(result.os.platform, process.platform);
  assert.equal(result.os.arch, os.arch());
  assert.equal(result.pathSeparator, path.sep);
  assert.equal(result.projectId, 'p_test');
  assert.equal(typeof result.shell, 'string');
  assert.ok(result.note.includes('cd'));
  assert.ok('toolchain' in result);
  for (const key of ['node', 'npm', 'python', 'git']) {
    assert.ok(key in result.toolchain, `toolchain.${key} 字段存在（值可为 null = 未安装）`);
  }
});

test('BLOCK-33 P1 registry 三方对齐（def/handler/contract）+ 提供者投影', async (_t) => {
  const registry = await import('../core/biof3-server/agent-tools/registry.js');
  // buildToolRegistry 在模块加载时强校验：def/handler/contract 不齐会 throw
  const entry = registry.getToolEntry('system_info');
  assert.ok(entry, 'system_info 已注册');
  assert.equal(entry.contract.category, 'verification');
  assert.equal(entry.contract.sideEffect, 'none');
  assert.equal(entry.contract.riskTier, 'R0');
  const projected = registry.getProviderToolDefs().find((d) => d.function.name === 'system_info');
  assert.ok(projected, '提供者投影包含 system_info');
  assert.deepEqual(projected.function.parameters.properties, {});
});

test('BLOCK-33 P1 只读模式同样可用（非 mutating 不受 accessMode 限制）', async (_t) => {
  const { executeToolCall } = await import('../core/biof3-server/agent-tools/tool-execution.js');
  const envelope = await executeToolCall('system_info', {}, {
    accessMode: 'read',
    allowExecution: false,
    userId: 'local-user',
  });
  assert.equal(envelope.status, 'success');
  assert.equal(envelope.data.ok, true);
  assert.equal(envelope.sideEffects.type, 'none');
  assert.equal(envelope.terminationReason, 'success');
});
