import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const scriptMod = require('../core/petri-server/helpers/workflow-script.js');
const { validateWorkflowMeta, hashWorkflowSource, hashWorkflowArgs, WORKFLOW_META_DEFAULTS } = scriptMod;
const sandboxMod = require('../core/petri-server/helpers/workflow-sandbox.js');
const { scanWorkflowSource, loadWorkflowModule } = sandboxMod;

// ── meta 校验 ──────────────────────────────────────────────

const VALID_META = {
  name: 'review-fanout',
  version: 1,
  budget: { maxAgents: 4, maxSteps: 20, timeoutMs: 600000 },
  concurrency: 2,
};

test('BLOCK-262 meta — 合法 meta 通过并归一（缺省补默认值）', () => {
  const res = validateWorkflowMeta({ name: 'w', version: 1 });
  assert.equal(res.ok, true);
  assert.equal(res.meta.concurrency, WORKFLOW_META_DEFAULTS.concurrency);
  assert.equal(res.meta.budget.maxAgents, WORKFLOW_META_DEFAULTS.budget.maxAgents);
  assert.equal(res.meta.budget.maxSteps, WORKFLOW_META_DEFAULTS.budget.maxSteps);
  assert.equal(res.meta.budget.timeoutMs, WORKFLOW_META_DEFAULTS.budget.timeoutMs);
});

test('BLOCK-262 meta — 完整 meta 原样通过', () => {
  const res = validateWorkflowMeta(VALID_META);
  assert.equal(res.ok, true);
  assert.deepEqual(res.meta, VALID_META);
});

test('BLOCK-262 meta — 非对象 meta 拒绝', () => {
  for (const bad of [null, undefined, 42, 'x', []]) {
    const res = validateWorkflowMeta(bad);
    assert.equal(res.ok, false);
    assert.equal(res.error, 'meta_invalid');
  }
});

test('BLOCK-262 meta — name 缺失/非串/超长拒绝', () => {
  for (const bad of [undefined, 42, '', 'a'.repeat(121)]) {
    const res = validateWorkflowMeta({ ...VALID_META, name: bad });
    assert.equal(res.ok, false, `name=${String(bad).slice(0, 8)} 应拒绝`);
    assert.ok(res.diagnostics.some((d) => d.includes('name')));
  }
});

test('BLOCK-262 meta — version 非正整数拒绝', () => {
  for (const bad of [0, -1, 1.5, '1', null]) {
    const res = validateWorkflowMeta({ ...VALID_META, version: bad });
    assert.equal(res.ok, false, `version=${bad} 应拒绝`);
  }
});

test('BLOCK-262 meta — budget 越界拒绝（maxAgents>32 / maxSteps>200 / timeoutMs>30min / 负值）', () => {
  assert.equal(validateWorkflowMeta({ ...VALID_META, budget: { maxAgents: 33 } }).ok, false);
  assert.equal(validateWorkflowMeta({ ...VALID_META, budget: { maxAgents: 0 } }).ok, false);
  assert.equal(validateWorkflowMeta({ ...VALID_META, budget: { maxSteps: 201 } }).ok, false);
  assert.equal(validateWorkflowMeta({ ...VALID_META, budget: { timeoutMs: 30 * 60 * 1000 + 1 } }).ok, false);
  assert.equal(validateWorkflowMeta({ ...VALID_META, budget: { timeoutMs: 0 } }).ok, false);
});

test('BLOCK-262 meta — concurrency 越界拒绝（0 / 9 / 非整数）', () => {
  assert.equal(validateWorkflowMeta({ ...VALID_META, concurrency: 0 }).ok, false);
  assert.equal(validateWorkflowMeta({ ...VALID_META, concurrency: 9 }).ok, false);
  assert.equal(validateWorkflowMeta({ ...VALID_META, concurrency: 1.5 }).ok, false);
});

test('BLOCK-262 meta — 未知顶层键拒绝（fail-closed）', () => {
  const res = validateWorkflowMeta({ ...VALID_META, schedule: 'daily' });
  assert.equal(res.ok, false);
  assert.ok(res.diagnostics.some((d) => d.includes('schedule')));
});

test('BLOCK-262 meta — budget 未知子键拒绝（fail-closed）', () => {
  const res = validateWorkflowMeta({ ...VALID_META, budget: { maxAgents: 4, extra: 1 } });
  assert.equal(res.ok, false);
});

// ── 哈希（resume 前缀命中的身份基础）──────────────────────

test('BLOCK-262 hash — scriptHash 对源码稳定且区分内容', () => {
  const a = hashWorkflowSource('export const meta = {}');
  const b = hashWorkflowSource('export const meta = {}');
  const c = hashWorkflowSource('export const meta = { }');
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.match(a, /^[0-9a-f]{64}$/);
});

test('BLOCK-262 hash — argsHash 键序无关（稳定序列化）', () => {
  const h1 = hashWorkflowArgs({ a: 1, b: { c: 2, d: 3 } });
  const h2 = hashWorkflowArgs({ b: { d: 3, c: 2 }, a: 1 });
  assert.equal(h1, h2);
  assert.notEqual(h1, hashWorkflowArgs({ a: 1, b: { c: 2, d: 4 } }));
});

