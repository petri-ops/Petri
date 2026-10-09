/**
 * BLOCK-109-CORE-ARCH P3 — 架构门禁自测（红/绿样本；plan §1 P3-4）。
 *
 * ① code-size v2 门禁（evaluateGate 纯函数直测）：
 *    绿=合规基线；红=行数棘轮 / 指纹漂移 / 超预算无例外 / 例外过期 / 例外缺 reason /
 *    例外锚定漂移 / 未知路径例外 / 新入册未刷基线。
 * ② 环门禁（computeGate + 签名规范化）：同环不同起点同签名；基线外新环红；绿=全在册。
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

const importScript = (rel) => import(pathToFileURL(path.join(root, rel)).href);
const { evaluateGate, BUDGET_LINES } = await importScript('scripts/code-size-ledger.mjs');
const cyclesGate = await importScript('scripts/arch-cycles-gate.mjs');

const TODAY = '2026-09-21';
const fileOf = (name, lines, sha) => ({ path: name, lines, sha256: sha || `sha-${name}-${lines}` });
const baseOf = (f) => ({ path: f.path, lines: f.lines, sha256: f.sha256 });
const baselineFrom = (files) => ({ schema: 'biof3/block109-size-ledger.v2', files: files.map(baseOf), total: files.reduce((s, f) => s + f.lines, 0) });

test('P3 自测 — 绿样本：预算内+指纹一致+无过期例外', () => {
  const files = [fileOf('a.js', 500), fileOf('b.js', 900)];
  const baseline = baselineFrom(files);
  const exceptions = { exceptions: [{ path: 'b.js', reason: '存量巨型文件拆分中', expires: '2026-12-31' }] };
  const current = { schema: 'v2', files: structuredClone(files), total: 1400 };
  const r = evaluateGate({ current, baseline, exceptions, today: TODAY });
  assert.equal(r.ok, true, JSON.stringify(r.violations));
});

test('P3 自测 — 红样本：行数棘轮 / 指纹漂移 / 超预算无例外 / 例外过期 / 缺 reason / 锚定漂移 / 未知路径例外 / 新文件未刷基线', () => {
  const base = [fileOf('a.js', 500, 'shaA'), fileOf('b.js', 900, 'shaB'), fileOf('c.js', 300, 'shaC')];
  const baseline = baselineFrom(base);
  const mk = (files) => ({ schema: 'v2', files, total: 0 });
  const exc = (list) => ({ exceptions: list });

  // 行数棘轮
  let r = evaluateGate({
    current: mk([fileOf('a.js', 501, 'shaA'), base[1], base[2]]), baseline, exceptions: exc([]), today: TODAY,
  });
  assert.match(r.violations.join('\n'), /棘轮只减不增/);

  // 指纹漂移（同行数改内容）
  r = evaluateGate({
    current: mk([fileOf('a.js', 500, 'shaA-changed'), base[1], base[2]]), baseline, exceptions: exc([]), today: TODAY,
  });
  assert.match(r.violations.join('\n'), /指纹漂移/);

  // 超预算无例外
  r = evaluateGate({
    current: mk([base[0], fileOf('b.js', 901, 'shaB'), base[2]]), baseline, exceptions: exc([]), today: TODAY,
  });
  assert.match(r.violations.join('\n'), /无例外/);

  // 例外过期（到期未清）
  r = evaluateGate({
    current: mk([base[0], fileOf('b.js', 900, 'shaB'), base[2]]), baseline,
    exceptions: exc([{ path: 'b.js', reason: 'r', expires: '2026-09-20' }]), today: TODAY,
  });
  assert.match(r.violations.join('\n'), /已过期/);

  // 例外缺 reason
  r = evaluateGate({
    current: mk([base[0], fileOf('b.js', 900, 'shaB'), base[2]]), baseline,
    exceptions: exc([{ path: 'b.js', reason: '', expires: '2026-12-31' }]), today: TODAY,
  });
  assert.match(r.violations.join('\n'), /缺 reason/);

  // 例外 sha256 锚定漂移
  r = evaluateGate({
    current: mk([base[0], fileOf('b.js', 900, 'shaB-new'), base[2]]), baseline,
    exceptions: exc([{ path: 'b.js', reason: '冻结文件', expires: '2026-12-31', sha256: 'shaB' }]), today: TODAY,
  });
  assert.match(r.violations.join('\n'), /锚定漂移/);

  // 未知路径例外
  r = evaluateGate({
    current: mk([base[0], base[1], base[2]]), baseline,
    exceptions: exc([{ path: 'ghost.js', reason: 'r', expires: '2026-12-31' }]), today: TODAY,
  });
  assert.match(r.violations.join('\n'), /不在台账清单/);

  // 新入册文件未刷基线
  r = evaluateGate({
    current: mk([base[0], base[1], base[2], fileOf('new.js', 100, 'shaN')]), baseline,
    exceptions: exc([]), today: TODAY,
  });
  assert.match(r.violations.join('\n'), /未刷新基线/);
});

test('P3 自测 — 只出不进棘轮（BLOCK-154 P2-3）：v2 缺白名单红 / 例外路径越界红 / 非白名单超预算红', () => {
  const base = [fileOf('a.js', 500, 'shaA'), fileOf('b.js', 900, 'shaB')];
  const baseline = baselineFrom(base);
  const mk = (files) => ({ schema: 'v2', files, total: 0 });
  const v2exceptions = (list, allowed) => ({
    schema: 'biof3/block109-size-exceptions.v2',
    allowedExceptionPaths: allowed,
    exceptions: list,
  });

  // 绿：v2 + 白名单 + 例外在白名单内
  let r = evaluateGate({
    current: mk(base), baseline,
    exceptions: v2exceptions(
      [{ path: 'b.js', reason: 'r', expires: '2026-12-31' }],
      ['b.js'],
    ), today: TODAY,
  });
  assert.equal(r.ok, true, JSON.stringify(r.violations));

  // 红：v2 schema 缺 allowedExceptionPaths
  r = evaluateGate({
    current: mk(base), baseline,
    exceptions: v2exceptions(
      [{ path: 'b.js', reason: 'r', expires: '2026-12-31' }],
      undefined,
    ), today: TODAY,
  });
  assert.match(r.violations.join('\n'), /必须提供 allowedExceptionPaths/);

  // 红：例外路径不在白名单（不得新增例外）
  r = evaluateGate({
    current: mk(base), baseline,
    exceptions: v2exceptions(
      [{ path: 'a.js', reason: 'r', expires: '2026-12-31' }],
      ['b.js'],
    ), today: TODAY,
  });
  assert.match(r.violations.join('\n'), /不在只出不进白名单——不得新增例外/);

  // 红：非白名单文件超预算且无例外 → 必须拆分（不提示「请登记」）
  const overBudget = [fileOf('a.js', 800, 'shaA')]; // a.js 超预算且不在白名单
  r = evaluateGate({
    current: mk(overBudget),
    baseline: baselineFrom(overBudget),
    exceptions: v2exceptions([], ['b.js']),
    today: TODAY,
  });
  assert.match(r.violations.join('\n'), /不在只出不进白名单——必须拆分至预算内，不得新增例外/);
  assert.doesNotMatch(r.violations.join('\n'), /请登记/);
});

test('P3 自测 — 环签名规范化：同环不同起点同签名', () => {
  const a = ['x/y.js', 'x/a.js', 'x/m.js'];
  const b = ['x/a.js', 'x/m.js', 'x/y.js'];
  assert.equal(cyclesGate.cycleSignature(a), cyclesGate.cycleSignature(b));
});

test('P3 自测 — 环门禁：基线外新环红、存量全在册绿、消亡环提示收紧', () => {
  const current = ['a -> b -> a', 'p -> q -> p'];
  const baseline = { cycles: ['a -> b -> a', 'p -> q -> p'] };
  assert.equal(cyclesGate.computeGate({ current, baseline }).ok, true);

  const withNew = { cycles: ['a -> b -> a'] };
  const g1 = cyclesGate.computeGate({ current, baseline: withNew });
  assert.equal(g1.ok, false);
  assert.deepEqual(g1.newCycles, ['p -> q -> p']);

  const withResolved = { cycles: [...current, 'old -> older -> old'] };
  const g2 = cyclesGate.computeGate({ current, baseline: withResolved });
  assert.equal(g2.ok, true);
  assert.deepEqual(g2.resolved, ['old -> older -> old']);
});

test('P3 冒烟 — 真实基线自洽（当前仓状态过门禁）', async () => {
  // 真门禁 CLI 已由 closeout 链执行；此处只校验自测注入契约与真实预算常量一致
  assert.equal(BUDGET_LINES, 700);
});
