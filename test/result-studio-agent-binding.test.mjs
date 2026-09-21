import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// BLOCK-49 加映清债 —— 统一临时 DB 自举（存量：单跑/全量缺 projects 表）
//（BIOF3_DB_PATH 须在 require db.js 前生效；与 agent-tool-registry.test 同一修法）
{
  const fsx = require('node:fs');
  const osx = require('node:os');
  const pth = require('node:path');
  const urlx = require('node:url');
  const hereDir = pth.dirname(urlx.fileURLToPath(import.meta.url));
  const Database = require(pth.resolve(hereDir, '..', 'core', 'biof3-server', 'node_modules', 'better-sqlite3'));
  const tempDbDir = fsx.mkdtempSync(pth.join(osx.tmpdir(), 'biof3-sweep-db-'));
  const boot = new Database(pth.join(tempDbDir, 'biof3.db'));
  const migrationsDir = pth.resolve(hereDir, '..', 'src', 'migrations');
  for (const f of fsx.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
    boot.exec(fsx.readFileSync(pth.join(migrationsDir, f), 'utf8'));
  }
  boot.close();
  process.env.BIOF3_DB_PATH = pth.join(tempDbDir, 'biof3.db');
  process.on('exit', () => { try { fsx.rmSync(tempDbDir, { recursive: true, force: true }); } catch {} });
}
const {
  bindResultStudioContextToken,
  createResultEditProgressRecorder,
  finalizeResultEditProgress,
  projectResultStudioToolContext,
} = require('../core/biof3-server/agent-tools/result-context-binding');
const { createAgentToolInterceptor } = require('../core/biof3-server/agent-tools/agent-tool-interceptor');

const TOKEN = 'f'.repeat(64);

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

test('P4R-3 projects only the current Artifact hint and opaque token into tool context', () => {
  assert.deepEqual(projectResultStudioToolContext({
    activeArtifact: {
      jobId: 'job-1', name: 'volcano.png', revisionId: 'rev-1',
      contextToken: TOKEN, url: 'file:///must-not-cross', selectionId: 'sel-1',
    },
  }), {
    activeArtifact: { jobId: 'job-1', name: 'volcano.png', revisionId: 'rev-1' },
    resultStudioContextToken: TOKEN,
  });
});

test('P6 binds an advanced-drawer scientific acknowledgement outside model tool arguments', () => {
  const projected = projectResultStudioToolContext({
    activeArtifact: {
      jobId: 'job-1', name: 'deg_table.csv', revisionId: 'rev-1', contextToken: TOKEN,
    },
    resultEditRequest: {
      origin: 'manual', completionExpectation: 'candidate', scientificConfirmed: false,
    },
  });
  assert.equal(projected.resultStudioScientificConfirmation, false);
  assert.equal(projected.resultStudioCompletionExpectation, 'candidate');

  const acknowledged = projectResultStudioToolContext({
    activeArtifact: {
      jobId: 'job-1', name: 'deg_table.csv', revisionId: 'rev-1', contextToken: TOKEN,
    },
    resultEditRequest: {
      origin: 'manual', completionExpectation: 'candidate', scientificConfirmed: true,
    },
  });
  assert.equal(acknowledged.resultStudioScientificConfirmation, true);
});

test('P7 projects an explicit completion contract for Composer actions and read-only helpers', () => {
  const base = {
    activeArtifact: {
      jobId: 'job-1', name: 'deg_table.csv', revisionId: 'rev-1', contextToken: TOKEN,
    },
  };
  assert.equal(projectResultStudioToolContext({
    ...base,
    resultEditRequest: {
      origin: 'agent', completionExpectation: 'result_action', scientificConfirmed: false,
    },
  }).resultStudioCompletionExpectation, 'result_action');
  assert.equal(projectResultStudioToolContext({
    ...base,
    resultEditRequest: {
      origin: 'agent', completionExpectation: 'none', scientificConfirmed: false,
    },
  }).resultStudioCompletionExpectation, 'none');
});

test('P4R-3 auto-binds a missing token only for context-bound Result Studio tools', () => {
  assert.deepEqual(
    bindResultStudioContextToken('result_edit_plan_in_context', { requestedOutcome: '换配色' }, {
      resultStudioContextToken: TOKEN,
    }),
    { requestedOutcome: '换配色', contextToken: TOKEN },
  );
  assert.deepEqual(
    bindResultStudioContextToken('run_tool', { op: 'list' }, { resultStudioContextToken: TOKEN }),
    { op: 'list' },
  );
});

test('P4R-3 injects the bound token before required-schema validation', async () => {
  const interceptor = createAgentToolInterceptor({
    getToolEntry: () => ({
      definition: {
        function: {
          parameters: {
            type: 'object',
            required: ['contextToken', 'intent'],
            properties: {
              contextToken: { type: 'string' },
              intent: { type: 'object' },
            },
          },
        },
      },
      contract: { category: 'result-studio' },
      handler: async (args) => ({ ok: true, args }),
    }),
    decideAgentToolCall: () => ({ decision: 'allow' }),
  });
  assert.deepEqual(await interceptor(
    'result_changeset_create_in_context',
    { intent: {} },
    { resultStudioContextToken: TOKEN },
  ), { ok: true, args: { intent: {}, contextToken: TOKEN } });
});

