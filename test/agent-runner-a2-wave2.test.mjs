import { describe, it } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 与 agent-runner-facade*.test.mjs 同一测试基建：依赖链模块顶层即 prepare projects。
const require = createRequire(import.meta.url);
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-a2-wave2-'));
process.env.PETRI_DB_PATH = path.join(tempDir, 'a2-wave2.db');
const { runMigrations } = require('../src/migration-runner');
await runMigrations(process.env.PETRI_DB_PATH, path.join(__dirname, '../src/migrations'));

function resolve(...segments) {
  return path.resolve(__dirname, '..', ...segments);
}
const runnerPath = resolve('core/petri-server/agent-runner.js');
const helpersPath = resolve('core/petri-server/helpers/agent-loop-helpers.js');
const runnerUrl = pathToFileURL(runnerPath).href;
const helpersUrl = pathToFileURL(helpersPath).href;

const EXPECTED_EXPORTS = [
  'runAgentLoop',
  'resolveAgentTaskTerminal',
  'resolveFailedJobReplacements',
  'buildObservedReplacementAttempt',
  'buildLoopObservationEvidence',
];

// 行为等价矩阵：facade 与抽出模块在同一组输入上必须逐字等价。
const TERMINAL_CASES = [
  [{ cancelled: true, fatalError: new Error('ignored'), assistantText: 'text', pendingApproval: true }],
  [{ cancelled: false, fatalError: new Error('provider 502') }],
  [{ cancelled: false, fatalError: 'string failure' }],
  [{ cancelled: false, fatalError: null, assistantText: 'tiny', pendingApproval: false }],
  [{ cancelled: false, fatalError: null, assistantText: 'tiny', pendingApproval: true }],
  [{ cancelled: false, fatalError: null, assistantText: '', pendingApproval: false }],
  [{ cancelled: false, fatalError: null, assistantText: '   ', pendingApproval: false }],
  [{}],
];

const REPLACEMENT_CASES = [
  [[]],
  [[
    { toolJobId: 'tj_failed', toolId: 'deseq2', status: 'failed', iteration: 1 },
    { toolJobId: 'tj_retry', toolId: 'deseq2', status: 'completed', iteration: 2 },
  ]],
  [[
    { toolJobId: 'tj_failed', toolId: 'deseq2', status: 'failed', iteration: 1 },
    { toolJobId: 'tj_other', toolId: 'gsea', status: 'completed', iteration: 2 },
  ]],
  [[
    { callId: 'c1', toolId: 'a', status: 'blocked', iteration: 1 },
    { callId: 'c2', toolId: 'a', status: 'completed', iteration: 3 },
  ]],
  [[
    { toolJobId: 'tj_f1', jobTruth: { tool_id: 'x' }, status: 'failed', iteration: 1 },
    { toolJobId: 'tj_r1', jobTruth: { tool_id: 'x' }, status: 'completed', iteration: 2 },
  ]],
];

const OBSERVED_ATTEMPT_CASES = [
  [null, null, null],
  [{ faultType: 'tool_error' }, { toolJobId: 'failed', toolId: 't' }, { toolJobId: 'repl', toolId: 't' }],
  [{}, { toolJobId: 'failed', jobTruth: { tool_id: 'jt' } }, { toolJobId: 'repl', jobTruth: { tool_id: 'jt2' } }],
  [{ faultType: 'x' }, { toolJobId: 'failed' }, {}],
];

// 显式注入 evidenceId/createdAt，消除 nowIso/generateId 的时钟差，保证确定性比较。
const EVIDENCE_CASES = [
  [{
    evidenceId: 'evid_fixed_1',
    loopRunId: 'loop-1',
    iterationId: 'iter-1',
    ref: 'ref_1',
    summaryDigest: 'digest_1',
    createdAt: '2026-11-25T00:00:00.000Z',
    parentEvidenceHash: null,
  }],
  [{
    evidenceId: 'evid_fixed_2',
    loopRunId: null,
    iterationId: null,
    kind: 'OVERRIDDEN_BY_WRAPPER',
    ref: 'secret-token',
    summaryDigest: '',
    createdAt: '2026-11-25T01:02:03.000Z',
    parentEvidenceHash: 'parent-hash',
  }],
];

