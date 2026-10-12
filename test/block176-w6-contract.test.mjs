// BLOCK-176 W6 — CP-16 事件镜像 + CP-18 成本熔断契约测试。
//
// CP-16：mirrorPeerTaskEvents 订阅对端任务 SSE，非 delta 事件镜像本地
// task_events（peerName 留痕）；SSE 不可达/解析失败→静默回退轮询语义。
// agent-task-store 经 require cache 注入桩（避免真实 DB）。
// CP-18：cost-cap 纯函数面（sanitize/resolve/isExceeded）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---------- CP-18 纯函数面 ----------
const {
  sanitizeCostCapCny,
  resolveCostCapCny,
  isCostCapExceeded,
} = require('../core/petri-server/helpers/cost-cap.js');

test('CP-18 sanitize：非正数/非有限数= null（无熔断），正数保留两位', () => {
  assert.equal(sanitizeCostCapCny(0), null);
  assert.equal(sanitizeCostCapCny(-5), null);
  assert.equal(sanitizeCostCapCny('abc'), null);
  assert.equal(sanitizeCostCapCny(Infinity), null);
  assert.equal(sanitizeCostCapCny(1.234), 1.23);
  assert.equal(sanitizeCostCapCny('2.5'), 2.5);
});

test('CP-18 resolve：env 覆盖优先 ai-settings；两者皆缺= null', () => {
  assert.equal(resolveCostCapCny({ costCapCny: 5 }, { PETRI_TASK_COST_CAP_CNY: '9' }), 9);
  assert.equal(resolveCostCapCny({ costCapCny: 5 }, {}), 5);
  assert.equal(resolveCostCapCny(null, {}), null);
  // env 非法 → 回落 settings 而不是误熔断
  assert.equal(resolveCostCapCny({ costCapCny: 5 }, { PETRI_TASK_COST_CAP_CNY: 'not-a-number' }), 5);
});

test('CP-18 isExceeded：上限未配置=永不熔断；spent>=cap 即超（诚实停机语义）', () => {
  assert.equal(isCostCapExceeded({ capCny: null, spentCny: 999 }).exceeded, false);
  assert.equal(isCostCapExceeded({ capCny: 0, spentCny: 999 }).exceeded, false);
  assert.equal(isCostCapExceeded({ capCny: 10, spentCny: 9.99 }).exceeded, false);
  assert.equal(isCostCapExceeded({ capCny: 10, spentCny: 10 }).exceeded, true);
  assert.equal(isCostCapExceeded({ capCny: 10, spentCny: 12 }).exceeded, true);
});

// ---------- CP-18 执行面接线（源码级：loop 每轮查询+超限提示） ----------
test('CP-18 执行面：loop-orchestrator 每轮消费 resolveCostCapCny/isCostCapExceeded/summarizeAiUsage', () => {
  const fs = require('node:fs');
  const src = fs.readFileSync(path.join(ROOT, 'core/petri-server/loop-orchestrator.js'), 'utf8');
  assert.match(src, /require\('\.\/helpers\/cost-cap'\)/);
  assert.match(src, /resolveCostCapCny\(getAiSettings\(\), process\.env\)/);
  assert.match(src, /summarizeAiUsage\(\{ conversationId: toolCtx\.conversationId \}\)/);
  assert.match(src, /cost_cap_exceeded/);
  assert.match(src, /costCapAnnounced/); // 防多轮重复提示
});

// ---------- CP-16 事件镜像（mock 对端 SSE + 注入 task-store 桩） ----------
test('CP-16 mirror：非 delta 事件镜像本地 task_events 且带 peerName；delta 与不可达静默', async () => {
  const storePath = require.resolve('../core/petri-server/agent-task-store.js');
  const mirrored = [];
  require.cache[storePath] = {
    id: storePath,
    filename: storePath,
    loaded: true,
    exports: {
      getAgentTaskEventsSince: () => [{ seq: 7, eventType: 'iter' }],
      appendAgentTaskEvent: (taskId, seq, eventType, payload) => {
        mirrored.push({ taskId, seq, eventType, payload });
      },
    },
  };

  const { mirrorPeerTaskEvents } = require('../core/petri-server/agent-tools/federation-tools.js');

  // mock SSE：iter 事件镜像；delta 跳过；坏帧容忍
  const frames = [
    'data: {"event":"iter","n":1}\n\n',
    'data: {"event":"delta","text":"x"}\n\n',
    'data: not-json\n\n',
    'data: {"event":"done","agentStatus":"completed"}\n\n',
  ].join('');
  const sseBody = (async function* () {
    yield Buffer.from(frames, 'utf8');
  })();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, body: sseBody });

  try {
    await mirrorPeerTaskEvents(
      { name: 'peer-a', baseUrl: 'http://peer-a.test' },
      'tok',
      'task-42',
      5000,
    );
  } finally {
    globalThis.fetch = originalFetch;
    delete require.cache[storePath];
  }

  assert.deepEqual(
    mirrored.map((m) => m.eventType),
    ['iter', 'done'],
  );
  assert.equal(mirrored[0].taskId, 'task-42');
  assert.equal(mirrored[0].seq, 8); // 桩清单最后 seq 7 → +1
  assert.equal(mirrored[0].payload.peerName, 'peer-a');
  assert.equal(mirrored[1].payload.agentStatus, 'completed');

  // SSE 不可达（fetch 抛错）→ 静默（不抛、不镜像）
  globalThis.fetch = async () => { throw new Error('ECONNREFUSED'); };
  try {
    await mirrorPeerTaskEvents({ name: 'peer-b', baseUrl: 'http://peer-b.test' }, 'tok', 't2', 1000);
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(mirrored.length, 2); // 无新增
});

test('CP-16 接线：delegate 委托轮询前叠加 SSE 镜像（源码级）', () => {
  const fs = require('node:fs');
  const src = fs.readFileSync(path.join(ROOT, 'core/petri-server/agent-tools/federation-tools.js'), 'utf8');
  assert.match(src, /await mirrorPeerTaskEvents\(peer, token, taskId, timeoutMs\)\.catch\(\(\) => \{\}\)/);
});
