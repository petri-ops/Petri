import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('block268: flow 可加载且断言面齐全（UI-585 四链）', () => {
  const flow = require(path.join(ROOT, '.agents/skills/petri-dev-infra/dev-verify/flows/b268-scratchpad-live.cjs'));
  assert.equal(typeof flow.run, 'function');
  const source = fs.readFileSync(
    path.join(ROOT, '.agents/skills/petri-dev-infra/dev-verify/flows/b268-scratchpad-live.cjs'),
    'utf8',
  );
  for (const name of ['UI585_dock_open', 'UI585_remount_keeps_open', 'UI585_close_semantics', 'UI585_reload_resets']) {
    assert.ok(source.includes(`'${name}'`), `flow 缺断言 ${name}`);
  }
  // SPA 切换路径：不得用 CDP Page.navigate 作重挂触发（那是整页刷新=新 realm，会误杀模块级 store）
  assert.ok(source.includes('history.back()'), '重挂触发必须是 SPA 内部切换（history.back）');
  assert.ok(!source.includes("Page.navigate', { url: `${APP_ORIGIN}/settings` }"), '禁止用整页导航触发重挂');
});

test('block268: 主脚本契约（隔离栈端口/证据目录/亮暗开关）', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts/block268-scratchpad-live.mjs'), 'utf8');
  assert.ok(source.includes("'acceptance', 'block-268'"), '证据必须落 acceptance/block-268/');
  assert.ok(source.includes('PETRI_B268_DARK'), '暗轮开关=PETRI_B268_DARK');
  assert.ok(source.includes('PETRI_TEST_INSTANCE'), '离屏测试实例纪律（零弹窗）');
  assert.ok(source.includes('9223'), '隔离 CDP 端口=9223（不占 dev 栈 9222）');
  assert.equal(fs.existsSync(path.join(ROOT, 'acceptance/block-268/scratchpad-live.json')), true, '亮轮证据在场');
  assert.equal(fs.existsSync(path.join(ROOT, 'acceptance/block-268/scratchpad-live-dark.json')), true, '暗轮证据在场');
});