test('P4R-3 never replaces an explicit stale token with the current one', () => {
  const stale = '0'.repeat(64);
  assert.deepEqual(
    bindResultStudioContextToken('result_changeset_create_in_context', {
      contextToken: stale, intent: {},
    }, { resultStudioContextToken: TOKEN }),
    { contextToken: stale, intent: {} },
  );
});

test('P4R-3 replaces transport redaction with the click-time bound token', () => {
  assert.deepEqual(
    bindResultStudioContextToken('result_changeset_create_in_context', {
      contextToken: '[REDACTED]', intent: {},
    }, { resultStudioContextToken: TOKEN }),
    { contextToken: TOKEN, intent: {} },
  );
});

test('P4R-3 does not invent a token when the Composer context is absent or malformed', () => {
  assert.deepEqual(
    bindResultStudioContextToken('result_edit_plan_in_context', { requestedOutcome: '换配色' }, {}),
    { requestedOutcome: '换配色' },
  );
  assert.deepEqual(
    bindResultStudioContextToken('result_edit_plan_in_context', { requestedOutcome: '换配色' }, {
      resultStudioContextToken: 'invalid',
    }),
    { requestedOutcome: '换配色' },
  );
});

test('P4R-3 records bounded five-stage progress and preserves terminal failure', () => {
  const recorder = createResultEditProgressRecorder();
  recorder.record({ stage: 'intent', status: 'completed' });
  recorder.record({ stage: 'plan', status: 'completed' });
  assert.deepEqual(recorder.record({
    sequence: 1,
    changeSetId: 'cs-1',
    stage: 'change_set',
    status: 'running',
    candidateCommit: 'must-not-persist',
  }), {
    resultEditProgressVersion: 1,
    sequence: 3,
    changeSetId: 'cs-1',
    stage: 'change_set',
    status: 'running',
    publicPhase: 'assess_impact',
    publicPhaseLabel: '判断影响',
  });
  recorder.record({ stage: 'materialize', status: 'completed', changeSetId: 'cs-1' });
  recorder.record({ stage: 'revision', status: 'completed', changeSetId: 'cs-1' });
  recorder.record({ stage: 'preview', status: 'ready', changeSetId: 'cs-1' });
  recorder.record({
    sequence: 2,
    changeSetId: 'cs-1',
    stage: 'failed',
    status: 'terminal',
    reason: 'validator blocked',
  });
  const snapshot = recorder.snapshot();
  assert.equal(snapshot.length, 7);
  assert.deepEqual(
    [...new Set(snapshot.map((event) => event.publicPhase).filter(Boolean))],
    ['understand_intent', 'assess_impact', 'execute_or_recompute', 'validate', 'candidate_comparable'],
  );
  assert.equal(snapshot[2].candidateCommit, undefined);
  assert.deepEqual(snapshot[6], {
    resultEditProgressVersion: 1,
    sequence: 7,
    changeSetId: 'cs-1',
    stage: 'failed',
    status: 'terminal',
    reason: 'validator blocked',
  });
  assert.equal(recorder.ensureTerminal({ stage: 'cancelled', reason: 'user_cancelled' }), null);
});

test('P4R-3 uses one executable finalizer for returned provider errors and normal cancellation', () => {
  const failedRecorder = createResultEditProgressRecorder();
  failedRecorder.record({ stage: 'plan', status: 'running' });
  const failed = finalizeResultEditProgress(failedRecorder, {
    outcome: 'failed', reason: 'agent_run_failed',
  });
  assert.equal(failed.terminal.stage, 'failed');
  assert.equal(failed.terminal.status, 'terminal');
  assert.match(failed.assistantMessage, /结果修改未完成/);

  const cancelledRecorder = createResultEditProgressRecorder();
  cancelledRecorder.record({ stage: 'materialize', status: 'running' });
  const cancelled = finalizeResultEditProgress(cancelledRecorder, {
    outcome: 'cancelled', reason: 'user_cancelled',
  });
  assert.equal(cancelled.terminal.stage, 'cancelled');
  assert.match(cancelled.assistantMessage, /结果修改已停止/);
});

test('P4R-3 wires the context/progress helpers into the durable task production path', () => {
  // 任务路径（BLOCK-49 对齐 thin-facade 现状）：agent-runner 投影上下文与失败原因，
  // loop-orchestrator 承载进度记录/完成守卫/终态收尾。
  // BLOCK-109-CORE-ARCH P1 — legacy SSE 路径（chat.js 内的 guard 接线）已物理退役，
  // 原 chat.js 断言段随之删除；durable 路径即唯一生产路径。
  const runnerText = source('core/biof3-server/agent-runner.js');
  assert.match(runnerText, /\.\.\.projectResultStudioToolContext\(context\)/);
  assert.match(runnerText, /providerFailureReason/);

  const orchestratorText = source('core/biof3-server/loop-orchestrator.js');
  for (const pattern of [
    /createResultEditProgressRecorder\(\)/,
    /providerFailureReason/,
    /finalizeResultEditProgress\(resultEditProgress/,
    /agent_run_failed/,
    /createResultEditCompletionGuard/,
    /resultEditCompletionGuard\.recordToolResult\(name, result\)/,
    /result_edit_completion_retry/,
    /resultEditCompletionGuard\.requiresToolExecution\(\)/,
  ]) {
    assert.match(orchestratorText, pattern);
  }
  assert.match(source('core/biof3-server/agent-tools/result-context-binding.js'), /已完成的阶段结论已保留/);
});
