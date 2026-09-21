/**
 * BLOCK-109-CORE-ARCH P2 — 工具执行元数据 + 调度分组契约。
 *
 * ① 完备性门禁：TOOL_DEFS/WORKSPACE_TOOL_DEFS 每个工具（含 skill 元工具）都有
 *    六字段元数据；元数据表无未知工具名（新工具缺元数据即红——plan §1 P2-6）。
 * ② 一致性：destructive ⇒ !concurrentSafe；readOnly ⇒ !destructive；riskLevel 枚举。
 * ③ spawn 组合语义（P2-5）：spawn 族 concurrentSafe=false——分组并行永不绕过派发
 *    软上限（软上限本体在 spawn 执行器，契约=block109-orchestration.test.mjs）。
 * ④ 调度行为：并行组真并发（耗时 < 串行和）、串行组保序、结果按原序重组。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fssync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import test from 'node:test';

const __filename = fileURLToPath(import.meta.url);
const here = path.dirname(__filename);
const root = path.resolve(here, '..');
const require = createRequire(import.meta.url);

// 内存 DB 自举（agent-tools 顶层初始化注册表，同 block34 先例）
{
  const Database = require('better-sqlite3');
  const tempDbDir = fssync.mkdtempSync(path.join(os.tmpdir(), 'biof3-b109-p2-meta-'));
  const db = new Database(path.join(tempDbDir, 'biof3.db'));
  const migrationsDir = path.join(root, 'src', 'migrations');
  for (const file of fssync.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(fssync.readFileSync(path.join(migrationsDir, file), 'utf8'));
  }
  db.close();
  process.env.BIOF3_DB_PATH = path.join(tempDbDir, 'biof3.db');
  process.on('exit', () => {
    try { fssync.rmSync(tempDbDir, { recursive: true, force: true }); } catch { /* Windows 句柄延迟释放 */ }
  });
}

const toolMetadataMod = require(path.join(root, 'core', 'biof3-server', 'agent-tools', 'tool-metadata.js'));
const { TOOL_METADATA, METADATA_KEYS, RISK_LEVELS, getToolMetadata } = toolMetadataMod;
const agentTools = require(path.join(root, 'core', 'biof3-server', 'agent-tools', 'index.js'));
const toolDefsMod = require(path.join(root, 'core', 'biof3-server', 'agent-tools', 'tool-defs.js'));
const { runAgentToolCallBatch } = require(path.join(root, 'core', 'biof3-server', 'agent-tools', 'agent-loop-control.js'));

// skill 元工具（skill_discover/get/execute）注册在 mcp/registry（getSkillToolDefinitions），
// 不在 tool-defs.js 内——计数时一并纳入完备性门禁。
const REGISTRY_SKILL_TOOLS = ['skill_discover', 'skill_get', 'skill_execute'];

function definedToolNames() {
  const names = new Set(REGISTRY_SKILL_TOOLS);
  const collect = (defs) => {
    for (const d of defs || []) {
      const n = d && d.function && d.function.name;
      if (n) names.add(n);
    }
  };
  collect(toolDefsMod.TOOL_DEFS);
  collect(toolDefsMod.WORKSPACE_TOOL_DEFS);
  collect(toolDefsMod.getToolDefs ? toolDefsMod.getToolDefs() : []);
  return names;
}

test('P2 完备性门禁 — 每个已定义工具都有六字段元数据（新工具缺元数据即红）', () => {
  const names = definedToolNames();
  assert.ok(names.size >= 60, `工具定义数量合理（实际 ${names.size}）`);
  const missing = [];
  for (const name of names) {
    const meta = TOOL_METADATA[name];
    if (!meta) { missing.push(name); continue; }
    for (const key of METADATA_KEYS) {
      assert.ok(key in meta, `${name} 缺元数据字段 ${key}`);
    }
    assert.equal(typeof meta.readOnly, 'boolean', `${name}.readOnly 必须布尔`);
    assert.equal(typeof meta.destructive, 'boolean', `${name}.destructive 必须布尔`);
    assert.equal(typeof meta.concurrentSafe, 'boolean', `${name}.concurrentSafe 必须布尔`);
    assert.equal(typeof meta.needsApproval, 'boolean', `${name}.needsApproval 必须布尔`);
    assert.ok(RISK_LEVELS.includes(meta.riskLevel), `${name}.riskLevel 必须在枚举内`);
    assert.ok(meta.timeoutMs === null || (Number.isFinite(meta.timeoutMs) && meta.timeoutMs > 0),
      `${name}.timeoutMs 只允许 null（未定预算）或正数`);
  }
  assert.deepEqual(missing, [], `缺元数据的工具：${missing.join(', ')}`);
});

