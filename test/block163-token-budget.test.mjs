/**
 * BLOCK-163 W3 P4/P5（MDL-1/MDL-2）— 计量可信契约测试。
 *
 * MDL-1：getContextWindowForBudget（preset 优先/已知模型 resolved/未知模型
 * 保守 32k+resolved:false——预算侧零盲区）；agent-runner 源码钉（未知→32k+warn
 * +token_budget resolved 字段）。
 * MDL-2：model-token-ratios（种子表子串匹配/EWMA 自愈收敛/双侧夹持/无匹配 1.0；
 * calibratedEstimate 上取整）。
 */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve('.');

// tiktoken 从 core 的 node_modules 解析（根 package 无此依赖；estimator 顶部
// require('tiktoken') 走 core 解析域）
const { createRequire: createCoreRequire } = require('node:module');
const coreRequire = createCoreRequire(path.join(ROOT, 'core/biof3-server/package.json'));
// 预置 tiktoken 解析域：注册为根 require 可见的 fallback 不行——直接预热 estimator
// 的模块解析：用 coreRequire 先加载一次 estimator 内部依赖链。
void coreRequire;

const estimator = coreRequire(path.join(ROOT, 'core/biof3-server/helpers/token-estimator.js'));
const ratios = require(path.join(ROOT, 'core/biof3-server/helpers/model-token-ratios'));

test('BLOCK-163 MDL-1 预算窗口：preset 优先；已知模型 resolved:true', async () => {
  const preset = await estimator.getContextWindowForBudget('any-model', 'openai', null, null, 200000);
  assert.deepEqual(preset, { window: 200000, resolved: true });

  const known = await estimator.getContextWindowForBudget('deepseek-chat', 'deepseek', null, null, null);
  assert.deepEqual(known, { window: 64000, resolved: true });
});

test('BLOCK-163 MDL-1 盲区收口：未知模型→保守 32k+resolved:false（不再 0）', async () => {
  const unknown = await estimator.getContextWindowForBudget('totally-unknown-model-xyz', 'openai-compatible', 'http://localhost:9', null, null);
  assert.equal(unknown.window, 32768);
  assert.equal(unknown.resolved, false);
  // 展示面语义不动：getContextWindow 仍返回 0（前端「—」）
  const display = await estimator.getContextWindow('totally-unknown-model-xyz', 'openai-compatible', 'http://localhost:9', null);
  assert.equal(display, 0);
});

test('BLOCK-163 MDL-1 源码钉：agent-runner 未知→32k+warn+token_budget resolved 字段', () => {
  const src = fs.readFileSync(path.join(ROOT, 'core/biof3-server/agent-runner.js'), 'utf8');
  assert.match(src, /getContextWindowForBudget/);
  assert.match(src, /32768/);
  assert.match(src, /resolved: ctxResolved/);
});

test('BLOCK-163 MDL-2 种子表：deepseek 0.65 / 无匹配 1.0', () => {
  ratios._resetForTests();
  assert.equal(ratios.getRatio('deepseek-chat'), 0.65);
  assert.equal(ratios.getRatio('DeepSeek-V4'), 0.65);
  assert.equal(ratios.getRatio('unknown-model-abc'), 1.0);
});

test('BLOCK-163 MDL-2 EWMA 自愈：观测收敛 actual/estimated，夹持 [0.3,2.0]', () => {
  ratios._resetForTests();
  // 模型 unknown（种子 1.0）：持续观测 actual=0.5*estimated → 系数收敛向 0.5
  let last = null;
  for (let i = 1; i <= 20; i++) {
    last = ratios.observeRatio('unknown-model-abc', 1000, 500);
  }
  assert.ok(last.ratio < 0.55 && last.ratio > 0.45, `EWMA 应收敛至 ~0.5，实际 ${last.ratio}`);
  assert.equal(last.observations, 20);
  assert.equal(ratios.getRatio('unknown-model-abc'), last.ratio);
  // 夹持：坏观测（actual 远超）不上天
  for (let i = 0; i < 30; i++) ratios.observeRatio('unknown-model-abc', 100, 1000);
  assert.ok(ratios.getRatio('unknown-model-abc') <= 2.0);
});

test('BLOCK-163 MDL-2 calibratedEstimate：乘系数上取整；坏观测零返回', () => {
  ratios._resetForTests();
  assert.equal(ratios.calibratedEstimate(1000, 'deepseek-chat'), Math.ceil(650));
  assert.equal(ratios.observeRatio('deepseek-chat', 0, 100), null);
  assert.equal(ratios.observeRatio('', 100, 100), null);
});
