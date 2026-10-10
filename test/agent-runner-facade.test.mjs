import { describe, it } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// BLOCK-51 测试基建修复（与 agent-concurrency.test.mjs 同一修复）：agent-runner
// 依赖链模块顶层即 prepare projects——先跑生产 migration 链再加载。
const require = createRequire(import.meta.url);
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-runner-facade-'));
process.env.PETRI_DB_PATH = path.join(tempDir, 'runner-facade.db');
const { runMigrations } = require('../src/migration-runner');
await runMigrations(process.env.PETRI_DB_PATH, path.join(__dirname, '../src/migrations'));

function resolve(...segments) {
  return path.resolve(__dirname, '..', ...segments);
}

describe('agent-runner-facade.test.mjs (BLOCK-14 PHASE 3.1 facade)', () => {
  it('exports exactly the 5 PHASE 3.1 documented APIs (no extras)', async () => {
    const mod = await import(pathToFileURL(resolve('core/petri-server/agent-runner.js')).href);
    const expected = [
      'runAgentLoop',
      'resolveAgentTaskTerminal',
      'resolveFailedJobReplacements',
      'buildObservedReplacementAttempt',
      'buildLoopObservationEvidence',
    ];
    for (const name of expected) {
      assert.strictEqual(typeof mod[name], 'function', `${name} should be a function`);
    }
    const named = Object.keys(mod).filter(
      (k) => !k.startsWith('default') && !k.startsWith('module')
    );
    assert.strictEqual(named.length, expected.length, 'no extra named exports');
    for (const name of expected) assert.ok(named.includes(name));
  });

  it('resolveAgentTaskTerminal error envelope covers all 5 branches', async () => {
    const { resolveAgentTaskTerminal } = await import(pathToFileURL(resolve('core/petri-server/agent-runner.js')).href);

    // branch 1: cancelled takes precedence
    const cancelled = resolveAgentTaskTerminal({
      cancelled: true,
      fatalError: new Error('ignored'),
      assistantText: 'long enough assistant text to satisfy completed branch',
      pendingApproval: true,
    });
    assert.strictEqual(cancelled.status, 'cancelled');
    assert.strictEqual(cancelled.error, null);

    // branch 2: fatalError → failed + error.message
    const fatal = resolveAgentTaskTerminal({ cancelled: false, fatalError: new Error('provider 502') });
    assert.strictEqual(fatal.status, 'failed');
    assert.ok(fatal.error.includes('provider 502'));

    // branch 3: long assistantText → completed
    const completed = resolveAgentTaskTerminal({ cancelled: false, fatalError: null, assistantText: 'x'.repeat(21) });
    assert.strictEqual(completed.status, 'completed');
    assert.strictEqual(completed.error, null);

    // branch 4: pendingApproval overrides short text → completed
    const pending = resolveAgentTaskTerminal({ cancelled: false, fatalError: null, assistantText: 'tiny', pendingApproval: true });
    assert.strictEqual(pending.status, 'completed');

    // branch 5: BLOCK-49 加映把完成判定放宽为「非空即完成」（原 >20 字符启发式
    // 把短回答子任务误判 failed，实机两轮触发）。本用例此前仍断言旧启发式
    // （'tiny' 期望 failed）——该分歧在 Windows 上被本文件的 import 路径错误
    // 长期掩盖（pathToFileURL 修复后本套件才首次真正执行）。
    const shortCompleted = resolveAgentTaskTerminal({ cancelled: false, fatalError: null, assistantText: 'tiny', pendingApproval: false });
    assert.strictEqual(shortCompleted.status, 'completed');
    assert.strictEqual(shortCompleted.error, null);

    // 空字符串仍判 failed（防御「模型全程无输出」的真失败）。
    const emptyFailed = resolveAgentTaskTerminal({ cancelled: false, fatalError: null, assistantText: '', pendingApproval: false });
    assert.strictEqual(emptyFailed.status, 'failed');
    assert.strictEqual(emptyFailed.error, 'agent loop 未生成有效回复');
  });

  it('resolveFailedJobReplacements fail-closed path distinguishes repaired vs unresolved', async () => {
    const { resolveFailedJobReplacements } = await import(pathToFileURL(resolve('core/petri-server/agent-runner.js')).href);

    // repaired: same-tool, higher iteration
    const repairedJobs = [
      { toolJobId: 'tj_failed', toolId: 'deseq2', status: 'failed', iteration: 1 },
      { toolJobId: 'tj_retry', toolId: 'deseq2', status: 'completed', iteration: 2 },
    ];
    const r1 = resolveFailedJobReplacements(repairedJobs);
    assert.strictEqual(r1.unresolvedFailedJobs.length, 0);
    assert.ok(r1.replacementByFailureKey.has('tj_failed'));
    assert.ok(r1.repairedFailedJobIds.has('tj_failed'));
    assert.strictEqual(r1.primaryFailed.toolJobId, 'tj_failed');

    // unresolved: different tool
    const unresolvedJobs = [
      { toolJobId: 'tj_failed', toolId: 'deseq2', status: 'failed', iteration: 1 },
      { toolJobId: 'tj_other', toolId: 'gsea', status: 'completed', iteration: 2 },
    ];
    const r2 = resolveFailedJobReplacements(unresolvedJobs);
    assert.strictEqual(r2.unresolvedFailedJobs.length, 1);
    assert.strictEqual(r2.repairedFailedJobIds.size, 0);

    // empty input → empty results, no throw
    const r3 = resolveFailedJobReplacements([]);
    assert.deepStrictEqual(r3.failedJobs, []);
    assert.strictEqual(r3.primaryFailed, null);
  });
});
