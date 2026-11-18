import test from 'node:test';
import assert from 'node:assert/strict';

// HK-01：模块缺席时本 import 即红，实现后转绿。
import {
  scanSourceAnchors,
  simulatePaging,
  buildConclusion,
} from '../scripts/block477-filetree-repro.mjs';

const ROOT = new URL('..', import.meta.url).pathname;

test('BLOCK-477 G2 源码三处模式逐项在场（fail-closed）', () => {
  const anchors = scanSourceAnchors(ROOT);
  assert.equal(anchors.loadMoreAppend, true, 'loadMoreRoot 必须以 [...prev, ...page.entries] 续拉');
  assert.equal(anchors.refreshResetsToOffsetZero, true, 'refreshFiles 必须以 fetchDirPage(\'\', 0) 覆盖整树');
  assert.equal(anchors.pollEvery2s, true, '本地项目必须存在 2000ms 轮询调用 refreshFiles');
  assert.equal(anchors.allPresent, true);
});

test('BLOCK-477 G3 状态机：加载第 2 页后 2s 轮询把树拉回第一页（回弹可复算）', () => {
  const r = simulatePaging({ total: 520, pageSize: 200, clicks: 2, pollAfterEachClickMs: 2000 });
  assert.equal(r.afterFirstClick.rows, 400, '首击 200→400');
  assert.equal(r.afterPoll.rows, 200, '轮询后回弹到 200');
  assert.equal(r.afterPoll.cursorDone, 200, '游标被重置回第一页');
  assert.equal(r.reboundObserved, true);
  assert.equal(r.inertObserved, true, '回弹窗口内的再次点击表现为 grew=false（惰性）');
});

test('BLOCK-477 G3 负测：若轮询不重置（注入修复版）则不产生回弹', () => {
  const r = simulatePaging({ total: 520, pageSize: 200, clicks: 2, pollAfterEachClickMs: 2000, pollResets: false });
  assert.equal(r.afterPoll.rows, 400, '修复版轮询不回弹');
  assert.equal(r.reboundObserved, false);
});

test('BLOCK-477 G4 三态结论 schema 合法且证据等级如实', () => {
  const c = buildConclusion(ROOT);
  assert.ok(['reproduced_and_attributed', 'observed_not_reproduced', 'environment_blocked'].includes(c.triState));
  assert.equal(typeof c.rootCauseAttributed, 'boolean');
  assert.equal(c.fixApplied, false, '归因包永不写 fixApplied=true');
  assert.equal(c.ticketStatus, 'kept-open', '本包不销票');
  assert.ok(c.evidenceLevel, '必须声明证据等级');
});

test('BLOCK-477 G2 负测：篡改的源码目录应全部判模式缺失（fail-closed）', () => {
  const anchors = scanSourceAnchors('/definitely/not/a/repo');
  assert.equal(anchors.allPresent, false);
  assert.equal(anchors.loadMoreAppend, false);
});
