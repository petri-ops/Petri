import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import http from 'node:http';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const R_SERVER = resolve(__dirname, '..', 'core', 'petri-server');
const require = createRequire(import.meta.url);

// BLOCK-52 收口顺手修（存量基建，与 agent-vision.test.mjs 同一修法）：自举临时 DB
//（src/migrations 全量）——registry 链路 require query-tools → db.js 在 default
// petri.db 缺最新 schema 时抛 no such table: projects；PETRI_DB_PATH 隔离须在
// require db.js 前生效（CommonJS require 顺序执行）。
{
  const fs = require('fs');
  const os = require('os');
  const dbPath = require('path');
  const Database = require(R_SERVER + '/node_modules/better-sqlite3');
  const tempDbDir = fs.mkdtempSync(dbPath.join(os.tmpdir(), 'petri-agent-registry-db-'));
  const boot = new Database(dbPath.join(tempDbDir, 'petri.db'));
  const migrationsDir = resolve(__dirname, '..', 'src', 'migrations');
  for (const f of fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
    boot.exec(fs.readFileSync(dbPath.join(migrationsDir, f), 'utf8'));
  }
  boot.close();
  process.env.PETRI_DB_PATH = dbPath.join(tempDbDir, 'petri.db');
  process.on('exit', () => {
    try { fs.rmSync(tempDbDir, { recursive: true, force: true }); } catch {}
  });
}

const {
  RISK_TIERS,
  buildToolRegistry,
  getProviderToolDefs,
  getToolContract,
  getToolRegistry,
} = require('../core/petri-server/agent-tools/registry.js');
const { getToolDefs } = require('../core/petri-server/agent-tools/tool-defs.js');
const { dispatchTool } = require('../core/petri-server/agent-tools/index.js');
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
  // 数量同源断言：工具集随工作包增长（BLOCK-69/77/78/85…），硬编码数字已两次漂移。
  // 改为与 defs 总数对齐 + 去重断言；三表失配仍由 buildToolRegistry 的互查 throw 覆盖。
  const defCount = (() => {
    const { TOOL_DEFS } = require('../core/petri-server/agent-tools/tool-defs.js');
    return TOOL_DEFS.length;
  })();
  assert.equal(registry.length, defCount);
  assert.equal(new Set(registry.map((entry) => entry.definition.function.name)).size, defCount);

  for (const entry of registry) {
    assert.equal(typeof entry.handler, 'function');
    assert.equal(getToolContract(entry.definition.function.name), entry.contract);
    assert.deepEqual(Object.keys(entry.contract).sort(), [...INTERNAL_CONTRACT_KEYS].sort());
    assert.equal(Object.isFrozen(entry), true);
    assert.equal(Object.isFrozen(entry.contract), true);
    // BLOCK-171 CP-1 — cancellable 收敛为「协作取消已贯通」布尔：true 集合必须
    // 与显式声明一致（当前=workspace_search/wait_agent），新工具默认 false。
    assert.equal(typeof entry.contract.cancellable, 'boolean');
  }
  const cancellableTools = registry
    .filter((entry) => entry.contract.cancellable === true)
    .map((entry) => entry.definition.function.name)
    .sort();
  assert.deepEqual(cancellableTools, ['wait_agent', 'workspace_search']);
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
      const { getToolDefs } = require('./core/petri-server/agent-tools/tool-defs.js');
      const actTools = require('./core/petri-server/agent-tools/act-tools.js');
      // BLOCK-99 G4：空间管理会话台工具族 71 件；BLOCK-116 W2（BK-04）决策观测 +2 = 73；
      // BLOCK-121 P2（B1）result_summary +1 = 74；BLOCK-124（C-13）codegraph +2 = 76；
      // BLOCK-157 W1（KNW-1）skill_discover/skill_get +2 = 78；BLOCK-164 W1 federation_list_peers +1 = 79；
      // BLOCK-176 W7（CP-21）skill_preflight +1 = 80；BLOCK-244 Q1-REM ask_user_question +1 = 81；
      // BLOCK-247（Q2b）web_search + web_fetch +2 = 83；BLOCK-249 read_agent_journal +1 = 84；
      // NEXT-01 run_workflow +1 = 93；NEXT-04A model3d_* +6 = 99；NEXT-04B model3d_visual_qa +1 = 100；NEXT-05 model3d_recipe +1 = 101
      if (getToolDefs().length !== 101) throw new Error('unexpected tool count');
      if (typeof actTools.actUiAction !== 'function') throw new Error('ui action dispatcher unavailable');
      if (typeof actTools.actOpenTool !== 'function') throw new Error('open_tool dispatcher unavailable');
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