// ── 静态扫描 fail-closed ─────────────────────────────────

test('BLOCK-262 scan — 干净源码通过', () => {
  const res = scanWorkflowSource('export const meta = { name: "w", version: 1 }');
  assert.equal(res.ok, true);
});

test('BLOCK-262 scan — 逐类禁词拒绝并回传 pattern id', () => {
  const cases = [
    ['require(', 'require', 'const f = require("fs")'],
    ['import 语句', 'import', 'import x from "y"'],
    ['process 访问', 'process', 'const e = process.env'],
    ['Date.now', 'date-now', 'const t = Date.now()'],
    ['new Date', 'new-date', 'const d = new Date()'],
    ['Math.random', 'math-random', 'const r = Math.random()'],
    ['fetch', 'fetch', 'fetch("http://x")'],
    ['node: 内建', 'node-builtin', 'const s = "node:fs"'],
    ['eval', 'eval', 'eval("1+1")'],
    ['Function 构造器', 'function-ctor', 'Function("return 1")()'],
    ['globalThis', 'global-this', 'const g = globalThis'],
    ['WebSocket', 'websocket', 'new WebSocket("ws://x")'],
    ['setTimeout', 'timers', 'setTimeout(() => {}, 10)'],
  ];
  for (const [label, patternId, src] of cases) {
    const res = scanWorkflowSource(src);
    assert.equal(res.ok, false, `${label} 应拒绝`);
    assert.equal(res.error, 'script_forbidden_syntax');
    assert.equal(res.pattern, patternId, `${label} pattern id 应为 ${patternId}`);
  }
});

test('BLOCK-262 scan — 空白混淆变体同样拒绝（Date .now / new  Date）', () => {
  assert.equal(scanWorkflowSource('const t = Date .now()').ok, false);
  assert.equal(scanWorkflowSource('const d = new\nDate()').ok, false);
  assert.equal(scanWorkflowSource('const r = Math . random()').ok, false);
});

test('BLOCK-262 scan — 正常词不误伤（important / subprocess / important 文案）', () => {
  assert.equal(scanWorkflowSource('const s = "important subprocess for reimporting data"').ok, true);
  assert.equal(scanWorkflowSource('const n = a.process_count').ok, true);
});

// ── ESM 子集与模块装载 ────────────────────────────────────

const GOOD_SOURCE = `
export const meta = { name: 'demo', version: 1, budget: { maxAgents: 2 }, concurrency: 1 };
export default async function run(ctx) {
  const t1 = now();
  const r1 = random();
  log('step', t1, r1);
  return { t1, r1 };
}
`;

function recordingHost() {
  const calls = [];
  return {
    calls,
    agent: async (opts) => { calls.push(['agent', opts]); return { ok: true, status: 'completed', summary: 's' }; },
    parallel: async (fns) => { calls.push(['parallel', fns.length]); return []; },
    pipeline: async (fns) => { calls.push(['pipeline', fns.length]); return null; },
    phase: async (name, fn) => { calls.push(['phase', name]); return fn(); },
    log: (...a) => { calls.push(['log', ...a]); },
    budget: { maxAgents: 2, startedAgents: 0, maxSteps: 10, doneSteps: 0, cancelled: false },
    console: { log: (...a) => calls.push(['console', ...a]) },
  };
}

test('BLOCK-262 load — 合法脚本装载出 meta 与 run 函数', async () => {
  const res = loadWorkflowModule(GOOD_SOURCE, { host: recordingHost(), seed: 42 });
  assert.equal(res.ok, true);
  assert.equal(res.meta.name, 'demo');
  assert.equal(typeof res.run, 'function');
});

test('BLOCK-262 load — run 执行且 now 单调 / random 由种子确定', async () => {
  const snapshot = (v) => JSON.parse(JSON.stringify(v)); // realm 对象转主 realm 再比较
  const host = recordingHost();
  const m1 = loadWorkflowModule(GOOD_SOURCE, { host, seed: 7 });
  const out1 = await m1.run();
  assert.ok(out1.t1 > 0);
  const m2 = loadWorkflowModule(GOOD_SOURCE, { host: recordingHost(), seed: 7 });
  const out2 = await m2.run();
  assert.deepEqual(snapshot(out1), snapshot(out2), '同种子同脚本应产生相同输出（确定性）');
  const m3 = loadWorkflowModule(GOOD_SOURCE, { host: recordingHost(), seed: 8 });
  const out3 = await m3.run();
  assert.notDeepEqual(snapshot(out1).r1, snapshot(out3).r1, '不同种子应产生不同随机序列');
});

test('BLOCK-262 load — now() 递增且与真实时间无关（虚拟时钟）', async () => {
  const src = `export const meta = { name: 't', version: 1 };
export default async function run() { return [now(), now(), now()]; }`;
  const m = loadWorkflowModule(src, { host: recordingHost(), seed: 1 });
  const seq = await m.run();
  assert.deepEqual([...seq], [1, 2, 3]);
});

