import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import http from 'node:http';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  RISK_TIERS,
  buildToolRegistry,
  getProviderToolDefs,
  getToolContract,
  getToolRegistry,
} = require('../core/r-server/agent-tools/registry.js');
const { getToolDefs } = require('../core/r-server/agent-tools/tool-defs.js');
const { dispatchTool } = require('../core/r-server/agent-tools/index.js');
const { DeepSeekProvider } = require('../core/shared-backend/llm-providers/deepseek.js');
const {
  openAIToAnthropicRequest,
} = require('../core/shared-backend/llm-providers/protocol-conversion.js');

const INTERNAL_CONTRACT_KEYS = new Set([
  'contractVersion',
  'category',
  'sideEffect',
  'riskTier',
  'resources',
  'estimatedDurationMs',
  'cancellable',
]);

function definition(name) {
  return {
    type: 'function',
    function: {
      name,
      description: `${name} description`,
      parameters: { type: 'object', properties: {} },
    },
  };
}

function contract(overrides = {}) {
  return {
    contractVersion: '1.0.0',
    category: 'retrieval',
    sideEffect: 'none',
    riskTier: 'R0',
    resources: ['project.database'],
    estimatedDurationMs: 100,
    cancellable: false,
    ...overrides,
  };
}

function collectKeys(value, keys = new Set()) {
  if (!value || typeof value !== 'object') return keys;
  for (const [key, child] of Object.entries(value)) {
    keys.add(key);
    collectKeys(child, keys);
  }
  return keys;
}

function startServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${address.port}/v1` });
    });
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

test('agent registry pairs every model-visible definition with one handler and contract', () => {
  const registry = getToolRegistry();
  assert.equal(registry.length, 17);
  assert.equal(new Set(registry.map((entry) => entry.definition.function.name)).size, 17);

  for (const entry of registry) {
    assert.equal(typeof entry.handler, 'function');
    assert.equal(getToolContract(entry.definition.function.name), entry.contract);
    assert.deepEqual(Object.keys(entry.contract).sort(), [...INTERNAL_CONTRACT_KEYS].sort());
    assert.equal(Object.isFrozen(entry), true);
    assert.equal(Object.isFrozen(entry.contract), true);
    assert.equal(entry.contract.cancellable, false);
  }
});

test('registry validation rejects duplicate definitions and definition-handler drift', () => {
  const handler = () => null;
  assert.throws(
    () => buildToolRegistry([definition('lookup'), definition('lookup')], { lookup: handler }, { lookup: contract() }),
    /lookup: duplicate definition/
  );
  assert.throws(
    () => buildToolRegistry([definition('lookup')], {}, { lookup: contract() }),
    /lookup: definition has no handler/
  );
  assert.throws(
    () => buildToolRegistry([], { orphan: handler }, {}),
    /orphan: handler has no definition/
  );
});

test('registry validation rejects invalid internal contract metadata', () => {
  assert.throws(
    () => buildToolRegistry(
      [definition('lookup')],
      { lookup: () => null },
      { lookup: contract({ riskTier: 'R9' }) }
    ),
    /lookup: invalid riskTier/
  );
});

test('risk tier allowlist cannot be extended by registry consumers', () => {
  assert.equal(Object.isFrozen(RISK_TIERS), true);
  assert.throws(() => RISK_TIERS.push('R9'), TypeError);
  assert.deepEqual(RISK_TIERS, ['R0', 'R1', 'R2', 'R3']);
  assert.throws(
    () => buildToolRegistry(
      [definition('lookup')],
      { lookup: () => null },
      { lookup: contract({ riskTier: 'R9' }) }
    ),
    /lookup: invalid riskTier/
  );
});

test('schema-first loading does not capture partial act helper exports', () => {
  const script = `
    (async () => {
      const { getToolDefs } = require('./core/r-server/agent-tools/tool-defs.js');
      const planTools = require('./core/r-server/agent-tools/plan-ui-tools.js');
      const actTools = require('./core/r-server/agent-tools/act-tools.js');
      if (getToolDefs().length !== 17) throw new Error('unexpected tool count');
      if (!actTools.testFilterExpr('5', '>3')) throw new Error('filter helper unavailable');
      const context = {};
      const result = await planTools.actOpenFigcodePlot({ figcardId: 'volcano' }, context);
      if (!result.ok) throw new Error('implied-page helper unavailable');
      process.exit(0);
    })().catch((error) => {
      console.error(error);
      process.exit(1);
    });
  `;
  const probe = spawnSync(process.execPath, ['--trace-warnings', '-e', script], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  assert.equal(probe.status, 0, probe.stderr || probe.stdout);
  assert.doesNotMatch(probe.stderr, /circular dependency|Accessing non-existent property/);
});

test('Provider definitions are fresh OpenAI function projections without internal metadata', () => {
  const first = getProviderToolDefs();
  const second = getToolDefs();
  assert.notEqual(first, second);
  assert.notEqual(first[0], second[0]);
  assert.deepEqual(first, second);

  for (const tool of first) {
    assert.deepEqual(Object.keys(tool), ['type', 'function']);
    assert.equal(tool.type, 'function');
    assert.equal(typeof tool.function.name, 'string');
    const keys = collectKeys(tool);
    for (const key of INTERNAL_CONTRACT_KEYS) assert.equal(keys.has(key), false, `${key} leaked`);
  }
});

test('retired learning handlers remain outside the Agent registry and dispatcher', async () => {
  for (const name of [
    'discover_capabilities',
    'act_generic',
    'suggest_next_steps',
    'verify_understanding',
    'suggest_review',
    'record_learning_signal',
  ]) {
    assert.equal(getToolRegistry().some((entry) => entry.definition.function.name === name), false);
    assert.equal((await dispatchTool(name, {}, {})).error, 'unknown_tool');
  }
});

test('Anthropic schema conversion explicitly strips internal contract metadata', () => {
  const converted = openAIToAnthropicRequest({
    model: 'claude-test',
    messages: [{ role: 'user', content: 'hello' }],
    tools: [{ ...definition('lookup'), riskTier: 'R0', resources: ['project.database'] }],
  });
  assert.deepEqual(Object.keys(converted.tools[0]).sort(), ['description', 'input_schema', 'name']);
  assert.equal(converted.tools[0].riskTier, undefined);
  assert.equal(converted.tools[0].resources, undefined);
});

test('OpenAI-compatible outbound JSON contains Provider schema only', async () => {
  let receivedBody;
  const { server, baseUrl } = await startServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      receivedBody = JSON.parse(body);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        id: 'registry-projection',
        choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'ok' } }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }));
    });
  });

  try {
    const result = await new DeepSeekProvider().chat(
      'test-key',
      {
        model: 'test-model',
        messages: [{ role: 'user', content: 'hello' }],
        tools: getToolDefs(),
      },
      {},
      { baseUrl }
    );
    assert.equal(result.choices[0].message.content, 'ok');
    assert.equal(receivedBody.tools.length, 17);
    const keys = collectKeys(receivedBody.tools);
    for (const key of INTERNAL_CONTRACT_KEYS) assert.equal(keys.has(key), false, `${key} leaked`);
  } finally {
    await closeServer(server);
  }
});
