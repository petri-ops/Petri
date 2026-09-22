/**
 * BLOCK-116 W2 — 决策平台契约（decision_log 台账记账 / 阈值注册表一致性 / 聚合观测）。
 *
 * 契约红线（plan docs/block-116-decision-platform-plan.md §2）：
 *  - 记账咽喉：askDecision 提供 meta.point 才记账；缺省零行（校准/测试零 DB 依赖）；
 *  - 记账 best-effort：store 抛错静默跳过，决策结果永不受影响；
 *  - 降级也记账（degraded=1 + reason）；
 *  - 阈值注册表：各模块常量=注册表值；evidence 文件在位（「改阈值必先重校准」机械承载）；
 *  - 71 工具集合恒等红线延续。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import test from 'node:test';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const require = createRequire(import.meta.url);

// 内存 DB 自举（migration 全量应用；decision_log 由 011 迁移创建）
{
  const Database = require('better-sqlite3');
  const tempDbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'biof3-b116-'));
  const db = new Database(path.join(tempDbDir, 'biof3.db'));
  const migrationsDir = path.join(root, 'src', 'migrations');
  for (const file of fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
    db.exec(fs.readFileSync(path.join(migrationsDir, file), 'utf8'));
  }
  db.close();
  process.env.BIOF3_DB_PATH = path.join(tempDbDir, 'biof3.db');
  process.on('exit', () => {
    try { fs.rmSync(tempDbDir, { recursive: true, force: true }); } catch { /* 句柄延迟释放 */ }
  });
}

const decisionLog = require(path.join(root, 'core', 'biof3-server', 'helpers', 'decision-log.js'));
const decisionApi = require(path.join(root, 'core', 'biof3-server', 'helpers', 'decision-api.js'));
const decisionConfigModule = require(path.join(root, 'core', 'biof3-server', 'helpers', 'decision-config.js'));
const thresholds = require(path.join(root, 'core', 'biof3-server', 'helpers', 'decision-thresholds.js'));
const { DECISION_MODEL_PIN } = decisionApi;

const NO_SLEEP = async () => {};
const API_KEY_OVERRIDE = { apiKey: 'test-key-do-not-call-real-api' };

function okFetch(answer) {
  return async () => ({
    ok: true,
    status: 200,
    json: async () => ({ model: 'jev-1.13.0', answers: { probe: answer } }),
  });
}

async function readRows() {
  const Database = require('better-sqlite3');
  const db = new Database(process.env.BIOF3_DB_PATH, { readonly: true });
  const rows = db.prepare('SELECT * FROM decision_log ORDER BY id ASC').all();
  db.close();
  return rows;
}

test('阈值注册表：七接点在册 + evidence 文件在位 + 模块常量一致', () => {
  for (const point of ['topic-shift', 'knowledge-guard', 'marker-celltype', 'intent-route', 'tool-route', 'failure-triage', 'test-suggest']) {
    assert.ok(thresholds[point], `接点 ${point} 在册`);
    assert.ok(fs.existsSync(path.join(root, thresholds[point].evidence)), `${point} 校准证据文件在位`);
    assert.equal(thresholds[point].model, DECISION_MODEL_PIN, `${point} 模型 pin 一致`);
  }
  // 模块常量=注册表值（re-export 兼容）
  const interpret = require(path.join(root, 'core', 'biof3-server', 'helpers', 'interpret.js'));
  const intentRouter = require(path.join(root, 'core', 'biof3-server', 'helpers', 'intent-router.js'));
  const toolRouter = require(path.join(root, 'core', 'biof3-server', 'helpers', 'tool-router.js'));
  const triage = require(path.join(root, 'scripts', 'lib', 'block114-triage-core.mjs'));
  const suggest = require(path.join(root, 'scripts', 'block115-test-suggest.mjs'));
  assert.equal(interpret.MARKER_DECISION_THRESHOLD, thresholds['marker-celltype'].threshold);
  assert.equal(intentRouter.INTENT_ROUTE_THRESHOLD, thresholds['intent-route'].threshold);
  assert.equal(toolRouter.TOOL_ROUTE_THRESHOLD, thresholds['tool-route'].threshold);
  assert.equal(triage.TRIAGE_THRESHOLD, thresholds['failure-triage'].threshold);
  assert.equal(suggest.SUGGEST_THRESHOLD, thresholds['test-suggest'].threshold);
});