test('BLOCK-262 load — 原语经 host 桥接（agent/phase/log 记录在案）', async () => {
  const host = recordingHost();
  const src = `export const meta = { name: 'p', version: 1 };
export default async function run() {
  await phase('scan', async () => { await agent({ prompt: 'x' }); });
  log('done');
  return 1;
}`;
  const m = loadWorkflowModule(src, { host, seed: 1 });
  await m.run();
  const kinds = host.calls.map((c) => c[0]);
  assert.ok(kinds.includes('phase'));
  assert.ok(kinds.includes('agent'));
  assert.ok(kinds.includes('log'));
});

test('BLOCK-262 load — export 形态白名单外拒绝', () => {
  const bad = [
    'export function helper() {}',
    'export { helper };',
    'export * from "x";',
    'export let meta = {};',
    'export const meta2 = {};',
  ];
  for (const src of bad) {
    const res = loadWorkflowModule(src, { host: recordingHost(), seed: 1 });
    assert.equal(res.ok, false, `应拒绝: ${src.slice(0, 40)}`);
    assert.equal(res.error, 'export_form_rejected');
  }
  // 行中段 export（合法 ESM）不经行首转译，进入 wrapper 后因函数内 export 语句被语法拒绝
  const midLine = loadWorkflowModule(
    'const run = async () => 1;\nexport default run; export const meta = {};',
    { host: recordingHost(), seed: 1 }
  );
  assert.equal(midLine.ok, false);
});

test('BLOCK-262 load — 缺 default 导出 / meta 非对象 / default 非函数 拒绝', () => {
  const missingDefault = loadWorkflowModule('export const meta = { name: "w", version: 1 };', { host: recordingHost(), seed: 1 });
  assert.equal(missingDefault.ok, false);
  assert.equal(missingDefault.error, 'default_missing');

  const metaNotObject = loadWorkflowModule(
    'export const meta = 42;\nexport default async function run() {}',
    { host: recordingHost(), seed: 1 }
  );
  assert.equal(metaNotObject.ok, false);
  assert.equal(metaNotObject.error, 'meta_invalid');

  const defaultNotFn = loadWorkflowModule(
    'export const meta = { name: "w", version: 1 };\nexport default 42;',
    { host: recordingHost(), seed: 1 }
  );
  assert.equal(defaultNotFn.ok, false);
  assert.equal(defaultNotFn.error, 'default_invalid');
});

test('BLOCK-262 load — meta 校验失败拒绝装载（超 maxAgents）', () => {
  const res = loadWorkflowModule(
    'export const meta = { name: "w", version: 1, budget: { maxAgents: 99 } };\nexport default async function run() {}',
    { host: recordingHost(), seed: 1 }
  );
  assert.equal(res.ok, false);
  assert.equal(res.error, 'meta_invalid');
});

test('BLOCK-262 load — 语法错误拒绝（syntax_invalid）', () => {
  const res = loadWorkflowModule('export const meta = { name: "w", version: 1 }; export default async function run( {', { host: recordingHost(), seed: 1 });
  assert.equal(res.ok, false);
  assert.equal(res.error, 'syntax_invalid');
});

// ── 沙箱隔离（防御纵深：扫描之外的运行时摘除）────────────

test('BLOCK-262 沙箱 — Date / Math.random / process / require / setTimeout 不可达', async () => {
  const probes = [
    ['Date', 'typeof Date', 'undefined'],
    ['process', 'typeof process', 'undefined'],
    ['require', 'typeof require', 'undefined'],
    ['setTimeout', 'typeof setTimeout', 'undefined'],
  ];
  for (const [label, expr, expected] of probes) {
    const src = `export const meta = { name: 'probe', version: 1 };
export default async function run() { return (${expr}); }`;
    const m = loadWorkflowModule(src, { host: recordingHost(), seed: 1 });
    const val = await m.run();
    assert.equal(val, expected, `${label} 应不可达`);
  }
  // Math.random 的运行时摘除：源码不能含被禁字样，改查 realm 内 Math 的键集
  const keysSrc = `export const meta = { name: 'probe', version: 1 };
export default async function run() { return Object.keys(Math).join(','); }`;
  const mKeys = loadWorkflowModule(keysSrc, { host: recordingHost(), seed: 1 });
  const mathKeys = await mKeys.run();
  assert.ok(!mathKeys.includes('random'), 'realm Math 应无 random');
  assert.ok(mathKeys.includes('floor'), 'realm Math 应保留无害方法');
});

test('BLOCK-262 沙箱 — 脚本内异常如实抛出（不被沙箱吞掉）', async () => {
  const src = `export const meta = { name: 'boom', version: 1 };
export default async function run() { throw new Error('planned'); }`;
  const m = loadWorkflowModule(src, { host: recordingHost(), seed: 1 });
  await assert.rejects(() => m.run(), /planned/);
});