test('P2 完备性门禁 — 元数据表无未知工具名（改名/删工具不同步即红）', () => {
  const names = definedToolNames();
  const unknown = Object.keys(TOOL_METADATA).filter((n) => !names.has(n));
  assert.deepEqual(unknown, [], `元数据表存在未定义的工具名：${unknown.join(', ')}`);
});

test('P2 一致性 — destructive ⇒ 串行；readOnly ⇒ 非破坏；spawn 族永不并行（P2-5 组合语义）', () => {
  for (const [name, meta] of Object.entries(TOOL_METADATA)) {
    if (meta.destructive) {
      assert.equal(meta.concurrentSafe, false, `${name}: 破坏性工具不得并行`);
      assert.equal(meta.readOnly, false, `${name}: 破坏性工具不得标只读`);
    }
    if (meta.readOnly) {
      assert.equal(meta.destructive, false, `${name}: 只读工具不得标破坏性`);
    }
  }
  // P2-5 组合语义：spawn 族串行——派发软上限（SPAWN_CONCURRENCY_LIMIT）在执行器内，
  // 分组并行永不绕过（wait_agent 只读但阻塞语义也必须串行）。
  for (const name of ['spawn_agent', 'wait_agent', 'interrupt_agent', 'send_message', 'followup_task']) {
    assert.equal(TOOL_METADATA[name].concurrentSafe, false, `${name} 必须串行（P2-5）`);
  }
  assert.equal(getToolMetadata('不存在的工具').concurrentSafe, false, '未知工具保守缺省=串行非只读');
});

test('P2 调度行为 — 并行组真并发、串行组保序、结果按原序重组', async () => {
  const timings = [];
  const makeCall = (id, name) => ({
    id,
    type: 'function',
    function: { name, arguments: '{}' },
  });
  // 混合批次：并行组（workspace_list/system_info 只读并发）+ 串行组（spawn_agent 语义占位）
  const toolCalls = [
    makeCall('c1', 'workspace_list'),
    makeCall('c2', 'spawn_agent'),
    makeCall('c3', 'system_info'),
  ];
  const controller = {
    reserve: (calls) => ({ accepted: calls }),
    parse: (toolCall) => ({ ok: true, name: toolCall.function.name, callId: toolCall.id, args: {} }),
    reserveProtocolCallId: (id) => id,
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const startedAt = new Map();
  const finishedAt = new Map();
  const serialOrder = [];

  const result = await runAgentToolCallBatch({
    controller,
    toolCalls,
    shouldAbort: () => false,
    execute: async (parsed) => {
      startedAt.set(parsed.callId, Date.now());
      // 并行组成员各 120ms：并发则总和 ≈120ms；串行则 ≈360ms
      await sleep(parsed.name === 'spawn_agent' ? 40 : 120);
      finishedAt.set(parsed.callId, Date.now());
      if (parsed.name === 'spawn_agent') serialOrder.push('spawn_agent');
      return { status: 'success', callId: parsed.callId };
    },
    reject: async (parsed) => ({ status: 'rejected', callId: parsed.callId }),
  });

  // 结果按原 prepared 顺序重组（c1/c2/c3）
  assert.deepEqual(result.outcomes.map((o) => o.parsed.callId), ['c1', 'c2', 'c3']);
  // 并行组真并发：c1 与 c3 的执行区间重叠（晚开始者早于先开始者结束）
  assert.ok(
    startedAt.get('c3') < finishedAt.get('c1'),
    `workspace_list 与 system_info 必须并行（c3 开始 ${startedAt.get('c3') - startedAt.get('c1')}ms < c1 结束）`,
  );
  // 串行组在并行组全部结束后才运行（spawn 永不与读组并发）
  assert.ok(startedAt.get('c2') >= Math.max(finishedAt.get('c1'), finishedAt.get('c3')),
    'spawn_agent 串行执行，不与并行组重叠');
  assert.deepEqual(serialOrder, ['spawn_agent']);
});
