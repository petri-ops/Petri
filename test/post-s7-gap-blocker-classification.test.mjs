/**
 * 34 条缺口「谁解锁」分类契约 —— 回答「剩下的是不是都是人眼验收」。
 *
 * 单一真相源 = acceptance/post-s7-2026-11-09/h7/gap-ledger.json 的 gaps[].blocker
 * （本测试不另建一份分类）。逐件钉住：
 *   ① 34 条都有合法主类，且 blockerCounts 由脚本机械汇总（不手写计数）；
 *   ② 人眼主类只有 4 条，且列表逐字冻结（防止把工程项误标成人眼、替 Agent 免责）；
 *   ③ 「人眼」外还有四大类，其中 engineering + dev_stack 是 Agent 可开工项（需发令）；
 *   ④ 末步需人眼 / 需凭据的附加条件单独记，不混进主类计数；
 *   ⑤ 8 项 humanEyePending 属任务产物质量判据，依赖 B-02 凭据，不冒充 UI 观感验收。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ledger = JSON.parse(fs.readFileSync(
  path.join(ROOT, 'acceptance/post-s7-2026-11-09/h7/gap-ledger.json'), 'utf8',
));

const VALID = ['none', 'human_eye', 'credential', 'user_decision', 'dev_stack', 'engineering'];
const by = (cls) => ledger.gaps.filter((g) => g.blocker === cls).map((g) => g.id).sort();

function recompute() {
  const c = {};
  for (const g of ledger.gaps) c[g.blocker] = (c[g.blocker] || 0) + 1;
  return c;
}

test('34 条逐件有合法主类，计数机械汇总不手写', () => {
  assert.equal(ledger.gaps.length, 34);
  assert.equal(new Set(ledger.gaps.map((g) => g.id)).size, 34);
  for (const g of ledger.gaps) assert.ok(VALID.includes(g.blocker), `${g.id} 主类非法: ${g.blocker}`);
  const counts = recompute();
  assert.deepEqual(counts, ledger.blockerCounts, 'blockerCounts 必须由 gaps[].blocker 汇总');
  assert.equal(Object.values(counts).reduce((a, b) => a + b, 0), 34);
});

test('人眼主类只有 4 条，逐字冻结（不是「剩下的都是人眼」）', () => {
  assert.deepEqual(by('human_eye'), ['B-10', 'B-12', 'B-32', 'B-34']);
  assert.ok(by('engineering').length >= 19, '工程项不得被改判成人眼');
  assert.ok(by('dev_stack').length >= 4);
});

test('非人眼类逐件在册：工程 / 实机栈 / 凭据 / 用户裁决 / 已完成', () => {
  assert.deepEqual(by('credential'), ['B-02']);
  assert.deepEqual(by('user_decision'), ['B-05']);
  assert.deepEqual(by('dev_stack'), ['B-07', 'B-09', 'B-14', 'B-22']);
  assert.deepEqual(by('none'), ['B-01', 'B-15', 'B-19', 'B-27', 'B-28']);
  assert.equal(by('engineering').length, 19);
});

test('附加条件单列：3 条末步需人眼、1 条附加需凭据，不重复计入主类', () => {
  const eye = ledger.gaps.filter((g) => g.alsoRequires.includes('human_eye')).map((g) => g.id);
  assert.deepEqual(eye, ['B-07', 'B-11', 'B-14']);
  const cred = ledger.gaps.filter((g) => g.alsoRequires.includes('credential')).map((g) => g.id);
  assert.deepEqual(cred, ['B-34']);
  assert.equal(ledger.blockerCounts.human_eye + eye.length, 7, '需人参与合计 7 条');
  const also = {};
  for (const g of ledger.gaps) for (const a of g.alsoRequires) also[a] = (also[a] || 0) + 1;
  assert.deepEqual(also, ledger.blockerAlsoRequires);
});

test('B-34 的 8 项人眼是任务产物质量判据，且依赖凭据（不冒充 UI 观感验收）', () => {
  const b34 = ledger.gaps.find((g) => g.id === 'B-34');
  assert.equal(b34.blocker, 'human_eye');
  assert.ok(b34.alsoRequires.includes('credential'));
  const results = JSON.parse(fs.readFileSync(
    path.join(ROOT, 'acceptance/block-356/results-v2final.json'), 'utf8',
  ));
  assert.equal(results.tasks.length, 8);
  assert.ok(results.tasks.every((t) => t.pendingHumanJudgment), '8 项判据仍待人工填写');
  assert.ok(results.tasks.every((t) => t.pendingHumanJudgment.toolSelectJudge && t.pendingHumanJudgment.artifactJudge),
    '判据形态是 toolSelectJudge/artifactJudge（任务产物质量），不是 UI 观感');
});

test('负测：把工程项误标人眼 / 删人眼条目 / 计数漂移都要红', () => {
  const mutated = JSON.parse(JSON.stringify(ledger));
  const g = mutated.gaps.find((x) => x.id === 'B-16');
  g.blocker = 'human_eye';
  assert.notDeepEqual((() => { const c = {}; for (const x of mutated.gaps) c[x.blocker] = (c[x.blocker] || 0) + 1; return c; })(), mutated.blockerCounts);
  const dropped = JSON.parse(JSON.stringify(ledger));
  dropped.gaps = dropped.gaps.filter((x) => x.id !== 'B-12');
  assert.equal(dropped.gaps.length, 33);
  assert.notDeepEqual((() => { const c = {}; for (const x of dropped.gaps) c[x.blocker] = (c[x.blocker] || 0) + 1; return c; })(), dropped.blockerCounts);
});
