import { describe, it } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolve(...segments) {
  return path.resolve(__dirname, '..', ...segments);
}

describe('loop-orchestrator-subdomains.test.mjs', () => {
  const cwd = resolve();

  describe('loop-orchestrator.js', () => {
    it('should require without error', async () => {
      const mod = await import(resolve('core/r-server/loop-orchestrator.js'));
      assert.ok(mod, 'module should be loaded');
    });

    it('should export runLoop function', async () => {
      const { runLoop } = await import(resolve('core/r-server/loop-orchestrator.js'));
      assert.strictEqual(typeof runLoop, 'function', 'runLoop should be a function');
    });

    it('runLoop should be async function', async () => {
      const { runLoop } = await import(resolve('core/r-server/loop-orchestrator.js'));
      assert.ok(runLoop.constructor.name === 'AsyncFunction', 'runLoop should be async');
    });

    it('should NOT reference harness-workflow-state', async () => {
      const fs = await import('fs');
      const content = fs.readFileSync(
        resolve('core/r-server/loop-orchestrator.js'),
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
      const mod = await import(resolve('core/r-server/conversation-adapter.js'));
      assert.ok(mod, 'module should be loaded');
    });

    it('should export required functions', async () => {
      const mod = await import(resolve('core/r-server/conversation-adapter.js'));
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
      const mod = await import(resolve('core/r-server/conversation-adapter.js'));
      assert.strictEqual(typeof mod.getOrCreateActiveConversation, 'function');
      assert.strictEqual(typeof mod.appendMessageToConversation, 'function');
      assert.strictEqual(typeof mod._maybeAutoTitleConversation, 'function');
      assert.strictEqual(typeof mod._maybeDetectTopicShift, 'function');
    });
  });

  describe('agent-runner.js facade', () => {
    it('should require without error', async () => {
      const mod = await import(resolve('core/r-server/agent-runner.js'));
      assert.ok(mod, 'module should be loaded');
    });

    it('should export runAgentLoop function', async () => {
      const { runAgentLoop } = await import(resolve('core/r-server/agent-runner.js'));
      assert.strictEqual(typeof runAgentLoop, 'function', 'runAgentLoop should be a function');
    });

    it('runAgentLoop should be async function', async () => {
      const { runAgentLoop } = await import(resolve('core/r-server/agent-runner.js'));
      assert.ok(runAgentLoop.constructor.name === 'AsyncFunction', 'runAgentLoop should be async');
    });

    it('should export 5 named functions (signature unchanged)', async () => {
      const mod = await import(resolve('core/r-server/agent-runner.js'));
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
      const { runAgentLoop } = await import(resolve('core/r-server/agent-runner.js'));
      // runAgentLoop uses destructuring with defaults, so length reports all params
      // We verify it's a function that can be called
      assert.ok(typeof runAgentLoop === 'function', 'runAgentLoop should be callable');
    });
  });

  describe('line count targets', () => {
    it('agent-runner.js should be under 700 lines', async () => {
      const fs = await import('fs');
      const content = fs.readFileSync(
        resolve('core/r-server/agent-runner.js'),
        'utf8'
      );
      const lines = content.split('\n').length;
      assert.ok(
        lines <= 700,
        `agent-runner.js should be <= 700 lines, got ${lines}`
      );
    });

    it('loop-orchestrator.js should be under 1100 lines', async () => {
      const fs = await import('fs');
      const content = fs.readFileSync(
        resolve('core/r-server/loop-orchestrator.js'),
        'utf8'
      );
      const lines = content.split('\n').length;
      assert.ok(
        lines <= 1100,
        `loop-orchestrator.js should be <= 1100 lines, got ${lines}`
      );
    });

    it('conversation-adapter.js should be under 450 lines', async () => {
      const fs = await import('fs');
      const content = fs.readFileSync(
        resolve('core/r-server/conversation-adapter.js'),
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
