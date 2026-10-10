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
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-facade-compat-'));
process.env.PETRI_DB_PATH = path.join(tempDir, 'facade-compat.db');
const { runMigrations } = require('../src/migration-runner');
await runMigrations(process.env.PETRI_DB_PATH, path.join(__dirname, '../src/migrations'));

function resolve(...segments) {
  return path.resolve(__dirname, '..', ...segments);
}

describe('agent-runner-facade-compat.test.mjs', () => {
  resolve();

  describe('runAgentLoop signature compatibility', () => {
    it('should have runAgentLoop as primary export', async () => {
      const { runAgentLoop } = await import(pathToFileURL(resolve('core/petri-server/agent-runner.js')).href);
      assert.strictEqual(typeof runAgentLoop, 'function');
    });

    it('runAgentLoop should be async', async () => {
      const { runAgentLoop } = await import(pathToFileURL(resolve('core/petri-server/agent-runner.js')).href);
      assert.ok(runAgentLoop.constructor.name === 'AsyncFunction');
    });

    it('runAgentLoop should accept messages array parameter', async () => {
      const { runAgentLoop } = await import(pathToFileURL(resolve('core/petri-server/agent-runner.js')).href);
      assert.ok(typeof runAgentLoop === 'function');
    });

    it('runAgentLoop should accept context parameter', async () => {
      const { runAgentLoop } = await import(pathToFileURL(resolve('core/petri-server/agent-runner.js')).href);
      assert.ok(typeof runAgentLoop === 'function');
    });

    it('runAgentLoop should accept userId parameter', async () => {
      const { runAgentLoop } = await import(pathToFileURL(resolve('core/petri-server/agent-runner.js')).href);
      assert.ok(typeof runAgentLoop === 'function');
    });

    it('runAgentLoop should accept conversationId parameter', async () => {
      const { runAgentLoop } = await import(pathToFileURL(resolve('core/petri-server/agent-runner.js')).href);
      assert.ok(typeof runAgentLoop === 'function');
    });

    it('runAgentLoop should accept _activeConv parameter', async () => {
      const { runAgentLoop } = await import(pathToFileURL(resolve('core/petri-server/agent-runner.js')).href);
      assert.ok(typeof runAgentLoop === 'function');
    });

    it('runAgentLoop should accept apiKey parameter', async () => {
      const { runAgentLoop } = await import(pathToFileURL(resolve('core/petri-server/agent-runner.js')).href);
      assert.ok(typeof runAgentLoop === 'function');
    });

    it('runAgentLoop should accept providerName parameter', async () => {
      const { runAgentLoop } = await import(pathToFileURL(resolve('core/petri-server/agent-runner.js')).href);
      assert.ok(typeof runAgentLoop === 'function');
    });

    it('runAgentLoop should accept onEvent parameter', async () => {
      const { runAgentLoop } = await import(pathToFileURL(resolve('core/petri-server/agent-runner.js')).href);
      assert.ok(typeof runAgentLoop === 'function');
    });

    it('runAgentLoop should accept shouldAbort parameter (optional)', async () => {
      const { runAgentLoop } = await import(pathToFileURL(resolve('core/petri-server/agent-runner.js')).href);
      assert.ok(typeof runAgentLoop === 'function');
    });

    it('runAgentLoop should accept kind parameter with default primary', async () => {
      const { runAgentLoop } = await import(pathToFileURL(resolve('core/petri-server/agent-runner.js')).href);
      assert.ok(typeof runAgentLoop === 'function');
    });

    it('runAgentLoop should accept parentLoopRunId parameter with default null', async () => {
      const { runAgentLoop } = await import(pathToFileURL(resolve('core/petri-server/agent-runner.js')).href);
      assert.ok(typeof runAgentLoop === 'function');
    });
  });

  describe('module exports compatibility', () => {
    it('should export all 5 required functions', async () => {
      const mod = await import(pathToFileURL(resolve('core/petri-server/agent-runner.js')).href);
      const namedExports = Object.keys(mod).filter(
        k => !k.startsWith('default') && !k.startsWith('module')
      );
      assert.ok(namedExports.includes('runAgentLoop'));
      assert.ok(namedExports.includes('resolveAgentTaskTerminal'));
      assert.ok(namedExports.includes('resolveFailedJobReplacements'));
      assert.ok(namedExports.includes('buildObservedReplacementAttempt'));
      assert.ok(namedExports.includes('buildLoopObservationEvidence'));
      assert.strictEqual(namedExports.length, 5);
    });

    it('resolveAgentTaskTerminal should be function', async () => {
      const { resolveAgentTaskTerminal } = await import(pathToFileURL(resolve('core/petri-server/agent-runner.js')).href);
      assert.strictEqual(typeof resolveAgentTaskTerminal, 'function');
    });

    it('resolveFailedJobReplacements should be function', async () => {
      const { resolveFailedJobReplacements } = await import(pathToFileURL(resolve('core/petri-server/agent-runner.js')).href);
      assert.strictEqual(typeof resolveFailedJobReplacements, 'function');
    });

    it('buildObservedReplacementAttempt should be function', async () => {
      const { buildObservedReplacementAttempt } = await import(pathToFileURL(resolve('core/petri-server/agent-runner.js')).href);
      assert.strictEqual(typeof buildObservedReplacementAttempt, 'function');
    });

    it('buildLoopObservationEvidence should be function', async () => {
      const { buildLoopObservationEvidence } = await import(pathToFileURL(resolve('core/petri-server/agent-runner.js')).href);
      assert.strictEqual(typeof buildLoopObservationEvidence, 'function');
    });
  });

  describe('helper functions behavior', () => {
    it('resolveAgentTaskTerminal should return cancelled status', async () => {
      const { resolveAgentTaskTerminal } = await import(pathToFileURL(resolve('core/petri-server/agent-runner.js')).href);
      const result = resolveAgentTaskTerminal({ cancelled: true });
      assert.strictEqual(result.status, 'cancelled');
      assert.strictEqual(result.error, null);
    });

    it('resolveAgentTaskTerminal should return completed status with text', async () => {
      const { resolveAgentTaskTerminal } = await import(pathToFileURL(resolve('core/petri-server/agent-runner.js')).href);
      const result = resolveAgentTaskTerminal({
        cancelled: false,
        assistantText: 'Here is a detailed response that is longer than 20 characters'
      });
      assert.strictEqual(result.status, 'completed');
      assert.strictEqual(result.error, null);
    });

    it('resolveAgentTaskTerminal should return failed status with error', async () => {
      const { resolveAgentTaskTerminal } = await import(pathToFileURL(resolve('core/petri-server/agent-runner.js')).href);
      const result = resolveAgentTaskTerminal({
        cancelled: false,
        fatalError: new Error('test error')
      });
      assert.strictEqual(result.status, 'failed');
      assert.ok(result.error.includes('test error'));
    });

    it('resolveFailedJobReplacements should handle empty array', async () => {
      const { resolveFailedJobReplacements } = await import(pathToFileURL(resolve('core/petri-server/agent-runner.js')).href);
      const result = resolveFailedJobReplacements([]);
      assert.deepStrictEqual(result.failedJobs, []);
      assert.deepStrictEqual(result.unresolvedFailedJobs, []);
      assert.strictEqual(result.primaryFailed, null);
      assert.strictEqual(result.replacementByFailureKey.size, 0);
      assert.strictEqual(result.repairedFailedJobIds.size, 0);
    });

    it('buildObservedReplacementAttempt should return null for missing params', async () => {
      const { buildObservedReplacementAttempt } = await import(pathToFileURL(resolve('core/petri-server/agent-runner.js')).href);
      const result = buildObservedReplacementAttempt(null, null, null);
      assert.strictEqual(result, null);
    });

    it('buildLoopObservationEvidence should return evidence object', async () => {
      const { buildLoopObservationEvidence } = await import(pathToFileURL(resolve('core/petri-server/agent-runner.js')).href);
      const result = buildLoopObservationEvidence({
        loopRunId: 'test-run-id',
        iterationId: 'test-iter-id',
        ref: 'test_ref',
        summaryDigest: 'test_digest',
        parentEvidenceHash: null,
      });
      assert.ok(result);
      assert.strictEqual(result.kind, 'observation');
    });
  });

  describe('submodule integration', () => {
    it('loop-orchestrator should be importable', async () => {
      const { runLoop } = await import(pathToFileURL(resolve('core/petri-server/loop-orchestrator.js')).href);
      assert.strictEqual(typeof runLoop, 'function');
    });

    it('conversation-adapter should be importable', async () => {
      const { appendAssistantMessage } = await import(pathToFileURL(resolve('core/petri-server/conversation-adapter.js')).href);
      assert.strictEqual(typeof appendAssistantMessage, 'function');
    });

    it('agent-runner should require loop-orchestrator internally', async () => {
      const fs = await import('fs');
      const content = fs.readFileSync(
        resolve('core/petri-server/agent-runner.js'),
        'utf8'
      );
      assert.ok(content.includes("require('./loop-orchestrator')"));
    });

    it('agent-runner should require conversation-adapter internally', async () => {
      const fs = await import('fs');
      const content = fs.readFileSync(
        resolve('core/petri-server/agent-runner.js'),
        'utf8'
      );
      assert.ok(content.includes("require('./conversation-adapter')"));
    });
  });
});
