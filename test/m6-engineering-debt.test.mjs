/**
 * M6（BLOCK-432）工程债务六组只读判据 · HK-01 红绿先行。
 * 首跑实现未落盘 → ERR_MODULE_NOT_FOUND 必红；实现后 → 全绿。
 * 全部视图只读仓库现有台账，零改写基线、零触碰在制 WIP。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { collectM6Views, adjudicateM6Views, M6_GROUPS } from '../scripts/m-blueprint-m6-debt-gate.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

test('M6 六组齐备且组内串行顺序固定', () => {
  assert.deepEqual(M6_GROUPS, ['A', 'B', 'C', 'D', 'E', 'F']);
});

test('M6-A 三矩阵共用 schema 只读对账：schema 缺失必红', () => {
  const views = collectM6Views(ROOT);
  assert.equal(adjudicateM6Views(views).ok, true, JSON.stringify(adjudicateM6Views(views).issues));
  const broken = { ...views, surface: { ...views.surface, schema: null } };
  assert.equal(adjudicateM6Views(broken).ok, false);
});

test('M6-A IPC 三真相只读视图：通道数与 preload 双向不虚报', () => {
  const v = collectM6Views(ROOT);
  assert.ok(v.ipc.channelCount > 100, '通道数须来自 channels.js 现取');
  assert.equal(v.ipc.rewritten, false, '本包零改写 channels/preload/catalog');
});

test('M6-B 巨型文件只读清单：不改文件、不抬 code-size 锚点', () => {
  const v = collectM6Views(ROOT);
  assert.ok(v.bigFiles.length >= 4);
  assert.ok(v.bigFiles.every((f) => f.lines > 1000));
  assert.ok(v.bigFiles.every((f) => f.rewritten === false));
});

test('M6-C 静默 catch 分域下降表：基线只读，总数可复算且与基线一致', () => {
  const v = collectM6Views(ROOT);
  // BLOCK-435：基线随收紧而下降（412→406），断言改为「与基线文件一致」而非硬编码值，
  // 否则每次合法收紧都会误红；只减不增由 gate:silent-catch 的棘轮负责。
  const baselineFile = JSON.parse(fs.readFileSync(path.join(ROOT, 'test/silent-catch-baseline.json'), 'utf8'));
  const baselineSum = Object.values(baselineFile.files || {}).reduce((a, b) => a + Number(b || 0), 0);
  assert.equal(v.silentCatch.baselineTotal, baselineSum);
  assert.equal(v.silentCatch.computedTotal, v.silentCatch.baselineTotal);
  assert.equal(v.silentCatch.rewritten, false);
  assert.ok(v.silentCatch.byDomain.core > 0);
});

test('M6-D W 类零触碰 + E 类人眼路线（Agent 不代答）', () => {
  const v = collectM6Views(ROOT);
  assert.equal(v.focus.terminal, 'W');
  assert.equal(v.focus.rewritten, false);
  assert.equal(v.focus.humanEyeRoute.status, 'pending_human_eye');
  assert.ok(v.focus.humanEyeRoute.steps.length >= 3);
  assert.ok(v.focus.humanEyeRoute.steps.every((s) => s.expected && s.evidencePoint));
});

test('M6-E 165 通道逐件分诊：保留 owner、零改写台账、结构/行为双列', () => {
  const v = collectM6Views(ROOT);
  assert.ok(v.channels.items.length > 100, '逐件而非汇总');
  assert.ok(v.channels.items.every((it) => it.owner && it.terminal));
  assert.equal(v.channels.rewritten, false);
  assert.ok(v.channels.dualColumn.includes('behavior') && v.channels.dualColumn.includes('structure'));
});

test('M6-F U 类材料 pending_user_ruling，不改默认语义', () => {
  const v = collectM6Views(ROOT);
  assert.equal(v.uMaterial.status, 'pending_user_ruling');
  assert.equal(v.uMaterial.defaultChanged, false);
  assert.ok(v.uMaterial.candidates.length >= 2);
  assert.equal(v.skills.rewritten, false);
});

test('M6 门自身篡改必红：baseline 被削减 / W 项被写成 verified', () => {
  const v = collectM6Views(ROOT);
  const shrunk = { ...v, silentCatch: { ...v.silentCatch, computedTotal: 1 } };
  assert.equal(adjudicateM6Views(shrunk).ok, false);
  const fakeVerified = { ...v, focus: { ...v.focus, terminal: 'verified' } };
  assert.equal(adjudicateM6Views(fakeVerified).ok, false);
  assert.ok(fs.existsSync(path.join(ROOT, 'test/silent-catch-baseline.json')));
});
