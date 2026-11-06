/**
 * Gen UI「完整单文件 HTML」优先级契约（2026-11-05 实测沉淀）。
 *
 * 事故：用户明确要求「生成一个完整的单文件 HTML」，模型被 gen-ui 系统提示
 * （唯一写入位置 + fragment 硬约束）与 visualize 技能规范同时钳住，产物降级为
 * fragment，无法作为独立文件直接打开。
 *
 * 契约：两处提示都必须保留「用户显式要求完整单文件 HTML 时优先」的例外，
 * 否则模型会在两份规则之间反复纠结甚至耗尽输出预算。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('gen-ui 系统提示保留完整单文件 HTML 优先级', () => {
  const src = fs.readFileSync(path.join(ROOT, 'core', 'petri-server', 'helpers', 'gen-ui-prompt.js'), 'utf8');
  assert.match(src, /完整的单文件 HTML/);
  assert.match(src, /以用户要求为准/);
  assert.match(src, /不要降级成 fragment/);
});

test('visualize 技能规范保留完整单文件 HTML 优先级', () => {
  const src = fs.readFileSync(path.join(ROOT, 'resources', 'skills', 'visualize', 'prompts', 'system.md'), 'utf8');
  assert.match(src, /完整的单文件 HTML/);
  assert.match(src, /不要[\s\S]{0,40}降级为 fragment/);
  assert.match(src, /聊天内嵌/, '「唯一写入位置」必须限定为聊天内嵌沙箱，不能是全局绝对句');
});

test('优先级条款必须先于输出目录出现（模型按顺序读）', () => {
  const src = fs.readFileSync(path.join(ROOT, 'core', 'petri-server', 'helpers', 'gen-ui-prompt.js'), 'utf8');
  assert.ok(src.indexOf('优先级') < src.indexOf('可视化输出目录'), '优先级必须先于目录约束');
});

test('对话风格默认值不得压过用户的完整/详尽要求', () => {
  const src = fs.readFileSync(path.join(ROOT, 'core', 'petri-server', 'helpers', 'system-prompt.js'), 'utf8');
  assert.match(src, /用户明确要求完整/);
  assert.match(src, /以用户要求为准/);
});

test('用户明确索要文件位置时允许给真实绝对路径，但仍禁止编造', () => {
  const sys = fs.readFileSync(path.join(ROOT, 'core', 'petri-server', 'helpers', 'system-prompt.js'), 'utf8');
  assert.match(sys, /用户明确索要/);
  assert.match(sys, /不得猜测、编造/, '放宽的是「给真实路径」，不是「允许编造路径」');

  const desktop = fs.readFileSync(path.join(ROOT, 'core', 'petri-server', 'helpers', 'desktop-agent-prompt.js'), 'utf8');
  assert.match(desktop, /用户明确索要文件存放位置时/);
  assert.match(desktop, /不得猜测或编造/);
});

test('领域包提示注入必须带「用户显式要求优先」元规则', () => {
  const src = fs.readFileSync(path.join(ROOT, 'core', 'petri-server', 'helpers', 'pack-prompt-fragments.js'), 'utf8');
  assert.match(src, /与用户显式要求冲突时，以用户要求为准/);
  assert.match(src, /安全、权限、审批与数据真实性条款除外/);
});