describe('A2 WAVE2 — agent-runner.js 纯函数拆解 HK-01', () => {
  describe('facade 兼容（外部 require 零变化）', () => {
    it('agent-runner 恰好导出 5 个 API，无增无减', async () => {
      const mod = await import(runnerUrl);
      const named = Object.keys(mod).filter(
        (k) => !k.startsWith('default') && !k.startsWith('module')
      );
      assert.deepStrictEqual(named.sort(), [...EXPECTED_EXPORTS].sort());
      const {
        runAgentLoop,
        resolveAgentTaskTerminal,
        resolveFailedJobReplacements,
        buildObservedReplacementAttempt,
        buildLoopObservationEvidence,
      } = mod;
      for (const [name, fn] of Object.entries({
        runAgentLoop,
        resolveAgentTaskTerminal,
        resolveFailedJobReplacements,
        buildObservedReplacementAttempt,
        buildLoopObservationEvidence,
      })) {
        assert.strictEqual(typeof fn, 'function', `${name} 必须是函数`);
      }
    });

    it('runAgentLoop 仍为 async 函数', async () => {
      const { runAgentLoop } = await import(runnerUrl);
      assert.strictEqual(runAgentLoop.constructor.name, 'AsyncFunction');
    });
  });

  describe('行为等价契约（facade 与抽出模块逐输入 deepStrictEqual）', () => {
    it('resolveAgentTaskTerminal 等价（覆盖 8 条分支）', async () => {
      const facade = await import(runnerUrl);
      const helpers = await import(helpersUrl);
      assert.strictEqual(
        facade.resolveAgentTaskTerminal,
        helpers.resolveAgentTaskTerminal,
        'facade 必须直接重导出抽出模块实现'
      );
      for (const [opts] of TERMINAL_CASES) {
        assert.deepStrictEqual(
          facade.resolveAgentTaskTerminal(opts),
          helpers.resolveAgentTaskTerminal(opts)
        );
      }
    });

    it('resolveFailedJobReplacements 等价（含 Set/Map 形状）', async () => {
      const facade = await import(runnerUrl);
      const helpers = await import(helpersUrl);
      assert.strictEqual(facade.resolveFailedJobReplacements, helpers.resolveFailedJobReplacements);
      for (const [jobs] of REPLACEMENT_CASES) {
        assert.deepStrictEqual(
          facade.resolveFailedJobReplacements(jobs),
          helpers.resolveFailedJobReplacements(jobs)
        );
      }
    });

    it('buildObservedReplacementAttempt 等价', async () => {
      const facade = await import(runnerUrl);
      const helpers = await import(helpersUrl);
      assert.strictEqual(facade.buildObservedReplacementAttempt, helpers.buildObservedReplacementAttempt);
      for (const args of OBSERVED_ATTEMPT_CASES) {
        assert.deepStrictEqual(
          facade.buildObservedReplacementAttempt(...args),
          helpers.buildObservedReplacementAttempt(...args)
        );
      }
    });

    it('buildLoopObservationEvidence 等价（kind 恒被 wrapper 覆盖为 observation）', async () => {
      const facade = await import(runnerUrl);
      const helpers = await import(helpersUrl);
      assert.strictEqual(facade.buildLoopObservationEvidence, helpers.buildLoopObservationEvidence);
      for (const [input] of EVIDENCE_CASES) {
        const a = facade.buildLoopObservationEvidence(input);
        const b = helpers.buildLoopObservationEvidence(input);
        assert.deepStrictEqual(a, b);
        assert.strictEqual(a.kind, 'observation');
      }
    });
  });

  describe('私有纯函数 _applyProjectTrustCeiling（非 facade 导出，行为对基线快照等价）', () => {
    it('抽出模块行为对拆前基线快照逐字等价', async () => {
      const helpers = await import(helpersUrl);
      assert.strictEqual(typeof helpers._applyProjectTrustCeiling, 'function');
      const contexts = [
        null,
        {},
        { accessMode: 'read' },
        { accessMode: 'plan' },
        { accessMode: 'workspace-write', projectId: 'p1' },
        { accessMode: 'full', projectId: 'p1' },
        { accessMode: 'bogus' },
        { accessMode: 'full', projectId: '' },
        { projectId: 'p1' },
      ];
      // 拆前基线（agent-runner.js 原实现逐字快照，见证据文件）
      const baseline = ['full', 'full', 'read', 'plan', 'workspace-write', 'full', 'full', 'full', 'full'];
      const out = contexts.map((c) => helpers._applyProjectTrustCeiling(c));
      assert.deepStrictEqual(out, baseline);
    });

    it('agent-runner 从 helper 导入并仍在 toolCtx 调用（未改调用点）', () => {
      const src = fs.readFileSync(runnerPath, 'utf8');
      assert.ok(
        src.includes("require('./helpers/agent-loop-helpers')"),
        '必须从 helper 导入'
      );
      assert.ok(
        src.includes('accessMode: _applyProjectTrustCeiling(context)'),
        'toolCtx 调用点必须逐字保留'
      );
    });
  });

  describe('注入点语义完整断言（D1 已合回 · wave2 拆解未破坏注入点）', () => {
    it('自进化注入块语义完整：D1 guard 已接线 + wave2 facade 重导出在场', () => {
      const src = fs.readFileSync(runnerPath, 'utf8');
      // D1 guard：真源判据（listActiveLessons + verifyLessonFrequency）必须先过 guard 再写注入
      const guardCall = "require('./helpers/lesson-injection-guard').guardLessonInjection(listActiveLessons(8), verifyLessonFrequency)";
      const guardIdx = src.indexOf(guardCall);
      const writeIdx = src.indexOf('ctxForPrompt.selfEvolutionLessons = lessons;');
      assert.ok(guardIdx >= 0, 'D1 guardLessonInjection 必须在注入点接线（真源判据入场）');
      assert.ok(writeIdx > guardIdx, 'guard 必须先于 lesson 注入赋值（冻结判定不绕过）');
      assert.ok(
        src.includes('if (lessons.length > 0) ctxForPrompt.selfEvolutionLessons = lessons;'),
        'D1 改写后的注入赋值行必须逐字在场'
      );
      assert.ok(
        src.includes('} catch { /* 自进化经验读取 / 冻结失败不影响本轮运行 */ }'),
        'fail-soft catch 注释必须逐字在场'
      );
      // wave2 门禁力保留：拆解后主文件仍从 helper 重导出，注入点未被内联改写
      assert.ok(
        src.includes("require('./helpers/agent-loop-helpers')"),
        'wave2 facade 重导出必须仍在场（注入点未被拆解内联破坏）'
      );
    });

    it('runAgentLoop 主循环体仍在 agent-runner.js（未外迁）', () => {
      const src = fs.readFileSync(runnerPath, 'utf8');
      assert.ok(src.includes('async function runAgentLoop({'), 'runAgentLoop 定义必须留在主文件');
      assert.ok(src.includes('await runLoop({'), 'runLoop 调用必须留在主文件');
    });
  });
});
