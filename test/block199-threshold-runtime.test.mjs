/**
 * BLOCK-199 P4① — 「设置页改了阈值必须真的生效」的红→绿契约（离线·零网络）。
 *
 * 缺陷（P0 实码核实）：`core/petri-server/helpers/tool-router.js:22` 在模块加载时把
 * `thresholdForPoint('tool-route')` 冻结成模块常量，`:90` 的 meta 与 `:96` 的采纳判定全程用它；
 * 而同族 `intent-router.js:81` 走的是 `runtime.threshold ?? INTENT_ROUTE_THRESHOLD`。
 * 后果=用户在设置页改 tool-route 阈值，落盘成功、回显正确，**判定值永不变**。
 *
 * 本测只断"行为"（route 与否），不去抠请求体：行为才是用户可感面。
 * 红线守恒：不校准的默认数值一个字节不改（无 stored 覆盖时仍须按注册表 θ=0.8 判），
 * 只把"读取时机"从模块加载改到调用时。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { resolveToolRoute, TOOL_ROUTE_THRESHOLD, TOOL_FAMILIES } = require(path.join(ROOT, 'core/petri-server/helpers/tool-router.js'));
const { thresholdForPoint } = require(path.join(ROOT, 'core/petri-server/helpers/decision-thresholds.js'));

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'b199-toolroute-'));
const decisionFile = path.join(sandbox, 'decision-config.json');
process.env.PETRI_DECISION_CONFIG_PATH = decisionFile;
process.env.PETRI_JEV_TOOL_ROUTE = '1';

test.after(() => {
  delete process.env.PETRI_JEV_TOOL_ROUTE;
  delete process.env.PETRI_DECISION_CONFIG_PATH;
  try { fs.rmSync(sandbox, { recursive: true, force: true }); } catch { /* 临时目录清理失败不影响结论 */ }
});

const NO_SLEEP = async () => {};
const ANSWER = { choice: 'knowledge', confidence: 0.2 };

/** 假出站：永不触网，回放一个**通过 choice 校验**的答案（概率完备、choice=argmax、和≈1）。 */
function fakeFetch() {
  let calls = 0;
  const probabilities = Object.fromEntries(Object.keys(TOOL_FAMILIES).map((k) => [k, k === 'knowledge' ? 1 : 0]));
  const impl = async () => {
    calls += 1;
    return {
      ok: true,
      status: 200,
      json: async () => ({ model: 'jev-1.13.0', answers: { family: { choice: 'knowledge', probabilities, confidence: ANSWER.confidence } } }),
    };
  };
  return { impl, count: () => calls };
}

const writeConfig = (points) => fs.writeFileSync(decisionFile, JSON.stringify({ version: 1, points }));
const route = async (fetchImpl) => resolveToolRoute('把 marker 表按细胞类型对一下', {
  apiKey: 'test-key-do-not-call-real-api', fetchImpl, sleep: NO_SLEEP,
});

test('注册表默认阈值仍是 0.8（校准数值未动；改了它=违反 BLOCK-113 定版）', () => {
  assert.equal(TOOL_ROUTE_THRESHOLD, 0.8);
  assert.equal(thresholdForPoint('tool-route'), 0.8);
});

test('无 stored 覆盖：confidence 0.2 < θ0.8 → 不采纳（未配置时行为零变化）', async () => {
  fs.rmSync(decisionFile, { force: true });
  const spy = fakeFetch();
  const r = await route(spy.impl);
  assert.equal(r.route, false);
  assert.equal(r.reason, 'below_threshold');
  assert.ok(spy.count() >= 1, '判定确实出站问了模型');
});

test('设置页把阈值热调到 0.11：同一条 0.2 置信必须被采纳（改配置即改判定）', async () => {
  writeConfig({ 'tool-route': { enabled: true, threshold: 0.11 } });
  const spy = fakeFetch();
  const r = await route(spy.impl);
  assert.equal(r.route, true, `期望采纳收窄，实际=${JSON.stringify(r)}`);
  assert.equal(r.family, 'knowledge');
});

test('设置页把阈值调到 0.95：同一条 0.2 置信必须回到不采纳（不是单向放开）', async () => {
  writeConfig({ 'tool-route': { enabled: true, threshold: 0.95 } });
  const spy = fakeFetch();
  const r = await route(spy.impl);
  assert.equal(r.route, false);
  assert.equal(r.reason, 'below_threshold');
});

test('stored 阈值改回 0.11 立即再次生效（无缓存粘滞，无需重启进程）', async () => {
  writeConfig({ 'tool-route': { enabled: true, threshold: 0.95 } });
  await route(fakeFetch().impl);
  writeConfig({ 'tool-route': { enabled: true, threshold: 0.11 } });
  const r = await route(fakeFetch().impl);
  assert.equal(r.route, true, '阈值回落后必须马上生效（模块级冻结就是这条失败）');
});