test('BLOCK-99 G4 knowledge-console subset filters to the knowledge whitelist and leaves other contexts untouched', () => {
  const all = getToolDefs();
  const { resolveToolDefsForContext, KNOWLEDGE_CONSOLE_TOOL_NAMES } = require('../core/petri-server/agent-tools/knowledge-console-tools.js');
  // 未命中 toolSubset：维持全量（additive，现状行为）
  assert.equal(resolveToolDefsForContext({}, all).length, all.length);
  assert.equal(resolveToolDefsForContext({ toolSubset: 'unknown-value' }, all).length, all.length);
  assert.equal(resolveToolDefsForContext(null, all).length, all.length);
  // 命中 knowledge-console：只下发白名单，且白名单 ⊆ 全集
  const subset = resolveToolDefsForContext({ toolSubset: 'knowledge-console' }, all);
  const allNames = new Set(all.map((d) => d.function.name));
  assert.equal(subset.length, KNOWLEDGE_CONSOLE_TOOL_NAMES.size);
  for (const def of subset) {
    assert.equal(KNOWLEDGE_CONSOLE_TOOL_NAMES.has(def.function.name), true, `${def.function.name} not whitelisted`);
    assert.match(def.function.name, /^knowledge_/);
    assert.equal(allNames.has(def.function.name), true, `${def.function.name} missing from registry`);
  }
  // 破坏性三件必须在白名单内（D4 门生效面）且其余 50+ 通用工具不外泄
  for (const gated of ['knowledge_space_delete', 'knowledge_space_clear', 'knowledge_doc_delete']) {
    assert.equal(subset.some((d) => d.function.name === gated), true, `${gated} must be in console subset`);
  }
  assert.equal(subset.some((d) => d.function.name === 'workspace_exec'), false);
  assert.equal(subset.some((d) => d.function.name === 'spawn_agent'), false);
});

test('Anthropic schema conversion explicitly strips internal contract metadata', () => {
  const converted = openAIToAnthropicRequest({
    model: 'claude-test',
    messages: [{ role: 'user', content: 'hello' }],
    tools: [{ ...definition('lookup'), riskTier: 'R0', resources: ['project.database'] }],
  });
  // BLOCK-280 — 最后一个工具带 ephemeral 缓存断点（单工具请求=唯一工具即最后）；
  // 内部契约元数据（riskTier/resources）仍被剥离。
  assert.deepEqual(Object.keys(converted.tools[0]).sort(), ['cache_control', 'description', 'input_schema', 'name']);
  assert.deepEqual(converted.tools[0].cache_control, { type: 'ephemeral' });
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
    // BLOCK-99 G4 71 件 + BLOCK-116 W2（BK-04）决策观测 2 件 = 73；BLOCK-121 result_summary +1 = 74；
    // BLOCK-124（C-13）codegraph +2 = 76；BLOCK-176 W7（CP-21）skill_preflight +1 = 80；
    // BLOCK-244 +1=81；BLOCK-254 +1=85；BLOCK-256 +3=88；BLOCK-264 C-40 浏览器连接器 +4 = 92；
    // NEXT-01 run_workflow +1 = 93；NEXT-04A model3d_* +6 = 99；NEXT-04B model3d_visual_qa +1 = 100；NEXT-05 model3d_recipe +1 = 101
    assert.equal(receivedBody.tools.length, 101);
    const keys = collectKeys(receivedBody.tools);
    for (const key of INTERNAL_CONTRACT_KEYS) assert.equal(keys.has(key), false, `${key} leaked`);
  } finally {
    await closeServer(server);
  }
});
