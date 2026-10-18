/**
 * BLOCK-213 — 功能发现率棘轮（单调不回退）。
 *
 * 口径来自 `scripts/block213-discoverability.mjs`（静态扫描，脚本内写明），基线数字=2026-10-18 实测：
 *   paletteCommands 24 / settingsCovered 10·10 / shortcutCovered 5·10 / emptyGuidePages 2·2。
 *
 * 为什么是"不回退"而不是"越高越好"：命令面板接新动作是产品决定，接多了会稀释搜索质量；
 * 本测只保证**已经发现的东西不会悄悄消失**（重构/删除时立刻红）。
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(import.meta.dirname, '..');
const { measure } = await import(pathToFileURL(path.join(ROOT, 'scripts', 'block213-discoverability.mjs')).href);

const BASELINE = {
  paletteCommands: 24,
  settingsCovered: 10,
  settingsSections: 10,
  keymapEntries: 10,
  shortcutCovered: 5,
  emptyGuidePages: 2,
};

test('BLOCK-213 — 四数字不低于基线（棘轮只增不减）', () => {
  const m = measure();
  assert.ok(m.paletteCommands >= BASELINE.paletteCommands, `命令面板命令 ${m.paletteCommands} < 基线 ${BASELINE.paletteCommands}`);
  assert.ok(m.settingsCovered >= BASELINE.settingsCovered, `设置节覆盖 ${m.settingsCovered} < 基线 ${BASELINE.settingsCovered}`);
  assert.ok(m.shortcutCovered >= BASELINE.shortcutCovered, `快捷键同名覆盖 ${m.shortcutCovered} < 基线 ${BASELINE.shortcutCovered}`);
  assert.ok(m.emptyGuidePages >= BASELINE.emptyGuidePages, `空态引导 ${m.emptyGuidePages} < 基线 ${BASELINE.emptyGuidePages}`);
});

test('BLOCK-213 — 命令 id 唯一（重复 id 会让快捷键徽章与点击行为错位）', () => {
  const m = measure();
  assert.equal(new Set(m.paletteStaticIds).size, m.paletteStaticIds.length, '存在重复命令 id');
});

test('BLOCK-213 — 每个设置节都有面板深链（发现率的硬要求）', () => {
  const m = measure();
  assert.equal(m.settingsCovered, m.settingsSections, '有设置节在命令面板里不可达');
});

test('BLOCK-213 — 外观与动效命令存在（W7c 能力必须能被发现）', () => {
  const m = measure();
  for (const id of ['view-theme-system', 'view-theme-light', 'view-theme-dark', 'view-motion-system', 'view-motion-full', 'view-motion-reduced']) {
    assert.ok(m.paletteStaticIds.includes(id), `缺少外观/动效命令 ${id}`);
  }
});

test('BLOCK-213 — 空态引导：确实有空态的页面全带标记，且 N/A 有据可查', () => {
  const m = measure();
  assert.equal(m.emptyGuidePages, m.emptyGuideTargets, '有空态的页面缺 data-testid="empty-guide"');
  assert.ok(m.emptyGuideNotApplicable.length === 2, '另两页必须写明为何记 N/A，不许含糊');
});
