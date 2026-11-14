'use strict';

/**
 * BLOCK-321c / UI-629 — 中栏优先宽度模型（拖宽把手钳制 + 阈值单一源）。
 *
 * 用户裁决「固定中间栏宽度，除非手动调整」：侧栏拖宽不得把中栏压到保底
 * （760）以下；阈值/gap 单一源导出，把手调用点消费 sidebarResizeMax。
 * 静态断言先例=block59 适配器契约 / block130 队列契约 / block321b 单钮契约。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('UI-629 阈值单一源：保底 420 / 迟滞 500 / gap 40 / 钳制 helper 导出', () => {
  const src = read('frontend/src/hooks/useResponsivePanelCollapse.ts');
  // BLOCK-375（S0）契约追新：f312ebfd（UI-629 后续刀）按用户裁决 2026-10-30
  // 「中间栏固定宽度太宽」把保底 760→420（手机宽度）、迟滞 840→500——锚随契约走。
  assert.match(src, /CENTER_SPACE_COLLAPSE_BELOW = 420/, '中栏保底 420（UI-629 收窄后）');
  assert.match(src, /CENTER_SPACE_RESTORE_ABOVE = 500/, '迟滞还原 500');
  assert.match(src, /CENTER_GAP_TOTAL = 40/, 'gap 计入（两侧 20px）');
  assert.match(src, /const CENTER_MIN_RESERVED = CENTER_SPACE_COLLAPSE_BELOW/, '钳制消费值（模块内常量，sidebarResizeMax 单一消费）');
  assert.match(src, /export function sidebarResizeMax/, '钳制计算 helper 导出');
  // 旧算法漏 gap：centerWith 必须减 CENTER_GAP_TOTAL
  assert.match(src, /-\s*CENTER_GAP_TOTAL/, 'centerWith 必须扣 gap');
});

test('UI-629 拖宽把手钳制：左右把手调用点都传 clamp.max（sidebarResizeMax 现算）', () => {
  const rail = read('frontend/src/components/desktop/AppRail.tsx');
  assert.match(
    rail,
    /startColumnResize\('left', \{ max: sidebarResizeMax\(window\.innerWidth, rightOpen \? rightWidth : 0\) \}\)/,
    '左把手钳制（右栏开时按其现宽预留）',
  );
  const ws = read('frontend/src/pages/project-workspace.tsx');
  assert.match(
    ws,
    // resultsFocus 时右栏把手切 resultRight 档（UI-457 后右栏双档），钳制消费不变
    /startColumnResize\((resultsFocus \? 'resultRight' : 'right'), \{ max: sidebarResizeMax\(window\.innerWidth, leftOpen \? leftWidth : 0\) \}\)/,
    '右把手钳制（左栏开时按其现宽预留）',
  );
});

test('UI-629 布局 gap 锚：CSS gap 走 --ws-layout-gap 单源，默认 20px 与 CENTER_GAP_TOTAL=40 同源语义', () => {
  // BLOCK-421（2026-11-11）布局层单源收敛：20px 字面量改为消费 --ws-layout-gap，
  // 默认值真源在 global.css:root（20px = 两侧 40 ），≤960px 断点覆盖为 space-4（12px）。
  // 契约演进而非放宽：默认档仍必须与 CENTER_GAP_TOTAL 同源，断点覆盖只允许引用既有 space 档位。
  const css = read('frontend/src/pages/project-workspace.module.css');
  const layout = css.match(/\.workspaceSessionLayout \{[^}]*\}/s);
  assert.ok(layout, 'workspaceSessionLayout 规则存在');
  assert.match(layout[0], /gap: var\(--ws-layout-gap\)/, 'gap 只消费单源变量，不写裸字面量');
  const globalCss = read('frontend/src/styles/global.css');
  assert.match(globalCss, /--ws-layout-gap:\s*20px/, '默认 20px（两侧 40 的来源）与 CENTER_GAP_TOTAL 同源');
  const narrow = css.match(/@media \(max-width: 960px\) \{[\s\S]*?--ws-layout-gap: var\(--petri-space-4\);/);
  assert.ok(narrow, '窄屏断点差异走既有 space 档位，不引入新阈值');
});
