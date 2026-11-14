/**
 * UI-D2 (BLOCK-417) — 布局定义唯一性门负测。
 * 植入第二定义 / WIP 未登记新重复 / WIP 重复增长 / 登记表缺 owner / 热点棘轮必红。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  checkFiles, verifyLayoutDefinitions, extractClassDefinitions, countContainerHotspots,
  WIP_CSS, WIP_KNOWN_DUPLICATES, CONTAINER_HOTSPOT_BASELINE,
} from '../scripts/ui-design-layout-gate.mjs';

const def = (file, className, line, containerProps = 1) => ({ file, className, line, containerProps });
// BLOCK-421 后真实 WIP 重复已收敛为 0（清单归零）。负测改为**自带登记表注入**，
// 验证「登记即不判红 / 未登记即红 / 增长即红」的机制仍然成立，不依赖真实数据现状。
const injectedKnown = () => ([
  { className: 'workspaceSessionLayout', definitions: 2, lines: [1, 2], owner: 'fixture owner', remediation: 'fixture remediation：收敛到单源' },
]);
const wipBase = () => [
  def(WIP_CSS, 'workspaceSessionLayout', 1546),
  def(WIP_CSS, 'workspaceSessionLayout', 2847),
];
const withSkip = (definitions, extra = {}) => ({ definitions, skipHotspotRatchet: true, ...extra });

test('real tree passes layout uniqueness gate (gate:ui-layout)', () => {
  assert.deepEqual(checkFiles().problems, []);
});

test('extractClassDefinitions 解析单条与容器属性计数', () => {
  const d = extractClassDefinitions('.workspaceSessionLayout { display: flex; gap: 20px; color: red; }', 'a.css');
  assert.equal(d.length, 1);
  assert.equal(d[0].className, 'workspaceSessionLayout');
  assert.equal(d[0].containerProps, 2);
});

test('植入同类名第二定义必红（非 WIP）', () => {
  const p = verifyLayoutDefinitions(withSkip([def('a.css', 'workspaceSessionLayout', 1), def('a.css', 'workspaceSessionLayout', 99)]));
  assert.ok(p.some((x) => x.includes('布局非单源') && x.includes('a.css')));
});

test('WIP 既存重复显式登记且不判红；新重复未登记必红', () => {
  assert.deepEqual(verifyLayoutDefinitions(withSkip(wipBase(), { knownWipDuplicates: injectedKnown() })), []);
  // 真实清单已归零（BLOCK-421 收敛），不是放宽：新重复仍必红
  assert.equal(WIP_KNOWN_DUPLICATES.length, 0);
  const p = verifyLayoutDefinitions(withSkip(wipBase(), { knownWipDuplicates: injectedKnown() }));
  assert.deepEqual(p, []);
  const unregistered = verifyLayoutDefinitions(withSkip([...wipBase(), def(WIP_CSS, 'workspaceSessionInset', 1), def(WIP_CSS, 'workspaceSessionInset', 2)]));
  assert.ok(unregistered.some((x) => x.includes('WIP 文件出现未登记的新重复布局定义')));
  // 归零后连既有的两处同名定义也必须判红（棘轮收紧）
  assert.ok(verifyLayoutDefinitions(withSkip(wipBase())).some((x) => x.includes('未登记的新重复布局定义')));
});

test('WIP 已登记重复增长 / 登记缺 owner 必红（只减棘轮）', () => {
  const grown = [...wipBase(), def(WIP_CSS, 'workspaceSessionLayout', 3000)];
  assert.ok(verifyLayoutDefinitions(withSkip(grown, { knownWipDuplicates: injectedKnown() })).some((x) => x.includes('只减棘轮')));
  const bad = [{ ...injectedKnown()[0], owner: '' }];
  assert.ok(verifyLayoutDefinitions({ definitions: wipBase(), knownWipDuplicates: bad, skipHotspotRatchet: true }).some((x) => x.includes('缺 owner')));
});

test('全仓容器热点新增即红（只减棘轮）', () => {
  const many = Array.from({ length: 5 }, (_, i) => def('a.css', `hot${i}`, i, 4));
  assert.equal(countContainerHotspots(many), 5);
  assert.ok(verifyLayoutDefinitions({ definitions: many, hotspotBaseline: 0 }).some((x) => x.includes('热点由 0 增至')));
  assert.equal(CONTAINER_HOTSPOT_BASELINE, 708);
});

test('WIP 例外不可被滥用于非 WIP 文件（越界必红）', () => {
  assert.ok(verifyLayoutDefinitions(withSkip([def('other.css', 'workspaceSessionLayout', 1), def('other.css', 'workspaceSessionLayout', 2)])).some((x) => x.includes('other.css')));
});
