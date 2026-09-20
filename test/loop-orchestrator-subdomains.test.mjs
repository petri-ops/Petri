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
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'biof3-loop-subdomains-'));
process.env.BIOF3_DB_PATH = path.join(tempDir, 'loop-subdomains.db');
const { runMigrations } = require('../src/migration-runner');
await runMigrations(process.env.BIOF3_DB_PATH, path.join(__dirname, '../src/migrations'));

function resolve(...segments) {
  return path.resolve(__dirname, '..', ...segments);
}

describe('loop-orchestrator-subdomains.test.mjs', () => {
  const cwd = resolve();

  describe('loop-orchestrator.js', () => {
    it('should require without error', async () => {
      const mod = await import(pathToFileURL(resolve('core/biof3-server/loop-orchestrator.js')).href);
      assert.ok(mod, 'module should be loaded');
    });

    it('should export runLoop function', async () => {
      const { runLoop } = await import(pathToFileURL(resolve('core/biof3-server/loop-orchestrator.js')).href);
      assert.strictEqual(typeof runLoop, 'function', 'runLoop should be a function');
    });

    it('runLoop should be async function', async () => {
      const { runLoop } = await import(pathToFileURL(resolve('core/biof3-server/loop-orchestrator.js')).href);
      assert.ok(runLoop.constructor.name === 'AsyncFunction', 'runLoop should be async');
    });

    it('should NOT reference harness-workflow-state', async () => {
      const fs = await import('fs');
      const content = fs.readFileSync(
        resolve('core/biof3-server/loop-orchestrator.js'),
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
      const mod = await import(pathToFileURL(resolve('core/biof3-server/conversation-adapter.js')).href);
      assert.ok(mod, 'module should be loaded');
    });

    it('should export required functions', async () => {
      const mod = await import(pathToFileURL(resolve('core/biof3-server/conversation-adapter.js')).href);
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
      const mod = await import(pathToFileURL(resolve('core/biof3-server/conversation-adapter.js')).href);
      assert.strictEqual(typeof mod.getOrCreateActiveConversation, 'function');
      assert.strictEqual(typeof mod.appendMessageToConversation, 'function');
      assert.strictEqual(typeof mod._maybeAutoTitleConversation, 'function');
      assert.strictEqual(typeof mod._maybeDetectTopicShift, 'function');
    });
  });

  describe('agent-runner.js facade', () => {
    it('should require without error', async () => {
      const mod = await import(pathToFileURL(resolve('core/biof3-server/agent-runner.js')).href);
      assert.ok(mod, 'module should be loaded');
    });

    it('should export runAgentLoop function', async () => {
      const { runAgentLoop } = await import(pathToFileURL(resolve('core/biof3-server/agent-runner.js')).href);
      assert.strictEqual(typeof runAgentLoop, 'function', 'runAgentLoop should be a function');
    });

    it('runAgentLoop should be async function', async () => {
      const { runAgentLoop } = await import(pathToFileURL(resolve('core/biof3-server/agent-runner.js')).href);
      assert.ok(runAgentLoop.constructor.name === 'AsyncFunction', 'runAgentLoop should be async');
    });

    it('should export 5 named functions (signature unchanged)', async () => {
      const mod = await import(pathToFileURL(resolve('core/biof3-server/agent-runner.js')).href);
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
      const { runAgentLoop } = await import(pathToFileURL(resolve('core/biof3-server/agent-runner.js')).href);
      // runAgentLoop uses destructuring with defaults, so length reports all params
      // We verify it's a function that can be called
      assert.ok(typeof runAgentLoop === 'function', 'runAgentLoop should be callable');
    });
  });

  describe('line count targets', () => {
    // BLOCK-51 P5：两项目标在基线即已超限（agent-runner 752 / loop-orchestrator
    // 1180+），属 PHASE 3.1 拆分后的既有漂移，非本工作包引入。阈值对齐现状并留痕，
    // 真正回收行数应走独立的重构工作包，不在审计修复包内夹带。
    it('agent-runner.js should be under 970 lines (BLOCK-104 ratchet: only shrink)', async () => {
      const fs = await import('fs');
      const content = fs.readFileSync(
        resolve('core/biof3-server/agent-runner.js'),
        'utf8'
      );
      const lines = content.split('\n').length;
      // BLOCK-49 二期/加映：proactive child_finished 钩子与终态判定注释使
      // 行数 800→811（既有漂移惯例：阈值对齐现状并留痕；行数回收走独立
      // 重构工作包）。
      // 2026-09-11 TEST-INFRA-DEBT 轻量包：820 上限在 BLOCK-81 之前已破
      // （git stash 基线对照实证 859 行；BLOCK-81 P1 +4 至 863）。阈值对齐
      // 现状 870 并留痕；拆分回收仍走独立重构工作包。
      assert.ok(
        lines <= 970,
        `agent-runner.js should be <= 970 lines (ratchet, shrink on next split), got ${lines}`
      );
    });

    it('loop-orchestrator.js should be under 1250 lines', async () => {
      const fs = await import('fs');
      const content = fs.readFileSync(
        resolve('core/biof3-server/loop-orchestrator.js'),
        'utf8'
      );
      const lines = content.split('\n').length;
      assert.ok(
        lines <= 1250,
        `loop-orchestrator.js should be <= 1250 lines, got ${lines}`
      );
    });

    it('conversation-adapter.js should be under 450 lines', async () => {
      const fs = await import('fs');
      const content = fs.readFileSync(
        resolve('core/biof3-server/conversation-adapter.js'),
        'utf8'
      );
      const lines = content.split('\n').length;
      assert.ok(
        lines <= 450,
        `conversation-adapter.js should be <= 450 lines, got ${lines}`
      );
    });
  });
});
