/**
 * hiddenInset 精调（owner msg_cf676d55d7fe）：按 Petri 自己的 header 几何重算红绿灯位置。
 * HK-01：y 相对 Petri 38px header 居中、x 与收起按钮留舒适间距、灯色/焦点诚实边界。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const win = fs.readFileSync(path.join(ROOT, 'src/main/_window-create.js'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'frontend/src/components/desktop/titlebar/ColumnizedTitleBar.module.css'), 'utf8');
const globalCss = fs.readFileSync(path.join(ROOT, 'frontend/src/styles/global.css'), 'utf8');

test('HK-01-1：CDP实测工具行中心y≈18.7 → 灯中心y=19 同线对齐（非照抄Orca y=12）', () => {
  assert.match(globalCss, /--petri-titlebar-height:\s*38px/);
  const m = win.match(/trafficLightPosition:\s*\{\s*x:\s*(\d+),\s*y:\s*(\d+)/);
  assert.ok(m, 'trafficLightPosition 缺失');
  assert.equal(Number(m[2]), 19, 'trafficLightPosition.y 是灯中心坐标，须对齐 CDP 实测工具行中心 y≈18.7');
});

test('HK-01-2：x 与左栏收起按钮留舒适间距（x=20 + padding-left≥90px）', () => {
  const m = win.match(/trafficLightPosition:\s*\{\s*x:\s*(\d+),/);
  assert.equal(Number(m[1]), 20);
  const p = css.match(/\.macTitlebar[^{]*\{\s*padding-left:\s*(\d+)px/);
  assert.ok(p && Number(p[1]) >= 90, `padding-left 应≥90px（实际 ${p && p[1]}）`);
});

test('HK-01-3：灯色诚实边界——不失焦时 OS 绘彩灯，灰灯属失焦标准行为', () => {
  // 主进程不改灯色（不伪造聚焦态）；仅位置可调。断言无自定义灯色覆盖配置。
  assert.doesNotMatch(win, /trafficLightTheme|setTrafficLight|red.*green.*yellow/i);
});
