import { describe, it } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// BLOCK-51 测试基建修复（与 agent-concurrency.test.mjs 同一修复）：loop-orchestrator
// 依赖链模块顶层即 prepare projects——先跑生产 migration 链再加载。
const require = createRequire(import.meta.url);
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'biof3-runner-loop-'));
process.env.BIOF3_DB_PATH = path.join(tempDir, 'runner-loop.db');
const { runMigrations } = require('../src/migration-runner');
await runMigrations(process.env.BIOF3_DB_PATH, path.join(__dirname, '../src/migrations'));

function resolve(...segments) {
  return path.resolve(__dirname, '..', ...segments);
}

describe('agent-runner-loop-orchestrator.test.mjs (BLOCK-14 PHASE 3.1 state machine)', () => {
  it('exports runLoop as the sole public API and preserves PHASE 3.1 contract', async () => {
    const mod = await import(pathToFileURL(resolve('core/biof3-server/loop-orchestrator.js')).href);
    assert.strictEqual(typeof mod.runLoop, 'function', 'runLoop must be exported');
    assert.strictEqual(mod.runLoop.constructor.name, 'AsyncFunction', 'runLoop must be async');

    // loop-orchestrator is the pure state machine; PHASE 3.1 forbids harness-workflow-state
    // imports because shared-backend must not reverse-require into biof3-server.
    const src = readFileSync(resolve('core/biof3-server/loop-orchestrator.js'), 'utf8');
    assert.equal(
      /require.*harness-workflow-state/.test(src),
      false,
      'loop-orchestrator.js must not require harness-workflow-state (A-001 PHASE 3.1 contract)',
    );

    // runLoop destructure contract: 9 documented config fields
    const configFields = [
      'userId', 'conversationId', '_activeConv', 'apiKey',
      'providerName', 'modelName', 'profileId', 'baseUrl',
    ];
    for (const field of configFields) {
      assert.ok(src.includes(`    ${field},`) || src.includes(`  ${field},`) || src.includes(`${field},`), `config.${field} must be destructured by runLoop`);
    }
  });

  it('runLoop input contract requires the 9 callbacks + config + conversationState', async () => {
    const src = readFileSync(resolve('core/biof3-server/loop-orchestrator.js'), 'utf8');

    // Function signature destructures 9 named top-level opts
    const requiredOpts = [
      'messages', 'toolCtx', 'shouldAbort',
      'emitToolResult', 'emitAssistant', 'emitDone',
      'callChatProvider', 'config', 'conversationState',
    ];
    for (const opt of requiredOpts) {
      assert.ok(src.includes(`${opt},`), `runLoop signature must include ${opt}`);
    }

    // 6 loop state variables are declared at the top of runLoop body
    for (const loopVar of [
      'loopState', 'loopRunId', 'loopSequence', 'loopIterations',
      'loopAbortedByController', 'loopPublicConclusion',
    ]) {
      assert.ok(src.includes(`let ${loopVar}`), `runLoop body must declare ${loopVar}`);
    }

    // Return shape: documented in PHASE 3.1 mapping (shorthand or key:value)
    for (const returnField of [
      'assistantText', 'loopRunId', 'loopState',
      'cancellationObserved', 'loopAbortedByController',
      'providerFailureReason', 'finalizationAttempts',
      'fatalAgentError', 'pendingApprovalEmitted',
    ]) {
      const re = new RegExp(`(^|[\\s,{])${returnField}([\\s,:}])`);
      assert.ok(re.test(src), `runLoop return must include ${returnField}`);
    }
  });

  it('agent-runner facade correctly wires runLoop with 4 emit callbacks and config', async () => {
    const facadeSrc = readFileSync(resolve('core/biof3-server/agent-runner.js'), 'utf8');

    // facade must require loop-orchestrator's runLoop
    assert.ok(
      facadeSrc.includes("require('./loop-orchestrator')"),
      'agent-runner.js must require loop-orchestrator',
    );

    // The runLoop(...) call begins with 'await runLoop({' and ends at the matching '});'.
    // Use a brace-balanced slice to avoid the inner 'emitDone: () => _emit({ event: "done" })'
    // confusing a simple regex.
    const startIdx = facadeSrc.indexOf('await runLoop({');
    assert.notStrictEqual(startIdx, -1, 'facade must call await runLoop(...)');
    let depth = 0;
    let endIdx = -1;
    for (let i = startIdx + 'await runLoop('.length; i < facadeSrc.length; i++) {
      const c = facadeSrc[i];
      if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) { endIdx = i + 1; break; } // include closing '}'
      }
    }
    assert.notStrictEqual(endIdx, -1, 'runLoop call must have a balanced closing brace');
    const inner = facadeSrc.slice(startIdx, endIdx);

    for (const field of [
      'emitToolResult', 'emitAssistant', 'emitDone',
      'callChatProvider', 'config', 'conversationState',
    ]) {
      assert.ok(inner.includes(field), `runLoop wiring must pass ${field}`);
    }

    // Emit helpers in facade must forward through the _emit closure that wraps
    // onEvent + task_events persistence.
    assert.ok(inner.includes('emitToolResult: (evt) => _emit(evt)'), 'emitToolResult must forward via _emit');
    assert.ok(inner.includes('emitAssistant: (evt) => _emit(evt)'), 'emitAssistant must forward via _emit');
    assert.ok(inner.includes("emitDone: () => _emit({ event: 'done' })"), 'emitDone must emit a done event');
  });
});