test('记账：askDecision 带 meta.point → decision_log 落行（choice/confidence/model/latency）', async () => {
  const before = (await readRows()).length;
  await decisionApi.askDecision({
    state: '探针状态文本',
    questions: { probe: { type: 'choice', criteria: { a: 'A', b: 'B' } } },
    meta: { point: 'test-probe', threshold: 0.7 },
    overrides: {
      ...API_KEY_OVERRIDE,
      fetchImpl: okFetch({ choice: 'a', probabilities: { a: 0.9, b: 0.1 }, confidence: 0.9 }),
      sleep: NO_SLEEP,
    },
  });
  const rows = await readRows();
  assert.equal(rows.length, before + 1);
  const row = rows[rows.length - 1];
  assert.equal(row.point, 'test-probe');
  assert.equal(row.choice, 'a');
  assert.equal(row.confidence, 0.9);
  assert.equal(row.degraded, 0);
  assert.equal(row.threshold, 0.7);
  assert.equal(row.model, 'jev-1.13.0');
  assert.ok(row.state_hash && row.state_hash.length === 16);
  assert.match(row.state_preview, /探针状态文本/);
  assert.ok(row.latency_ms !== null);
});

test('记账：降级也落行（degraded=1 + reason）', async () => {
  const before = (await readRows()).length;
  const impl = async () => { const e = new Error('TimeoutError'); e.name = 'TimeoutError'; throw e; };
  await decisionApi.askDecision({
    state: '会降级的状态',
    questions: { probe: { type: 'noul', instructions: 'x' } },
    meta: { point: 'test-probe-degraded' },
    overrides: { ...API_KEY_OVERRIDE, fetchImpl: impl, sleep: NO_SLEEP },
  });
  const rows = await readRows();
  assert.equal(rows.length, before + 1);
  const row = rows[rows.length - 1];
  assert.equal(row.degraded, 1);
  assert.equal(row.reason, 'timeout');
  assert.equal(row.point, 'test-probe-degraded');
});

test('无 meta：零记账零行为（校准/测试零 DB 依赖）', async () => {
  const before = (await readRows()).length;
  await decisionApi.askDecision({
    state: '无 meta 的调用',
    questions: { probe: { type: 'noul', instructions: 'x' } },
    overrides: {
      ...API_KEY_OVERRIDE,
      fetchImpl: okFetch({ noul: 0.5 }),
      sleep: NO_SLEEP,
    },
  });
  assert.equal((await readRows()).length, before, '无 meta 不得记账');
});

test('记账 best-effort：store 抛错不影响决策结果', async (t) => {
  decisionLog._setDecisionLogDb(Promise.reject(new Error('db down')));
  t.after(() => decisionLog._setDecisionLogDb(null));
  const r = await decisionLog.logDecision({ point: 'x', state: 's' });
  assert.equal(r, undefined, 'logDecision 永不 throw');
  const outcome = await decisionApi.askDecision({
    state: 's',
    questions: { probe: { type: 'noul', instructions: 'x' } },
    meta: { point: 'x' },
    overrides: {
      ...API_KEY_OVERRIDE,
      fetchImpl: okFetch({ noul: 0.9 }),
      sleep: NO_SLEEP,
    },
  });
  assert.equal(outcome.ok, true, '记账失败不影响决策');
  decisionLog._setDecisionLogDb(null);
});

test('聚合：summarizeDecisions 按接点聚合调用量与降级率', async () => {
  const summary = await decisionLog.summarizeDecisions({ days: 7 });
  assert.ok(Array.isArray(summary));
  const probe = summary.find((s) => s.point === 'test-probe');
  assert.ok(probe && probe.calls >= 1, '聚合含 test-probe');
  assert.ok(probe.degradedRate >= 0 && probe.degradedRate <= 1);
});

