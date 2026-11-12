import { describe, it } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// BLOCK-51 测试基建修复（与 agent-concurrency.test.mjs 同一修复）：模块顶层
// require ./db 即 prepare projects——全新环境必须先跑生产 migration 链再加载，
// 否则 SQLITE_ERROR（block-30 后既有损坏，本轮顺带修复）。
const require = createRequire(import.meta.url);
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'petri-loop-subdomains-'));
process.env.PETRI_DB_PATH = path.join(tempDir, 'loop-subdomains.db');
const { runMigrations } = require('../src/migration-runner');
await runMigrations(process.env.PETRI_DB_PATH, path.join(__dirname, '../src/migrations'));

function resolve(...segments) {
  return path.resolve(__dirname, '..', ...segments);
}

describe('loop-orchestrator-subdomains.test.mjs', () => {
  resolve();

  describe('loop-orchestrator.js', () => {
    it('should require without error', async () => {
      const mod = await import(pathToFileURL(resolve('core/petri-server/loop-orchestrator.js')).href);
      assert.ok(mod, 'module should be loaded');
    });

    it('should export runLoop function', async () => {
      const { runLoop } = await import(pathToFileURL(resolve('core/petri-server/loop-orchestrator.js')).href);
      assert.strictEqual(typeof runLoop, 'function', 'runLoop should be a function');
    });

    it('runLoop should be async function', async () => {
      const { runLoop } = await import(pathToFileURL(resolve('core/petri-server/loop-orchestrator.js')).href);
      assert.ok(runLoop.constructor.name === 'AsyncFunction', 'runLoop should be async');
    });

    it('should NOT reference harness-workflow-state', async () => {
      const fs = await import('fs');
      const content = fs.readFileSync(
        resolve('core/petri-server/loop-orchestrator.js'),
        'utf8'
      );
      const matches = content.match(/require.*harness-workflow-state|harnessWorkflowState/g);
      assert.strictEqual(
        matches && matches.length > 0 ? 'found' : 'not found',
        'not found',
        'loop-orchestrator.js must not reference harness-workflow-state'
      );
    });
  });

  describe('conversation-adapter.js', () => {
    it('should require without error', async () => {
      const mod = await import(pathToFileURL(resolve('core/petri-server/conversation-adapter.js')).href);
      assert.ok(mod, 'module should be loaded');
    });

    it('should export required functions', async () => {
      const mod = await import(pathToFileURL(resolve('core/petri-server/conversation-adapter.js')).href);
      assert.strictEqual(typeof mod.appendAssistantMessage, 'function');
      assert.strictEqual(typeof mod.appendUserMessage, 'function');
      assert.strictEqual(typeof mod.saveChatTurnToMemory, 'function');
      assert.strictEqual(typeof mod.triggerBackgroundFactExtraction, 'function');
      assert.strictEqual(typeof mod.triggerChatSummary, 'function');
      assert.strictEqual(typeof mod.logAudit, 'function');
      assert.strictEqual(typeof mod.buildConversationMetadata, 'function');
      assert.strictEqual(typeof mod.announceActiveConversation, 'function');
    });

    it('should re-export conversation helpers', async () => {
      const mod = await import(pathToFileURL(resolve('core/petri-server/conversation-adapter.js')).href);
      assert.strictEqual(typeof mod.getOrCreateActiveConversation, 'function');
      assert.strictEqual(typeof mod.appendMessageToConversation, 'function');
      assert.strictEqual(typeof mod._maybeAutoTitleConversation, 'function');
      assert.strictEqual(typeof mod._maybeDetectTopicShift, 'function');
    });
  });

  describe('agent-runner.js facade', () => {
    it('should require without error', async () => {
      const mod = await import(pathToFileURL(resolve('core/petri-server/agent-runner.js')).href);
      assert.ok(mod, 'module should be loaded');
    });

    it('should export runAgentLoop function', async () => {
      const { runAgentLoop } = await import(pathToFileURL(resolve('core/petri-server/agent-runner.js')).href);
      assert.strictEqual(typeof runAgentLoop, 'function', 'runAgentLoop should be a function');
    });

    it('runAgentLoop should be async function', async () => {
      const { runAgentLoop } = await import(pathToFileURL(resolve('core/petri-server/agent-runner.js')).href);
      assert.ok(runAgentLoop.constructor.name === 'AsyncFunction', 'runAgentLoop should be async');
    });

    it('should export 5 named functions (signature unchanged)', async () => {
      const mod = await import(pathToFileURL(resolve('core/petri-server/agent-runner.js')).href);
      const namedExports = Object.keys(mod).filter(
        k => !k.startsWith('default') && !k.startsWith('module')
      );
      const expected = [
        'buildLoopObservationEvidence',
        'buildObservedReplacementAttempt',
        'resolveAgentTaskTerminal',
        'resolveFailedJobReplacements',
        'runAgentLoop',
      ].sort();

      assert.deepStrictEqual(namedExports.sort(), expected, 'named exports should match pre-split interface');
    });

    it('runAgentLoop should be callable with documented parameters', async () => {
      const { runAgentLoop } = await import(pathToFileURL(resolve('core/petri-server/agent-runner.js')).href);
      // runAgentLoop uses destructuring with defaults, so length reports all params
      // We verify it's a function that can be called
      assert.ok(typeof runAgentLoop === 'function', 'runAgentLoop should be callable');
    });
  });

  describe('line count targets', () => {
    // BLOCK-375（S0）——旧上限（970/1250/450）在 HEAD a2354ffb 已全部违反
    // （agent-runner 1140 / loop-orchestrator 1570 / conversation-adapter 461+，
    // 与昨日 wave-0 分片同谱系），断言沦为常红化石。按 W5b 惯例转为
    // 「锚定现值只减不增」真棘轮：任何增长即红，收缩后手动下调锚。
    // 真正拆分回收走蓝图 S4.1（runLoop 五段拆分 + 行数下降），不在此夹带。
    // POST-S7 H0——loop-orchestrator 锚 1572 落后现值 1579（+7）：BLOCK-376（1a439237）S1
    // compaction_failed 事件生产 + provider_retry 投影为合法增长，收口时未同步重锚。
    // 按本测试自己的纪律「增长需显式重锚留因」重锚到 1579（只减不增继续生效）。
    const LINE_ANCHORS = [
      // BLOCK-437 锚点修正：BLOCK-398（89568433）已有 additive 增长但当时未重锚，
      // 现值 1143 与锚点 1140 长期不一致（存量红）。按本测试自述「增长需显式重锚留因」校正到 1143，
      // 语义仍是只减不增；后续收缩走蓝图 S4.1 拆分回收。
      { file: 'core/petri-server/agent-runner.js', anchor: 1143 },
      { file: 'core/petri-server/loop-orchestrator.js', anchor: 1579 },
      { file: 'core/petri-server/conversation-adapter.js', anchor: 465 },
    ];
    // 行数口径与 `wc -l` 一致（末行换行不额外计 1）。此前 readLines 用 split('\n').length，
    // 比 wc -l 恒多 1，而锚值来自 wc -l 口径 → 两个断言长期互相打架（POST-S7 H0 抓真）。
    const readLines = (rel) => {
      const raw = require('fs').readFileSync(resolve(rel), 'utf8');
      const parts = raw.split('\n');
      return raw.endsWith('\n') ? parts.length - 1 : parts.length;
    };
    for (const { file, anchor } of LINE_ANCHORS) {
      it(`${file} <= ${anchor} lines (BLOCK-375 shrink-only ratchet)`, () => {
        const lines = readLines(file);
        assert.ok(
          lines <= anchor,
          `${file} grew past shrink-only anchor ${anchor} (got ${lines}); 拆分回收走蓝图 S4.1，增长需显式重锚留因`
        );
      });
    }
    it('line anchors reflect current reality (anchor-update guard)', () => {
      for (const { file, anchor } of LINE_ANCHORS) {
        const lines = readLines(file);
        assert.ok(
          lines >= anchor - 25,
          `${file} is now ${lines} lines, far below anchor ${anchor} — 下调锚并留因（棘轮只减不增）`
        );
      }
    });

  });
});
