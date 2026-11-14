'use strict';

/**
 * BLOCK-448 — P6 恢复腿 driver 的 executeJavaScript 表达式语法门禁。
 *
 * 事故（2026-09-25 起潜伏，2026-11-14 定位）：`lifecycleExpression()` 返回的脚本里
 * `publicProjectionHits` 被误插在 `return { ... };` 之后，形成非法 label 序列。
 * `webContents.executeJavaScript` 对整段脚本抛 SyntaxError，而调用点 `try { } catch { }`
 * 把错误静默吞成 `lifecycle = null` ⇒ `waitForLifecycle(...,'ready')` 恒定 120s 超时
 * ⇒ P6 恢复腿全链红（`p6_recovery_active_electron_persisted_driver_failure`）。
 *
 * 本测试把「表达式必须语法合法」变成机械门禁：新增/改写属性后一旦破坏结构，直接红。
 * 同源纪律见 driver 内 `lifecycleExpression` 上方的 BLOCK-448 留痕注释。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DRIVER = path.join(ROOT, 'scripts/g0-rs-p6-recovery-electron-driver.cjs');

/** 从 driver 源码按大括号配平截取具名函数（不执行 driver 主进程逻辑）。 */
function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} 必须存在于 ${path.basename(DRIVER)}`);
  let depth = 0;
  let index = source.indexOf('{', start);
  assert.ok(index > start, `${name} 必须有函数体`);
  for (; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    else if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  return source.slice(start, index + 1);
}

function buildFunction(source, name) {
  return new Function(`return (${extractFunction(source, name)})`)();
}

test('P6 恢复 driver 的 executeJavaScript 表达式必须语法合法（BLOCK-448）', () => {
  const source = fs.readFileSync(DRIVER, 'utf8');
  const lifecycle = buildFunction(source, 'lifecycleExpression');
  const renderer = buildFunction(source, 'rendererStateExpression');

  const cases = [
    ['lifecycleExpression("ready")', lifecycle('ready')],
    ['lifecycleExpression("recovery_available")', lifecycle('recovery_available')],
    ['lifecycleExpression(null)', lifecycle()],
    ['rendererStateExpression()', renderer()],
  ];
  for (const [label, produced] of cases) {
    assert.equal(typeof produced, 'string', `${label} 必须返回脚本文本`);
    assert.ok(produced.includes('document.'), `${label} 必须仍是页面内脚本`);
    assert.doesNotThrow(() => new Function(produced), `${label} 语法必须合法`);
  }
});

test('lifecycle 表达式必须能读到 data-state（不做 instanceof 之外的额外门槛）', () => {
  const source = fs.readFileSync(DRIVER, 'utf8');
  const lifecycle = buildFunction(source, 'lifecycleExpression');
  const produced = lifecycle('ready');
  // 选择器与状态门是恢复腿的唯一判定入口；漂移即红（防止再次读错元素）。
  assert.match(produced, /\[aria-label="Result Studio 版本与变更"\]/, '面板选择器单一真源');
  assert.match(produced, /data-state/, '必须按 data-state 判定 lifecycle 状态');
  assert.match(produced, /lifecycleState !== "ready"/, 'ready 门必须显式比较');
});

test('语法门禁自身有效：事故形态的坏脚本必须被 new Function 抓到', () => {
  // 复刻 2026-11 事故形态：属性插在 return 对象闭合之后 → 非法 label 序列。
  const broken = '(() => { return { a: 1 }; b: (() => 1)(), })()';
  assert.throws(() => new Function(broken), SyntaxError);
});
