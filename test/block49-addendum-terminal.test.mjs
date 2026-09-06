'use strict';

/**
 * BLOCK-49 加映 — resolveAgentTaskTerminal 完成判定行为单测。
 *
 * 原 >20 字符启发式把短回答子任务（纯算式 14 字符）误判 failed（实机两轮），
 * 放宽为非空即完成；空字符串仍判 failed（防御「模型全程无输出」真失败）。
 */

import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const R_SERVER = path.resolve(__dirname, '..', 'core', 'biof3-server');

// require 链（agent-runner → agent-task-store → db.js）需要 schema 就绪的 DB
//（与 agent-tool-registry.test.mjs 同一自举手法：BIOF3_DB_PATH 须在 require 前生效）
{
  const fs = require('node:fs');
  const os = require('node:os');
  const Database = require(path.join(R_SERVER, 'node_modules', 'better-sqlite3'));
  const tempDbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'biof3-b49add-db-'));
  const boot = new Database(path.join(tempDbDir, 'biof3.db'));
  const migrationsDir = path.resolve(__dirname, '..', 'src', 'migrations');
  for (const f of fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
    boot.exec(fs.readFileSync(path.join(migrationsDir, f), 'utf8'));
  }
  boot.close();
  process.env.BIOF3_DB_PATH = path.join(tempDbDir, 'biof3.db');
  process.on('exit', () => {
    try { fs.rmSync(tempDbDir, { recursive: true, force: true }); } catch {}
  });
}

const { resolveAgentTaskTerminal } = require(
  path.join(__dirname, '..', 'core', 'biof3-server', 'agent-runner.js'),
);

describe('终态判定（BLOCK-49 加映：非空即完成）', () => {
  test('短回答（14 字符算式）→ completed', () => {
    const t = resolveAgentTaskTerminal({ assistantText: '17 * 23 = 391' });
    assert.equal(t.status, 'completed');
    assert.equal(t.error, null);
  });

  test('极短回答（1 字符）→ completed', () => {
    const t = resolveAgentTaskTerminal({ assistantText: '好' });
    assert.equal(t.status, 'completed');
  });

  test('空白文本 → failed（空回答防御保留）', () => {
    assert.equal(resolveAgentTaskTerminal({ assistantText: '' }).status, 'failed');
    assert.equal(resolveAgentTaskTerminal({ assistantText: '   \n  ' }).status, 'failed');
    assert.equal(resolveAgentTaskTerminal({}).status, 'failed');
  });

  test('cancelled 优先于文本判定', () => {
    const t = resolveAgentTaskTerminal({ cancelled: true, assistantText: '' });
    assert.equal(t.status, 'cancelled');
  });

  test('fatalError 优先于文本判定且携带错误信息', () => {
    const t = resolveAgentTaskTerminal({ fatalError: new Error('boom'), assistantText: 'x' });
    assert.equal(t.status, 'failed');
    assert.equal(t.error, 'boom');
  });

  test('pendingApproval → completed（确认流不算失败）', () => {
    const t = resolveAgentTaskTerminal({ assistantText: '', pendingApproval: true });
    assert.equal(t.status, 'completed');
  });
});