test('recentDecisions：最新在前 + point 过滤 + limit 上限', async () => {
  const recent = await decisionLog.recentDecisions({ limit: 10 });
  assert.ok(Array.isArray(recent) && recent.length >= 2);
  assert.ok(recent[0].at >= recent[recent.length - 1].at, '最新在前');
  const filtered = await decisionLog.recentDecisions({ limit: 10, point: 'test-probe-degraded' });
  assert.ok(filtered.every((r) => r.point === 'test-probe-degraded'));
  assert.ok(filtered.every((r) => r.degraded === true));
  const capped = await decisionLog.recentDecisions({ limit: 5000 });
  assert.ok(capped.length <= 200, 'limit 上限 200');
});

test('recentDecisions：DB 不可用返回 null（诚实不可用）', async (t) => {
  decisionLog._setDecisionLogDb(Promise.reject(new Error('db down')));
  t.after(() => decisionLog._setDecisionLogDb(null));
  assert.equal(await decisionLog.recentDecisions({}), null);
});


test('P5 provider：文件供给优先于 env（file > env > 默认）', async (t) => {
  const cfgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'biof3-b116-p5-'));
  const cfgPath = path.join(cfgDir, 'decision-config.json');
  fs.writeFileSync(cfgPath, JSON.stringify({ version: 1, points: {}, provider: { baseUrl: 'https://file.example', apiKey: 'file-key', model: 'jev-1.13.0' } }));
  process.env.BIOF3_DECISION_CONFIG_PATH = cfgPath;
  process.env.TYPESAFE_API_KEY = 'env-key';
  t.after(() => {
    delete process.env.BIOF3_DECISION_CONFIG_PATH;
    delete process.env.TYPESAFE_API_KEY;
    decisionLog._setDecisionLogDb(null);
  });
  const cfg = decisionApi.resolveDecisionConfig();
  assert.equal(cfg.apiKey, 'file-key', '文件供给优先于 env');
  assert.equal(cfg.baseUrl, 'https://file.example');
});

test('P5 provider：env 回退（文件无供给时用 env key）', async (t) => {
  const cfgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'biof3-b116-p5b-'));
  const cfgPath = path.join(cfgDir, 'decision-config.json');
  fs.writeFileSync(cfgPath, JSON.stringify({ version: 1, points: {} }));
  process.env.BIOF3_DECISION_CONFIG_PATH = cfgPath;
  process.env.TYPESAFE_API_KEY = 'env-key';
  t.after(() => {
    delete process.env.BIOF3_DECISION_CONFIG_PATH;
    delete process.env.TYPESAFE_API_KEY;
  });
  const cfg = decisionApi.resolveDecisionConfig();
  assert.equal(cfg.apiKey, 'env-key');
});

test('P5 provider：GET 打码（apiKey 永不回传原文）', async (t) => {
  const cfgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'biof3-b116-p5c-'));
  const cfgPath = path.join(cfgDir, 'decision-config.json');
  fs.writeFileSync(cfgPath, JSON.stringify({ version: 1, points: {}, provider: { baseUrl: 'https://file.example', apiKey: 'file-key', model: 'jev-1.13.0' } }));
  process.env.BIOF3_DECISION_CONFIG_PATH = cfgPath;
  t.after(() => { delete process.env.BIOF3_DECISION_CONFIG_PATH; });
  const masked = decisionConfigModule.getProviderMasked();
  assert.equal(masked.hasKey, true);
  assert.ok(!JSON.stringify(masked).includes('file-key'), '打码视图不得包含 key 原文');
});

test('70 工具恒等红线延续（W1-3 契约复验）', () => {
  const { TOOL_DEFS, DOMAIN_TOOL_DEFS } = require(path.join(root, 'core', 'biof3-server', 'agent-tools', 'tool-defs.js'));
  const union = Object.values(DOMAIN_TOOL_DEFS).flat();
  assert.equal(union.length, TOOL_DEFS.length);
});
